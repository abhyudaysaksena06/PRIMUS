-- Scale to 200 teams per track (W1), only checked-in teams are drawn (W2), the practice market is one simulated
-- company per checked-in Finance team (W3).
--
-- 1. Limits: an event has 3 to 200 teams per track (the live event no longer needs exactly 50); up to 200 squads.
--    The registration desk hands out the next free card in numeric order (P9, P10, P100; it was text order).
-- 2. Switch draw_checked_in (migration 070): with it on, the squad draw takes only the teams that may play (checked
--    in at the desk; every team when the desk is off). When the tracks differ, the smallest track sets the number of
--    squads S: S teams of every larger track are picked by a seeded shuffle (stream 'seats' of the draw's own root,
--    so anyone with the seed and the dice can redo it) and the rest are left out. A team left out is no longer
--    checked in (it cannot sign in or play; its card stays). public.draw_records keeps who entered and who was left
--    out; public.draw_preview shows it before the draw. Switch off: every team is drawn, as before.
-- 3. Switch practice_verified: the Round 1 practice market has one simulated company per checked-in Finance team
--    (names and tickers fixed per event), prepared once by an organiser (public.prepare_practice_market, in chunks)
--    instead of by the first Finance page that loads. Switch off: the first Finance page prepares it, as before.
-- 4. An index for app.auto_submit_due_drafts, which every tick runs.

-- ───────────────────────────── 1. Limits ─────────────────────────────

alter table public.squads drop constraint if exists squads_number_check;
alter table public.squads add constraint squads_number_check check (number between 1 and 200);

select app.patch_functions(
$o$  if v_n_product not between 3 and 50 then
    raise exception 'between 3 and 50 teams per track are needed (got %)', v_n_product;
  end if;
  if not v_rehearsal and v_n_product <> 50 then
    raise exception 'the live event needs exactly 50 teams per track (got %)', v_n_product;
  end if;$o$,
$n$  if v_n_product not between 3 and 200 then
    raise exception 'between 3 and 200 teams per track are needed (got %)', v_n_product;
  end if;$n$);

-- The desk's next free card: numeric order within the track (codes share their letters, so the digits decide).
select app.patch_functions(
$o$     order by code limit 1 for update skip locked;$o$,
$n$     order by length(code), code limit 1 for update skip locked;$n$);

-- ───────────────────────────── 2. The draw: only checked-in teams ─────────────────────────────

