-- Staff activity: what every staff account (organisers, the desks, the judge, the crisis desk, fairness, the
-- projector) did, when and to what, for the organisers' Activity page.
--
-- What was already recorded: public.audit_log has the actor's user id (actor_user_id), role and team, the action,
-- the table and row id and the row before and after, written by the audit trigger on every game table (teams,
-- members, events, phases, deadlines, rounds, scores, appeals, corrections, bulletins, problem and crisis cards, ...)
-- and by app.reject for refused calls. So desk check-in and check-out, the phase controls, pause, resume, extend,
-- the switches, the lottery, releases, appeals, corrections, bulletins and the decks were all logged already.
--
-- What this adds:
--   * audit_log.actor_user_id defaults to auth.uid(), so the inserts that leave it out (reset_event) record the caller.
--   * audit_log.xact (the transaction id), so one action that touches many rows reads as one line.
--   * an index for the newest staff rows of an event.
--   * audit rows for the staff tables that had none: roster (import and edit), problem_statements (Round 3
--     statements), event_log (the run-the-event log lines: phase, crisis, control), draw_records (the lottery) and
--     one row per start or re-run of judging (judge_runs, by staff only; the worker's own writes are not logged).
--     These loggers never block the action: any error in them is swallowed.
--   * public.staff_activity (organisers only) and public.staff_accounts (organisers only).
--
-- Adding the column and the defaults rewrites nothing (the defaults are set after the column is added).

alter table public.audit_log add column if not exists xact bigint;
alter table public.audit_log alter column xact set default txid_current();
alter table public.audit_log alter column actor_user_id set default auth.uid();

create index if not exists audit_log_staff_idx on public.audit_log (event_id, at desc)
  where actor_user_id is not null and actor_team_id is null;

-- ───────────────────────────── Loggers that never block ─────────────────────────────

create or replace function app.audit_row_safe()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_role text;
  v_team uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if current_setting('app.allow_purge', true) = 'on' then
    return null;
  end if;
  begin
    if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
    if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
    if tg_op = 'UPDATE' and v_before = v_after then
      return null;
    end if;
    select a.user_id, a.role, a.team_id into v_user, v_role, v_team from app.audit_actor() a;
    insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, before, after)
    values (
      coalesce(v_after ->> 'event_id', v_before ->> 'event_id')::uuid,
      v_user, v_role, v_team,
      lower(tg_op), tg_table_name,
      coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'event_id', v_before ->> 'event_id'),
      v_before, v_after);
  exception when others then
    null;
  end;
  return null;
end
$$;

-- Judging is started and re-run by staff in batches of many runs; the worker then updates each run. One audit row
-- per staff statement (how many runs, of which types), nothing for the worker.
create or replace function app.audit_judge_runs()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_role text;
  v_team uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  begin
    select a.user_id, a.role, a.team_id into v_user, v_role, v_team from app.audit_actor() a;
    insert into public.audit_log (event_id, actor_user_id, actor_role, actor_team_id, action, entity, entity_id, after)
    select n.event_id, v_user, v_role, v_team, 'insert', 'judge_runs', null,
           jsonb_build_object('runs', count(*), 'types', jsonb_agg(distinct n.type))
      from new_runs n group by n.event_id;
  exception when others then
    null;
  end;
  return null;
end
$$;

drop trigger if exists audit on public.roster;
create trigger audit after insert or update or delete on public.roster for each row execute function app.audit_row_safe();
drop trigger if exists audit on public.problem_statements;
create trigger audit after insert or update or delete on public.problem_statements for each row execute function app.audit_row_safe();
drop trigger if exists audit on public.event_log;
create trigger audit after insert on public.event_log for each row execute function app.audit_row_safe();
drop trigger if exists audit on public.draw_records;
create trigger audit after insert or update or delete on public.draw_records for each row execute function app.audit_row_safe();
drop trigger if exists audit_staff on public.judge_runs;
create trigger audit_staff after insert on public.judge_runs referencing new table as new_runs
  for each statement execute function app.audit_judge_runs();

-- ───────────────────────────── Reading it ─────────────────────────────

