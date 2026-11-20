-- Migration 083 (20 Nov): the practice market's prize is real again. The organisers: the top 3 funds each get
-- $50,000 of real cash, added when Round 1 closes, for Round 2 (the IPO and the trading rounds). Undoes the prize half
-- of 082; 082's other change (one simulated company per verified Finance team) stays.

create or replace function app.practice_prize() returns bigint language sql immutable as $$ select 5000000::bigint $$;
revoke all on function app.practice_prize() from public, anon, authenticated;

select app.patch_one_function('app.settle_practice(uuid)'::regprocedure,
  $f$'The practice market is closed. It was practice only: nothing from it carries into the real game. Top funds: ' || w.names || '.'$f$,
  $t$'The practice market is closed. The top ' || app.practice_winners() || ' funds each win $50,000 in real cash for the IPO: ' || w.names || '.'$t$);
select app.patch_one_function('app.settle_practice(uuid)'::regprocedure,
  $f$'The practice market is closed. No fund traded.'$f$,
  $t$'The practice market is closed. No fund traded, so no prize was won.'$t$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261219000083'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
