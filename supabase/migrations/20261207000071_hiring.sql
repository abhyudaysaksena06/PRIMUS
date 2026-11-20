-- The hiring platform for the 20 Nov night: a firm's base rate, the minimum bid, a seeded draw for the companies that
-- did not hire, and "locked = gone".
--
-- 1. Base rate (app.firm_base_rate). Every Consulting firm has a base rate: 2% of a company (2,000 of its 100,000
--    shares) plus 0.04% for each point its Round 1 ZestUp memo scored above 50 (less below), kept between 1% and 4%:
--        basis points = clamp(200 + 4 × (score − 50), 100, 400)       score 50 → 2%, 25 or less → 1%, 100 → 4%
--    The score is the released MEMO score of the firm's own squad company (scores are kept per company). A firm with
--    no released memo score, or no squad, has 2%. Released scores are public, so the rate reveals nothing new.
--
-- 2. Minimum bid (switch hire_min_bid, app.min_bid_problem). An offer either way (make_offer, make_offer_to, a counter,
--    and the binding accept, which checks the terms again like app.offer_problem does) is refused with BELOW_MIN_BID
--    when it is worth less than the firm's base rate of the company at today's price:
--        value = cash + shares × market price          minimum = base-rate shares × market price
--    Off: no minimum, as before.
--
-- 3. The draw (switch hire_base_rate, app.assign_firms_by_draw). When hiring closes (crises 1–4 and Round 3), every
--    company that has not hired gets a firm by a seeded draw that anyone with the seed can replay (app.hire_draw):
--      - the lottery's generator (app.rng_new / app.rng_shuffle), root = SHA-256(seed || dice) exactly as the squad
--        draw (event_secrets.seed, events.dice), stream 'hire:' || k, so every sub-round has its own draw;
--      - the companies that have not hired (drawn, and checked in while the desk is on: the 066 rule) are shuffled,
--        then the firms with room (drawn, checked in while the desk is on, fewer than 2 clients);
--      - in the shuffled company order, each company takes the least busy firm, ties going to the firm earlier in the
--        shuffled firm order, so clients still spread evenly (as before) and a firm never has more than 2;
--      - the fee is THAT firm's base rate in shares, held exactly like an accepted share offer: the engagement holds
--        the shares (escrow HELD), they stay in the company's retained lot and count against its 40,000-share floor
--        until the due time, when they go to the firm if its memo is in (app.settle_engagements, unchanged);
--      - if the floor blocks those shares, the fee is their cash value at the market price, never more than the
--        company's cash, held in escrow as cash (the same ESCROW_HOLD ledger pair as an accepted cash offer).
--    Off: the least busy firm at the base fee in cash ($22,500; Round 3: 10% of cash), exactly as before.
--
-- 4. Locked = gone. After each accepted offer every screen hears 'hire_locked' on the event channel ({k, company,
--    firm, firm_full}) and after a pass of assignments one {k, assigned: true}: the screens re-read (lib/live/channel)
--    and the hire lists, computed on the server, no longer show the hired company or the full firm. The assigned
--    firm and company each hear an 'offers' message saying so (now with the ticker, the firm and its rate).
--
-- 5. firm_values lists, once the event has drawn, only the firms in a drawn squad (an absent firm is not listed), and
--    gives each firm's base rate and, for a Product team, the minimum bid for its own company in cents.

-- ─────────────── 1. Base rate ───────────────

create or replace function app.firm_base_rate(p_firm uuid)
returns integer
language sql stable
as $$
  select coalesce(
    (select greatest(100, least(400, 200 + 4 * (sc.final_score - 50)))::int
       from public.squads s
       join public.companies c on c.squad_id = s.id
       join public.scores sc on sc.company_id = c.id and sc.type = 'MEMO' and sc.status = 'RELEASED'
      where s.consulting_team_id = p_firm and sc.final_score is not null),
    200)
$$;
revoke all on function app.firm_base_rate(uuid) from public, anon, authenticated;

