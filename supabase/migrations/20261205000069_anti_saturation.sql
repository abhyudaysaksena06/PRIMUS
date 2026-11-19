-- Anti-saturation guardrails.
--
-- 1. A one-round cooling-off (PRIMUS). The exchange fills every order at one price that moves at most ±10% a round, so
--    160,000 shares chasing a winner cost no more than 10,000: in a 200-night stress test a leader rose the full 10%
--    four or five rounds running and up to 66% of fund money piled into five companies. Now a company whose last round
--    moved the full ±10% takes no new orders for the next round. With it no company moved the limit two rounds running,
--    and the peak share of fund money in the top five fell to 48–50%.
--
-- 2. Raises. A fund holds at most 10,000 shares (10%) of a company through raises (outside the 4,000 trading cap), and
--    funds at most one raise per crisis: no fund buys a company out four raises at a time.

-- ── 1 · Cooling-off after a ±10% round (PRIMUS)
create or replace function app.cooling_off(p_company uuid)
returns boolean
language sql stable
as $$
  -- The company's last cleared round moved it the full ±10% (net demand at the 10,000-share cap).
  select coalesce((
           select abs(rp.capped_net) >= 10000
             from public.round_prices rp join public.rounds r on r.id = rp.round_id
            where rp.company_id = p_company and rp.kind = 'CLEARING'
            order by r.number desc
            limit 1), false)
     and exists (select 1 from public.companies c join public.events e on e.id = c.event_id
                  where c.id = p_company and e.format = 'PRIMUS')
$$;
revoke all on function app.cooling_off(uuid) from public, anon, authenticated;

select app.patch_functions(
$o$  v_round := app.open_round(v_team.event_id);

  v_check := app.check_order(app.order_context(v_team),$o$,
$n$  v_round := app.open_round(v_team.event_id);
  -- Checked first, so a team always sees why: the company moved the full 10% last round.
  if app.cooling_off(p_company) then
    return app.reject(v_team.event_id, 'place_order', 'COOLING_OFF', app.order_message('COOLING_OFF'), v_details);
  end if;

  v_check := app.check_order(app.order_context(v_team),$n$);

select app.patch_functions(
$o$    when 'NOT_ENOUGH_SHORT' then 'You can only cover shares you are short (minus pending covers).'$o$,
$n$    when 'NOT_ENOUGH_SHORT' then 'You can only cover shares you are short (minus pending covers).'
    when 'COOLING_OFF' then 'This company moved the full 10% last round, so it is cooling off for one round. Trade it again next round.'$n$);

-- Which companies are cooling off now, for the trade desk (any signed-in team of the event, and staff).
create or replace function public.cooling_off_companies(p_event uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}')
    from public.companies c
   where c.event_id = p_event
     and (p_event = app.my_event_id() or app.is_staff())
     and app.cooling_off(c.id)
$$;
revoke all on function public.cooling_off_companies(uuid) from public, anon;
grant execute on function public.cooling_off_companies(uuid) to authenticated;

-- ── 2 · Raises: 10% per fund per company, one raise per fund per crisis
select app.patch_functions(
$o$  if v_raise.k <> app.raise_k(v_team.event_id) then
    update public.raises set status = 'LAPSED', decided_at = now() where id = p_raise;
    return app.fail('RAISE_CLOSED', 'This raise was posted in an earlier crisis and has lapsed.');
  end if;$o$,
$n$  if v_raise.k <> app.raise_k(v_team.event_id) then
    update public.raises set status = 'LAPSED', decided_at = now() where id = p_raise;
    return app.fail('RAISE_CLOSED', 'This raise was posted in an earlier crisis and has lapsed.');
  end if;
  if exists (select 1 from public.raises where funded_by = v_team.id and k = v_raise.k and status = 'FUNDED') then
    return app.fail('ONE_RAISE', 'A fund can fund one raise per crisis.');
  end if;
  if (select coalesce(sum(qty), 0) from public.holdings
       where team_id = v_team.id and company_id = v_raise.company_id and lot = 'SQUAD') + v_raise.shares > 10000 then
    return app.fail('RAISE_CAP', 'A fund holds at most 10,000 shares (10%) of a company through raises.');
  end if;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261205000069'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
