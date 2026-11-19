-- Round 2: a Product company raises cash from Finance by selling equity (the organisers' rules: "I am giving 5%
-- equity to the Finance team, that means I am taking Rs 5,000 from them").
--
-- A company posts a raise: an equity stake in whole shares out of its 100,000 (1% = 1,000 shares), between 1% and
-- 10%, with a note. Any Finance team in the event can fund it. Funding is the deal: the price is the company's
-- current market price at that moment, so the money is shares × price, worked out by the exchange and never typed.
-- The fund's cash moves to the company, the shares move from the company's retained lot to the fund's SQUAD lot (an
-- investment held to the close and valued there, like a classic rescue deal; it is not limited by the 4,000-share
-- trading limit and is not sold on the exchange).
--
-- Rules, all checked here so no screen can go round them:
--   - only while Round 2 runs (phase PRESSURE); a raise posted in one crisis lapses when the next crisis is revealed;
--   - one open raise per company at a time, and at most one funded raise per company per crisis;
--   - the company keeps at least 40,000 shares (the same floor as a consulting fee, counting fee shares promised to a
--     firm and not yet handed over);
--   - the fund must have the cash available (cash less collateral and money reserved for pending orders);
--   - a fund may not fund its own squad's company (that is a transfer inside one squad, not an investment).
-- The price does not move because of a raise; the market moves it.