-- ─────────────── 2. Minimum bid ───────────────

-- Why an offer is below the firm's minimum bid, or null (also null while the switch is off or there is no price).
-- p_firm_side: the firm is the one proposing (its pitch, its counter, its accept), so the text speaks to the firm.
create or replace function app.min_bid_problem(p_company public.companies, p_firm uuid, p_cash bigint, p_shares int, p_firm_side boolean)
returns text
language plpgsql stable
as $$
declare
  v_price bigint := coalesce(p_company.market_price, 0);
  v_bp int;
  v_min bigint;
  v_about text;
begin
  if v_price <= 0 or not app.feature_on(p_company.event_id, 'hire_min_bid') then
    return null;
  end if;
  v_bp := app.firm_base_rate(p_firm);
  -- base-rate shares = 100,000 × bp / 10,000 = bp × 10
  v_min := v_bp::bigint * 10 * v_price;
  if greatest(coalesce(p_cash, 0), 0) + greatest(coalesce(p_shares, 0), 0)::bigint * v_price >= v_min then
    return null;
  end if;
  -- "about": rounded up to the next $100, so offering the amount shown is always enough.
  v_about := to_char(ceil(v_min / 10000.0) * 100, 'FM$999,999,990');
  if p_firm_side then
    return format('Your minimum bid is %s%% of %s (about %s).', trim_scale(v_bp / 100.0), coalesce(p_company.ticker, 'the company'), v_about);
  end if;
  return format('This firm''s minimum bid is %s%% of your company (about %s).', trim_scale(v_bp / 100.0), v_about);
end
$$;
revoke all on function app.min_bid_problem(public.companies, uuid, bigint, int, boolean) from public, anon, authenticated;

-- ─────────────── 3. The draw ───────────────

-- The draw itself, pure (like app.lottery_draw), so anyone with the seed can replay it. p_companies: the Product team
-- codes of the companies to place; p_firms: the Consulting team codes of the firms with room, p_clients their clients
-- this sub-round so far (same order as p_firms). Both lists are put in code order first, so the caller's order does not
-- matter. Returns [{company, firm}] in the order the companies were drawn; firm is null once every firm is full.
create or replace function app.hire_draw(p_root text, p_k int, p_companies text[], p_firms text[], p_clients int[])
returns jsonb
language plpgsql immutable parallel safe
as $$
declare
  st app.rng_state;
  rec record;
  v_companies text[];
  v_firms text[];
  v_load int[];
  v_out jsonb := '[]'::jsonb;
  i int;
  j int;
  best int;
begin
  if coalesce(array_length(p_firms, 1), 0) <> coalesce(array_length(p_clients, 1), 0) then
    raise exception 'one client count per firm';
  end if;
  st := app.rng_new(p_root, 'hire:' || p_k);
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_companies) x order by x collate "C"));
    st := rec.st; v_companies := rec.result;
  select * into rec from app.rng_shuffle(st, array(select x from unnest(p_firms) x order by x collate "C"));
    st := rec.st; v_firms := rec.result;
  v_load := array(select p_clients[array_position(p_firms, f.code)] from unnest(v_firms) with ordinality f(code, n) order by f.n);
  for i in 1..coalesce(array_length(v_companies, 1), 0) loop
    best := null;
    for j in 1..coalesce(array_length(v_firms, 1), 0) loop
      if v_load[j] < 2 and (best is null or v_load[j] < v_load[best]) then
        best := j;
      end if;
    end loop;
    if best is not null then
      v_load[best] := v_load[best] + 1;
    end if;
    v_out := v_out || jsonb_build_object('company', v_companies[i], 'firm', case when best is null then null else v_firms[best] end);
  end loop;
  return v_out;
end
$$;
revoke all on function app.hire_draw(text, int, text[], text[], int[]) from public, anon, authenticated;

