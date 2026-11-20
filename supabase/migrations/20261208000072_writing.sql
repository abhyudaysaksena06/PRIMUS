-- Writing tonight (W10, W11): Submit only in the last 5 minutes, a fairness note when a draft grows too fast to have
-- been typed, and the theme of a crisis for the reveal pop-up.
--
-- Every new behaviour has its switch (migration 070); a switch that is off leaves the game exactly as it was.
--
-- 1. submit_last_5 (off by default): submit_submission and submit_for refuse with SUBMIT_NOT_YET until 5 minutes
--    before the writing deadline: the PRD and the crisis memo at PITCH, a crisis plan or an advice memo at DUE_k, the
--    Round 3 solution and its memos at DUE_5 (app.submission_deadline). Saving is never limited, and the automatic
--    submission at the deadline (app.auto_submit_due_drafts, 054) inserts directly, so it is unaffected.
-- 2. paste_flag (on by default): save_draft and save_draft_for note a save that adds more than 120 words within
--    10 seconds of the previous save (nobody types 720 words a minute). The note goes to its own table,
--    public.writing_flags, readable by the fairness officer only. Not to public.flags: app.generate_flags (013) skips
--    the whole collusion check when any flag exists, and an open flag holds the APPEALS phase, so a paste note there
--    would silently cancel the collusion flags. The save always goes ahead.
-- 3. public.crisis_category: the category every company shares in crisis k (the sector deck deals each sector's card
--    k: 1 Operations, 2 Market, 3 Trust, 4 Money), once revealed. Only the category: the cards stay sealed until
--    hiring closes (063).

-- ───────────────────────────── 1. Submit opens in the last 5 minutes ─────────────────────────────

-- When Submit opens for this type: 5 minutes before its writing deadline. Null when the switch is off or the type
-- has no deadline: Submit is open for the whole window, as before.
create or replace function app.submit_opens_at(p_event uuid, p_type public.submission_type)
returns timestamptz
language sql stable
as $$
  select app.deadline(p_event, app.submission_deadline(p_type)) - interval '5 minutes'
   where app.feature_on(p_event, 'submit_last_5')
$$;
revoke all on function app.submit_opens_at(uuid, public.submission_type) from public, anon, authenticated;

-- Is it too early to submit? The clock stands still while the event is paused, as every deadline does (a deadline
-- after the pause began moves later on resume).
create or replace function app.submit_too_early(p_event uuid, p_type public.submission_type)
returns boolean
language sql stable
as $$
  select coalesce(app.submit_opens_at(p_event, p_type)
                  > coalesce((select e.paused_at from public.events e where e.id = p_event and e.paused), now()), false)
$$;
revoke all on function app.submit_too_early(uuid, public.submission_type) from public, anon, authenticated;

-- The refusal, logged like every other: "Submit opens at 21:55 (the last 5 minutes)." in the event's time zone.
create or replace function app.submit_refusal(p_event uuid, p_type public.submission_type)
returns jsonb
language plpgsql
as $$
declare
  v_opens timestamptz := app.submit_opens_at(p_event, p_type);
  v_zone text := coalesce((select e.timezone from public.events e where e.id = p_event), 'Asia/Kolkata');
begin
  return app.reject(p_event, 'submit', 'SUBMIT_NOT_YET',
                    format('Submit opens at %s (the last 5 minutes).', to_char(v_opens at time zone v_zone, 'HH24:MI')),
                    jsonb_build_object('type', p_type, 'opens_at', v_opens));
end
$$;
revoke all on function app.submit_refusal(uuid, public.submission_type) from public, anon, authenticated;

-- The squad's own submission: after the deadline check, before anything is stored.
select app.patch_functions(
$o$  -- Submitting the same text again changes nothing and stores nothing.
$o$,
$n$  -- Submit opens only in the last 5 minutes before the deadline (switch submit_last_5, migration 072).
  if app.submit_too_early(v_team.event_id, p_type) then
    return app.submit_refusal(v_team.event_id, p_type);
  end if;
  -- Submitting the same text again changes nothing and stores nothing.
$n$);

-- A hired firm's submission for its client (the advice memo; the Round 3 solution with the client).
select app.patch_functions(
$o$  if not app.subround_open(v_team.event_id, app.subround_of(p_type)) then
    return app.reject(v_team.event_id, 'submit', 'DEADLINE_PASSED', 'The deadline has passed; this submission was not accepted.',
                      jsonb_build_object('type', p_type, 'at', now()));
  end if;
$o$,
$n$  if not app.subround_open(v_team.event_id, app.subround_of(p_type)) then
    return app.reject(v_team.event_id, 'submit', 'DEADLINE_PASSED', 'The deadline has passed; this submission was not accepted.',
                      jsonb_build_object('type', p_type, 'at', now()));
  end if;
  -- Submit opens only in the last 5 minutes before the deadline (switch submit_last_5, migration 072).
  if app.submit_too_early(v_team.event_id, p_type) then
    return app.submit_refusal(v_team.event_id, p_type);
  end if;
$n$);