-- Who entered the draw (rule CHECKED_IN), how many squads, and who was left out. One row per drawn event.
create table if not exists public.draw_records (
  event_id uuid primary key references public.events (id) on delete cascade,
  rule text not null check (rule = 'CHECKED_IN'),
  seats int not null check (seats >= 0),
  -- The teams that entered, by track: {"product": [codes], "consulting": [...], "finance": [...]}.
  entrants jsonb not null,
  -- The entrants of a larger track not picked for a squad, by track (same shape).
  left_out jsonb not null,
  left_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.draw_records enable row level security;
grant select on public.draw_records to authenticated;
create policy draw_records_read on public.draw_records for select to authenticated
  using ((select app.sees_all_events()) or event_id = (select app.my_event_id()));

-- The seats: S = the smallest track. A track with more than S teams is shuffled (one 'seats' stream for the draw, used
-- by Product, then Consulting, then Finance, only by the tracks that are larger than S) and its first S teams are
-- drawn. Pure, so the record can be checked: the engine mirror is the same Fisher–Yates shuffle (Rng(root, "seats")).
create or replace function app.lottery_seats(p_root text, p_product text[], p_consulting text[], p_finance text[])
returns jsonb
language plpgsql immutable parallel safe
as $$
declare
  v_seats int := least(coalesce(array_length(p_product, 1), 0), coalesce(array_length(p_consulting, 1), 0),
                       coalesce(array_length(p_finance, 1), 0));
  v_keys text[] := array['product', 'consulting', 'finance'];
  st app.rng_state := app.rng_new(p_root, 'seats');
  rec record;
  v_sorted text[];
  v_drawn jsonb := '{}'::jsonb;
  v_left jsonb := '{}'::jsonb;
  i int;
begin
  for i in 1..3 loop
    v_sorted := array(select x from unnest(case i when 1 then p_product when 2 then p_consulting else p_finance end) x
                       order by x collate "C");
    if coalesce(array_length(v_sorted, 1), 0) > v_seats then
      select * into rec from app.rng_shuffle(st, v_sorted);
      st := rec.st;
      v_drawn := v_drawn || jsonb_build_object(v_keys[i],
        to_jsonb(array(select x from unnest(rec.result[1:v_seats]) x order by x collate "C")));
      v_left := v_left || jsonb_build_object(v_keys[i],
        to_jsonb(array(select x from unnest(rec.result[v_seats + 1:]) x order by x collate "C")));
    else
      v_drawn := v_drawn || jsonb_build_object(v_keys[i], to_jsonb(v_sorted));
      v_left := v_left || jsonb_build_object(v_keys[i], '[]'::jsonb);
    end if;
  end loop;
  return jsonb_build_object('seats', v_seats, 'drawn', v_drawn, 'left_out', v_left);
end
$$;
revoke all on function app.lottery_seats(text, text[], text[], text[]) from public, anon, authenticated;

-- The squads for run_lottery. Switch off: every team of the event (a card the desk has not admitted is an empty
-- seat), exactly as before. Switch on: only the teams that may play; see app.lottery_seats.
create or replace function app.squad_draw(p_event uuid, p_root text)
returns jsonb
language plpgsql
as $$
declare
  v_event public.events;
  v_cards text[] := array(select pc.number::text from public.problem_cards pc where pc.event_id = p_event order by pc.number);
  v_seats jsonb;
  v_left text[];
  v_entrants jsonb;
begin
  if not app.feature_on(p_event, 'draw_checked_in') then
    return app.lottery_draw(
      p_root,
      array(select code from public.teams where event_id = p_event and track = 'PRODUCT'),
      array(select code from public.teams where event_id = p_event and track = 'CONSULTING'),
      array(select code from public.teams where event_id = p_event and track = 'FINANCE'),
      v_cards);
  end if;
  select * into v_event from public.events where id = p_event;
  v_entrants := jsonb_build_object(
    'product', to_jsonb(array(select t.code from public.teams t where t.event_id = p_event and t.track = 'PRODUCT'
                                 and app.team_admitted(t.id) order by t.code collate "C")),
    'consulting', to_jsonb(array(select t.code from public.teams t where t.event_id = p_event and t.track = 'CONSULTING'
                                    and app.team_admitted(t.id) order by t.code collate "C")),
    'finance', to_jsonb(array(select t.code from public.teams t where t.event_id = p_event and t.track = 'FINANCE'
                                 and app.team_admitted(t.id) order by t.code collate "C")));
  v_seats := app.lottery_seats(p_root,
    array(select jsonb_array_elements_text(v_entrants -> 'product')),
    array(select jsonb_array_elements_text(v_entrants -> 'consulting')),
    array(select jsonb_array_elements_text(v_entrants -> 'finance')));
  if (v_seats ->> 'seats')::int < 3 then
    raise exception 'the draw needs at least 3 checked-in teams in every track (the smallest track has %)', v_seats ->> 'seats';
  end if;

  -- A team left out can no longer play: it is no longer checked in (with the desk off, nobody is ever left out).
  v_left := array(select jsonb_array_elements_text(v_seats -> 'left_out' -> k) from unnest(array['product', 'consulting', 'finance']) k);
  if coalesce(cardinality(v_left), 0) > 0 then
    update public.teams set checked_in_at = null, checked_in_by = null
     where event_id = p_event and code = any (v_left) and checked_in_at is not null;
  end if;
  insert into public.draw_records (event_id, rule, seats, entrants, left_out, left_count)
  values (p_event, 'CHECKED_IN', (v_seats ->> 'seats')::int, v_entrants, v_seats -> 'left_out', coalesce(cardinality(v_left), 0))
  on conflict (event_id) do update
    set rule = excluded.rule, seats = excluded.seats, entrants = excluded.entrants, left_out = excluded.left_out,
        left_count = excluded.left_count, created_at = now();
  perform app.log_event(p_event, 'CONTROL', format('Squad draw: %s squads from the checked-in teams (%s Product, %s Consulting, %s Finance); %s left out%s',
    v_seats ->> 'seats', jsonb_array_length(v_entrants -> 'product'), jsonb_array_length(v_entrants -> 'consulting'),
    jsonb_array_length(v_entrants -> 'finance'), coalesce(cardinality(v_left), 0),
    case when coalesce(cardinality(v_left), 0) > 0 then ': ' || array_to_string(v_left, ', ') else '' end));

  return app.lottery_draw(
    p_root,
    array(select jsonb_array_elements_text(v_seats -> 'drawn' -> 'product')),
    array(select jsonb_array_elements_text(v_seats -> 'drawn' -> 'consulting')),
    array(select jsonb_array_elements_text(v_seats -> 'drawn' -> 'finance')),
    v_cards);
end
$$;
revoke all on function app.squad_draw(uuid, text) from public, anon, authenticated;

select app.patch_functions(
$o$  v_draw := app.lottery_draw(
    v_root,
    array(select code from public.teams where event_id = p_event and track = 'PRODUCT'),
    array(select code from public.teams where event_id = p_event and track = 'CONSULTING'),
    array(select code from public.teams where event_id = p_event and track = 'FINANCE'),
    array(select pc.number::text from public.problem_cards pc where pc.event_id = p_event order by pc.number));$o$,
$n$  v_draw := app.squad_draw(p_event, v_root);$n$);

-- Before the draw: per track, the cards, the teams checked in, how many squads the draw makes and who would be left
-- out. After it: what the draw did. For the Desk and Lottery pages (organisers).
create or replace function public.draw_preview(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_on boolean;
  v_rec public.draw_records;
  v_tracks jsonb;
  v_seats int;
  v_left int;
  v_empty int;
  v_message text;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  v_on := app.feature_on(p_event, 'draw_checked_in');

  if v_event.drawn_at is not null then
    select * into v_rec from public.draw_records where event_id = p_event;
    select jsonb_agg(jsonb_build_object(
             'track', c.track, 'cards', c.cards, 'checked_in', c.checked_in, 'drawn', c.drawn,
             'left_out', coalesce(jsonb_array_length(v_rec.left_out -> lower(c.track::text)), 0),
             'left_out_codes', coalesce(v_rec.left_out -> lower(c.track::text), '[]'::jsonb)) order by c.track)
      into v_tracks
      from (select t.track, count(*)::int as cards,
                   count(*) filter (where t.checked_in_at is not null)::int as checked_in,
                   count(*) filter (where exists (select 1 from public.squads s where s.event_id = p_event
                                                   and t.id in (s.product_team_id, s.consulting_team_id, s.finance_team_id)))::int as drawn
              from public.teams t where t.event_id = p_event group by t.track) c;
    v_seats := (select count(*) from public.squads where event_id = p_event);
    v_left := coalesce(v_rec.left_count, 0);
    return app.ok(jsonb_build_object(
      'drawn', true, 'rule', case when v_rec.event_id is not null then 'CHECKED_IN' else 'ALL_TEAMS' end,
      'desk', v_event.desk_check_in, 'squads', v_seats, 'left_out', v_left, 'tracks', coalesce(v_tracks, '[]'::jsonb),
      'message', format('%s squads were drawn.', v_seats) ||
                 case when v_left > 0 then format(' %s checked-in teams were left out and can no longer sign in.', v_left) else '' end));
  end if;

  with c as (
    select t.track, count(*)::int as cards,
           count(*) filter (where t.checked_in_at is not null)::int as checked_in,
           count(*) filter (where app.team_admitted(t.id))::int as entrants
      from public.teams t where t.event_id = p_event group by t.track
  )
  select case when v_on then min(entrants) else min(cards) end into v_seats from c;
  v_seats := coalesce(v_seats, 0);
  with c as (
    select t.track, count(*)::int as cards,
           count(*) filter (where t.checked_in_at is not null)::int as checked_in,
           count(*) filter (where app.team_admitted(t.id))::int as entrants
      from public.teams t where t.event_id = p_event group by t.track
  )
  select jsonb_agg(jsonb_build_object(
           'track', c.track, 'cards', c.cards, 'checked_in', c.checked_in,
           'drawn', case when v_on then least(c.entrants, v_seats) else c.cards end,
           'left_out', case when v_on then greatest(c.entrants - v_seats, 0) else 0 end,
           'empty_seats', case when v_on or not v_event.desk_check_in then 0 else c.cards - c.checked_in end) order by c.track),
         coalesce(sum(case when v_on then greatest(c.entrants - v_seats, 0) else 0 end), 0)::int,
         coalesce(sum(case when v_on or not v_event.desk_check_in then 0 else c.cards - c.checked_in end), 0)::int
    into v_tracks, v_left, v_empty
    from c;

  if v_on and v_seats < 3 then
    v_message := format('The draw needs at least 3 checked-in teams in every track; the smallest track has %s.', v_seats);
  elsif v_on and v_left > 0 then
    v_message := format('%s squads (the smallest track). %s checked-in teams would be left out: %s.', v_seats, v_left,
      (select string_agg(format('%s %s', x ->> 'left_out', initcap(x ->> 'track')), ', ')
         from jsonb_array_elements(v_tracks) x where (x ->> 'left_out')::int > 0));
  elsif v_on then
    v_message := format('%s squads. Every checked-in team is drawn.', v_seats);
  elsif v_empty > 0 then
    v_message := format('%s squads: every card is drawn; %s cards not checked in become empty seats.', v_seats, v_empty);
  else
    v_message := format('%s squads: every card is drawn.', v_seats);
  end if;

  return app.ok(jsonb_build_object(
    'drawn', false, 'rule', case when v_on then 'CHECKED_IN' else 'ALL_TEAMS' end, 'desk', v_event.desk_check_in,
    'squads', v_seats, 'ready', v_seats >= 3, 'left_out', v_left, 'empty_seats', v_empty,
    'tracks', coalesce(v_tracks, '[]'::jsonb), 'message', v_message));
end
$$;
revoke all on function public.draw_preview(uuid) from public, anon;
grant execute on function public.draw_preview(uuid) to authenticated;

-- ───────────────────────────── 3. The practice market ─────────────────────────────

-- The simulated companies, fixed when the market is prepared: [{"id": <key>, "ticker": "ABCD", "name": "..."}], by
-- ticker. Null for a market prepared the old way (one ticker per Product team, named after it).
alter table public.practice_markets add column if not exists companies jsonb;

-- One simulated company per Finance team that may play: checked in (every team with the desk off) and, once the
-- squads are drawn, in a squad. Names come from two word lists (400 pairs) in an order fixed by the event, so the
-- same event always gets the same companies; tickers are the first two letters of each word (unique: no two words
-- of a list share them). The key of the k-th company is the k-th Product team in numeric order: practice_ticks and
-- practice_trade key a ticker on a Product team row (there are as many Product cards as Finance cards), and nothing
-- shows that team.
create or replace function app.practice_companies(p_event uuid)
returns jsonb
language sql stable
as $$
  with funds as (
    select count(*)::int as n
      from public.teams t join public.events e on e.id = t.event_id
     where t.event_id = p_event and t.track = 'FINANCE' and app.team_admitted(t.id)
       and (e.drawn_at is null or exists (select 1 from public.squads s where s.finance_team_id = t.id))
  ), slots as (
    select t.id, row_number() over (order by length(t.code), t.code) as k
      from public.teams t where t.event_id = p_event and t.track = 'PRODUCT'
  ), pairs as (
    select a.w as a, b.w as b, row_number() over (order by md5(p_event::text || ':' || a.w || ':' || b.w)) as k
      from unnest(array['Apex', 'Blue', 'Cedar', 'Delta', 'Ember', 'Fjord', 'Granite', 'Harbor', 'Indigo', 'Juniper',
                        'Kestrel', 'Lumen', 'Maple', 'Nova', 'Orbit', 'Pioneer', 'Quartz', 'River', 'Summit', 'Titan']) a(w)
     cross join unnest(array['Analytics', 'Bio', 'Cargo', 'Dynamics', 'Energy', 'Foods', 'Grid', 'Health', 'Industries',
                             'Jets', 'Kinetics', 'Labs', 'Mobility', 'Networks', 'Optics', 'Power', 'Robotics', 'Systems',
                             'Textiles', 'Ventures']) b(w)
  ), picked as (
    select upper(left(p.a, 2) || left(p.b, 2)) as ticker, p.a || ' ' || p.b as name
      from pairs p, funds f where p.k <= f.n
  ), ordered as (
    select p.ticker, p.name, row_number() over (order by p.ticker collate "C") as k from picked p
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ticker', o.ticker, 'name', o.name) order by o.k), '[]'::jsonb)
    from ordered o join slots s on s.k = o.k
$$;
revoke all on function app.practice_companies(uuid) from public, anon, authenticated;

-- How far the practice market is prepared (for the organiser's button and its status).
create or replace function app.practice_market_state(p_event uuid)
returns jsonb
language sql stable
as $$
  select case when m.event_id is null then jsonb_build_object('prepared', false, 'companies', 0, 'loaded', 0, 'ready', false)
    else jsonb_build_object(
      'prepared', true,
      'simulated', m.companies is not null,
      'companies', coalesce(jsonb_array_length(m.companies), l.loaded),
      'loaded', l.loaded,
      'ready', l.loaded >= coalesce(jsonb_array_length(m.companies), l.loaded) and l.loaded > 0,
      'starts_at', m.starts_at, 'tick_seconds', m.tick_seconds, 'steps', m.steps, 'settled', m.settled_at is not null,
      'list', coalesce(m.companies, '[]'::jsonb),
      'missing', coalesce((select jsonb_agg(c -> 'id' order by k) from jsonb_array_elements(m.companies) with ordinality x(c, k)
                            where not exists (select 1 from public.practice_ticks x
                                               where x.ticker_team_id = (c ->> 'id')::uuid and x.step = 0)), '[]'::jsonb))
    end
    from (select p_event as event_id) e
    left join public.practice_markets m on m.event_id = e.event_id
    cross join lateral (select count(*)::int as loaded from public.practice_ticks t where t.event_id = p_event and t.step = 0) l
$$;
revoke all on function app.practice_market_state(uuid) from public, anon, authenticated;

-- Prepares the practice market (organisers), once and in chunks: the first call (Round 1 must have started) fixes
-- the companies and the clock (tick 0 at the start of Round 1); every call stores the price paths in p_rows
-- ([{"ticker": <company id>, "prices": [cents, ...]}], every path p_steps long) for the companies that have none yet.
-- Calling again is safe: stored paths are never changed. Paths are made by the server (packages/engine candles.ts).
create or replace function public.prepare_practice_market(p_event uuid, p_tick_seconds int, p_steps int, p_rows jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_market public.practice_markets;
  v_companies jsonb;
  v_bad int;
  v_added int := 0;
begin
  perform app.require_organiser();
  if not app.feature_on(p_event, 'practice_verified') then
    return app.fail('SWITCH_OFF', 'The practice market switch is off: the first Finance page opens the market instead.');
  end if;
  select * into v_market from public.practice_markets where event_id = p_event for update;
  if v_market.event_id is null then
    select * into v_event from public.events where id = p_event for no key update;
    if v_event.id is null then
      return app.fail('NO_EVENT', 'No such event.');
    end if;
    select * into v_market from public.practice_markets where event_id = p_event for update;
  end if;
  if v_market.event_id is null then
    if v_event.current_phase <> 'BUILD' then
      return app.fail('NOT_ROUND_1', 'The practice market opens with Round 1: prepare it once Round 1 has started.');
    end if;
    if p_tick_seconds is null or p_tick_seconds not between 1 and 60 or p_steps is null or p_steps not between 1 and 10000 then
      return app.fail('BAD_INPUT', 'A tick is 1 to 60 seconds and a path 1 to 10,000 ticks.');
    end if;
    v_companies := app.practice_companies(p_event);
    if jsonb_array_length(v_companies) = 0 then
      return app.fail('NO_FUNDS', 'No Finance team is checked in, so there is no practice market to prepare.');
    end if;
    insert into public.practice_markets (event_id, starts_at, tick_seconds, steps, companies)
    values (p_event, coalesce((select started_at from public.phases where event_id = p_event and code = 'BUILD'), now()),
            p_tick_seconds, p_steps, v_companies)
    returning * into v_market;
    perform app.log_event(p_event, 'CONTROL', format('Practice market prepared: %s companies, one per Finance team.',
                                                     jsonb_array_length(v_companies)));
  end if;
  if v_market.settled_at is not null then
    return app.fail('PRACTICE_CLOSED', 'The practice market has closed.');
  end if;

  if p_rows is not null and jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0 then
    if v_market.companies is null then
      return app.fail('OLD_MARKET', 'This practice market was opened by a Finance page (switch off); it is complete.');
    end if;
    select count(*) into v_bad from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r -> 'prices') is distinct from 'array'
        or jsonb_array_length(r -> 'prices') <> v_market.steps
        or not exists (select 1 from jsonb_array_elements(v_market.companies) c where c ->> 'id' = r ->> 'ticker');
    if v_bad > 0 then
      return app.fail('BAD_CONTENT', format('Every path must be for a company of this market and %s prices long.', v_market.steps));
    end if;
    insert into public.practice_ticks (event_id, ticker_team_id, step, at, price_cents)
    select p_event, (r ->> 'ticker')::uuid, p.ord - 1,
           v_market.starts_at + make_interval(secs => (p.ord - 1) * v_market.tick_seconds), p.price::int
      from jsonb_array_elements(p_rows) r
     cross join lateral jsonb_array_elements_text(r -> 'prices') with ordinality as p(price, ord)
     where not exists (select 1 from public.practice_ticks x where x.ticker_team_id = (r ->> 'ticker')::uuid and x.step = 0)
    on conflict (ticker_team_id, step) do nothing;
    get diagnostics v_added = row_count;
  end if;
  return app.ok(app.practice_market_state(p_event) || jsonb_build_object('added_ticks', v_added));
end
$$;
revoke all on function public.prepare_practice_market(uuid, int, int, jsonb) from public, anon;
grant execute on function public.prepare_practice_market(uuid, int, int, jsonb) to authenticated;

-- The practice market's state for staff screens (the Run page button).
create or replace function public.practice_market_status(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_state jsonb;
begin
  if not app.is_staff() then
    raise exception 'only staff can see this' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  v_state := app.practice_market_state(p_event) - 'list' - 'missing';
  return app.ok(v_state || jsonb_build_object(
    'switch', app.feature_on(p_event, 'practice_verified'),
    'phase', v_event.current_phase,
    'funds', jsonb_array_length(app.practice_companies(p_event))));
end
$$;
revoke all on function public.practice_market_status(uuid) from public, anon;
grant execute on function public.practice_market_status(uuid) to authenticated;

-- ───────────────────────────── 4. Every tick's draft scan ─────────────────────────────

-- app.auto_submit_due_drafts reads the event's saved drafts on every tick: only those (event, type) rows.
create index if not exists submission_drafts_event_type_idx on public.submission_drafts (event_id, type) where version > 0;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261212000076'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
