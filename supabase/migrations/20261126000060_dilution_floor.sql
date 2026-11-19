-- A company may never give away more than 60% of itself. It keeps 60,000 of its 100,000 shares at the IPO, so the
-- only way further equity leaves is a consulting fee paid in shares. One fee is capped at 3,000 shares, but a company
-- hires five times over the night, so without a floor it could hand over 15,000 and fall to 45% of itself.
--
-- The floor is 40,000 retained shares (40% of the company): the literal "no more than 60% diluted". It counts the
-- shares of every engagement whose escrow is still HELD, because those are promised but do not leave the holdings
-- until the sub-round settles, and a company could otherwise promise the same shares twice.
--
-- app.offer_problem is the one place offers are validated — make_offer, a counter and the binding accept all call it —
-- so the floor cannot be walked around by the UI or by a direct RPC call.

create or replace function app.min_retained_shares() returns integer language sql immutable as $$ select 40000 $$;
revoke all on function app.min_retained_shares() from public, anon, authenticated;

create or replace function app.offer_problem(p_company public.companies, p_k int, p_cash bigint, p_shares int)
returns text
language plpgsql stable
as $$
declare
  v_cash bigint;
  v_retained int;
  v_promised int;
  v_floor int := app.min_retained_shares();
  v_value bigint;
begin
  if p_cash < 0 or p_shares < 0 or (p_cash = 0 and p_shares = 0) then
    return 'Offer cash, shares or both.';
  end if;
  select cash_cents into v_cash from public.teams where id = p_company.product_team_id;
  select coalesce(sum(qty), 0) into v_retained from public.holdings
   where team_id = p_company.product_team_id and company_id = p_company.id and lot = 'RETAINED';
  if p_cash > v_cash then
    return 'Your company does not have that much cash.';
  end if;
  if p_shares > v_retained then
    return format('Your company retains only %s shares.', v_retained);
  end if;
  -- Promised to a firm this night and not yet handed over.
  select coalesce(sum(e.shares), 0) into v_promised from public.engagements e
   where e.company_id = p_company.id and e.escrow = 'HELD';
  if v_retained - v_promised - p_shares < v_floor then
    return format('A company keeps at least %s shares (60%% of itself). You have %s left to offer.',
                  v_floor, greatest(v_retained - v_promised - v_floor, 0));
  end if;
  if p_k = 5 then
    v_value := p_cash + p_shares::bigint * coalesce(p_company.market_price, 0);
    if v_value < v_cash * 5 / 100 or v_value > v_cash * 20 / 100 then
      return 'In Round 3 a fee is worth 5% to 20% of the company''s cash.';
    end if;
  end if;
  return null;
end
$$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261126000060'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
