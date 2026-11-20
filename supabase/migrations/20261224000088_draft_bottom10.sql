-- Round 3 draft, the organisers' rule for 20 Nov: only the 10 lowest-scoring companies of each sector pick.
--
-- The 10 lowest-scoring companies in each sector pick a statement, lowest first, 20 seconds each, each statement once.
-- Every other company in the sector is given a statement at random, spread evenly across the ten.
--
-- In a draft run by sector (switch draft_by_sector, statements naming sectors):
--   1. Pickers. In each sector the first k companies of the queue pick (the same order as before: the lowest score so
--      far first, ties the lower ticker, then the company id), 20 s each, the sectors at the same time. k is
--      app.draft_pickers() (10), never more than the sector's statements or its companies: a sector with 10 or fewer
--      companies, everyone picks.
--   2. Each statement once. A picker cannot take a statement an earlier picker took (STATEMENT_TAKEN).
--   3. A picker who misses their 20 s gets a random statement no picker has taken yet (draft_random_fallback: the
--      first untaken statement in the company's seeded order; off: the least-crowded, which is an untaken one).
--   4. The others (draft_picks.auto): once the sector's pickers are done, app.allocate_rest gives each, in the order
--      md5(event id || company id), the sector's statement with the fewest companies so far (ties: md5(event id ||
--      company id || statement number)), never above its cap. Deterministic per event: a restore or a re-run of the
--      same picks gives the same statements. They are marked by_default.
--   5. The draft is over when every company has a statement (app.current_pick is null): Round 3 hiring opens as before.
-- Pause and resume (081) are unchanged: resume shifts every row still without a statement, the others' too.
-- The planned length is the longest sector's pickers: 10 × 20 s + 20 s.
-- With draft_by_sector off the one-queue draft is exactly as before (everyone picks).

alter table public.draft_picks add column if not exists auto boolean not null default false;
comment on column public.draft_picks.auto is
  'Not a picker (088): beyond the 10 lowest-scoring companies of its sector; given a statement at random, spread evenly, when the sector''s pickers are done.';

-- How many companies per sector pick in a draft run by sector.
create or replace function app.draft_pickers()
returns int
language sql immutable
as $$ select 10 $$;
revoke all on function app.draft_pickers() from public, anon, authenticated;

-- The picker on the clock in each queue (the others never are).
create or replace function app.draft_heads(p_event uuid)
returns setof public.draft_picks
language sql stable
as $$
  select distinct on (coalesce(d.sector, '')) d.*
    from public.draft_picks d
   where d.event_id = p_event and d.statement_id is null and not d.auto
   order by coalesce(d.sector, ''), d.pick_no
$$;
revoke all on function app.draft_heads(uuid) from public, anon, authenticated;

-- The picker on the clock in this company's queue.
create or replace function app.current_pick(p_event uuid, p_company uuid)
returns public.draft_picks
language sql stable
as $$
  select d.* from public.draft_picks d
   where d.event_id = p_event and d.statement_id is null and not d.auto
     and d.sector is not distinct from (select m.sector from public.draft_picks m where m.company_id = p_company and m.event_id = p_event)
   order by d.pick_no
   limit 1
$$;
revoke all on function app.current_pick(uuid, uuid) from public, anon, authenticated;

-- The pick on the clock: a Product team's own sector's picker first, then any picker, then (only while a sector's
-- others still wait for their statements) any row still without one. Null only when the whole draft is over.
create or replace function app.current_pick(p_event uuid)
returns public.draft_picks
language sql stable
as $$
  select d.* from public.draft_picks d
   where d.event_id = p_event and d.statement_id is null
   order by d.auto,
            (not d.auto and d.sector is not distinct from (select m.sector from public.draft_picks m join public.companies c on c.id = m.company_id
                                            where m.event_id = p_event and m.sector is not null
                                              and c.product_team_id = app.my_team_id())) desc,
            d.pick_no
   limit 1
$$;
revoke all on function app.current_pick(uuid) from public, anon, authenticated;

