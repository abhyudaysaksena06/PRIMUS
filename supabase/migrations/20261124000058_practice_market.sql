-- The Round 1 practice market for Finance funds (PRIMUS).
--
-- While the companies are being built (BUILD) and read (READING), the funds have no shares to trade yet. Each fund is
-- given $60,000 to trade a separate, simulated market of six made-up companies: prices move on their own every few
-- seconds (a random walk with a shared market move), and news headlines move a stock and give it a trend for the next
-- few steps, so a fund that reads the news can profit. Orders fill at once at the current price (BUY and SELL only;
-- no shorts, no fees). The market closes when the IPO opens; open positions are valued at the last prices.
--
-- When Round 2 starts (PRESSURE), each fund's practice result (cash plus holdings at the last prices) is added to its
-- fund cash, on top of the $500,000 it was given. The $60,000 counts as money the fund was given, so its Round 1
-- profit or loss counts in its final return.
--
--   public.practice_stocks / practice_prices / practice_news   the simulated market (every team of the event reads it)
--   public.practice_accounts / practice_holdings / practice_trades   each fund's own (the fund and staff read them)
--   public.practice_trade(stock, side, qty)   a fund's order
--   app.practice_tick(event)   from the heartbeat: opens the accounts, moves the prices, settles into Round 2
--
-- events.practice_enabled turns it off for an event (set it to false before BUILD).

alter type public.ledger_kind add value if not exists 'PRACTICE';

alter table public.events
  add column if not exists practice_enabled boolean not null default true,
  add column if not exists practice_step integer not null default -1,
  add column if not exists practice_stepped_at timestamptz,
  add column if not exists practice_settled_at timestamptz;

create table if not exists public.practice_stocks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  symbol text not null,
  name text not null,
  sector text not null,
  blurb text not null,
  open_cents integer not null check (open_cents > 0),
  price_cents integer not null check (price_cents > 0),
  vol_bp integer not null,     -- noise per step, basis points
  beta_pct integer not null,   -- how much of the market move it takes, percent
  trend_bp integer not null default 0, -- extra move per step after news
  trend_until integer not null default -1, -- the last step the trend applies to
  unique (event_id, symbol)
);

create table if not exists public.practice_prices (
  stock_id uuid not null references public.practice_stocks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  step integer not null,
  price_cents integer not null,
  at timestamptz not null default now(),
  primary key (stock_id, step)
);
create index if not exists practice_prices_event on public.practice_prices (event_id, step);

create table if not exists public.practice_news (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  step integer not null,
  stock_id uuid references public.practice_stocks (id) on delete cascade, -- null: news for the whole market
  headline text not null,
  move_bp integer not null,
  at timestamptz not null default now()
);
create index if not exists practice_news_event on public.practice_news (event_id, id desc);

create table if not exists public.practice_accounts (
  team_id uuid primary key references public.teams (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  grant_cents bigint not null,
  cash_cents bigint not null check (cash_cents >= 0),
  final_value_cents bigint,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.practice_holdings (
  team_id uuid not null references public.practice_accounts (team_id) on delete cascade,
  stock_id uuid not null references public.practice_stocks (id) on delete cascade,
  qty integer not null check (qty >= 0),
  cost_cents bigint not null default 0, -- what the shares held now cost in total
  primary key (team_id, stock_id)
);

create table if not exists public.practice_trades (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.practice_accounts (team_id) on delete cascade,
  stock_id uuid not null references public.practice_stocks (id) on delete cascade,
  side text not null check (side in ('BUY', 'SELL')),
  qty integer not null check (qty > 0),
  price_cents integer not null,
  step integer not null,
  at timestamptz not null default now()
);
create index if not exists practice_trades_team on public.practice_trades (team_id, id desc);

alter table public.practice_stocks enable row level security;
alter table public.practice_prices enable row level security;
alter table public.practice_news enable row level security;
alter table public.practice_accounts enable row level security;
alter table public.practice_holdings enable row level security;
alter table public.practice_trades enable row level security;

create policy practice_stocks_read on public.practice_stocks for select to authenticated
  using ((select app.is_staff()) or event_id = (select app.my_event_id()));
create policy practice_prices_read on public.practice_prices for select to authenticated
  using ((select app.is_staff()) or event_id = (select app.my_event_id()));
create policy practice_news_read on public.practice_news for select to authenticated
  using ((select app.is_staff()) or event_id = (select app.my_event_id()));
create policy practice_accounts_read on public.practice_accounts for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));
create policy practice_holdings_read on public.practice_holdings for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));
create policy practice_trades_read on public.practice_trades for select to authenticated
  using ((select app.is_staff()) or team_id = (select app.my_team_id()));