-- Places every company that has not hired by the draw, each at its firm's base rate. Called by
-- app.assign_default_firms when the switch is on (in the tick, as hiring closes, before open offers lapse).
create or replace function app.assign_firms_by_draw(p_event uuid, p_k int)
returns int
language plpgsql
as $$
declare
  v_event public.events;
  v_seed text;
  v_firm_codes text[];
  v_firm_loads int[];
  v_draw jsonb;
  d jsonb;
  v_company public.companies;
  v_firm uuid;
  v_bp int;
  v_shares int;
  v_cash bigint;
  v_fee bigint;
  v_retained int;
  v_promised int;
  v_eng public.engagements;
  v_txn uuid;
  v_done int := 0;
begin
  select * into v_event from public.events where id = p_event;
  select s.seed into v_seed from public.event_secrets s where s.event_id = p_event;
  select coalesce(array_agg(f.code order by f.code collate "C"), '{}'), coalesce(array_agg(f.n order by f.code collate "C"), '{}')
    into v_firm_codes, v_firm_loads
    from (select t.code, (select count(*) from public.engagements e where e.firm_team_id = t.id and e.k = p_k)::int as n
            from public.teams t
           where t.event_id = p_event and t.track = 'CONSULTING'
             and (not v_event.desk_check_in or t.checked_in_at is not null)
             and exists (select 1 from public.squads s where s.consulting_team_id = t.id)) f
   where f.n < 2;
  v_draw := app.hire_draw(
    app.sha256_hex(coalesce(v_seed, p_event::text) || coalesce(v_event.dice, '')),
    p_k,
    array(select pt.code from public.companies c join public.teams pt on pt.id = c.product_team_id
           where c.event_id = p_event and c.squad_id is not null
             and not exists (select 1 from public.engagements e where e.company_id = c.id and e.k = p_k)
             and (not v_event.desk_check_in or pt.checked_in_at is not null)),
    v_firm_codes,
    v_firm_loads);

  for d in select x from jsonb_array_elements(v_draw) x loop
    exit when d ->> 'firm' is null; -- every firm is full: the rest keep going without one.
    select c.* into v_company from public.companies c join public.teams pt on pt.id = c.product_team_id
     where c.event_id = p_event and pt.code = d ->> 'company';
    select t.id into v_firm from public.teams t where t.event_id = p_event and t.code = d ->> 'firm';
    v_bp := app.firm_base_rate(v_firm);
    v_shares := v_bp * 10;
    select cash_cents into v_cash from public.teams where id = v_company.product_team_id for update;
    -- The 40,000-share floor counts the shares already promised to a firm and not yet handed over (as offers do).
    select coalesce(sum(h.qty), 0) into v_retained from public.holdings h
     where h.team_id = v_company.product_team_id and h.company_id = v_company.id and h.lot = 'RETAINED';
    select coalesce(sum(e.shares), 0) into v_promised from public.engagements e
     where e.company_id = v_company.id and e.escrow = 'HELD';
    if v_retained - v_promised - v_shares >= app.min_retained_shares() then
      v_fee := 0;
    else
      -- The floor blocks the shares: their value in cash at today's price, never more than the company has.
      v_fee := least(v_shares::bigint * coalesce(v_company.market_price, 0), greatest(coalesce(v_cash, 0), 0));
      v_shares := 0;
    end if;
    v_txn := gen_random_uuid();
    insert into public.engagements (event_id, k, company_id, firm_team_id, cash_cents, shares, assigned)
    values (p_event, p_k, v_company.id, v_firm, v_fee, v_shares, true)
    returning * into v_eng;
    if v_fee > 0 then
      update public.teams set cash_cents = cash_cents - v_fee where id = v_company.product_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents + v_fee where id = p_event;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo) values
        (p_event, v_txn, 'ESCROW_HOLD', v_company.product_team_id, v_company.id, -v_fee, 'engagements', v_eng.id, 'Assigned firm: fee into escrow'),
        (p_event, v_txn, 'ESCROW_HOLD', null, v_company.id, v_fee, 'engagements', v_eng.id, 'Held by the exchange');
    end if;
    insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, cash_cents, shares, details)
    values (p_event, v_txn, 'HIRE', format('%s was assigned a firm by the draw (%s)', coalesce(v_company.ticker, 'A company'),
              case when p_k = 5 then 'Round 3' else 'crisis ' || p_k end),
            v_company.id, v_company.ticker, v_fee, v_shares,
            jsonb_build_object('k', p_k, 'firm', v_firm, 'assigned', true, 'draw', true, 'base_rate_bp', v_bp));
    perform app.broadcast_offer(p_event, jsonb_build_object('assigned', true, 'draw', true, 'k', p_k, 'ticker', v_company.ticker,
              'firm_code', d ->> 'firm', 'base_rate_bp', v_bp), v_firm, v_company.product_team_id);
    v_done := v_done + 1;
  end loop;
  -- Locked = gone: one message for the whole pass.
  if v_done > 0 then
    perform app.broadcast(p_event, 'hire_locked', jsonb_build_object('k', p_k, 'assigned', true));
  end if;
  return v_done;