-- A missed pick's statement under draft_random_fallback: the first statement with room in the company's own seeded
-- order (as 077). A picker of a draft run by sector skips the statements another picker already has.
create or replace function app.random_statement(p_event uuid, p_company uuid)
returns uuid
language plpgsql stable
as $$
declare
  v_seed text;
  v_dice text;
  v_sector text := app.company_sector(p_company);
  v_sectors boolean;
  v_once boolean;
  v_order text[];
  v_no text;
  v_id uuid;
  rec record;
begin
  select s.seed into v_seed from public.event_secrets s where s.event_id = p_event;
  select e.dice into v_dice from public.events e where e.id = p_event;
  v_sectors := exists (select 1 from public.problem_statements st where st.event_id = p_event and st.sector is not null);
  v_once := exists (select 1 from public.draft_picks d where d.company_id = p_company and d.sector is not null and not d.auto);
  select * into rec from app.rng_shuffle(
    app.rng_new(app.sha256_hex(coalesce(v_seed, p_event::text) || coalesce(v_dice, '')), 'draft:' || p_company::text),
    array(select st.number::text from public.problem_statements st
           where st.event_id = p_event and (not v_sectors or app.norm_sector(st.sector) is not distinct from v_sector)
           order by st.number));
  v_order := rec.result;
  foreach v_no in array coalesce(v_order, '{}'::text[]) loop
    select st.id into v_id from public.problem_statements st
     where st.event_id = p_event and st.number = v_no::smallint
       and (select count(*) from public.draft_picks d where d.statement_id = st.id) < (case when v_once then 1 else st.cap end);
    exit when v_id is not null;
  end loop;
  return coalesce(v_id, app.open_statement(p_event, p_company));
end
$$;
revoke all on function app.random_statement(uuid, uuid) from public, anon, authenticated;

-- The others of a sector whose pickers are done: each, in the order md5(event || company), gets the sector's statement
-- with the fewest companies so far (ties: md5(event || company || statement number)), never above its cap. Returns how
-- many were placed. Does nothing while a picker of the sector still has to pick.
create or replace function app.allocate_rest(p_event uuid, p_sector text)
returns int
language plpgsql
as $$
declare
  r record;
  v_st uuid;
  n int := 0;
