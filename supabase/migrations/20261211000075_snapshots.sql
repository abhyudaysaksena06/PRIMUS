-- Backups after every round, and resets (the 20 Nov changes W8 and W16).
--
-- A backup (snapshot) is every row of every event-scoped table of one event (every public table with an event_id
-- column, plus the event row), stored as jsonb, one part per table, with a fingerprint: row counts, the teams' cash
-- and collateral, the exchange's cash, the shares held per lot, the exchange's inventory and the sum of prices.
--
--   When       the event leaves SETUP ("Base"), a phase starts, a trading round clears, scores are released, or an
--              organiser presses Back up now. The game's own transaction only queues a request (a trigger inserts
--              one row): the backup is taken by the pg_cron job msim-snapshot every 10 seconds, outside the game's
--              transactions, at most one per event every 5 seconds (requests that meet are merged into one backup),
--              and the last 200 are kept per event (the Base backup is always kept). The switch "snapshots"
--              (migration 070) turns taking backups off; restoring is always possible.
--   Read       in one SQL statement, so every table is read at the same instant (one MVCC snapshot) while the game
--              goes on. The judge's full prompt and raw reply (request_text, raw_response) are left out: they are
--              large and only kept for reference (a restore keeps the ones already stored for the runs it writes back).
--   Restore    two people, like a ledger correction (migration 013): an organiser asks with a reason, a different
--              organiser or the fairness officer approves, and only while the event is paused. The job then, in one
--              transaction: backs up the event as it is now ("Before restoring …"), deletes the event's rows
--              (children first) and writes the backup's rows back (parents first), with the audit, append-only and
--              immutable triggers standing aside exactly as for purge_event (migration 005); checks that the event's
--              fingerprint equals the backup's (or undoes everything); logs "Restored backup <label> taken at HH:MM";
--              and tells every screen to re-read. The event stays paused, as of the moment of the backup: Resume
--              moves every later time by the length of the gap, so the night continues from that moment.
--              Kept as they are now: logins (accounts) and the teams' rows themselves (their game columns go back),
--              attendance (check-in, names, members, the desk's team list), the event log, the audit log, the
--              event's settings (switches, manual mode, auto-advance, judge model) and the backups themselves.
--   Reset      to base = restore the Base backup; a round = restore the backup taken before it.
--
--   public.request_snapshot(event, label)       organisers: Back up now
--   public.snapshots_list(event)                staff: the backups, the queue and the restore requests
--   public.snapshot_data(backup, table)         staff: the download, one table at a time (no table: the list)
--   public.request_restore(backup, reason)      organisers, event paused
--   public.approve_restore(request, yes, note)  a second organiser or the fairness officer (no = reject or cancel)
--
-- A trigger added later on an event table must do nothing while app.allow_purge is 'on' (as the audit trigger does),
-- or a restore would run it for every row it writes back.

-- ───────────────────────────── Tables ─────────────────────────────

create table app.snapshots (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('BASE', 'PHASE', 'ROUND', 'RELEASE', 'MANUAL', 'SAFETY')),
  requested_by uuid,
  taken_at timestamptz not null default now(),
  -- The game's clock at the backup: when the event was paused then, the start of that pause.
  game_time timestamptz,
  phase public.phase_code,
  fingerprint jsonb not null default '{}'::jsonb,
  n_tables int not null default 0,
  n_rows bigint not null default 0,
  size_bytes bigint not null default 0,   -- as stored (compressed)
  ms int
);
create index snapshots_event_idx on app.snapshots (event_id, id desc);

create table app.snapshot_parts (
  snapshot_id bigint not null references app.snapshots (id) on delete cascade,
  tbl text not null,
  depth int not null,          -- parents first: a table's depth is 1 + its deepest parent's (0 for the event row)
  restore boolean not null,    -- written back by a restore (the event log, members and the desk's list are not)
  cols text[] not null,
  n_rows int not null,
  bytes bigint not null default 0,
  data jsonb not null,
  primary key (snapshot_id, tbl)
);

create table app.snapshot_requests (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in ('BASE', 'PHASE', 'ROUND', 'RELEASE', 'MANUAL')),
  label text not null,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  attempts int not null default 0,
  processed_at timestamptz,
  snapshot_id bigint references app.snapshots (id) on delete set null,
  note text
);
-- One waiting request per label and event: a release updates every score row, but queues one backup.
create unique index snapshot_requests_waiting_uq on app.snapshot_requests (event_id, label) where processed_at is null;
create index snapshot_requests_waiting_idx on app.snapshot_requests (event_id, id) where processed_at is null;

create table app.snapshot_restores (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  snapshot_id bigint references app.snapshots (id) on delete set null,
  snapshot_label text not null,
  snapshot_taken_at timestamptz not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  reason text not null check (length(reason) >= 10),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'RUNNING', 'DONE', 'FAILED', 'REJECTED', 'CANCELLED')),
  decided_by uuid,
  decided_at timestamptz,
  note text,
  started_at timestamptz,
  finished_at timestamptz,
  safety_snapshot_id bigint references app.snapshots (id) on delete set null,
  error text,
  -- Two people: whoever asked never approves (asking and then cancelling is the same person, and allowed).
  check (decided_by is null or decided_by <> requested_by or status in ('REJECTED', 'CANCELLED'))
);
create index snapshot_restores_event_idx on app.snapshot_restores (event_id, id desc);