end
$$;
revoke all on function app.assign_firms_by_draw(uuid, int) from public, anon, authenticated;

-- ─────────────── 5. firm_values: drawn firms only, with the base rate and the minimum bid ───────────────

drop function if exists public.firm_values(uuid);
create function public.firm_values(p_event uuid)
returns table (team_id uuid, code text, name text, cash_cents bigint, fee_share_value_cents bigint, value_cents bigint,
               clients integer, avg_rating numeric, base_rate_bp integer, min_bid_cents bigint)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.code, t.name, t.cash_cents,
         coalesce((select sum(h.qty::bigint * coalesce(c.market_price, 0)) from public.holdings h
                     join public.companies c on c.id = h.company_id where h.team_id = t.id and h.lot = 'FEE'), 0)::bigint,
         t.cash_cents + coalesce((select sum(h.qty::bigint * coalesce(c.market_price, 0)) from public.holdings h
                     join public.companies c on c.id = h.company_id where h.team_id = t.id and h.lot = 'FEE'), 0)::bigint,
         (select count(*) from public.engagements e where e.firm_team_id = t.id)::int,
         (select round(avg(e.rating), 2) from public.engagements e where e.firm_team_id = t.id and e.rating is not null),
         app.firm_base_rate(t.id),
         -- For a Product team: the firm's base rate of its own company at today's price (null for anyone else).
         app.firm_base_rate(t.id)::bigint * 10
           * (select c.market_price from public.companies c where c.product_team_id = app.my_team_id() and c.event_id = p_event)
    from public.teams t
   where t.event_id = p_event and t.track = 'CONSULTING'
     and (p_event = app.my_event_id() or app.is_staff())
     and ((select e.drawn_at from public.events e where e.id = p_event) is null
          or exists (select 1 from public.squads s where s.consulting_team_id = t.id))
   order by 6 desc, t.code
$$;
revoke all on function public.firm_values(uuid) from public, anon;
grant execute on function public.firm_values(uuid) to authenticated;

-- ─────────────── The offer functions and the hiring close, from their current definitions ───────────────
-- (Each is its definition as of migration 070 with only the lines marked here added.)

