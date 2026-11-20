-- Migration 082 (20 Nov): the Round 1 practice market is for learning only, and it lists one simulated company per
-- Finance team the registration desk verified.
--
-- 1. No prize. The organisers: "this isn't connected to the actual rubrics but just made for their learning". The top
--    funds were paid $50,000 each into their real cash at the close (058); now nothing moves into the real game. The
--    ranking stays, for the teams' own interest, and the closing bulletin says so.
-- 2. The companies: one per Finance team that entered the squad draw (checked in by the desk), not one per seated
--    fund. E.g. 167 Finance teams verified, 67 drawn into squads: the 67 seated funds trade among 167 companies. The
--    draw clears the left-out teams' check-in, so the count comes from the draw's record of entrants; before the draw
--    (or with the draw switch off) it is the checked-in Finance teams, as before.

create or replace function app.practice_prize() returns bigint language sql immutable as $$ select 0::bigint $$;
revoke all on function app.practice_prize() from public, anon, authenticated;

select app.patch_one_function('app.settle_practice(uuid)'::regprocedure,
  $f$'The practice market is closed. The top ' || app.practice_winners() || ' funds each win $50,000 in real cash for the IPO: ' || w.names || '.'$f$,
  $t$'The practice market is closed. It was practice only: nothing from it carries into the real game. Top funds: ' || w.names || '.'$t$);
select app.patch_one_function('app.settle_practice(uuid)'::regprocedure,
  $f$'The practice market is closed. No fund traded, so no prize was won.'$f$,
  $t$'The practice market is closed. No fund traded.'$t$);

select app.patch_one_function('app.practice_companies(uuid)'::regprocedure,
  $f$  with funds as (
    select count(*)::int as n
      from public.teams t join public.events e on e.id = t.event_id
     where t.event_id = p_event and t.track = 'FINANCE' and app.team_admitted(t.id)
       and (e.drawn_at is null or exists (select 1 from public.squads s where s.finance_team_id = t.id))
  ), slots as ($f$,
  $t$  with funds as (
    select greatest(
             (select count(*)::int
                from public.teams t join public.events e on e.id = t.event_id
               where t.event_id = p_event and t.track = 'FINANCE' and app.team_admitted(t.id)
                 and (e.drawn_at is null or exists (select 1 from public.squads s where s.finance_team_id = t.id))),
             coalesce((select jsonb_array_length(d.entrants -> 'finance') from public.draw_records d where d.event_id = p_event), 0)
           ) as n
  ), slots as ($t$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261218000082'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