revoke all on app.snapshots, app.snapshot_parts, app.snapshot_requests, app.snapshot_restores from public, anon, authenticated;

-- ───────────────────────────── Which tables, in which order ─────────────────────────────

-- Every event-scoped table (a public table with an event_id column) except the logs that are never rolled back
-- (audit_log, error_log) and the screens' pings; its depth (parents first: 1 + the deepest parent among these
-- tables, through foreign keys); and whether a restore writes it back. Read from the catalog, so a table added by a
-- later migration is backed up and restored without changing this.
create or replace function app.snapshot_tables()
returns table (tbl text, depth int, restore boolean)
language sql stable
set search_path = ''
as $$
  with recursive t as (
    select c.oid, c.relname::text as relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('audit_log', 'error_log', 'client_pings')
       and exists (select 1 from pg_catalog.pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'event_id' and a.attnum > 0 and not a.attisdropped)
  ),
  edges as (
    select distinct k.conrelid as child, k.confrelid as parent
      from pg_catalog.pg_constraint k
      join t tc on tc.oid = k.conrelid
      join t tp on tp.oid = k.confrelid
     where k.contype = 'f' and k.conrelid <> k.confrelid
  ),
  lvl (oid, depth) as (
    select oid, 0 from t
    union all
    select e.child, l.depth + 1 from edges e join lvl l on l.oid = e.parent where l.depth < 40
  )
  select t.relname, max(l.depth)::int, t.relname not in ('event_log', 'members', 'roster')
    from t join lvl l on l.oid = t.oid
   group by t.relname
   order by 2, 1
$$;
revoke all on function app.snapshot_tables() from public, anon, authenticated;

-- A table's columns as a backup stores them (the judge's full prompt and raw reply are left out).
create or replace function app.snapshot_cols(p_tbl text)
returns text[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('public.' || quote_ident(p_tbl)) and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attname not in ('request_text', 'raw_response')
$$;
revoke all on function app.snapshot_cols(text) from public, anon, authenticated;

-- How many backups each event keeps (the Base backup is kept as well).
create or replace function app.snapshot_keep() returns int language sql immutable as $$ select 200 $$;
revoke all on function app.snapshot_keep() from public, anon, authenticated;

-- ───────────────────────────── Fingerprints ─────────────────────────────

-- From a backup's stored rows.
create or replace function app.snapshot_fingerprint(p_snapshot bigint)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'rows', coalesce((select jsonb_object_agg(p.tbl, p.n_rows order by p.tbl) from app.snapshot_parts p
                       where p.snapshot_id = p_snapshot and p.restore and p.tbl <> 'events' and p.n_rows > 0), '{}'::jsonb),
    'phase', (select p.data -> 0 ->> 'current_phase' from app.snapshot_parts p where p.snapshot_id = p_snapshot and p.tbl = 'events'),
    'exchange_cash_cents', (select coalesce((p.data -> 0 ->> 'exchange_cash_cents')::numeric, 0) from app.snapshot_parts p
                             where p.snapshot_id = p_snapshot and p.tbl = 'events'),
    'cash_cents', (select coalesce(sum((x ->> 'cash_cents')::numeric), 0) from app.snapshot_parts p
                     cross join lateral jsonb_array_elements(p.data) x where p.snapshot_id = p_snapshot and p.tbl = 'teams'),
    'collateral_cents', (select coalesce(sum((x ->> 'collateral_cents')::numeric), 0) from app.snapshot_parts p
                           cross join lateral jsonb_array_elements(p.data) x where p.snapshot_id = p_snapshot and p.tbl = 'teams'),
    'holdings', (select coalesce(jsonb_object_agg(h.lot, h.qty order by h.lot), '{}'::jsonb) from (
                   select x ->> 'lot' as lot, sum((x ->> 'qty')::numeric) as qty from app.snapshot_parts p
                    cross join lateral jsonb_array_elements(p.data) x
                    where p.snapshot_id = p_snapshot and p.tbl = 'holdings' group by 1) h),
    'exchange_inventory', (select coalesce(sum((x ->> 'exchange_inventory')::numeric), 0) from app.snapshot_parts p
                             cross join lateral jsonb_array_elements(p.data) x where p.snapshot_id = p_snapshot and p.tbl = 'companies'),
    'market_price', (select coalesce(sum((x ->> 'market_price')::numeric), 0) from app.snapshot_parts p
                       cross join lateral jsonb_array_elements(p.data) x where p.snapshot_id = p_snapshot and p.tbl = 'companies'),
    'ledger_cash', (select coalesce(sum((x ->> 'cash_delta_cents')::numeric), 0) from app.snapshot_parts p
                      cross join lateral jsonb_array_elements(p.data) x
                     where p.snapshot_id = p_snapshot and p.tbl = 'ledger_entries' and x ->> 'team_id' is not null))
$$;
revoke all on function app.snapshot_fingerprint(bigint) from public, anon, authenticated;