begin
  if exists (select 1 from public.draft_picks d
              where d.event_id = p_event and d.sector is not distinct from p_sector and not d.auto and d.statement_id is null) then
    return 0;
  end if;
  for r in select d.company_id from public.draft_picks d
            where d.event_id = p_event and d.sector is not distinct from p_sector and d.auto and d.statement_id is null
            order by md5(p_event::text || d.company_id::text), d.company_id loop
    v_st := null;
    select st.id into v_st from public.problem_statements st
     where st.event_id = p_event and app.norm_sector(st.sector) is not distinct from nullif(p_sector, '')
       and (select count(*) from public.draft_picks x where x.statement_id = st.id) < st.cap
     order by (select count(*) from public.draft_picks x where x.statement_id = st.id),
              md5(p_event::text || r.company_id::text || st.number::text)
     limit 1;
    v_st := coalesce(v_st, app.open_statement(p_event, r.company_id));
    exit when v_st is null; -- no room anywhere (the room checks prevent it)
    update public.draft_picks set statement_id = v_st, picked_at = now(), by_default = true where company_id = r.company_id;
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke all on function app.allocate_rest(uuid, text) from public, anon, authenticated;

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
    -- One queue per sector, all at the same time, the lowest score so far first (ties: the lower ticker, then the
    -- company id). The first k of each queue pick, 20 s each (k: 10, at most the sector's statements); the others
    -- wait for the end of their sector's picks. pick_no runs round by round across the sectors, pickers first.
    insert into public.draft_picks (event_id, company_id, pick_no, score_avg, opens_at, closes_at, sector, auto)
    select p_event, q.id, row_number() over (order by q.pos > q.k, q.pos, q.sec collate "C"), q.a,
           now() + make_interval(secs => 20 * (least(q.pos, q.k + 1) - 1)), now() + make_interval(secs => 20 * least(q.pos, q.k)),
           q.sec, q.pos > q.k
      from (select c.id, c.a, c.sec,
                   row_number() over (partition by c.sec order by c.a, c.ticker collate "C", c.id) as pos,
                   least(app.draft_pickers(),
                         (select count(*) from public.problem_statements st
                           where st.event_id = p_event and app.norm_sector(st.sector) is not distinct from nullif(c.sec, '')))::int as k
              from (select c.id, c.ticker, app.score_so_far(c.id) as a, coalesce(app.company_sector(c.id), '') as sec
                      from public.companies c where c.event_id = p_event and c.squad_id is not null) c) q;
    select coalesce(max(x.n), 0) into v_longest
      from (select count(*) as n from public.draft_picks where event_id = p_event and not auto group by sector) x;
  else
    -- Lowest score so far first (ties: the lower ticker, then the company id), 20 s per pick: everyone picks.
    insert into public.draft_picks (event_id, company_id, pick_no, score_avg, opens_at, closes_at)
    select p_event, c.id, n, a, now() + make_interval(secs => 20 * (n - 1)), now() + make_interval(secs => 20 * n)
      from (select c.id, app.score_so_far(c.id) as a,
                   row_number() over (order by app.score_so_far(c.id), c.ticker collate "C", c.id) as n
              from public.companies c where c.event_id = p_event and c.squad_id is not null) c;
    v_longest := v_n;
  end if;
  -- Every picker gets its 20 seconds: if the schedule left too little time for the longest queue, the draft's
  -- deadline moves later and the rest of Round 3 with it (hiring, the due time and the rating keep their planned gaps).
  v_end := now() + make_interval(secs => 20 * v_longest + 20);
  select at into v_draft from public.deadlines where event_id = p_event and code = 'DRAFT';
  if v_draft is not null and v_draft < v_end then
    perform app.shift_schedule(p_event, v_draft, v_end - v_draft);
  end if;
  if v_by_sector then
    perform app.broadcast(p_event, 'draft', jsonb_build_object('step', 'start', 'by_sector', true));
  else
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
    -- One queue: as before.
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
  -- By sector: each queue's picker on the clock runs out on its own (an untaken statement); once the deadline passes
  -- every queue is emptied. A sector whose pickers are done has its others placed.
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
    n := n + app.allocate_rest(p_event, v_queue);
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
  v_mine public.draft_picks;
  v_st public.problem_statements;
  v_company uuid;
  v_by_sector boolean;
  v_taken text;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can pick a statement' using errcode = '42501';
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'PRODUCT' then
    return app.fail('NOT_ALLOWED', 'The Product team picks the statement.');
  end if;
  perform 1 from public.events where id = v_team.event_id for no key update;
  if (select e.paused from public.events e where e.id = v_team.event_id) then
    return app.fail('PAUSED', 'The event is paused. Pick when it resumes.');
  end if;
  if app.deadline_passed(v_team.event_id, 'DRAFT') then
    return app.fail('DRAFT_CLOSED', 'The draft has ended.');
  end if;
  select id into v_company from public.companies where product_team_id = v_team.id;
  v_by_sector := app.draft_parallel(v_team.event_id);
  select * into v_mine from public.draft_picks d where d.company_id = v_company and d.event_id = v_team.event_id;
  if v_mine.auto then
    return app.fail('NOT_A_PICKER', format('Only the %s lowest-scoring companies in each sector pick. Your company is given a statement at random, spread evenly across the sector''s statements, when they are done.', app.draft_pickers()));
  end if;
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
  if v_by_sector then
    -- Each statement once among the pickers.
    select c.ticker into v_taken from public.draft_picks d join public.companies c on c.id = d.company_id
     where d.statement_id = v_st.id order by d.picked_at limit 1;
    if found then
      return app.fail('STATEMENT_TAKEN', format('Statement %s has already been picked%s. Each statement can be picked only once: choose another.',
                                                v_st.number, case when v_taken is not null and v_taken <> '' then ' by ' || v_taken else '' end));
    end if;
  end if;
  if (select count(*) from public.draft_picks where statement_id = v_st.id) >= v_st.cap then
    return app.fail('STATEMENT_FULL', format('Statement %s already has %s companies.', v_st.number, v_st.cap));
  end if;
  update public.draft_picks set statement_id = v_st.id, picked_at = now() where company_id = v_pick.company_id;
  if v_by_sector then
    -- Only staff screens hear a pick; the teams' draft screens read public.draft_clock. The event channel hears the end.
    perform app.advance_draft(v_team.event_id, v_pick.sector);
    perform app.allocate_rest(v_team.event_id, v_pick.sector);
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

-- Where the draft stands, for screens (077), now with the pickers: each head's queue, place and left count only the
-- sector's pickers; 'others' is how many of the sector are given a statement at random, 'others_left' how many of
-- them still wait. Top level: 'pickers' (per sector, at most), 'picks' and 'left' over every company as before.
create or replace function public.draft_clock(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_all boolean := app.is_staff() or app.sees_all_events();
  v_team uuid := app.my_team_id();
  v_by_sector boolean;
  v_mine text;
  v_auto boolean;
begin
  if not (v_all or p_event = app.my_event_id()) then
    return null;
  end if;
  v_by_sector := app.draft_parallel(p_event);
  -- The caller's queue: its squad's company's sector (any track).
  select d.sector, d.auto into v_mine, v_auto
    from public.draft_picks d join public.companies c on c.id = d.company_id join public.squads s on s.id = c.squad_id
   where d.event_id = p_event and v_team in (s.product_team_id, s.consulting_team_id, s.finance_team_id);
  return jsonb_build_object(
    'by_sector', v_by_sector,
    'pickers', case when v_by_sector then app.draft_pickers() end,
    'my_auto', coalesce(v_auto, false),
    'picks', (select count(*) from public.draft_picks d where d.event_id = p_event),
    'left', (select count(*) from public.draft_picks d where d.event_id = p_event and d.statement_id is null),
    'heads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sector', h.sector,
               'company_id', h.company_id,
               'ticker', c.ticker,
               'pick_no', h.pick_no,
               'place', (select count(*) from public.draft_picks x
                          where x.event_id = p_event and x.sector is not distinct from h.sector and not x.auto and x.pick_no <= h.pick_no),
               'queue', (select count(*) from public.draft_picks x where x.event_id = p_event and x.sector is not distinct from h.sector and not x.auto),
               'left', (select count(*) from public.draft_picks x
                         where x.event_id = p_event and x.sector is not distinct from h.sector and not x.auto and x.statement_id is null),
               'others', (select count(*) from public.draft_picks x where x.event_id = p_event and x.sector is not distinct from h.sector and x.auto),
               'closes_at', h.closes_at,
               'mine', v_team is not null and c.product_team_id = v_team)
             order by coalesce(h.sector, ''), h.pick_no)
        from app.draft_heads(p_event) h join public.companies c on c.id = h.company_id
       where v_all or not v_by_sector or h.sector is not distinct from v_mine), '[]'::jsonb));
