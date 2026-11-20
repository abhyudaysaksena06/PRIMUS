-- The trading algorithm, verified (docs/system/TRADING-ALGORITHM.md). Every rule was written down from this code,
-- fuzzed in the engine (packages/engine/src/trading.fuzz.test.ts) and run through these functions against the engine
-- (supabase/tests/trading-fuzz.test.ts, trading-edges.test.ts). What that found and changed here:
--
-- 1. A buy never costs more than it reserved. A BUY reserved qty × price × 1.10 rounded once, but the clearing rounds
--    the price per share: at $10.05 a full +10% round fills at $11.06 (1,105.5 rounded up), so 4,000 shares could cost
--    $20 more than the $44,220 reserved and a fund that bought with all its available cash ended below zero. The
--    reserve is now the larger of qty × price × 1.10 and qty × the highest price the order can fill at (the price
--    after a full +10% round, rounded per share). It grows by at most half a cent a share, only at prices whose last
--    digit is 5–9; everywhere else it is unchanged.
-- 2. The Round 3 leveller ranks once. app.release_tier_bp ranked every drafted company by app.score_so_far for each
--    company released (n² calls: 40,000 at 200 companies). app.release_tier_bps ranks the whole draft in one query
--    (one aggregate over the scores, one window); app.release_tier_bp reads its own row from it. Same results: the
--    tests compare it with the old function on random drafts.
-- 3. A Finance return on zero capital. app.primus_results divided by the capital a fund received (starting cash and
--    the injection); a fund whose capital summed to 0 made the division fail, and with it the whole settlement. Its
--    return is now left empty (rankings are by final value, so nothing else changes).
-- 4. The practice market lets a fund under 150% cover reduce its risk. Every practice trade had to leave cash ≥ 150%
--    of the shorts, so a fund whose shorts had risen could neither SELL a long (to raise cash) nor COVER part of a
--    short: it was locked in. SELL and COVER only shrink positions, so they are no longer held to the 150% rule
--    (a COVER still needs the cash to pay for it). BUY and SHORT are checked as before.
-- 5. Raises before the first crisis count as crisis 1. app.raise_k was 0 between the start of Round 2 and the reveal
--    of crisis 1 (seconds, or minutes when the organiser holds the reveal), so a company could raise once at 0 and
--    again in crisis 1, and a fund could fund one raise at 0 and another in crisis 1: past the "one raise per crisis"
--    limits. raise_k is now at least 1.

-- ── 1 · Buy reserve: never less than the most the buy can cost
create or replace function app.buy_reserve(p_qty bigint, p_price bigint)
returns bigint
language sql immutable strict parallel safe
as $$
  select greatest(app.mul_rate(p_qty::numeric * p_price, 110, 100), p_qty * app.clearing_price(p_price, 10000))
$$;

-- ── 2 · The leveller: the draft ranked once
-- One row per company of the event: its released tier for p_type, levelled for a positive SOLUTION tier
-- (bp × (1.25 − (place − 1) / (n − 1)), whole basis points; place 1 = the weakest score so far; ties share the lower
-- place). The score so far is the average of the PRD and the four crisis plan scores (missing = 0), rounded to 2
-- decimals: exactly app.score_so_far, summed over the scores table in one pass instead of one call per company.
create or replace function app.release_tier_bps(p_event uuid, p_type public.submission_type)
returns table (company_id uuid, bp integer)
language sql stable
as $$
  with sofar as (
    select d.company_id,
           round(coalesce(sum(s.final_score), 0)::numeric / 5, 2) as score
      from public.draft_picks d
      left join public.scores s on s.company_id = d.company_id
                               and s.type in ('PITCH', 'CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4')
     where d.event_id = p_event
     group by d.company_id
  ), places as (
    select x.company_id, count(*) over () as n, rank() over (order by x.score) as place from sofar x
  )
  select c.id,
         case when p_type <> 'SOLUTION' or coalesce(s.tier_bp, 0) <= 0 or p.n is null or p.n <= 1
              then coalesce(s.tier_bp, 0)
              else ((coalesce(s.tier_bp, 0) * (125 * (p.n - 1) - 100 * (p.place - 1))) / (100 * (p.n - 1)))::int end
    from public.companies c
    left join public.scores s on s.company_id = c.id and s.type = p_type
    left join places p on p.company_id = c.id
   where c.event_id = p_event
$$;
revoke all on function app.release_tier_bps(uuid, public.submission_type) from public, anon, authenticated;

create or replace function app.release_tier_bp(p_company uuid, p_type public.submission_type)
returns integer
language plpgsql stable
as $$
declare
  v_bp int;