create or replace function public.make_offer(p_firm uuid, p_cash bigint, p_shares integer, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_firm public.teams;
  v_k smallint;
  v_problem text;
  v_offer public.offers;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can make an offer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'PRODUCT' then
    return app.fail('NOT_ALLOWED', 'Only a Product team hires a firm.');
  end if;
  select * into v_company from public.companies where product_team_id = v_team.id for no key update;
  select * into v_firm from public.teams where id = p_firm and event_id = v_team.event_id and track = 'CONSULTING';
  if v_firm.id is null then
    return app.fail('NO_SUCH_FIRM', 'No such Consulting firm.');
  end if;
  v_k := app.hiring_subround(v_team.event_id);
  if v_k is null then
    return app.fail('HIRING_CLOSED', 'Hiring is not open now.');
  end if;
  if exists (select 1 from public.engagements where company_id = v_company.id and k = v_k) then
    return app.fail('ALREADY_HIRED', 'Your company has already hired a firm this sub-round.');
  end if;
  if (select count(*) from public.engagements where firm_team_id = p_firm and k = v_k) >= 2 then
    return app.fail('FIRM_FULL', 'That firm already has two clients this sub-round.');
  end if;
  if exists (select 1 from public.offers where company_id = v_company.id and firm_team_id = p_firm and k = v_k and status = 'OPEN') then
    return app.fail('OFFER_OPEN', 'You already have an open offer with that firm.');
  end if;
  if (select count(*) from public.offers where company_id = v_company.id and k = v_k and status = 'OPEN'
         and opened_by = 'COMPANY') >= 5 then
    return app.fail('TOO_MANY_OFFERS', 'You can have at most 5 open offers at once. Withdraw one or wait for an answer.');
  end if;
  v_problem := app.offer_problem(v_company, v_k, coalesce(p_cash, 0), coalesce(p_shares, 0));
  if v_problem is not null then
    return app.fail('BAD_TERMS', v_problem);
  end if;
  -- The firm's minimum bid (switch hire_min_bid): its base rate of the company, valued at today's price.
  v_problem := app.min_bid_problem(v_company, p_firm, coalesce(p_cash, 0), coalesce(p_shares, 0), false);
  if v_problem is not null then
    return app.fail('BELOW_MIN_BID', v_problem);
  end if;
  insert into public.offers (event_id, k, company_id, firm_team_id, cash_cents, shares, note, turn)
  values (v_team.event_id, v_k, v_company.id, p_firm, coalesce(p_cash, 0), coalesce(p_shares, 0), left(btrim(coalesce(p_note, '')), 300), 'FIRM')
  returning * into v_offer;
  perform app.broadcast_offer(v_team.event_id, '{}'::jsonb, p_firm, v_company.product_team_id);
  return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
end
$$;

create or replace function public.make_offer_to(p_company uuid, p_cash bigint, p_shares integer, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_k smallint;
  v_problem text;
  v_offer public.offers;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can make an offer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'CONSULTING' then
    return app.fail('NOT_ALLOWED', 'Only a Consulting firm pitches a company.');
  end if;
  select * into v_company from public.companies where id = p_company and event_id = v_team.event_id for no key update;
  if v_company.id is null then
    return app.fail('NO_SUCH_COMPANY', 'No such company.');
  end if;
  v_k := app.hiring_subround(v_team.event_id);
  if v_k is null then
    return app.fail('HIRING_CLOSED', 'Hiring is not open now.');
  end if;
  if exists (select 1 from public.engagements where company_id = v_company.id and k = v_k) then
    return app.fail('ALREADY_HIRED', 'That company has already hired a firm this sub-round.');
  end if;
  if (select count(*) from public.engagements where firm_team_id = v_team.id and k = v_k) >= 2 then
    return app.fail('FIRM_FULL', 'You already have two clients this sub-round.');
  end if;
  if exists (select 1 from public.offers where company_id = v_company.id and firm_team_id = v_team.id and k = v_k and status = 'OPEN') then
    return app.fail('OFFER_OPEN', 'You already have an open offer with that company.');
  end if;
  v_problem := app.offer_problem(v_company, v_k, coalesce(p_cash, 0), coalesce(p_shares, 0));
  if v_problem is not null then
    return app.fail('BAD_TERMS', v_problem);
  end if;
  -- The firm's minimum bid (switch hire_min_bid): its base rate of the company, valued at today's price.
  v_problem := app.min_bid_problem(v_company, v_team.id, coalesce(p_cash, 0), coalesce(p_shares, 0), true);
  if v_problem is not null then
    return app.fail('BELOW_MIN_BID', v_problem);
  end if;
  insert into public.offers (event_id, k, company_id, firm_team_id, cash_cents, shares, note, turn, opened_by)
  values (v_team.event_id, v_k, v_company.id, v_team.id, coalesce(p_cash, 0), coalesce(p_shares, 0),
          left(btrim(coalesce(p_note, '')), 300), 'COMPANY', 'FIRM')
  returning * into v_offer;
  perform app.broadcast_offer(v_team.event_id, '{}'::jsonb, v_team.id, v_company.product_team_id);
  return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
end
$$;

create or replace function public.respond_offer(p_offer uuid, p_action text, p_cash bigint default null, p_shares integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_offer public.offers;
  v_company public.companies;
  v_side text;
  v_problem text;
  v_eng public.engagements;
  v_txn uuid := gen_random_uuid();
begin
  if app.my_team_id() is null then
    raise exception 'only a team can answer an offer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  select * into v_offer from public.offers where id = p_offer and event_id = v_team.event_id;
  if v_offer.id is null then
    return app.fail('NO_SUCH_OFFER', 'No such offer.');
  end if;
  select * into v_company from public.companies where id = v_offer.company_id;
  v_side := case when v_team.id = v_offer.firm_team_id then 'FIRM' when v_team.id = v_company.product_team_id then 'COMPANY' end;
  if v_side is null then
    return app.fail('NOT_ALLOWED', 'This offer is not yours.');
  end if;
  -- Both teams are locked in id order before the offer, so two answers never interleave.
  perform 1 from public.teams where id in (v_offer.firm_team_id, v_company.product_team_id) order by id for no key update;
  select * into v_offer from public.offers where id = p_offer for no key update;
  if v_offer.status <> 'OPEN' then
    return app.fail('OFFER_CLOSED', format('This offer is %s.', lower(v_offer.status)));
  end if;
  if app.hiring_subround(v_team.event_id) is distinct from v_offer.k then
    return app.fail('HIRING_CLOSED', 'Hiring for this sub-round has closed.');
  end if;
  p_action := upper(coalesce(p_action, ''));
  if p_action = 'WITHDRAW' then
    if v_side <> 'COMPANY' then
      return app.fail('NOT_ALLOWED', 'Only the company withdraws its offer.');
    end if;
    update public.offers set status = 'WITHDRAWN', decided_at = now(), updated_at = now() where id = p_offer returning * into v_offer;
    return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
  end if;
  if v_offer.turn <> v_side then
    return app.fail('NOT_YOUR_TURN', 'Wait for the other side to answer.');
  end if;
  if p_action = 'DECLINE' then
    update public.offers set status = 'DECLINED', decided_at = now(), updated_at = now() where id = p_offer returning * into v_offer;
    perform app.broadcast_offer(v_team.event_id, jsonb_build_object('offer', p_offer), v_offer.firm_team_id, v_company.product_team_id);
    return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
  elsif p_action = 'COUNTER' then
    if (v_side = 'FIRM' and v_offer.firm_counters >= 3) or (v_side = 'COMPANY' and v_offer.company_counters >= 3) then
      return app.fail('NO_COUNTERS_LEFT', 'You have used your three counters: accept or decline.');
    end if;
    v_problem := app.offer_problem(v_company, v_offer.k, coalesce(p_cash, -1), coalesce(p_shares, -1));
    if v_problem is not null then
      return app.fail('BAD_TERMS', v_problem);
    end if;
    -- The firm's minimum bid (switch hire_min_bid): its base rate of the company, valued at today's price.
    v_problem := app.min_bid_problem(v_company, v_offer.firm_team_id, p_cash, p_shares, v_side = 'FIRM');
    if v_problem is not null then
      return app.fail('BELOW_MIN_BID', v_problem);
    end if;
    update public.offers set cash_cents = p_cash, shares = p_shares, updated_at = now(),
           turn = case v_side when 'FIRM' then 'COMPANY' else 'FIRM' end,
           firm_counters = firm_counters + (v_side = 'FIRM')::int, company_counters = company_counters + (v_side = 'COMPANY')::int
     where id = p_offer returning * into v_offer;
    perform app.broadcast_offer(v_team.event_id, jsonb_build_object('offer', p_offer), v_offer.firm_team_id, v_company.product_team_id);
    return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
  elsif p_action <> 'ACCEPT' then
    return app.fail('BAD_ACTION', 'Accept, decline or counter.');
  end if;

  -- Accept: binding. Capacity and the terms are checked again now.
  if exists (select 1 from public.engagements where company_id = v_company.id and k = v_offer.k) then
    return app.fail('ALREADY_HIRED', 'The company has already hired a firm this sub-round.');
  end if;
  if (select count(*) from public.engagements where firm_team_id = v_offer.firm_team_id and k = v_offer.k) >= 2 then
    return app.fail('FIRM_FULL', 'The firm already has two clients this sub-round.');
  end if;
  v_problem := app.offer_problem(v_company, v_offer.k, v_offer.cash_cents, v_offer.shares);
  if v_problem is not null then
    return app.fail('BAD_TERMS', v_problem);
  end if;
  -- The firm's minimum bid (switch hire_min_bid): its base rate of the company, valued at today's price.
  v_problem := app.min_bid_problem(v_company, v_offer.firm_team_id, v_offer.cash_cents, v_offer.shares, v_side = 'FIRM');
  if v_problem is not null then
    return app.fail('BELOW_MIN_BID', v_problem);
  end if;
  update public.offers set status = 'ACCEPTED', decided_at = now(), updated_at = now() where id = p_offer returning * into v_offer;
  -- The company's other open offers this sub-round lapse; so do the firm's if it is now full.
  update public.offers set status = 'LAPSED', decided_at = now(), updated_at = now()
   where status = 'OPEN' and k = v_offer.k and (company_id = v_company.id
      or (firm_team_id = v_offer.firm_team_id and (select count(*) from public.engagements e
           where e.firm_team_id = v_offer.firm_team_id and e.k = v_offer.k) >= 1));
  insert into public.engagements (event_id, k, company_id, firm_team_id, offer_id, cash_cents, shares)
  values (v_offer.event_id, v_offer.k, v_company.id, v_offer.firm_team_id, v_offer.id, v_offer.cash_cents, v_offer.shares)
  returning * into v_eng;
  if v_offer.cash_cents > 0 then
    update public.teams set cash_cents = cash_cents - v_offer.cash_cents where id = v_company.product_team_id;
    update public.events set exchange_cash_cents = exchange_cash_cents + v_offer.cash_cents where id = v_offer.event_id;
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo) values
      (v_offer.event_id, v_txn, 'ESCROW_HOLD', v_company.product_team_id, v_company.id, -v_offer.cash_cents, 'engagements', v_eng.id, 'Consulting fee into escrow'),
      (v_offer.event_id, v_txn, 'ESCROW_HOLD', null, v_company.id, v_offer.cash_cents, 'engagements', v_eng.id, 'Held by the exchange');
  end if;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, cash_cents, shares, details)
  values (v_offer.event_id, v_txn, 'HIRE', format('%s hired a firm (%s)', coalesce(v_company.ticker, 'A company'),
            case when v_offer.k = 5 then 'Round 3' else 'crisis ' || v_offer.k end),
          v_company.id, v_company.ticker, v_offer.cash_cents, v_offer.shares, jsonb_build_object('k', v_offer.k, 'firm', v_offer.firm_team_id));
  perform app.broadcast_offer(v_team.event_id, jsonb_build_object('offer', p_offer, 'accepted', true), v_offer.firm_team_id, v_company.product_team_id);
  -- Locked = gone: every screen re-reads, so the company (and the firm, once it has two clients) leaves every hire list.
  perform app.broadcast(v_team.event_id, 'hire_locked', jsonb_build_object(
    'k', v_offer.k, 'company', v_company.id, 'firm', v_offer.firm_team_id,
    'firm_full', (select count(*) from public.engagements e where e.firm_team_id = v_offer.firm_team_id and e.k = v_offer.k) >= 2));
  return app.ok(jsonb_build_object('offer', to_jsonb(v_offer), 'engagement', to_jsonb(v_eng)));
end
$$;

create or replace function app.assign_default_firms(p_event uuid, p_k int)
returns int
language plpgsql
as $$
declare
  v_company record;
  v_firm uuid;
  v_fee bigint;
  v_cash bigint;
  v_eng public.engagements;
  v_txn uuid;
  v_done int := 0;
begin
  -- Switch hire_base_rate: a seeded draw, each company at its firm's base rate (app.assign_firms_by_draw).
  if app.feature_on(p_event, 'hire_base_rate') then
    return app.assign_firms_by_draw(p_event, p_k);
  end if;
  -- Off: the least busy firm, at the base fee in cash, exactly as before.
  for v_company in
    select c.id, c.ticker, c.product_team_id from public.companies c
     where c.event_id = p_event
       and not exists (select 1 from public.engagements e where e.company_id = c.id and e.k = p_k)
       and (not (select ev.desk_check_in from public.events ev where ev.id = p_event)
            or exists (select 1 from public.teams pt where pt.id = c.product_team_id and pt.checked_in_at is not null))
     order by c.ticker nulls last, c.id
  loop
    -- The least busy firm this sub-round, then the lowest code: recomputed each time, so clients spread evenly.
    select t.id into v_firm from public.teams t
     where t.event_id = p_event and t.track = 'CONSULTING'
       and (t.checked_in_at is not null or not (select ev.desk_check_in from public.events ev where ev.id = p_event))
       and (select count(*) from public.engagements e where e.firm_team_id = t.id and e.k = p_k) < 2
     order by (select count(*) from public.engagements e where e.firm_team_id = t.id and e.k = p_k), t.code collate "C"
     limit 1;
    exit when v_firm is null; -- every firm is full: the rest keep going without one.

    select cash_cents into v_cash from public.teams where id = v_company.product_team_id for update;
    v_fee := case when p_k = 5 then greatest(coalesce(v_cash, 0), 0) / 10
                  else least(app.default_hire_fee(), greatest(coalesce(v_cash, 0), 0)) end;
    v_txn := gen_random_uuid();
    insert into public.engagements (event_id, k, company_id, firm_team_id, cash_cents, shares, assigned)
    values (p_event, p_k, v_company.id, v_firm, v_fee, 0, true)
    returning * into v_eng;
    if v_fee > 0 then
      update public.teams set cash_cents = cash_cents - v_fee where id = v_company.product_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents + v_fee where id = p_event;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo) values
        (p_event, v_txn, 'ESCROW_HOLD', v_company.product_team_id, v_company.id, -v_fee, 'engagements', v_eng.id, 'Assigned firm: fee into escrow'),
        (p_event, v_txn, 'ESCROW_HOLD', null, v_company.id, v_fee, 'engagements', v_eng.id, 'Held by the exchange');
    end if;
    insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, cash_cents, shares, details)
    values (p_event, v_txn, 'HIRE', format('%s was assigned a firm (%s)', coalesce(v_company.ticker, 'A company'),
              case when p_k = 5 then 'Round 3' else 'crisis ' || p_k end),
            v_company.id, v_company.ticker, v_fee, 0, jsonb_build_object('k', p_k, 'firm', v_firm, 'assigned', true));
    perform app.broadcast_offer(p_event, jsonb_build_object('assigned', true), v_firm, v_company.product_team_id);
    v_done := v_done + 1;
  end loop;
  -- Locked = gone: one message for the whole pass.
  if v_done > 0 then
    perform app.broadcast(p_event, 'hire_locked', jsonb_build_object('k', p_k, 'assigned', true));
  end if;
  return v_done;
end
$$;


create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261207000071'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