-- From the event's tables as they are now (the same keys; tables with no rows are left out of both).
create or replace function app.live_fingerprint(p_event uuid)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_rows jsonb := '{}'::jsonb;
  v_n bigint;
  t record;
begin
  for t in select st.tbl from app.snapshot_tables() st where st.restore order by st.tbl loop
    execute format('select count(*) from public.%I where event_id = $1', t.tbl) into v_n using p_event;
    if v_n > 0 then
      v_rows := v_rows || jsonb_build_object(t.tbl, v_n);
    end if;
  end loop;
  return jsonb_build_object(
    'rows', v_rows,
    'phase', (select e.current_phase::text from public.events e where e.id = p_event),
    'exchange_cash_cents', (select coalesce(e.exchange_cash_cents, 0)::numeric from public.events e where e.id = p_event),
    'cash_cents', (select coalesce(sum(cash_cents), 0)::numeric from public.teams where event_id = p_event),
    'collateral_cents', (select coalesce(sum(collateral_cents), 0)::numeric from public.teams where event_id = p_event),
    'holdings', (select coalesce(jsonb_object_agg(h.lot, h.qty order by h.lot), '{}'::jsonb) from (
                   select lot::text as lot, sum(qty)::numeric as qty from public.holdings where event_id = p_event group by 1) h),
    'exchange_inventory', (select coalesce(sum(exchange_inventory), 0)::numeric from public.companies where event_id = p_event),
    'market_price', (select coalesce(sum(market_price), 0)::numeric from public.companies where event_id = p_event),
    'ledger_cash', (select coalesce(sum(cash_delta_cents), 0)::numeric from public.ledger_entries
                     where event_id = p_event and team_id is not null));
end
$$;
revoke all on function app.live_fingerprint(uuid) from public, anon, authenticated;

-- ───────────────────────────── Taking a backup ─────────────────────────────

