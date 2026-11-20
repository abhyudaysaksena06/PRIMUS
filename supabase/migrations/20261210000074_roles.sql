-- Staff roles for the 20 Nov night: each volunteer gets a login that opens only their own desk.
--
--   ORGANISER     everything (unchanged)
--   FAIRNESS      flags and appeals, reads everything (unchanged)
--   DISPLAY       the projector (unchanged)
--   REGISTRATION  the registration desk: roster, check-in and check-out, the desk and registration switches
--   JUDGE         judging operations: start, retry, seal missing scores, the model slot, re-runs, calibration
--   CRISIS        the content decks: problem cards, crisis cards, Round 3 statements
--
-- Release scores, pause and resume, the schedule, resets, corrections and the switches stay organiser-only.
--
-- public.account_role is an enum. ALTER TYPE ... ADD VALUE is allowed inside a transaction (PostgreSQL 12+), but a
-- new value cannot be USED (cast to the enum, in a query, a policy or a SQL function body) until that transaction
-- commits, and the catch-up file runs every migration in one transaction. So nothing in this migration casts the new
-- names: every check compares the role as text (a.role::text). The values are ordinary from the next transaction
-- on, which is when pnpm staff-sql creates the accounts that use them.

alter type public.account_role add value if not exists 'REGISTRATION';
alter type public.account_role add value if not exists 'JUDGE';
alter type public.account_role add value if not exists 'CRISIS';

-- ───────────────────────────── Helpers ─────────────────────────────

-- Rewrites ONE named function, replacing a text that must occur exactly once in its definition (grants, owner and
-- settings are kept by CREATE OR REPLACE). Unlike app.patch_functions it cannot touch any other function that
-- happens to contain the same line (perform app.require_organiser(); is in dozens).
create or replace function app.patch_one_function(p_fn regprocedure, p_from text, p_to text)
returns void
language plpgsql
as $$
declare
  d text := pg_get_functiondef(p_fn);
  n int := (length(d) - length(replace(d, p_from, ''))) / greatest(length(p_from), 1);
begin
  if n <> 1 then
    raise exception 'patch_one_function: % contains "%" % times, expected once', p_fn, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$$;
revoke all on function app.patch_one_function(regprocedure, text, text) from public, anon, authenticated;

-- Is the caller signed in with one of these roles? (text comparison: see the header)
create or replace function app.has_role(variadic p_roles text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select a.role::text = any(p_roles) from public.accounts a where a.user_id = auth.uid()), false)
$$;
revoke all on function app.has_role(text[]) from public, anon;
-- Row-level security policies call it as the querying role.
grant execute on function app.has_role(text[]) to authenticated, service_role;

-- Any staff login (the control panel's realtime staff channel carries only "something changed" signals).
create or replace function app.is_any_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role('ORGANISER', 'FAIRNESS', 'REGISTRATION', 'JUDGE', 'CRISIS')
$$;
revoke all on function app.is_any_staff() from public, anon, authenticated;

-- The new roles see every event's public data, exactly what the projector sees (events, phases, the clock, released
-- scores, published news). Private data stays is_staff() (organisers and the fairness officer) plus the narrow
-- read policies below for each desk.
create or replace function app.sees_all_events()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role('ORGANISER', 'FAIRNESS', 'DISPLAY', 'REGISTRATION', 'JUDGE', 'CRISIS')
$$;

create or replace function app.require_desk()
returns void
language plpgsql stable
as $$
begin
  if not (app.has_role('ORGANISER', 'REGISTRATION') or app.is_system()) then
    raise exception 'only an organiser or the registration desk can do this' using errcode = '42501';
  end if;
end
$$;
revoke all on function app.require_desk() from public, anon, authenticated;

create or replace function app.require_judge_ops()
returns void
language plpgsql stable
as $$
begin
  if not (app.has_role('ORGANISER', 'JUDGE') or app.is_system()) then
    raise exception 'only an organiser or the judging desk can do this' using errcode = '42501';
  end if;
end
$$;
revoke all on function app.require_judge_ops() from public, anon, authenticated;

create or replace function app.require_crisis()
returns void
language plpgsql stable
as $$
begin
  if not (app.has_role('ORGANISER', 'CRISIS') or app.is_system()) then
    raise exception 'only an organiser or the crisis desk can do this' using errcode = '42501';
  end if;
