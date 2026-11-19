-- The close counts the end of a PRIMUS night.
--
-- app.close_market took the market part of the closing price from rounds 20 and 21: the last two rounds of the
-- classic night. A PRIMUS night has 31 rounds, so its close used 03:20–03:50 and ignored rounds 22–31, all of Round 3
-- included: in a 200-night stress test final prices (and every team's result) moved on average 7–8% from what the
-- market said at 06:30. The closing market price is now the average of the last round's opening and clearing prices:
-- on the classic night that is rounds 20 and 21 exactly as before; on a PRIMUS night it is the price once the solutions
-- are released (round 31 opens only after that) and round 31's clearing price, so Round 3's judging counts in full and a
-- pump in the very last round counts only half. The closing price still averages that with the AI price.

select app.patch_functions(
$o$  if exists (select 1 from public.rounds where event_id = p_event and number in (20, 21) and status <> 'CLEARED') then
    raise exception 'rounds 20 and 21 must be cleared before the close';
  end if;$o$,
$n$  -- The last round of the night (21 on the classic night, 31 on a PRIMUS night) must be cleared.
  if exists (select 1 from public.rounds where event_id = p_event and status <> 'CLEARED'
               and number = (select max(r2.number) from public.rounds r2 where r2.event_id = p_event)) then
    raise exception 'the last round must be cleared before the close';
  end if;$n$);

select app.patch_functions(
$o$  with px as (
    select c.id,
           app.avg_half_up((select rp.market_after from public.round_prices rp join public.rounds r on r.id = rp.round_id
                             where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 20),
                           (select rp.market_after from public.round_prices rp join public.rounds r on r.id = rp.round_id
                             where rp.company_id = c.id and rp.kind = 'CLEARING' and r.number = 21)) as market
      from public.companies c where c.event_id = p_event and c.market_price is not null
  )$o$,
$n$  -- The closing market price: the average of the last round's opening price (market_before) and its clearing price.
  with last_clear as (
    select distinct on (rp.company_id) rp.company_id, rp.market_before, rp.market_after
      from public.round_prices rp join public.rounds r on r.id = rp.round_id
     where rp.event_id = p_event and rp.kind = 'CLEARING'
     order by rp.company_id, r.number desc
  ), px as (
    select c.id, coalesce(app.avg_half_up(l.market_before, l.market_after), c.market_price) as market
      from public.companies c left join last_clear l on l.company_id = c.id
     where c.event_id = p_event and c.market_price is not null
  )$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261204000068'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
