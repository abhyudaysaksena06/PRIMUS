-- PRIMUS saturation monitor: read-only. Paste into Supabase -> SQL Editor and press Run at each crisis reveal and at
-- 04:45. It changes nothing. Each line says what it measures now and when staff should act (docs/GUARDRAILS.md).
-- Change the slug on the next line if the event is not primus-2026.
with ev as (select id from public.events where slug = 'primus-2026'),
px as (select c.id, c.ticker, c.market_price, c.ai_price, c.ipo_price,
              (select p.sector from public.squads s join public.problem_cards p on p.id = s.chosen_card_id where s.id = c.squad_id) as sector
         from public.companies c where c.event_id = (select id from ev) and c.market_price is not null),
held as (select h.company_id, sum(h.qty)::bigint as qty from public.holdings h
          where h.event_id = (select id from ev) and h.lot in ('EXCHANGE', 'SQUAD') group by h.company_id),
val as (select px.ticker, coalesce(held.qty, 0) * px.market_price as v from px left join held on held.company_id = px.id),
last_round as (select max(r.number) as n from public.rounds r where r.event_id = (select id from ev) and r.status = 'CLEARED'),
limits as (select c.ticker, count(*) as hits from public.round_prices rp join public.rounds r on r.id = rp.round_id
            join public.companies c on c.id = rp.company_id
           where rp.event_id = (select id from ev) and rp.kind = 'CLEARING' and abs(rp.capped_net) >= 10000
             and r.number > (select n from last_round) - 4 group by c.ticker)
select 'Fund money in the top 5 companies' as signal,
       coalesce(round(100.0 * (select sum(v) from (select v from val order by v desc limit 5) t) / nullif((select sum(v) from val), 0), 1)::text || '%', 'no holdings') as now,
       'act above 55%' as threshold
union all
select 'Companies at the ±10% limit in the last 4 rounds',
       coalesce((select string_agg(ticker || ' ×' || hits, ', ' order by hits desc) from limits), 'none'), 'act at ×3 or more'
union all
select 'Most overpriced vs the AI price',
       coalesce((select string_agg(ticker || ' ' || round(market_price::numeric / ai_price, 2) || '×', ', ') from
                 (select ticker, market_price, ai_price from px order by market_price::numeric / ai_price desc limit 3) t), '-'), 'act above 1.5×'
union all
select 'Price vs IPO by sector (median)',
       coalesce((select string_agg(sector || ' ' || m || '×', ', ' order by sector) from
                 (select coalesce(sector, '?') as sector, round(percentile_cont(0.5) within group (order by market_price::numeric / ipo_price)::numeric, 2) as m
                    from px where ipo_price is not null group by 1) t), '-'), 'act if one sector differs by 0.5× or more';