-- Takes one backup now and returns its id (the queue's job, and a restore's "before" backup).
create or replace function app.take_snapshot(p_event uuid, p_label text, p_kind text, p_by uuid default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
  v_started timestamptz := clock_timestamp();
  v_parts text[];
  v_ev jsonb;
  t record;
begin
  if (select max(st.depth) from app.snapshot_tables() st) >= 40 then
    raise exception 'the event tables'' foreign keys form a cycle; backups cannot order them';
  end if;
  insert into app.snapshots (event_id, label, kind, requested_by, taken_at)
  values (p_event, left(coalesce(nullif(btrim(p_label), ''), 'Backup'), 200), p_kind, p_by, v_started)
  returning id into v_id;

  -- One statement, so every table is read at the same instant (one MVCC snapshot) while the game goes on.
  v_parts := array[format(
    'select %L::text as tbl, 0 as depth, true as restore, %L::text[] as cols, (select jsonb_agg(to_jsonb(x)) from public.events x where x.id = $2) as data',
    'events', app.snapshot_cols('events'))];
  for t in select st.tbl, st.depth, st.restore from app.snapshot_tables() st loop
    v_parts := v_parts || format(
      'select %L::text, %s, %L::boolean, %L::text[], (select jsonb_agg(to_jsonb(x) - ''request_text'' - ''raw_response'') from public.%I x where x.event_id = $2)',
      t.tbl, t.depth + 1, t.restore, app.snapshot_cols(t.tbl), t.tbl);
  end loop;
  execute 'insert into app.snapshot_parts (snapshot_id, tbl, depth, restore, cols, n_rows, data) '
       || 'select $1, p.tbl, p.depth, p.restore, p.cols, coalesce(jsonb_array_length(p.data), 0), coalesce(p.data, ''[]''::jsonb) from ('
       || array_to_string(v_parts, ' union all ') || ') p'
    using v_id, p_event;
  update app.snapshot_parts set bytes = pg_column_size(data) where snapshot_id = v_id;

  select p.data -> 0 into v_ev from app.snapshot_parts p where p.snapshot_id = v_id and p.tbl = 'events';
  if v_ev is null then
    raise exception 'no such event';
  end if;
  update app.snapshots s
     set phase = (v_ev ->> 'current_phase')::public.phase_code,
         game_time = case when (v_ev ->> 'paused')::boolean then (v_ev ->> 'paused_at')::timestamptz else v_started end,
         fingerprint = app.snapshot_fingerprint(v_id),
         n_tables = (select count(*) from app.snapshot_parts p where p.snapshot_id = v_id),
         n_rows = (select coalesce(sum(p.n_rows), 0) from app.snapshot_parts p where p.snapshot_id = v_id),
         size_bytes = (select coalesce(sum(p.bytes), 0) from app.snapshot_parts p where p.snapshot_id = v_id),
         ms = (extract(epoch from clock_timestamp() - v_started) * 1000)::int
   where s.id = v_id;

  -- Keep the newest app.snapshot_keep() backups of the event, the Base backup, and any backup a restore waits for.
  delete from app.snapshots s
   where s.event_id = p_event and s.kind <> 'BASE'
     and s.id < (select min(k.id) from (select x.id from app.snapshots x where x.event_id = p_event
                                         order by x.id desc limit app.snapshot_keep()) k)
     and not exists (select 1 from app.snapshot_restores r
                      where r.snapshot_id = s.id and r.status in ('PENDING', 'APPROVED', 'RUNNING'));
  return v_id;
end
$$;
revoke all on function app.take_snapshot(uuid, text, text, uuid) from public, anon, authenticated;

-- ───────────────────────────── The queue ─────────────────────────────

-- Queues a backup (one row; the job takes it). Nothing while backups are switched off or while a restore writes rows.
create or replace function app.enqueue_snapshot(p_event uuid, p_kind text, p_label text, p_by uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' or not app.feature_on(p_event, 'snapshots') then
    return;
  end if;
  insert into app.snapshot_requests (event_id, kind, label, requested_by)
  values (p_event, p_kind, p_label, p_by)
  on conflict (event_id, label) where processed_at is null do nothing;
end
$$;
revoke all on function app.enqueue_snapshot(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function app.snapshot_on_phase()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.current_phase = 'SETUP' then
    perform app.enqueue_snapshot(new.id, 'BASE', 'Base');
  end if;
  perform app.enqueue_snapshot(new.id, 'PHASE', 'Start of ' || app.phase_name(new.current_phase));
  return null;
end
$$;
revoke all on function app.snapshot_on_phase() from public, anon, authenticated;
create trigger snapshot_on_phase after update of current_phase on public.events
  for each row when (old.current_phase is distinct from new.current_phase)
  execute function app.snapshot_on_phase();

create or replace function app.snapshot_on_round()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.enqueue_snapshot(new.event_id, 'ROUND', 'Trading round ' || new.number || ' cleared');
  return null;
end
$$;
revoke all on function app.snapshot_on_round() from public, anon, authenticated;
create trigger snapshot_on_round after update of status on public.rounds
  for each row when (new.status = 'CLEARED' and old.status is distinct from new.status)
  execute function app.snapshot_on_round();

create or replace function app.snapshot_on_release()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.enqueue_snapshot(new.event_id, 'RELEASE', 'Scores released: ' || new.type::text);
  return null;
end
$$;
revoke all on function app.snapshot_on_release() from public, anon, authenticated;
create trigger snapshot_on_release after update of released_at on public.scores
  for each row when (new.released_at is not null and new.released_at is distinct from old.released_at)
  execute function app.snapshot_on_release();

-- ───────────────────────────── Restoring ─────────────────────────────

-- Runs one approved restore (called by the job, never inside a game transaction). Raises on any problem: the
-- caller's subtransaction then undoes everything, and the request is marked FAILED with the reason.
create or replace function app.restore_snapshot(p_restore bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r app.snapshot_restores;
  v_s app.snapshots;
  v_event public.events;
  v_teams jsonb;
  v_ev jsonb;
  v_safety bigint;
  v_live jsonb;
  v_cols text;
  v_set text;
  v_by text;
  t record;
  -- The event's settings stay as they are now; its game state goes back.
  v_keep_event text[] := array['id', 'slug', 'name', 'is_rehearsal', 'created_at', 'clock_speed', 'timezone', 'format',
                               'features', 'paused', 'paused_at', 'auto_advance', 'manual_starts', 'hold_steps',
                               'judge_model_slot', 'desk_check_in', 'registration_open'];
  -- A team's identity and attendance stay; its money, collateral and standing go back.
  v_keep_team text[] := array['id', 'event_id', 'code', 'track', 'name', 'created_at', 'checked_in_at', 'checked_in_by'];
begin
  perform set_config('lock_timeout', '5s', true);
  select * into v_r from app.snapshot_restores where id = p_restore for update;
  if v_r.id is null or v_r.status <> 'APPROVED' then
    raise exception 'restore request % is not waiting to run', p_restore;
  end if;
  select * into v_s from app.snapshots where id = v_r.snapshot_id;
  if v_s.id is null or v_s.event_id <> v_r.event_id then
    raise exception 'The backup no longer exists.';
  end if;
  -- Hold the event: the heartbeat skips it while this runs, organiser and team actions wait for it.
  perform pg_advisory_xact_lock(hashtext('tick:' || v_s.event_id::text));
  select * into v_event from public.events where id = v_s.event_id for update;
  if not v_event.paused then
    raise exception 'The event was resumed before the restore ran. Pause it and ask again.';
  end if;
  select p.data into v_teams from app.snapshot_parts p where p.snapshot_id = v_s.id and p.tbl = 'teams';
  select p.data -> 0 into v_ev from app.snapshot_parts p where p.snapshot_id = v_s.id and p.tbl = 'events';
  if v_ev is null or v_teams is null then
    raise exception 'This backup is incomplete.';
  end if;
  if exists (select 1 from public.teams tm where tm.event_id = v_event.id
              and not exists (select 1 from jsonb_array_elements(v_teams) x where (x ->> 'id')::uuid = tm.id)) then
    raise exception 'Some teams were added after this backup was taken, so it cannot be restored.';
  end if;

  update app.snapshot_restores set status = 'RUNNING', started_at = clock_timestamp() where id = v_r.id;
  -- The event as it is now, in case this was the wrong backup.
  v_safety := app.take_snapshot(v_event.id, format('Before restoring #%s (%s)', v_s.id, v_s.label), 'SAFETY', v_r.decided_by);

  perform set_config('app.allow_purge', 'on', true);       -- audit, append-only and immutable triggers stand aside
  perform set_config('app.price_writer', 'CLEARING', true); -- prices go back as stored; no indicative-price updates
  perform set_config('app.restoring', 'on', true);          -- the rows written back queue no backups

  -- The judge's full texts are not in backups: keep the ones stored now for the runs written back.
  for t in select st.tbl from app.snapshot_tables() st
            where st.restore and exists (select 1 from pg_catalog.pg_attribute a
                                          where a.attrelid = pg_catalog.to_regclass('public.' || quote_ident(st.tbl))
                                            and a.attname = 'raw_response' and not a.attisdropped)
                             and exists (select 1 from pg_catalog.pg_attribute a
                                          where a.attrelid = pg_catalog.to_regclass('public.' || quote_ident(st.tbl))
                                            and a.attname = 'request_text' and not a.attisdropped) loop
    execute format('drop table if exists pg_temp.%I', 'keep_' || t.tbl);
    execute format('create temporary table %I on commit drop as select id, request_text, raw_response from public.%I '
                   'where event_id = %L and (request_text is not null or raw_response is not null)', 'keep_' || t.tbl, t.tbl, v_event.id);
  end loop;

  -- Children first.
  for t in select st.tbl from app.snapshot_tables() st where st.restore and st.tbl <> 'teams' order by st.depth desc, st.tbl loop
    execute format('delete from public.%I where event_id = $1', t.tbl) using v_event.id;
  end loop;

  -- The teams stay (their logins point at them); their game columns go back.
  select string_agg(format('%I = s.%I', c, c), ', ') into v_set
    from unnest(app.snapshot_cols('teams')) c
   where c <> all (v_keep_team) and (v_teams -> 0) ? c;
  if v_set is not null then
    execute format('update public.teams t set %s from jsonb_populate_recordset(null::public.teams, $1) s '
                   'where t.id = s.id and t.event_id = $2', v_set)
      using v_teams, v_event.id;
  end if;
  select string_agg(quote_ident(c), ', ') into v_cols
    from unnest(app.snapshot_cols('teams')) c where (v_teams -> 0) ? c;
  if v_cols is not null then
    execute format('insert into public.teams (%1$s) select %1$s from jsonb_populate_recordset(null::public.teams, $1) s '
                   'where not exists (select 1 from public.teams x where x.id = s.id)', v_cols)
      using v_teams;
  end if;

  -- The event's state goes back; it stays paused, as of the moment of the backup.
  select string_agg(format('%I = s.%I', c, c), ', ') into v_set
    from unnest(app.snapshot_cols('events')) c
   where c <> all (v_keep_event) and v_ev ? c;
  if v_set is not null then
    execute format('update public.events e set %s from jsonb_populate_record(null::public.events, $1) s where e.id = $2', v_set)
      using v_ev, v_event.id;
  end if;
  update public.events set paused = true, paused_at = coalesce(v_s.game_time, v_s.taken_at) where id = v_event.id;

  -- Parents first.
  for t in select p.tbl, p.cols, p.data from app.snapshot_parts p
             join app.snapshot_tables() st on st.tbl = p.tbl
            where p.snapshot_id = v_s.id and st.restore and p.tbl not in ('teams', 'events') and p.n_rows > 0
            order by st.depth, p.tbl loop
    select string_agg(quote_ident(c), ', ') into v_cols
      from unnest(t.cols) c where c = any (app.snapshot_cols(t.tbl));
    execute format('insert into public.%1$I (%2$s) overriding system value '
                   'select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)', t.tbl, v_cols)
      using t.data;
  end loop;

  for t in select c.relname::text as tmp, substr(c.relname::text, 6) as tbl
             from pg_catalog.pg_class c
            where c.relnamespace = pg_catalog.pg_my_temp_schema() and c.relname::text like 'keep\_%' loop
    execute format('update public.%I x set request_text = k.request_text, raw_response = k.raw_response '
                   'from pg_temp.%I k where x.id = k.id', t.tbl, t.tmp);
    execute format('drop table pg_temp.%I', t.tmp);
  end loop;

  perform set_config('app.allow_purge', 'off', true);
  perform set_config('app.price_writer', '', true);

  -- The event must now be exactly the backup, or nothing is changed.
  v_live := app.live_fingerprint(v_event.id);
  if v_live is distinct from v_s.fingerprint then
    raise exception 'The restored event does not match the backup, so nothing was changed (backup %, now %).', v_s.fingerprint, v_live;
  end if;

  -- Backups queued before the restore describe a night that is gone.
  update app.snapshot_requests set processed_at = now(), note = 'Skipped: a backup was restored'
   where event_id = v_event.id and processed_at is null;
  update app.snapshot_restores set status = 'DONE', finished_at = clock_timestamp(), safety_snapshot_id = v_safety
   where id = v_r.id;

  v_by := coalesce((select a.display_name from public.accounts a where a.user_id = v_r.decided_by), 'Organiser');
  perform set_config('msim.manual', v_by, true);
  perform app.log_event(v_event.id, 'CONTROL', format('Restored backup %s taken at %s', v_s.label,
                        to_char(v_s.taken_at at time zone v_event.timezone, 'HH24:MI')));
  perform set_config('msim.manual', '', true);
  insert into public.audit_log (event_id, actor_user_id, actor_role, action, entity, entity_id, before, after)
  values (v_event.id, v_r.decided_by, 'system', 'restore', 'events', v_event.id::text,
          jsonb_build_object('phase', v_event.current_phase, 'before_backup', v_safety),
          jsonb_build_object('backup', v_s.id, 'label', v_s.label, 'taken_at', v_s.taken_at, 'phase', v_ev ->> 'current_phase',
                             'requested_by', v_r.requested_by, 'approved_by', v_r.decided_by, 'reason', v_r.reason));
  perform set_config('app.restoring', 'off', true);
  -- Every screen re-reads.
  perform app.broadcast(v_event.id, 'phase', jsonb_build_object('phase', v_ev ->> 'current_phase', 'restored', true));
  perform app.broadcast_staff(v_event.id, 'restore');
  return jsonb_build_object('restored', v_s.id, 'before_backup', v_safety);
end
$$;
revoke all on function app.restore_snapshot(bigint) from public, anon, authenticated;

-- The job (pg_cron msim-snapshot, every 10 seconds): approved restores first, then the queue — per event, one
-- backup for everything waiting, at most one every p_min_gap. Each in its own subtransaction: a failure is logged
-- (error_log, and the restore request) and never stops another event's backups.
create or replace function app.process_snapshot_requests(p_min_gap interval default interval '5 seconds')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_restore bigint;
  v_event uuid;
  v_max bigint;
  v_kind text;
  v_label text;
  v_by uuid;
  v_id bigint;
  v_taken int := 0;
  v_restored int := 0;
  v_failed int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('msim-snapshot')) then
    return jsonb_build_object('skipped', true);
  end if;

  for v_restore in select r.id from app.snapshot_restores r where r.status = 'APPROVED' order by r.id loop
    begin
      perform app.restore_snapshot(v_restore);
      v_restored := v_restored + 1;
    exception when others then
      v_failed := v_failed + 1;
      update app.snapshot_restores set status = 'FAILED', finished_at = clock_timestamp(), error = sqlerrm where id = v_restore;
      insert into public.error_log (event_id, source, message, context)
      select r.event_id, 'restore', sqlerrm, jsonb_build_object('sqlstate', sqlstate, 'restore', v_restore)
        from app.snapshot_restores r where r.id = v_restore;
      perform app.log_event(r.event_id, 'CONTROL', 'Restore failed, nothing was changed: ' || left(sqlerrm, 300))
         from app.snapshot_restores r where r.id = v_restore;
      perform app.broadcast_staff(r.event_id, 'restore') from app.snapshot_restores r where r.id = v_restore;
    end;
  end loop;

  for v_event in select q.event_id from app.snapshot_requests q where q.processed_at is null
                  group by q.event_id order by min(q.id) loop
    continue when exists (select 1 from app.snapshots s where s.event_id = v_event and s.taken_at > clock_timestamp() - p_min_gap);
    select max(q.id) into v_max from app.snapshot_requests q where q.event_id = v_event and q.processed_at is null;
    if not app.feature_on(v_event, 'snapshots') then
      update app.snapshot_requests set processed_at = now(), note = 'Skipped: backups are switched off'
       where event_id = v_event and processed_at is null and id <= v_max;
      continue;
    end if;
    select (array_agg(q.kind order by case q.kind when 'BASE' then 1 when 'RELEASE' then 2 when 'ROUND' then 3
                                                  when 'PHASE' then 4 else 5 end, q.id))[1],
           string_agg(q.label, ' · ' order by q.id),
           (array_agg(q.requested_by order by q.id) filter (where q.requested_by is not null))[1]
      into v_kind, v_label, v_by
      from app.snapshot_requests q where q.event_id = v_event and q.processed_at is null and q.id <= v_max;
    begin
      v_id := app.take_snapshot(v_event, v_label, v_kind, v_by);
      update app.snapshot_requests set processed_at = now(), snapshot_id = v_id
       where event_id = v_event and processed_at is null and id <= v_max;
      v_taken := v_taken + 1;
      perform app.broadcast_staff(v_event, 'backup');
    exception when others then
      v_failed := v_failed + 1;
      insert into public.error_log (event_id, source, message, context)
      values (v_event, 'snapshot', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
      update app.snapshot_requests
         set attempts = attempts + 1, note = left(sqlerrm, 300),
             processed_at = case when attempts + 1 >= 3 then now() end
       where event_id = v_event and processed_at is null and id <= v_max;
    end;
  end loop;
  return jsonb_build_object('taken', v_taken, 'restored', v_restored, 'failed', v_failed);
end
$$;
revoke all on function app.process_snapshot_requests(interval) from public, anon, authenticated;

-- ───────────────────────────── For the Backups page ─────────────────────────────

-- Back up now (organisers). Queued: the job takes it within about 10 seconds.
create or replace function public.request_snapshot(p_event uuid, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  perform app.require_organiser();
  if not exists (select 1 from public.events where id = p_event) then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if not app.feature_on(p_event, 'snapshots') then
    return app.fail('BACKUPS_OFF', 'Backups are switched off. Turn them on under Switches on the Run page.');
  end if;
  if length(v_label) > 80 then
    return app.fail('BAD_LABEL', 'Keep the name under 80 characters.');
  end if;
  v_label := coalesce(v_label, 'Backup by ' || coalesce((select a.display_name from public.accounts a where a.user_id = auth.uid()), 'the system'));
  perform app.enqueue_snapshot(p_event, 'MANUAL', v_label, auth.uid());
  return app.ok(jsonb_build_object('queued', true, 'label', v_label));
end
$$;
revoke all on function public.request_snapshot(uuid, text) from public, anon;
grant execute on function public.request_snapshot(uuid, text) to authenticated;

-- Everything the Backups page shows (organisers and the fairness officer).
create or replace function public.snapshots_list(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  if not app.is_staff() then
    raise exception 'only organisers and the fairness officer can see backups' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  return app.ok(jsonb_build_object(
    'backups_on', app.feature_on(p_event, 'snapshots'),
    'paused', v_event.paused,
    'phase', v_event.current_phase,
    'keep', app.snapshot_keep(),
    -- While paused, the event's own fingerprint now (it does not change until the event resumes).
    'now', case when v_event.paused then app.live_fingerprint(p_event) end,
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'label', s.label, 'kind', s.kind, 'taken_at', s.taken_at, 'game_time', s.game_time,
               'phase', s.phase, 'tables', s.n_tables, 'rows', s.n_rows, 'size_bytes', s.size_bytes, 'ms', s.ms,
               'fingerprint', s.fingerprint, 'by', a.display_name) order by s.id desc)
        from app.snapshots s left join public.accounts a on a.user_id = s.requested_by
       where s.event_id = p_event), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'label', q.label, 'kind', q.kind, 'requested_at', q.requested_at,
                                          'attempts', q.attempts, 'note', q.note) order by q.id)
        from app.snapshot_requests q where q.event_id = p_event and q.processed_at is null), '[]'::jsonb),
    'restores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'snapshot_id', r.snapshot_id, 'label', r.snapshot_label, 'taken_at', r.snapshot_taken_at,
               'reason', r.reason, 'status', r.status, 'requested_by', r.requested_by, 'requested_by_name', ra.display_name,
               'requested_at', r.requested_at, 'decided_by_name', da.display_name, 'decided_at', r.decided_at,
               'note', r.note, 'finished_at', r.finished_at, 'error', r.error, 'before_backup', r.safety_snapshot_id,
               'mine', r.requested_by = auth.uid()) order by r.id desc)
        from (select * from app.snapshot_restores x where x.event_id = p_event order by x.id desc limit 20) r
        left join public.accounts ra on ra.user_id = r.requested_by
        left join public.accounts da on da.user_id = r.decided_by), '[]'::jsonb)));