revoke all on public.practice_stocks, public.practice_prices, public.practice_news, public.practice_accounts,
  public.practice_holdings, public.practice_trades from anon, authenticated;
grant select on public.practice_stocks, public.practice_prices, public.practice_news, public.practice_accounts,
  public.practice_holdings, public.practice_trades to authenticated;

-- The money each fund gets for the practice market.
create or replace function app.practice_grant()
returns bigint language sql immutable as $$ select 6000000::bigint $$; -- $60,000

-- Is the practice market open for trading now?
create or replace function app.practice_open(p_event public.events)
returns boolean
language sql stable
as $$
  select p_event.format = 'PRIMUS' and p_event.practice_enabled and not p_event.paused
     and p_event.current_phase in ('BUILD', 'READING') and p_event.practice_settled_at is null
     and p_event.practice_step >= 0
$$;

-- A standard normal draw (sum of 12 uniforms − 6).
create or replace function app.practice_z()
returns double precision language sql volatile as $$
  select (random() + random() + random() + random() + random() + random()
        + random() + random() + random() + random() + random() + random()) - 6
$$;

-- The six made-up companies, created when the market opens.
create or replace function app.practice_list(p_event uuid)
returns void
language sql
as $$
  insert into public.practice_stocks (event_id, symbol, name, sector, blurb, open_cents, price_cents, vol_bp, beta_pct)
  values
    (p_event, 'NVRB', 'Novar Robotics', 'Technology', 'Warehouse robots for e-commerce. Fast growth, big swings.', 4200, 4200, 90, 140),
    (p_event, 'GRFR', 'Greenfield Foods', 'FMCG', 'Packaged snacks and drinks. Steady and dull.', 1850, 1850, 35, 60),
    (p_event, 'SKRT', 'SkyRoute Airways', 'Aviation', 'A low-cost airline. Moves with fuel prices and travel demand.', 2700, 2700, 70, 120),
    (p_event, 'LUMR', 'Maison Lumière', 'Luxury', 'Handbags and watches. Sensitive to how rich shoppers feel.', 12000, 12000, 50, 100),
    (p_event, 'VGRD', 'Volt Grid Energy', 'Energy', 'Solar farms and power lines. Long contracts, slow moves.', 3500, 3500, 45, 70),
    (p_event, 'CRDP', 'Cardinal Pay', 'Fintech', 'A payments app. Cheap, risky, and loved by traders.', 980, 980, 120, 160)
  on conflict (event_id, symbol) do nothing
$$;

-- One step of the market: the shared market move, each stock's own noise and trend, and sometimes a headline.
create or replace function app.practice_step(p_event uuid, p_step integer)
returns void
language plpgsql
as $$
declare
  v_market double precision := app.practice_z() * 25; -- basis points, shared
  s public.practice_stocks;
  v_move double precision;
  v_news_stock uuid;
  v_news_move integer := 0;
  v_good boolean;
  v_name text;
  v_headline text;
  v_market_news integer := 0;
