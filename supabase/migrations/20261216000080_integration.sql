-- Integration fixes found while merging tonight's changes (070-079).
--
-- 1. Settlement paid the classic "plan bonus" on a PRIMUS night: a PRIMUS company has no classic PLAN score, so every
--    squad's Consulting firm was charged a negative bonus. PRIMUS firms earn their bonuses per crisis (migration 033), so
--    the classic plan and deal bonuses are classic-only.
-- 2. The draw could not be checked on a PRIMUS night: only the classic crisis published the seed, so the lottery record
--    answered "not yet" all night. The seed also drives tonight's random hiring draw (071) and the Round 3 draft fallback
--    (077), so it stays secret until settlement and is published when the event reaches SETTLEMENT.
-- 3. The Round 3 "picks ahead of you" count counted every sector; with one queue per sector (077) it counts the team's own.
-- 4. Auto-submit checked each draft's deadline on every 2-second beat (about 2,800 drafts at 200 per track); it now checks
--    each type's deadline once.
-- 5. Backups kept per event: 60 (about 24 MB each at 200 teams per track; 200 would approach 5 GB).

-- 1
select app.patch_functions(
$o$    from public.squads s join public.companies c on c.squad_id = s.id where s.event_id = p_event
  union all
  select s.consulting_team_id, c.id, 'BONUS_DEAL'::public.ledger_kind, 500000, 'Deal bonus: signed by 02:45'
    from public.squads s join public.companies c on c.squad_id = s.id join public.deals d on d.squad_id = s.id
   where s.event_id = p_event and d.executed_at is not null$o$,
$n$    from public.squads s join public.companies c on c.squad_id = s.id where s.event_id = p_event
     and (select e.format from public.events e where e.id = p_event) <> 'PRIMUS'
  union all
  select s.consulting_team_id, c.id, 'BONUS_DEAL'::public.ledger_kind, 500000, 'Deal bonus: signed by 02:45'
    from public.squads s join public.companies c on c.squad_id = s.id join public.deals d on d.squad_id = s.id
   where s.event_id = p_event and d.executed_at is not null
     and (select e.format from public.events e where e.id = p_event) <> 'PRIMUS'$n$);

-- 2
create or replace function app.reveal_primus_seed()
returns trigger
language plpgsql
as $$
begin
  if new.format = 'PRIMUS' and new.seed_revealed is null and new.current_phase >= 'SETTLEMENT'
     and new.current_phase is distinct from old.current_phase then
    new.seed_revealed := (select s.seed from public.event_secrets s where s.event_id = new.id);
  end if;
  return new;
end
$$;
revoke all on function app.reveal_primus_seed() from public, anon, authenticated;
create trigger reveal_primus_seed before update of current_phase on public.events
  for each row execute function app.reveal_primus_seed();

-- 3
select app.patch_functions(
$o$and d.statement_id is null and d.pick_no < v_mine.pick_no)) end);$o$,
$n$and d.statement_id is null and d.pick_no < v_mine.pick_no and d.sector is not distinct from v_mine.sector)) end);$n$);

-- 4
select app.patch_functions(
$o$       and app.scoring_closed(p_event, dr.type)
       and not exists (select 1 from public.submissions s where s.company_id = dr.company_id and s.type = dr.type)$o$,
$n$       and dr.type in (select t from unnest(enum_range(null::public.submission_type)) t where app.scoring_closed(p_event, t))
       and not exists (select 1 from public.submissions s where s.company_id = dr.company_id and s.type = dr.type)$n$);

-- 6. Migration 077 rewrote set_problem_statements from its older body, dropping 074's crisis-desk permission: put it back.
select app.patch_one_function('public.set_problem_statements(uuid, jsonb)'::regprocedure,
  'perform app.require_organiser();', 'perform app.require_crisis();');

-- 5
create or replace function app.snapshot_keep() returns int language sql immutable as $$ select 60 $$;
revoke all on function app.snapshot_keep() from public, anon, authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261216000080'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