begin
  select coalesce(s.tier_bp, 0) into v_bp from public.scores s where s.company_id = p_company and s.type = p_type;
  v_bp := coalesce(v_bp, 0);
  if p_type <> 'SOLUTION' or v_bp <= 0 then
    return v_bp;
  end if;
  -- One query for the whole draft (it used to call app.score_so_far once per drafted company, for every company).
  select t.bp into v_bp
    from public.companies c, app.release_tier_bps(c.event_id, p_type) t
   where c.id = p_company and t.company_id = p_company;
  return v_bp;
end
$$;
revoke all on function app.release_tier_bp(uuid, public.submission_type) from public, anon, authenticated;

-- ── 3 · Finance return: no division by a zero capital
select app.patch_functions(
$o$  update public.results r set start_value_cents = x.capital, return_bp = app.return_bp(r.final_value_cents, x.capital)$o$,
$n$  update public.results r set start_value_cents = x.capital,
         return_bp = case when x.capital > 0 then app.return_bp(r.final_value_cents, x.capital) end$n$);

-- ── 4 · Practice: SELL and COVER always reduce risk
select app.patch_functions(
$o$  if v_cash < 0 or v_cash < (v_shorts * 3) / 2 then$o$,
$n$  -- SELL and COVER only shrink a position, so they are not held to the 150% rule: a fund under cover can always
  -- reduce its risk (a COVER still needs the cash to pay for it).
  if v_cash < 0 or (p_type in ('BUY', 'SHORT') and v_cash < (v_shorts * 3) / 2) then$n$);

-- ── 5 · Raises: before crisis 1 is revealed, a raise belongs to crisis 1
create or replace function app.raise_k(p_event uuid)
returns smallint
language sql stable
as $$
  select greatest(coalesce(max(s.k), 0), 1)::smallint from public.subrounds s
   where s.event_id = p_event and s.k between 1 and 4 and s.revealed_at is not null
$$;
revoke all on function app.raise_k(uuid) from public, anon, authenticated;

-- ── 6 · The clearing at 200 companies × 200 funds
-- (a) The live round range (app.track_round_range, on every order written) sums the company's pending orders in the
--     round: an index for exactly that.
create index if not exists orders_round_company_pending_idx on public.orders (round_id, company_id) where status = 'PENDING';

-- (b) A clearing rewrites every order, position and fund of the round (with a full book: 40,000 orders and as many
--     positions), and the per-row audit about doubled its time. Each of those changes is already recorded where it
--     can be checked: one TRADE ledger row per filled order and one per company for the exchange (cash = Σ ledger and
--     holdings = Σ ledger are tested invariants), the round's price rows and every order's fill price; the round's own
--     row is still audited. So while app.clear_round runs (app.price_writer = 'CLEARING', which it resets when it is
--     done, so nothing later in the same tick goes unaudited), the per-row audit skips orders, holdings, teams and
--     companies. A restore (app.allow_purge = 'on') still skips everything, as before.
select app.patch_functions(
$o$  if current_setting('app.allow_purge', true) = 'on' then
    return null;
  end if;$o$,
$n$  if current_setting('app.allow_purge', true) = 'on' then
    return null;
  end if;
  if current_setting('app.price_writer', true) = 'CLEARING' and tg_table_name in ('orders', 'holdings', 'teams', 'companies') then
    return null;
  end if;$n$);

select app.patch_functions(
$o$  update public.rounds set status = 'CLEARED', closed_at = coalesce(closed_at, now()), cleared_at = now()
   where id = v_round.id;$o$,
$n$  -- The clearing's writes are done: later writes in this transaction are audited and tracked again.
  perform set_config('app.price_writer', '', true);
  update public.rounds set status = 'CLEARED', closed_at = coalesce(closed_at, now()), cleared_at = now()
   where id = v_round.id;$n$);

-- Every patch landed where it was meant to, and only there.
do $$
declare
  v_where text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into v_where
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and strpos(p.prosrc, 'when x.capital > 0 then app.return_bp') > 0;
  if v_where is distinct from 'app.primus_results' then
    raise exception 'finance return patch landed in %', v_where;
  end if;
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into v_where
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and strpos(p.prosrc, 'p_type in (''BUY'', ''SHORT'') and v_cash < (v_shorts * 3) / 2') > 0;
  if v_where is distinct from 'public.practice_trade' then
    raise exception 'practice patch landed in %', v_where;
  end if;
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into v_where
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and strpos(p.prosrc, 'app.price_writer'', true) = ''CLEARING'' and tg_table_name in') > 0;
  if v_where is distinct from 'app.audit_row' then
    raise exception 'audit patch landed in %', v_where;
  end if;
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into v_where
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and strpos(p.prosrc, 'later writes in this transaction are audited and tracked again') > 0;
  if v_where is distinct from 'app.clear_round' then
    raise exception 'clearing patch landed in %', v_where;
  end if;
end
$$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261215000079'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