begin
  -- About one headline every 12 steps (every ~4 minutes on the night); one in five is about the whole market.
  if random() < 0.085 then
    v_good := random() < 0.5;
    if random() < 0.2 then
      v_market_news := (case when v_good then 1 else -1 end) * (100 + floor(random() * 150))::int;
      v_headline := case when v_good
        then (array['The central bank surprises with a rate cut',
                    'Inflation falls faster than expected',
                    'Foreign investors pour money into Indian shares',
                    'Strong festive-season sales lift the whole market'])[1 + floor(random() * 4)::int]
        else (array['The central bank raises rates to fight inflation',
                    'Global markets slide on recession fears',
                    'Oil jumps 8% overnight; investors turn cautious',
                    'A big fund is selling everything: prices slip across the board'])[1 + floor(random() * 4)::int] end;
      insert into public.practice_news (event_id, step, stock_id, headline, move_bp)
      values (p_event, p_step, null, v_headline, v_market_news);
    else
      select id, name into v_news_stock, v_name from public.practice_stocks
       where event_id = p_event order by random() limit 1;
      v_news_move := (case when v_good then 1 else -1 end) * (300 + floor(random() * 500))::int;
      v_headline := replace(case when v_good
        then (array['{n} beats its quarterly earnings estimates',
                    '{n} wins a large government contract',
                    'Analysts upgrade {n} to Buy',
                    '{n} launches a product to strong early demand',
                    'Rumour: a bigger rival wants to buy {n}'])[1 + floor(random() * 5)::int]
        else (array['{n} misses earnings and cuts its forecast',
                    'The regulator opens an investigation into {n}',
                    '{n} recalls a product after safety complaints',
                    'The CFO of {n} resigns without warning',
                    'A short-seller publishes a report attacking {n}'])[1 + floor(random() * 5)::int] end, '{n}', v_name);
      insert into public.practice_news (event_id, step, stock_id, headline, move_bp)
      values (p_event, p_step, v_news_stock, v_headline, v_news_move);
      -- The news keeps working for the next 10 steps: about half as much again.
      update public.practice_stocks set trend_bp = v_news_move / 20, trend_until = p_step + 10 where id = v_news_stock;
    end if;
  end if;

  for s in select * from public.practice_stocks where event_id = p_event loop
    v_move := v_market * s.beta_pct / 100.0 + app.practice_z() * s.vol_bp
            + case when p_step <= s.trend_until then s.trend_bp else 0 end
            + case when s.id = v_news_stock then v_news_move else 0 end
            + v_market_news * s.beta_pct / 100.0;
    v_move := greatest(-2500, least(2500, v_move)); -- at most ±25% in one step
    update public.practice_stocks
       set price_cents = greatest(100, round(price_cents * (1 + v_move / 10000.0))::int)
     where id = s.id
    returning * into s;
    insert into public.practice_prices (stock_id, event_id, step, price_cents) values (s.id, p_event, p_step, s.price_cents);
  end loop;
end
$$;

-- Round 2 has started: every fund's practice result (cash plus holdings at the last prices) goes into its fund cash.
create or replace function app.practice_settle(p_event uuid)
returns integer
language plpgsql
as $$
declare
  v_txn uuid := gen_random_uuid();
  v_total bigint;
  v_n int;
begin
  update public.practice_accounts a set
      final_value_cents = a.cash_cents + coalesce((
        select sum(h.qty::bigint * s.price_cents) from public.practice_holdings h
          join public.practice_stocks s on s.id = h.stock_id where h.team_id = a.team_id), 0),
      settled_at = now()
   where a.event_id = p_event and a.settled_at is null;
  get diagnostics v_n = row_count;
  select coalesce(sum(final_value_cents), 0) into v_total from public.practice_accounts
   where event_id = p_event and settled_at = now();
  if v_total > 0 then
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
    select p_event, v_txn, 'PRACTICE', a.team_id, a.final_value_cents,
           'Round 1 practice market result (from ' || to_char(a.grant_cents / 100.0, 'FM$999,999,990') || ')'
      from public.practice_accounts a where a.event_id = p_event and a.settled_at = now() and a.final_value_cents > 0;
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
    values (p_event, v_txn, 'PRACTICE', null, -v_total, 'Paid by the exchange');
    update public.teams t set cash_cents = t.cash_cents + a.final_value_cents
      from public.practice_accounts a
     where a.team_id = t.id and a.event_id = p_event and a.settled_at = now() and a.final_value_cents > 0;
    update public.events set exchange_cash_cents = exchange_cash_cents - v_total where id = p_event;
    insert into public.public_ledger (event_id, txn_id, kind, label, cash_cents)
    values (p_event, v_txn, 'PRACTICE', 'Round 2: every fund''s practice market result was added to its cash', v_total);
  end if;
  update public.events set practice_settled_at = now() where id = p_event;
  if v_n > 0 then
    insert into public.bulletins (event_id, kind, title, body, published_at)
    values (p_event, 'GENERAL', 'Practice market settled',
            'Round 2 has started. Each fund''s practice market result (its cash plus its shares at the last prices) '
            || 'has been added to its fund cash.', now());
  end if;
  return v_n;