-- What changed between two versions of a row: {column: {from, to}} for an update, {column: {to}} for an insert,
-- {column: {from}} for a delete; ids and timestamps of the row itself left out, long values cut short.
create or replace function app.audit_changes(p_before jsonb, p_after jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  with keys as (
    select k from jsonb_object_keys(coalesce(p_after, '{}'::jsonb) || coalesce(p_before, '{}'::jsonb)) k
     where k not in ('id', 'event_id', 'created_at', 'updated_at')
  ), vals as (
    select k, p_before -> k as b, p_after -> k as a from keys
  ), cut as (
    select k,
           case when b is not null and length(b::text) > 160 then to_jsonb(left(b::text, 160) || '…') else b end as b,
           case when a is not null and length(a::text) > 160 then to_jsonb(left(a::text, 160) || '…') else a end as a,
           p_before is not null and p_after is not null as upd
      from vals
     where p_before is null or p_after is null or b is distinct from a
  )
  select coalesce(jsonb_object_agg(k, case
           when upd then jsonb_build_object('from', b, 'to', a)
           when p_before is null then jsonb_build_object('to', a)
           else jsonb_build_object('from', b) end), '{}'::jsonb)
    from cut
   where upd or (p_before is null and a is not null and a <> 'null'::jsonb) or (p_after is null and b is not null and b <> 'null'::jsonb)
$$;

-- Every staff account (not the team logins): user id, email, name and role.
create or replace function public.staff_accounts()
returns table (user_id uuid, email text, display_name text, role text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.require_organiser();
  return query
    select a.user_id, u.email::text, a.display_name, a.role::text
      from public.accounts a left join auth.users u on u.id = a.user_id
     where a.role <> 'TEAM'
     order by a.role::text, u.email;
end
$$;

-- The newest staff actions of an event (organisers only), one line per action: the rows one call wrote to one table
-- are one line (rows = how many). Paged: p_before is the `at` of the last line already shown.
create or replace function public.staff_activity(p_event uuid, p_actor uuid default null, p_limit integer default 500,
                                                 p_before timestamptz default null)
returns table (id bigint, at timestamptz, actor_id uuid, actor_email text, actor_name text, actor_role text,
               action text, entity text, entity_id text, entity_label text, rows integer, changes jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
begin
  perform app.require_organiser();
  return query
  with raw as (
    select l.id, l.at, l.actor_user_id, l.action, l.entity, l.entity_id, l.before, l.after,
           coalesce(l.xact, -l.id) as g
      from public.audit_log l
     where l.event_id = p_event
       and l.actor_user_id is not null and l.actor_team_id is null
       and (p_actor is null or l.actor_user_id = p_actor)
       and (p_before is null or l.at < p_before)
     order by l.at desc
     limit v_limit * 20
  ), grp as (
    select distinct on (r.g, r.entity, r.action) r.*,
           count(*) over w as n, max(r.at) over w as last_at
      from raw r
    window w as (partition by r.g, r.entity, r.action)
     order by r.g, r.entity, r.action, r.id
  )
  select g.id, g.last_at, g.actor_user_id, u.email::text, a.display_name, a.role::text,
         g.action, g.entity, g.entity_id,
         coalesce(
           (select t.code || ' · ' || t.name from public.teams t
             where t.id = coalesce(
               case when g.entity = 'teams' then g.entity_id end,
               coalesce(g.after, g.before) ->> 'team_id')::uuid),
           nullif(concat_ws(' · ',
             coalesce(g.after, g.before) ->> 'code',
             coalesce(g.after, g.before) ->> 'ticker',
             coalesce(g.after, g.before) ->> 'number',
             coalesce(coalesce(g.after, g.before) ->> 'team_name', coalesce(g.after, g.before) ->> 'title',
                      coalesce(g.after, g.before) ->> 'name', coalesce(g.after, g.before) ->> 'label',
                      coalesce(g.after, g.before) ->> 'full_name', coalesce(g.after, g.before) ->> 'phase',
                      coalesce(g.after, g.before) ->> 'kind')), '')),
         g.n::integer,
         case when g.entity = 'event_log' then jsonb_build_object('what', g.after -> 'what', 'kind', g.after -> 'kind')
              else app.audit_changes(g.before, g.after) end
    from grp g
    join public.accounts a on a.user_id = g.actor_user_id and a.role <> 'TEAM'
    left join auth.users u on u.id = g.actor_user_id
   order by g.last_at desc, g.id desc
   limit v_limit;
end
$$;

revoke all on function app.audit_row_safe(), app.audit_judge_runs(), app.audit_changes(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.staff_activity(uuid, uuid, integer, timestamptz), public.staff_accounts()
  from public, anon, authenticated;
grant execute on function public.staff_activity(uuid, uuid, integer, timestamptz), public.staff_accounts()
  to authenticated, service_role;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270105000100'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