create table public.raises (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  k smallint not null check (k between 0 and 4),
  shares integer not null check (shares between 1000 and 10000),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'OPEN' check (status in ('OPEN', 'FUNDED', 'CANCELLED', 'LAPSED')),
  funded_by uuid references public.teams (id) on delete set null,
  price_cents integer check (price_cents > 0),
  cash_cents bigint check (cash_cents > 0),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index raises_open_uq on public.raises (company_id) where status = 'OPEN';
create unique index raises_funded_uq on public.raises (company_id, k) where status = 'FUNDED';
create index raises_event_idx on public.raises (event_id, status);
alter table public.raises enable row level security;
-- Every team in the event sees the raises (Finance must, to fund one) and the staff see all.
create policy raises_read on public.raises for select to authenticated
  using (event_id = (select app.my_event_id()) or (select app.is_staff()));

-- The crisis a raise belongs to: the latest one revealed (0 before Crisis 1).
create or replace function app.raise_k(p_event uuid)
returns smallint
language sql stable
as $$
  select coalesce(max(s.k), 0)::smallint from public.subrounds s
   where s.event_id = p_event and s.k between 1 and 4 and s.revealed_at is not null
$$;

create or replace function public.post_raise(p_shares integer, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_company public.companies;
  v_k smallint;
  v_retained int;
  v_promised int;
  v_raise public.raises;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can raise money' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'PRODUCT' then
    return app.fail('NOT_ALLOWED', 'Only a Product company raises money from Finance.');
  end if;
  select * into v_event from public.events where id = v_team.event_id;
  if v_event.format <> 'PRIMUS' or v_event.current_phase <> 'PRESSURE' then
    return app.fail('RAISE_CLOSED', 'Raising from Finance is open during Round 2 only.');
  end if;
  select * into v_company from public.companies where product_team_id = v_team.id for no key update;
  if v_company.id is null or v_company.market_price is null then
    return app.fail('NO_COMPANY', 'Your company has no share price yet.');
  end if;
  if p_shares is null or p_shares < 1000 or p_shares > 10000 or p_shares % 10 <> 0 then
    return app.fail('BAD_TERMS', 'Offer between 1% and 10% of the company (1,000 to 10,000 shares, in steps of 0.01%).');
  end if;
  v_k := app.raise_k(v_team.event_id);
  update public.raises set status = 'LAPSED', decided_at = now()
   where company_id = v_company.id and status = 'OPEN' and k <> v_k;
  if exists (select 1 from public.raises where company_id = v_company.id and status = 'OPEN') then
    return app.fail('RAISE_OPEN', 'You already have an open raise: cancel it first.');
  end if;
  if exists (select 1 from public.raises where company_id = v_company.id and status = 'FUNDED' and k = v_k) then
    return app.fail('ALREADY_RAISED', 'Your company has already raised from Finance in this crisis.');
  end if;
  select coalesce(sum(qty), 0) into v_retained from public.holdings
   where team_id = v_team.id and company_id = v_company.id and lot = 'RETAINED';
  select coalesce(sum(e.shares), 0) into v_promised from public.engagements e
   where e.company_id = v_company.id and e.escrow = 'HELD';
  if v_retained - v_promised - p_shares < app.min_retained_shares() then
    return app.fail('BAD_TERMS', format('A company keeps at least %s shares (40%% of itself). You have %s left to offer.',
                    app.min_retained_shares(), greatest(v_retained - v_promised - app.min_retained_shares(), 0)));
  end if;
  insert into public.raises (event_id, company_id, k, shares, note)
  values (v_team.event_id, v_company.id, v_k, p_shares, left(btrim(coalesce(p_note, '')), 300))
  returning * into v_raise;
  perform app.broadcast(v_team.event_id, 'raises', jsonb_build_object('raise', v_raise.id));
  return app.ok(jsonb_build_object('raise', to_jsonb(v_raise), 'price_cents', v_company.market_price,
                                   'value_cents', p_shares::bigint * v_company.market_price));
end
$$;

create or replace function public.cancel_raise(p_raise uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_raise public.raises;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can cancel a raise' using errcode = '42501';
  end if;
  v_team := app.lock_caller_team();
  select r.* into v_raise from public.raises r join public.companies c on c.id = r.company_id
   where r.id = p_raise and c.product_team_id = v_team.id for update of r;
  if v_raise.id is null then
    return app.fail('NOT_ALLOWED', 'This raise is not yours.');
  end if;
  if v_raise.status <> 'OPEN' then
    return app.fail('RAISE_CLOSED', format('This raise is %s.', lower(v_raise.status)));
  end if;
  update public.raises set status = 'CANCELLED', decided_at = now() where id = p_raise returning * into v_raise;
  perform app.broadcast(v_team.event_id, 'raises', jsonb_build_object('raise', v_raise.id));
  return app.ok(jsonb_build_object('raise', to_jsonb(v_raise)));
end
$$;

create or replace function public.fund_raise(p_raise uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_raise public.raises;
  v_company public.companies;
  v_fund public.teams;
  v_reserved bigint;
  v_retained int;
  v_promised int;
  v_cash bigint;
  v_txn uuid := gen_random_uuid();
begin
  if app.my_team_id() is null then
    raise exception 'only a team can fund a raise' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'FINANCE' then
    return app.fail('NOT_ALLOWED', 'Only a Finance team funds a raise.');
  end if;
  select * into v_event from public.events where id = v_team.event_id;
  if v_event.current_phase <> 'PRESSURE' then
    return app.fail('RAISE_CLOSED', 'Raising from Finance is open during Round 2 only.');
  end if;
  select * into v_raise from public.raises where id = p_raise and event_id = v_team.event_id;
  if v_raise.id is null then
    return app.fail('NO_SUCH_RAISE', 'No such raise.');
  end if;
  select * into v_company from public.companies where id = v_raise.company_id;
  if exists (select 1 from public.squads s where s.event_id = v_team.event_id
               and s.finance_team_id = v_team.id and s.product_team_id = v_company.product_team_id) then
    return app.fail('OWN_SQUAD', 'A fund cannot fund its own squad''s company.');
  end if;
  -- Both teams in id order, then the raise and the company, so two funds pressing at once never both win.
  perform 1 from public.teams where id in (v_team.id, v_company.product_team_id) order by id for no key update;
  select * into v_raise from public.raises where id = p_raise for update;
  if v_raise.status <> 'OPEN' then
    return app.fail('RAISE_CLOSED', format('This raise is %s.', lower(v_raise.status)));
  end if;
  if v_raise.k <> app.raise_k(v_team.event_id) then
    update public.raises set status = 'LAPSED', decided_at = now() where id = p_raise;
    return app.fail('RAISE_CLOSED', 'This raise was posted in an earlier crisis and has lapsed.');
  end if;
  select * into v_company from public.companies where id = v_raise.company_id for no key update;
  v_cash := v_raise.shares::bigint * v_company.market_price;
  select * into v_fund from public.teams where id = v_team.id;
  select coalesce(sum(o.reserve_cents), 0) into v_reserved
    from public.orders o join public.rounds r on r.id = o.round_id
   where o.team_id = v_fund.id and o.status = 'PENDING' and r.status = 'OPEN';
  if v_fund.cash_cents - v_fund.collateral_cents - v_reserved < v_cash then
    return app.fail('FUND_CASH', format('Your fund does not have %s available.', to_char(v_cash / 100.0, 'FM$999,999,990.00')));
  end if;
  select coalesce(sum(qty), 0) into v_retained from public.holdings
   where team_id = v_company.product_team_id and company_id = v_company.id and lot = 'RETAINED';
  select coalesce(sum(e.shares), 0) into v_promised from public.engagements e
   where e.company_id = v_company.id and e.escrow = 'HELD';
  if v_retained - v_promised - v_raise.shares < app.min_retained_shares() then
    update public.raises set status = 'LAPSED', decided_at = now() where id = p_raise;
    return app.fail('BAD_TERMS', 'The company no longer has that many shares to sell above its 40% floor; the raise has lapsed.');
  end if;

  update public.teams set cash_cents = cash_cents - v_cash where id = v_fund.id;
  update public.teams set cash_cents = cash_cents + v_cash where id = v_company.product_team_id;
  update public.holdings set qty = qty - v_raise.shares, updated_at = now()
   where team_id = v_company.product_team_id and company_id = v_company.id and lot = 'RETAINED';
  insert into public.holdings (event_id, team_id, company_id, lot, qty, cost_cents)
  values (v_raise.event_id, v_fund.id, v_company.id, 'SQUAD', v_raise.shares, v_cash)
  on conflict (team_id, company_id, lot) do update
    set qty = public.holdings.qty + excluded.qty, cost_cents = public.holdings.cost_cents + excluded.cost_cents, updated_at = now();
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, ref_table, ref_id, memo) values
    (v_raise.event_id, v_txn, 'DEAL', v_fund.id, v_company.id, 'SQUAD', -v_cash, v_raise.shares, v_company.market_price, 'raises', v_raise.id, 'Equity bought in a raise'),
    (v_raise.event_id, v_txn, 'DEAL', v_company.product_team_id, v_company.id, 'RETAINED', v_cash, -v_raise.shares, v_company.market_price, 'raises', v_raise.id, 'Equity sold in a raise');
  update public.raises set status = 'FUNDED', funded_by = v_fund.id, price_cents = v_company.market_price, cash_cents = v_cash,
         decided_at = now() where id = p_raise returning * into v_raise;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, cash_cents, shares, price_cents, details)
  values (v_raise.event_id, v_txn, 'RAISE', format('%s sold %s%% of itself to a fund', coalesce(v_company.ticker, 'A company'),
            to_char(v_raise.shares / 1000.0, 'FM990.99')),
          v_company.id, v_company.ticker, v_cash, v_raise.shares, v_company.market_price,
          jsonb_build_object('k', v_raise.k, 'fund', v_fund.id));
  perform app.broadcast(v_team.event_id, 'raises', jsonb_build_object('raise', v_raise.id, 'funded', true));
  return app.ok(jsonb_build_object('raise', to_jsonb(v_raise)));
end
$$;

revoke all on function app.raise_k(uuid) from public, anon, authenticated;
revoke all on function public.post_raise(integer, text), public.cancel_raise(uuid), public.fund_raise(uuid) from public, anon;
grant execute on function public.post_raise(integer, text), public.cancel_raise(uuid), public.fund_raise(uuid) to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261203000067'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
