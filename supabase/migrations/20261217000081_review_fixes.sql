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

-- F1 (hiring, 071). Round 3 (k = 5) keeps its 5–20%-of-cash band: no firm minimum bid there. The draw charges Round 3
-- the old fee (10% of cash, no shares, as with the switch off), not the base rate. Crises 1–4: when the 40,000-share
-- floor blocks the base-rate shares, the cash fallback is capped at the base fee ($22,500) and the company's cash.
select app.patch_one_function('public.make_offer(uuid, bigint, integer, text)'::regprocedure,
$o$  v_problem := app.min_bid_problem(v_company, p_firm, coalesce(p_cash, 0), coalesce(p_shares, 0), false);$o$,
$n$  v_problem := case when v_k = 5 then null else app.min_bid_problem(v_company, p_firm, coalesce(p_cash, 0), coalesce(p_shares, 0), false) end;$n$);
select app.patch_one_function('public.make_offer_to(uuid, bigint, integer, text)'::regprocedure,
$o$  v_problem := app.min_bid_problem(v_company, v_team.id, coalesce(p_cash, 0), coalesce(p_shares, 0), true);$o$,
$n$  v_problem := case when v_k = 5 then null else app.min_bid_problem(v_company, v_team.id, coalesce(p_cash, 0), coalesce(p_shares, 0), true) end;$n$);
select app.patch_one_function('public.respond_offer(uuid, text, bigint, integer)'::regprocedure,
$o$    v_problem := app.min_bid_problem(v_company, v_offer.firm_team_id, p_cash, p_shares, v_side = 'FIRM');$o$,
$n$    v_problem := case when v_offer.k = 5 then null else app.min_bid_problem(v_company, v_offer.firm_team_id, p_cash, p_shares, v_side = 'FIRM') end;$n$);
select app.patch_one_function('public.respond_offer(uuid, text, bigint, integer)'::regprocedure,
$o$  v_problem := app.min_bid_problem(v_company, v_offer.firm_team_id, v_offer.cash_cents, v_offer.shares, v_side = 'FIRM');$o$,
$n$  v_problem := case when v_offer.k = 5 then null else app.min_bid_problem(v_company, v_offer.firm_team_id, v_offer.cash_cents, v_offer.shares, v_side = 'FIRM') end;$n$);

select app.patch_one_function('app.assign_firms_by_draw(uuid, integer)'::regprocedure,
$o$    if v_retained - v_promised - v_shares >= app.min_retained_shares() then
      v_fee := 0;
    else
      -- The floor blocks the shares: their value in cash at today's price, never more than the company has.
      v_fee := least(v_shares::bigint * coalesce(v_company.market_price, 0), greatest(coalesce(v_cash, 0), 0));
      v_shares := 0;
    end if;$o$,
$n$    if p_k = 5 then
      -- Round 3 keeps its old fee: 10% of cash, no shares (as with the switch off).
      v_fee := greatest(coalesce(v_cash, 0), 0) / 10;
      v_shares := 0;
    elsif v_retained - v_promised - v_shares >= app.min_retained_shares() then
      v_fee := 0;
    else
      -- The floor blocks the shares: their value in cash at today's price, never more than the base fee or the cash.
      v_fee := least(v_shares::bigint * coalesce(v_company.market_price, 0), app.default_hire_fee(), greatest(coalesce(v_cash, 0), 0));
      v_shares := 0;
    end if;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261217000081'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