-- ───────────────────────────── 2. A draft that grew too fast ─────────────────────────────

create table if not exists public.writing_flags (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The team whose save it was (a firm saving its client's advice memo or solution is named, not the client).
  team_id uuid not null references public.teams (id) on delete cascade,
  type public.submission_type not null,
  -- The version this save made, the words before and after it, and the seconds since the save before it.
  version integer not null,
  words_before integer not null,
  words_after integer not null,
  seconds numeric(6, 1) not null,
  created_at timestamptz not null default now()
);
create index if not exists writing_flags_event_idx on public.writing_flags (event_id, created_at);
alter table public.writing_flags enable row level security;
drop policy if exists writing_flags_read on public.writing_flags;
create policy writing_flags_read on public.writing_flags for select to authenticated using ((select app.is_fairness()));
grant select on public.writing_flags to authenticated;

-- Notes a save that adds more than 120 words within 10 seconds of the previous save (switch paste_flag). A first save
-- (version 0 before it) has no previous save and is never noted. Never stops the save: any error here is dropped.
create or replace function app.flag_fast_draft(p_team public.teams, p_draft public.submission_drafts,
                                               p_type public.submission_type, p_content jsonb)
returns void
language plpgsql
as $$
declare
  v_seconds numeric;
  v_before int;
  v_after int;
begin
  if p_draft.id is null or p_draft.version < 1 or not app.feature_on(p_team.event_id, 'paste_flag') then
    return;
  end if;
  v_seconds := extract(epoch from now() - p_draft.updated_at);
  if v_seconds >= 10 then
    return;
  end if;
  begin
    v_before := app.submission_words(p_type, coalesce(p_draft.content, '{}'::jsonb));
    v_after := app.submission_words(p_type, coalesce(p_content, '{}'::jsonb));
    if v_after - v_before > 120 then
      insert into public.writing_flags (event_id, company_id, team_id, type, version, words_before, words_after, seconds)
      values (p_team.event_id, p_draft.company_id, p_team.id, p_type, p_draft.version + 1, v_before, v_after,
              round(greatest(v_seconds, 0), 1));
    end if;
  exception when others then
    -- A note for the fairness officer must never cost a team its save.
    null;
  end;
end
$$;
revoke all on function app.flag_fast_draft(public.teams, public.submission_drafts, public.submission_type, jsonb)
  from public, anon, authenticated;

select app.patch_functions(
$o$    return app.fail('VERSION_CONFLICT', 'Someone else in your squad saved a newer version.',
                    jsonb_build_object('draft', to_jsonb(v_draft)));
  end if;
$o$,
$n$    return app.fail('VERSION_CONFLICT', 'Someone else in your squad saved a newer version.',
                    jsonb_build_object('draft', to_jsonb(v_draft)));
  end if;
  -- A save that adds over 120 words within 10 s of the last one is noted for the fairness officer (072).
  perform app.flag_fast_draft(v_team, v_draft, p_type, p_content);
$n$);

select app.patch_functions(
$o$    return app.fail('VERSION_CONFLICT', 'Someone else saved a newer version.', jsonb_build_object('draft', to_jsonb(v_draft)));
  end if;
$o$,
$n$    return app.fail('VERSION_CONFLICT', 'Someone else saved a newer version.', jsonb_build_object('draft', to_jsonb(v_draft)));
  end if;
  -- A save that adds over 120 words within 10 s of the last one is noted for the fairness officer (072).
  perform app.flag_fast_draft(v_team, v_draft, p_type, p_content);
$n$);

-- ───────────────────────────── 3. The theme of a crisis ─────────────────────────────

-- The category every company shares in crisis k, once it is revealed (the reveal pop-up: "Crisis 2 of 4: Market");
-- null when the companies' cards differ in category, before the reveal, and for anyone outside the event. The cards
-- themselves stay sealed until hiring closes.
create or replace function public.crisis_category(p_event uuid, p_k int)
returns text
language sql stable security definer set search_path = ''
as $$
  select case when count(distinct cc.category) = 1 then min(cc.category) end
    from public.subround_crises x
    join public.crisis_cards cc on cc.id = x.crisis_card_id
   where x.event_id = p_event and x.k = p_k
     and (p_event = app.my_event_id() or app.is_staff() or app.sees_all_events())
     and exists (select 1 from public.subrounds s where s.event_id = p_event and s.k = p_k and s.revealed_at is not null)
$$;
revoke all on function public.crisis_category(uuid, int) from public, anon;
grant execute on function public.crisis_category(uuid, int) to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261208000072'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