end
$$;
revoke all on function public.snapshots_list(uuid) from public, anon;
grant execute on function public.snapshots_list(uuid) to authenticated;

-- The download (organisers and the fairness officer). Without a table: the backup and its tables; with one: that
-- table's rows (the page fetches them one by one and saves one JSON file).
create or replace function public.snapshot_data(p_snapshot bigint, p_table text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_s app.snapshots;
  v_slug text;
  v_part app.snapshot_parts;
begin
  if not app.is_staff() then
    raise exception 'only organisers and the fairness officer can download backups' using errcode = '42501';
  end if;
  select * into v_s from app.snapshots where id = p_snapshot;
  if v_s.id is null then
    return app.fail('NO_BACKUP', 'No such backup.');
  end if;
  if p_table is null then
    select slug into v_slug from public.events where id = v_s.event_id;
    return app.ok(jsonb_build_object(
      'backup', jsonb_build_object('id', v_s.id, 'event_id', v_s.event_id, 'event', v_slug, 'label', v_s.label,
                                   'kind', v_s.kind, 'taken_at', v_s.taken_at, 'game_time', v_s.game_time,
                                   'phase', v_s.phase, 'fingerprint', v_s.fingerprint, 'size_bytes', v_s.size_bytes),
      'tables', coalesce((select jsonb_agg(jsonb_build_object('table', p.tbl, 'rows', p.n_rows, 'restored', p.restore)
                                           order by p.depth, p.tbl)
                            from app.snapshot_parts p where p.snapshot_id = p_snapshot), '[]'::jsonb)));
  end if;
  select * into v_part from app.snapshot_parts where snapshot_id = p_snapshot and tbl = p_table;
  if v_part.tbl is null then
    return app.fail('NO_TABLE', 'This backup has no such table.');
  end if;
  return app.ok(jsonb_build_object('table', v_part.tbl, 'columns', to_jsonb(v_part.cols), 'rows', v_part.data));
end
$$;
revoke all on function public.snapshot_data(bigint, text) from public, anon;
grant execute on function public.snapshot_data(bigint, text) to authenticated;

-- Ask for a restore (an organiser, with a reason, while the event is paused). A second person approves it.
create or replace function public.request_restore(p_snapshot bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s app.snapshots;
  v_event public.events;
  v_id bigint;
begin
  if not app.is_organiser() then
    raise exception 'only an organiser can ask for a restore' using errcode = '42501';
  end if;
  select * into v_s from app.snapshots where id = p_snapshot;
  if v_s.id is null then
    return app.fail('NO_BACKUP', 'No such backup.');
  end if;
  select * into v_event from public.events where id = v_s.event_id for no key update;
  if not v_event.paused then
    return app.fail('NOT_PAUSED', 'Pause the event first: a backup is restored only while the event is paused.');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    return app.fail('NO_REASON', 'Say why (at least 10 characters).');
  end if;
  if exists (select 1 from app.snapshot_restores r where r.event_id = v_s.event_id and r.status in ('PENDING', 'APPROVED', 'RUNNING')) then
    return app.fail('ALREADY_ASKED', 'Another restore is waiting. Approve or cancel it first.');
  end if;
  insert into app.snapshot_restores (event_id, snapshot_id, snapshot_label, snapshot_taken_at, requested_by, reason)
  values (v_s.event_id, v_s.id, v_s.label, v_s.taken_at, auth.uid(), btrim(p_reason))
  returning id into v_id;
  perform app.mark_manual();
  perform app.log_event(v_s.event_id, 'CONTROL', format('Restore asked for: backup %s (%s), taken at %s. Waiting for a second person.',
                        v_s.id, v_s.label, to_char(v_s.taken_at at time zone v_event.timezone, 'HH24:MI')));
  perform app.broadcast_staff(v_s.event_id, 'restore');
  return app.ok(jsonb_build_object('restore_id', v_id));
end
$$;
revoke all on function public.request_restore(bigint, text) from public, anon;
grant execute on function public.request_restore(bigint, text) to authenticated;

-- A different organiser, or the fairness officer, approves; the job runs the restore within about 10 seconds.
-- No: rejects it (or, for whoever asked, cancels it).
create or replace function public.approve_restore(p_restore bigint, p_approve boolean default true, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r app.snapshot_restores;
  v_event public.events;
begin
  if not (app.is_organiser() or app.is_fairness()) then
    raise exception 'only an organiser or the fairness officer can decide a restore' using errcode = '42501';
  end if;
  select * into v_r from app.snapshot_restores where id = p_restore;
  if v_r.id is null then
    return app.fail('NO_REQUEST', 'No such restore request.');
  end if;
  select * into v_event from public.events where id = v_r.event_id for no key update;
  select * into v_r from app.snapshot_restores where id = p_restore for update;
  if v_r.status <> 'PENDING' then
    return app.fail('NOT_WAITING', 'This request was already decided.');
  end if;
  perform app.mark_manual();
  if not coalesce(p_approve, false) then
    update app.snapshot_restores
       set status = case when requested_by = auth.uid() then 'CANCELLED' else 'REJECTED' end,
           decided_by = auth.uid(), decided_at = now(), note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_r.id;
    perform app.log_event(v_r.event_id, 'CONTROL', format('Restore of backup %s (%s) %s', v_r.snapshot_id, v_r.snapshot_label,
                          case when v_r.requested_by = auth.uid() then 'cancelled' else 'rejected' end));
    perform app.broadcast_staff(v_r.event_id, 'restore');
    return app.ok(jsonb_build_object('status', case when v_r.requested_by = auth.uid() then 'CANCELLED' else 'REJECTED' end));
  end if;
  if v_r.requested_by = auth.uid() then
    return app.fail('SAME_PERSON', 'A second person must approve: you asked for this restore.');
  end if;
  if not v_event.paused then
    return app.fail('NOT_PAUSED', 'Pause the event first: a backup is restored only while the event is paused.');
  end if;
  if v_r.snapshot_id is null then
    return app.fail('NO_BACKUP', 'That backup no longer exists.');
  end if;
  if v_r.requested_at < now() - interval '30 minutes' then
    update app.snapshot_restores set status = 'CANCELLED', note = 'Expired: not approved within 30 minutes' where id = v_r.id;
    return app.fail('EXPIRED', 'This request is over 30 minutes old. Ask again.');
  end if;
  update app.snapshot_restores
     set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), note = nullif(btrim(coalesce(p_note, '')), '')
   where id = v_r.id;
  perform app.log_event(v_r.event_id, 'CONTROL', format('Restore of backup %s (%s) approved; it runs within 10 seconds',
                        v_r.snapshot_id, v_r.snapshot_label));
  perform app.broadcast_staff(v_r.event_id, 'restore');
  return app.ok(jsonb_build_object('status', 'APPROVED'));
end
$$;
revoke all on function public.approve_restore(bigint, boolean, text) from public, anon;
grant execute on function public.approve_restore(bigint, boolean, text) to authenticated;

-- ───────────────────────────── The job ─────────────────────────────

-- Every 10 seconds (Supabase pg_cron ≥ 1.5 runs second-level schedules). Skipped where pg_cron is not installed
-- (local tests call app.process_snapshot_requests() themselves).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.unschedule(jobid) from cron.job where jobname = 'msim-snapshot';
    perform cron.schedule('msim-snapshot', '10 seconds', 'select app.process_snapshot_requests()');
  end if;
exception when others then
  raise warning 'pg_cron backups not scheduled: %', sqlerrm;
end $$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261211000075'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
