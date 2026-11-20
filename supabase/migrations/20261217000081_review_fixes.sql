-- Fixes from the deep review of tonight's build (20 Nov).
--
-- F7 (trading audit): a score release was refused only while app.open_round found an open round, which misses a round
-- past its close that the heartbeat has not cleared yet (up to ~2 s). The plan release falls due as round 5 of each
-- sub-round closes, so a release in that window moved the price the pending book then cleared at (buys filled above
-- their reserve; orders placed before the release filled at post-release prices). Now any round still OPEN refuses.

select app.patch_functions(
$o$  if (app.open_round(p_event)).id is not null then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');$o$,
$n$  if (app.open_round(p_event)).id is not null
     or exists (select 1 from public.rounds r where r.event_id = p_event and r.status = 'OPEN') then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');$n$, 2);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261217000081'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