end
$$;
revoke all on function public.draft_clock(uuid) from public, anon;
grant execute on function public.draft_clock(uuid) to authenticated;

-- A team's plan: a company that is not a picker is never on the clock; 'ahead' counts the pickers still to pick in its
-- sector; 'auto' says it is given its statement at random.
select app.patch_one_function('app.team_primus_facts(public.teams, public.events, uuid)'::regprocedure,
$o$        'my_turn', v_mine.statement_id is null and v_cur.company_id = p_company and not app.deadline_passed(p_event.id, 'DRAFT'),$o$,
$n$        'my_turn', v_mine.statement_id is null and not v_mine.auto and v_cur.company_id = p_company and not app.deadline_passed(p_event.id, 'DRAFT'),
        'auto', v_mine.auto,$n$);
select app.patch_one_function('app.team_primus_facts(public.teams, public.events, uuid)'::regprocedure,
$o$and d.pick_no < v_mine.pick_no and d.sector is not distinct from v_mine.sector)) end);$o$,
$n$and d.pick_no < v_mine.pick_no and d.sector is not distinct from v_mine.sector and not d.auto)) end);$n$);

-- The Run page's label for the switch.
select app.patch_one_function('app.feature_catalog()'::regprocedure,
$o$'Round 3 draft: one queue per sector, all at the same time'$o$,
$n$'Round 3 draft: one queue per sector, all at the same time; the 10 lowest-scoring of each sector pick, each statement once, the others get one at random'$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261224000088'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