end
$$;

-- From the heartbeat (PRIMUS events). Any failure is logged and never stops the rest of the tick.
create or replace function app.practice_tick(p_event uuid)
returns text[]
language plpgsql
as $$
declare
  v_event public.events;
  v_every interval;
  v_out text[] := '{}';
  v_n int;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.format <> 'PRIMUS' or not v_event.practice_enabled or v_event.practice_settled_at is not null then
    return v_out;
  end if;
  begin
    if v_event.current_phase in ('BUILD', 'READING') then
      if v_event.practice_step < 0 then
        perform app.practice_list(p_event);
        insert into public.practice_prices (stock_id, event_id, step, price_cents)
        select id, event_id, 0, price_cents from public.practice_stocks where event_id = p_event
        on conflict do nothing;
        update public.events set practice_step = 0, practice_stepped_at = now() where id = p_event;
        insert into public.bulletins (event_id, kind, title, body, published_at)
        values (p_event, 'GENERAL', 'Practice market open',
                'Finance funds: you each have $60,000 to trade a practice market of six companies until the IPO opens. '
                || 'Watch the news. Your result is added to your fund cash when Round 2 starts.', now());
        v_out := v_out || 'practice market opened'::text;
      else
        -- One step every 20 seconds (every 2 seconds in a fast rehearsal).
        v_every := make_interval(secs => greatest(2, 20.0 / greatest(v_event.clock_speed, 1)));
        if now() >= v_event.practice_stepped_at + v_every then
          perform app.practice_step(p_event, v_event.practice_step + 1);
          -- No broadcast: every message re-reads every screen of the night; the practice page refreshes itself.
          update public.events set practice_step = practice_step + 1, practice_stepped_at = now() where id = p_event;
        end if;
      end if;
      -- Every admitted fund has an account (a team admitted late gets one too).
      insert into public.practice_accounts (team_id, event_id, grant_cents, cash_cents)
      select t.id, p_event, app.practice_grant(), app.practice_grant() from public.teams t
       where t.event_id = p_event and t.track = 'FINANCE' and app.team_admitted(t.id)
      on conflict (team_id) do nothing;
    elsif v_event.current_phase in ('PRESSURE', 'SATURATION', 'CLOSE', 'SETTLEMENT', 'APPEALS', 'AWARDS')
          and v_event.practice_step >= 0 then
      v_n := app.practice_settle(p_event);
      v_out := v_out || ('practice settled ' || v_n);
    end if;
  exception when others then
    insert into public.error_log (event_id, source, message, context)
    values (p_event, 'practice', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  end;
  return v_out;
end
$$;

select app.patch_functions(
  '    v_actions := v_actions || app.primus_tick(p_event);',
  '    v_actions := v_actions || app.primus_tick(p_event);
    v_actions := v_actions || app.practice_tick(p_event);');

-- A fund's order on the practice market: fills at once at the current price.
create or replace function public.practice_trade(p_stock uuid, p_side text, p_qty integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_event public.events;
  v_stock public.practice_stocks;
  v_acct public.practice_accounts;
  v_held public.practice_holdings;
  v_cost bigint;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can trade' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  select * into v_team from public.teams where id = app.my_team_id();
  select * into v_event from public.events where id = v_team.event_id;
  if v_team.track <> 'FINANCE' then
    return app.fail('NOT_A_FUND', 'Only Finance teams trade on the practice market.');
  end if;
  if not app.practice_open(v_event) then
    return app.fail('PRACTICE_CLOSED', 'The practice market is not open now.');
  end if;
  if p_side not in ('BUY', 'SELL') then
    return app.fail('NO_SIDE', 'Choose BUY or SELL.');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    return app.fail('BAD_QUANTITY', 'Enter 1 to 100,000 shares.');
  end if;
  select * into v_stock from public.practice_stocks where id = p_stock and event_id = v_event.id for share;
  if v_stock.id is null then
    return app.fail('NO_STOCK', 'Choose a practice stock.');
  end if;
  insert into public.practice_accounts (team_id, event_id, grant_cents, cash_cents)
  values (v_team.id, v_event.id, app.practice_grant(), app.practice_grant())
  on conflict (team_id) do nothing;
  select * into v_acct from public.practice_accounts where team_id = v_team.id for update;
  select * into v_held from public.practice_holdings where team_id = v_team.id and stock_id = p_stock for update;
  v_cost := p_qty::bigint * v_stock.price_cents;
  if p_side = 'BUY' then
    if v_cost > v_acct.cash_cents then
      return app.fail('NO_CASH', format('That costs %s; you have %s in practice cash.',
        to_char(v_cost / 100.0, 'FM$999,999,990.00'), to_char(v_acct.cash_cents / 100.0, 'FM$999,999,990.00')));
    end if;
    update public.practice_accounts set cash_cents = cash_cents - v_cost where team_id = v_team.id;
    insert into public.practice_holdings (team_id, stock_id, qty, cost_cents) values (v_team.id, p_stock, p_qty, v_cost)
    on conflict (team_id, stock_id) do update set qty = practice_holdings.qty + excluded.qty,
                                                   cost_cents = practice_holdings.cost_cents + excluded.cost_cents;
  else
    if coalesce(v_held.qty, 0) < p_qty then
      return app.fail('NOT_ENOUGH_SHARES', format('You hold %s shares of %s.', coalesce(v_held.qty, 0), v_stock.symbol));
    end if;
    update public.practice_accounts set cash_cents = cash_cents + v_cost where team_id = v_team.id;
    update public.practice_holdings
       set qty = qty - p_qty,
           cost_cents = case when qty = p_qty then 0 else cost_cents - (cost_cents * p_qty / qty) end
     where team_id = v_team.id and stock_id = p_stock;
  end if;
  insert into public.practice_trades (event_id, team_id, stock_id, side, qty, price_cents, step)
  values (v_event.id, v_team.id, p_stock, p_side, p_qty, v_stock.price_cents, v_event.practice_step);
  return app.ok(jsonb_build_object('side', p_side, 'qty', p_qty, 'symbol', v_stock.symbol, 'price_cents', v_stock.price_cents,
                                   'total_cents', v_cost));
end
$$;
revoke all on function public.practice_trade(uuid, text, integer) from public, anon;
grant execute on function public.practice_trade(uuid, text, integer) to authenticated;

revoke all on function app.practice_tick(uuid), app.practice_step(uuid, integer), app.practice_settle(uuid),
  app.practice_list(uuid), app.practice_grant(), app.practice_open(public.events), app.practice_z()
  from public, anon, authenticated;

-- Finance: return on all money received, the practice market's $60,000 included.
select app.patch_functions(
  '    from (select l.team_id, sum(l.cash_delta_cents) as capital from public.ledger_entries l
           where l.event_id = p_event and l.kind in (''STARTING_CASH'', ''INJECTION'') and l.team_id is not null group by l.team_id) x',
  '    from (select y.team_id, sum(y.amount) as capital from (
            select l.team_id, l.cash_delta_cents as amount from public.ledger_entries l
             where l.event_id = p_event and l.kind in (''STARTING_CASH'', ''INJECTION'') and l.team_id is not null
            union all
            select a.team_id, a.grant_cents from public.practice_accounts a
             where a.event_id = p_event and a.settled_at is not null) y group by y.team_id) x');

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261124000058'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