end
$$;
revoke all on function app.require_crisis() from public, anon, authenticated;

-- ───────────────────────────── Permission lines ─────────────────────────────
-- Only the permission line of each function changes; the rest of its body is kept exactly as it is now.

-- The registration desk.
select app.patch_one_function(f::regprocedure, 'perform app.require_organiser();', 'perform app.require_desk();')
  from unnest(array[
    'public.desk_check_in(uuid, public.track, text, text, jsonb, uuid, boolean, jsonb)',
    'public.desk_check_out(uuid, uuid)',
    'public.import_roster(uuid, jsonb, boolean)',
    'public.update_roster(uuid, text, public.track, jsonb, jsonb)',
    'public.set_desk_check_in(uuid, boolean)',
    'public.set_registration_open(uuid, boolean)'
  ]) f;

-- Judging operations (release_scores, apply_appeal and dismiss_appeal stay organiser-only).
select app.patch_one_function(f::regprocedure, 'perform app.require_organiser();', 'perform app.require_judge_ops();')
  from unnest(array[
    'public.start_judging(uuid, public.submission_type)',
    'public.retry_failed_runs(uuid, public.submission_type)',
    'public.seal_missing_scores(uuid, public.submission_type)',
    'public.start_calibration(uuid, jsonb)',
    'public.set_judge_model(uuid, text)',
    'public.rerun_judging(uuid, public.submission_type, text)'
  ]) f;

-- Content: the problem and crisis decks and the Round 3 statements (the classic flash bulletin stays organiser-only).
select app.patch_one_function(f::regprocedure, 'perform app.require_organiser();', 'perform app.require_crisis();')
  from unnest(array[
    'public.upload_problem_deck(uuid, jsonb)',
    'public.upload_crisis_deck(uuid, jsonb)',
    'public.set_problem_statements(uuid, jsonb)'
  ]) f;

-- Every staff console listens on the event's staff channel (signals only; the data is read through the policies).
select app.patch_one_function('app.can_hear(text)'::regprocedure,
  $o$(p_topic like 'staff:%' and app.is_staff() and exists ($o$,
  $n$(p_topic like 'staff:%' and app.is_any_staff() and exists ($n$);

-- ───────────────────────────── What each desk reads ─────────────────────────────
-- Permissive policies beside the existing ones (organisers and the fairness officer already read all of it).

-- Registration desk: every team (code, track, check-in) and the uploaded roster.
create policy teams_desk_read on public.teams for select to authenticated using ((select app.has_role('REGISTRATION', 'CRISIS')));
create policy roster_desk_read on public.roster for select to authenticated using ((select app.has_role('REGISTRATION')));

-- Judging desk: every company and squad number, the submissions, runs, scores (sealed too), appeals and calibration.
create policy companies_judge_read on public.companies for select to authenticated using ((select app.has_role('JUDGE')));
create policy squads_judge_read on public.squads for select to authenticated using ((select app.has_role('JUDGE')));
create policy submissions_judge_read on public.submissions for select to authenticated using ((select app.has_role('JUDGE')));
create policy judge_runs_judge_read on public.judge_runs for select to authenticated using ((select app.has_role('JUDGE')));
create policy scores_judge_read on public.scores for select to authenticated using ((select app.has_role('JUDGE')));
create policy appeals_judge_read on public.appeals for select to authenticated using ((select app.has_role('JUDGE')));
create policy calibration_samples_judge_read on public.calibration_samples for select to authenticated using ((select app.has_role('JUDGE')));
create policy calibration_runs_judge_read on public.calibration_runs for select to authenticated using ((select app.has_role('JUDGE')));

-- Crisis desk: the decks and statements before they are revealed (and the Product team count, above, for the room
-- the statements need).
create policy problem_cards_crisis_read on public.problem_cards for select to authenticated using ((select app.has_role('CRISIS')));
create policy crisis_cards_crisis_read on public.crisis_cards for select to authenticated using ((select app.has_role('CRISIS')));
create policy problem_statements_crisis_read on public.problem_statements for select to authenticated using ((select app.has_role('CRISIS')));

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261210000074'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
