-- Round 3 at 67 companies per sector: the draft runs one queue per sector, all at the same time, and a missed pick
-- gets a seeded random statement with room.
--
-- draft_by_sector (Run page switch, read when the draft starts). When the statements name sectors, each sector drafts
-- on its own: its companies pick from its own statements, the lowest score so far first (ties: the lower ticker, then
-- the company id), 20 seconds each, while the other sectors pick at the same time. The draft's planned length, and the
-- push of the rest of Round 3 when the schedule left too little time, come from the longest queue: 67 companies take
-- 22 min 40 s (one queue of 200 took 67 min). pick_no still numbers every pick once, in the order the picks come up
-- (the 1st of every sector, then the 2nd…), and draft_picks.sector names each pick's queue (null: one queue).
-- Picks are no longer broadcast on the event channel, where every screen re-read its page at each of the 200 picks:
-- staff screens hear them on the staff channel, the Product teams' draft screens ask public.draft_clock every
-- 3 seconds, and the event channel hears only the start and the end of the draft.
-- Off: the single queue over every company, with its broadcasts, exactly as before.
--
-- draft_random_fallback (Run page switch, read at each missed pick). A company whose 20 seconds run out, and every
-- company still waiting when the draft's deadline passes, gets the first statement with room in its own seeded order:
-- its sector's statement numbers shuffled by the lottery's generator (root = SHA-256(seed + dice) of the squad draw,
-- stream 'draft:<company id>'), so anyone with the revealed seed can replay every default pick. Off: the
-- least-crowded statement, as before.
--
-- app.current_pick answers for the caller's sector: a team whose sector still has picks to make gets its own sector's
-- pick on the clock; staff, the heartbeat and a team whose sector is done get the first pick still to make, so "no
-- current pick" still means the whole draft is over (hiring and writing open then, for everyone at once).
-- app.draft_heads gives every queue's pick on the clock; public.draft_clock shows them to screens.

alter table public.draft_picks add column if not exists sector text check (length(sector) <= 100);
comment on column public.draft_picks.sector is
  'The queue of a draft run by sector: the company''s sector (normalised; '''' without one). Null in a one-queue draft.';

-- Does this event's draft run by sector? Decided when it starts (switch draft_by_sector, statements with sectors).
create or replace function app.draft_parallel(p_event uuid)
returns boolean
language sql stable
as $$
  select exists (select 1 from public.draft_picks d where d.event_id = p_event and d.sector is not null)
$$;
revoke all on function app.draft_parallel(uuid) from public, anon, authenticated;

-- The pick on the clock in each queue (one per sector when the draft runs by sector, else the one queue's).
create or replace function app.draft_heads(p_event uuid)
returns setof public.draft_picks
language sql stable
as $$
  select distinct on (coalesce(d.sector, '')) d.*
    from public.draft_picks d
   where d.event_id = p_event and d.statement_id is null
   order by coalesce(d.sector, ''), d.pick_no
$$;
revoke all on function app.draft_heads(uuid) from public, anon, authenticated;

-- The pick on the clock in this company's queue.
create or replace function app.current_pick(p_event uuid, p_company uuid)
returns public.draft_picks
language sql stable
as $$
  select d.* from public.draft_picks d
   where d.event_id = p_event and d.statement_id is null
     and d.sector is not distinct from (select m.sector from public.draft_picks m where m.company_id = p_company and m.event_id = p_event)
   order by d.pick_no
   limit 1
$$;
revoke all on function app.current_pick(uuid, uuid) from public, anon, authenticated;

-- The pick on the clock: for a Product team in a draft run by sector, its own sector's while that sector still has
-- picks to make; else the first pick still to make (one queue: as before). Null only when the whole draft is over.
create or replace function app.current_pick(p_event uuid)
returns public.draft_picks
language sql stable
as $$
  select d.* from public.draft_picks d
   where d.event_id = p_event and d.statement_id is null
   order by d.sector is not distinct from (select m.sector from public.draft_picks m join public.companies c on c.id = m.company_id
                                            where m.event_id = p_event and m.sector is not null
                                              and c.product_team_id = app.my_team_id()) desc,
            d.pick_no
   limit 1
$$;
revoke all on function app.current_pick(uuid) from public, anon, authenticated;

-- The next pick in this sector's queue starts its 20 seconds now (a draft run by sector; app.advance_draft(event) moves
-- the one queue).
create or replace function app.advance_draft(p_event uuid, p_sector text)
returns void
language sql
as $$
  update public.draft_picks d set opens_at = now(), closes_at = now() + interval '20 seconds'
   where d.event_id = p_event
     and d.company_id = (select h.company_id from app.draft_heads(p_event) h where h.sector is not distinct from p_sector)
$$;
revoke all on function app.advance_draft(uuid, text) from public, anon, authenticated;

-- A missed pick's statement under draft_random_fallback: the first statement with room in the company's own seeded
-- order. The order shuffles its sector's statement numbers (every statement's when none names a sector) with the
-- lottery's generator: root SHA-256(seed + dice) as the squad draw, stream 'draft:<company id>'. The same draw in
-- TypeScript: new Rng(rootSeed(seed, dice), `draft:${companyId}`).shuffle(numbers) (packages/engine/src/lottery.ts).
-- Without room in its sector (the room checks prevent it), the least-crowded statement as before.
create or replace function app.random_statement(p_event uuid, p_company uuid)
returns uuid
language plpgsql stable
as $$
declare
  v_seed text;
  v_dice text;
  v_sector text := app.company_sector(p_company);
  v_sectors boolean;
  v_order text[];
  v_no text;
  v_id uuid;
  rec record;
begin
  select s.seed into v_seed from public.event_secrets s where s.event_id = p_event;
  select e.dice into v_dice from public.events e where e.id = p_event;
  v_sectors := exists (select 1 from public.problem_statements st where st.event_id = p_event and st.sector is not null);
  select * into rec from app.rng_shuffle(
    app.rng_new(app.sha256_hex(coalesce(v_seed, p_event::text) || coalesce(v_dice, '')), 'draft:' || p_company::text),
    array(select st.number::text from public.problem_statements st
           where st.event_id = p_event and (not v_sectors or app.norm_sector(st.sector) is not distinct from v_sector)
           order by st.number));
  v_order := rec.result;
  foreach v_no in array coalesce(v_order, '{}'::text[]) loop
    select st.id into v_id from public.problem_statements st
     where st.event_id = p_event and st.number = v_no::smallint
       and (select count(*) from public.draft_picks d where d.statement_id = st.id) < st.cap;
    exit when v_id is not null;
  end loop;
  return coalesce(v_id, app.open_statement(p_event, p_company));
end
$$;
revoke all on function app.random_statement(uuid, uuid) from public, anon, authenticated;

-- The statement a missed pick gets: seeded random with room (draft_random_fallback), else the least-crowded.
create or replace function app.default_statement(p_event uuid, p_company uuid)
returns uuid
language sql stable
as $$
  select case when app.feature_on(p_event, 'draft_random_fallback') then app.random_statement(p_event, p_company)
              else app.open_statement(p_event, p_company) end
$$;
revoke all on function app.default_statement(uuid, uuid) from public, anon, authenticated;

create or replace function app.start_draft(p_event uuid)
returns boolean
language plpgsql
as $$
declare
  v_event public.events;
  v_n int;
  v_room int;
  v_end timestamptz;
  v_draft timestamptz;
  v_by_sector boolean;
  v_longest int;
begin
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.format <> 'PRIMUS' or v_event.current_phase <> 'SATURATION'
     or exists (select 1 from public.draft_picks where event_id = p_event) then
    return false;
  end if;
  select count(*) into v_n from public.companies c where c.event_id = p_event and c.squad_id is not null;
  select coalesce(sum(cap), 0) into v_room from public.problem_statements where event_id = p_event;
  if v_n = 0 or v_room < v_n or app.sector_room_short(p_event) is not null then
    return false;
  end if;
  v_by_sector := app.feature_on(p_event, 'draft_by_sector')
                 and exists (select 1 from public.problem_statements where event_id = p_event and sector is not null);
  if v_by_sector then
    -- One queue per sector, all at the same time: in each, the lowest score so far first (ties: the lower ticker, then
    -- the company id), 20 s per pick. pick_no runs round by round across the sectors.
    insert into public.draft_picks (event_id, company_id, pick_no, score_avg, opens_at, closes_at, sector)
    select p_event, q.id, row_number() over (order by q.pos, q.sec collate "C"), q.a,
           now() + make_interval(secs => 20 * (q.pos - 1)), now() + make_interval(secs => 20 * q.pos), q.sec
      from (select c.id, c.a, c.sec,
                   row_number() over (partition by c.sec order by c.a, c.ticker collate "C", c.id) as pos
              from (select c.id, c.ticker, app.score_so_far(c.id) as a, coalesce(app.company_sector(c.id), '') as sec
                      from public.companies c where c.event_id = p_event and c.squad_id is not null) c) q;
    select max(x.n) into v_longest from (select count(*) as n from public.draft_picks where event_id = p_event group by sector) x;
  else
    -- Lowest score so far first (ties: the lower ticker, then the company id), 20 s per pick.
    insert into public.draft_picks (event_id, company_id, pick_no, score_avg, opens_at, closes_at)
    select p_event, c.id, n, a, now() + make_interval(secs => 20 * (n - 1)), now() + make_interval(secs => 20 * n)
      from (select c.id, app.score_so_far(c.id) as a,
                   row_number() over (order by app.score_so_far(c.id), c.ticker collate "C", c.id) as n
              from public.companies c where c.event_id = p_event and c.squad_id is not null) c;
    v_longest := v_n;
  end if;
  -- Every company gets its 20 seconds: if the schedule left too little time for the longest queue, the draft's
  -- deadline moves later and the rest of Round 3 with it (hiring, the due time and the rating keep their planned gaps).
  v_end := now() + make_interval(secs => 20 * v_longest + 20);
  select at into v_draft from public.deadlines where event_id = p_event and code = 'DRAFT';
  if v_draft is not null and v_draft < v_end then
    perform app.shift_schedule(p_event, v_draft, v_end - v_draft);
  end if;
  if v_by_sector then
    perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'start', 'by_sector', true));
  else
    -- next_product: the first company's team hears "Your pick!" (lost when the draft was redefined in 042).
    perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'start', 'next_product', app.on_the_clock(p_event)));
  end if;
  return true;
end
$$;
revoke all on function app.start_draft(uuid) from public, anon, authenticated;

create or replace function app.draft_tick(p_event uuid)
returns int
language plpgsql
as $$
declare
  v_pick public.draft_picks;
  v_queue text;
  n int := 0;
begin
  if not app.draft_parallel(p_event) then
    -- One queue: as before (the missed pick's statement now follows draft_random_fallback).
    loop
      v_pick := app.current_pick(p_event);
      exit when v_pick.company_id is null;
      exit when v_pick.closes_at > now() and not app.deadline_passed(p_event, 'DRAFT');
      update public.draft_picks set statement_id = app.default_statement(p_event, v_pick.company_id), picked_at = now(), by_default = true
       where company_id = v_pick.company_id;
      exit when (select statement_id from public.draft_picks where company_id = v_pick.company_id) is null; -- no room left
      perform app.advance_draft(p_event);
      n := n + 1;
    end loop;
    if n > 0 then
      perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'pick', 'by_default', true, 'next_product', app.on_the_clock(p_event)));
    end if;
    return n;
  end if;
  -- By sector: each queue's pick on the clock runs out on its own; once the deadline passes every queue is emptied.
  for v_queue in select distinct d.sector from public.draft_picks d where d.event_id = p_event and d.statement_id is null order by 1 loop
    loop
      v_pick := null;
      select h.* into v_pick from app.draft_heads(p_event) h where h.sector = v_queue;
      exit when v_pick.company_id is null;
      exit when v_pick.closes_at > now() and not app.deadline_passed(p_event, 'DRAFT');
      update public.draft_picks set statement_id = app.default_statement(p_event, v_pick.company_id), picked_at = now(), by_default = true
       where company_id = v_pick.company_id;
      exit when (select statement_id from public.draft_picks where company_id = v_pick.company_id) is null; -- no room left
      perform app.advance_draft(p_event, v_queue);
      n := n + 1;
    end loop;
  end loop;
  if n > 0 then
    perform app.broadcast_staff(p_event, 'draft');
    if not exists (select 1 from public.draft_picks d where d.event_id = p_event and d.statement_id is null) then
      perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'done'));
    end if;
  end if;
  return n;
end
$$;
revoke all on function app.draft_tick(uuid) from public, anon, authenticated;

create or replace function public.pick_statement(p_statement uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_pick public.draft_picks;
  v_st public.problem_statements;
  v_company uuid;
  v_by_sector boolean;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can pick a statement' using errcode = '42501';
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'PRODUCT' then
    return app.fail('NOT_ALLOWED', 'The Product team picks the statement.');
  end if;
  perform 1 from public.events where id = v_team.event_id for no key update;
  if app.deadline_passed(v_team.event_id, 'DRAFT') then
    return app.fail('DRAFT_CLOSED', 'The draft has ended.');
  end if;
  select id into v_company from public.companies where product_team_id = v_team.id;
  v_by_sector := app.draft_parallel(v_team.event_id);
  -- By sector: the pick on the clock in this company's own queue.
  v_pick := case when v_by_sector then app.current_pick(v_team.event_id, v_company) else app.current_pick(v_team.event_id) end;
  if v_pick.company_id is null or v_pick.company_id <> v_company then
    return app.fail('NOT_YOUR_TURN', 'Wait for your turn in the draft.');
  end if;
  select * into v_st from public.problem_statements where id = p_statement and event_id = v_team.event_id;
  if v_st.id is null then
    return app.fail('NO_SUCH_STATEMENT', 'No such problem statement.');
  end if;
  if app.norm_sector(v_st.sector) is not null and app.norm_sector(v_st.sector) is distinct from app.company_sector(v_pick.company_id) then
    return app.fail('WRONG_SECTOR', format('Statement %s belongs to the %s sector; pick one of your own sector.', v_st.number, v_st.sector));
  end if;
  if (select count(*) from public.draft_picks where statement_id = v_st.id) >= v_st.cap then
    return app.fail('STATEMENT_FULL', format('Statement %s already has %s companies.', v_st.number, v_st.cap));
  end if;
  update public.draft_picks set statement_id = v_st.id, picked_at = now() where company_id = v_pick.company_id;
  if v_by_sector then
    -- Only staff screens hear a pick; the teams' draft screens read public.draft_clock. The event channel hears the end.
    perform app.advance_draft(v_team.event_id, v_pick.sector);
    perform app.broadcast_staff(v_team.event_id, 'draft');
    if not exists (select 1 from public.draft_picks d where d.event_id = v_team.event_id and d.statement_id is null) then
      perform app.broadcast(v_team.event_id, 'draft', jsonb_build_object('step', 'done'));
    end if;
  else
    perform app.advance_draft(v_team.event_id);
    perform app.broadcast(v_team.event_id, 'draft', jsonb_build_object('step', 'pick', 'pick_no', v_pick.pick_no, 'next_product', app.on_the_clock(v_team.event_id)));
  end if;
  return app.ok(jsonb_build_object('statement', v_st.number));
end
$$;
revoke all on function public.pick_statement(uuid) from public, anon;
grant execute on function public.pick_statement(uuid) to authenticated;

-- Where the draft stands, for screens: whether it runs by sector, how many picks are left, and the pick on the clock in
-- each queue (its company, its place in the queue, when its 20 seconds end, and whether it is the caller's). Staff and
-- the projector get every queue; a team its own sector's (in a one-queue draft, the one queue's). The Product teams'
-- draft screens read it every 3 seconds while the draft runs.
create or replace function public.draft_clock(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_all boolean := app.is_staff() or app.sees_all_events();
  v_team uuid := app.my_team_id();
  v_by_sector boolean;
  v_mine text;
begin
  if not (v_all or p_event = app.my_event_id()) then
    return null;
  end if;
  v_by_sector := app.draft_parallel(p_event);
  -- The caller's queue: its squad's company's sector (any track).
  select d.sector into v_mine
    from public.draft_picks d join public.companies c on c.id = d.company_id join public.squads s on s.id = c.squad_id
   where d.event_id = p_event and v_team in (s.product_team_id, s.consulting_team_id, s.finance_team_id);
  return jsonb_build_object(
    'by_sector', v_by_sector,
    'picks', (select count(*) from public.draft_picks d where d.event_id = p_event),
    'left', (select count(*) from public.draft_picks d where d.event_id = p_event and d.statement_id is null),
    'heads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sector', h.sector,
               'company_id', h.company_id,
               'ticker', c.ticker,
               'pick_no', h.pick_no,
               'place', (select count(*) from public.draft_picks x
                          where x.event_id = p_event and x.sector is not distinct from h.sector and x.pick_no <= h.pick_no),
               'queue', (select count(*) from public.draft_picks x where x.event_id = p_event and x.sector is not distinct from h.sector),
               'left', (select count(*) from public.draft_picks x
                         where x.event_id = p_event and x.sector is not distinct from h.sector and x.statement_id is null),
               'closes_at', h.closes_at,
               'mine', v_team is not null and c.product_team_id = v_team)
             order by coalesce(h.sector, ''), h.pick_no)
        from app.draft_heads(p_event) h join public.companies c on c.id = h.company_id
       where v_all or not v_by_sector or h.sector is not distinct from v_mine), '[]'::jsonb));
end
$$;
revoke all on function public.draft_clock(uuid) from public, anon;
grant execute on function public.draft_clock(uuid) to authenticated;

-- The statements' room, per sector. Once the squads are drawn each sector's companies are counted (as before); before
-- the draw the lottery will deal the squads equally round the sector cards (2 to 6), so each sector needs room for its
-- cards' shares: at most ceil(companies / cards) per card (67 for 200 companies on 3 cards).
create or replace function public.set_problem_statements(p_event uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  v_companies int;
  v_room int;
  v_short text;
  v_cards int;
begin
  perform app.require_organiser();
  perform 1 from public.events where id = p_event for no key update;
  if exists (select 1 from public.draft_picks where event_id = p_event and statement_id is not null) then
    return app.fail('DRAFT_STARTED', 'A company has already picked; the statements can no longer change.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return app.fail('BAD_CONTENT', 'Upload at least one problem statement.');
  end if;
  select count(*) into v_companies from public.companies c
   where c.event_id = p_event and (c.squad_id is not null or not exists (select 1 from public.squads s where s.event_id = p_event));
  select coalesce(sum(coalesce(nullif(x ->> 'cap', '')::int, 5)), 0) into v_room from jsonb_array_elements(p_rows) x;
  if v_room < v_companies then
    return app.fail('NOT_ENOUGH_ROOM',
      format('These statements have room for %s companies, but there are %s. Add statements or raise their caps.', v_room, v_companies));
  end if;
  -- With sectors, each sector's statements must have room for that sector's companies.
  if exists (select 1 from jsonb_array_elements(p_rows) x where app.norm_sector(x ->> 'sector') is not null) then
    if exists (select 1 from public.squads s where s.event_id = p_event) then
      select string_agg(format('%s: room for %s, %s companies', d.sec, d.room, d.n), '; ' order by d.sec) into v_short
        from (select y.sec, count(*) as n,
                     (select coalesce(sum(coalesce(nullif(x ->> 'cap', '')::int, 5)), 0) from jsonb_array_elements(p_rows) x
                       where app.norm_sector(x ->> 'sector') = y.sec) as room
                from (select app.company_sector(c.id) as sec from public.companies c
                       where c.event_id = p_event and c.squad_id is not null) y
               where y.sec is not null
               group by y.sec) d
       where d.room < d.n;
    else
      select count(*) into v_cards from public.problem_cards pc where pc.event_id = p_event;
      if v_cards between 2 and 6 and v_cards < v_companies + 2
         and not exists (select 1 from public.problem_cards pc where pc.event_id = p_event and app.norm_sector(pc.sector) is null) then
        select string_agg(format('%s: room for %s, up to %s companies', d.sec, d.room, d.need), '; ' order by d.sec) into v_short
          from (select g.sec, g.cards * ceil(v_companies::numeric / v_cards)::int as need,
                       (select coalesce(sum(coalesce(nullif(x ->> 'cap', '')::int, 5)), 0) from jsonb_array_elements(p_rows) x
                         where app.norm_sector(x ->> 'sector') = g.sec) as room
                  from (select app.norm_sector(pc.sector) as sec, count(*) as cards
                          from public.problem_cards pc where pc.event_id = p_event group by 1) g) d
         where d.room < d.need;
        if v_short is not null then
          v_short := v_short || format(' (%s companies over %s sector cards)', v_companies, v_cards);
        end if;
      end if;
    end if;
    if v_short is not null then
      return app.fail('NOT_ENOUGH_ROOM', 'Each sector needs room for its companies. ' || v_short || '. Add statements or raise their caps.');
    end if;
  end if;
  delete from public.draft_picks where event_id = p_event;
  delete from public.problem_statements where event_id = p_event;
  insert into public.problem_statements (event_id, number, title, body, cap, sector)
  select p_event, coalesce((x ->> 'number')::smallint, o::smallint), btrim(x ->> 'title'), btrim(x ->> 'body'),
         coalesce(nullif(x ->> 'cap', '')::smallint, 5), nullif(btrim(coalesce(x ->> 'sector', '')), '')
    from jsonb_array_elements(p_rows) with ordinality t(x, o);
  get diagnostics n = row_count;
  return app.ok(jsonb_build_object('statements', n, 'draft_started', app.start_draft(p_event)));
end
$$;
revoke all on function public.set_problem_statements(uuid, jsonb) from public, anon;
grant execute on function public.set_problem_statements(uuid, jsonb) to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261213000077'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
