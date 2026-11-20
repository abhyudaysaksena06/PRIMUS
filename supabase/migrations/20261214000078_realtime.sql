-- Realtime within the Supabase Pro budget (500 connections, 500 messages a second).
--
-- One message on an event's channel reaches every screen of the event (about 430 with 400 teams, the projectors and
-- the staff), and every screen re-reads its page on it. Two kinds of message are sent once per change by many teams at
-- the same moment: equity raises (posted, funded, cancelled) and, from tonight, hires locked (migration 071). With the
-- switch 'broadcast_coalesce' on they are gathered and the heartbeat (every 2 s) sends them as ONE "refresh" message
-- naming the kinds that changed. Every other message (rounds, phases, crisis steps, releases, bulletins, Q&A, pauses)
-- still goes at once.
--
-- The automatic holds of manual mode (app.hold_tick) moved the schedule without telling any screen, so the projector
-- showed the old times for up to a minute; they now send "extended" (about once a minute while a step is held).

create table app.broadcast_pending (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index broadcast_pending_event_idx on app.broadcast_pending (event_id);
revoke all on table app.broadcast_pending from public, anon, authenticated;

-- The kinds the heartbeat sends together.
create or replace function app.lazy_broadcast(p_kind text)
returns boolean
language sql immutable
as $$
  select p_kind in ('raises', 'hire_locked')
$$;
revoke all on function app.lazy_broadcast(text) from public, anon, authenticated;

create or replace function app.broadcast(p_event uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
begin
  -- Many teams change these at once: the heartbeat sends them as one message (app.flush_broadcasts).
  if app.lazy_broadcast(p_kind) and app.feature_on(p_event, 'broadcast_coalesce') then
    insert into app.broadcast_pending (event_id, kind) values (p_event, p_kind);
    return;
  end if;
  perform realtime.send(
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('kind', p_kind, 'event_id', p_event, 'at', now()),
    p_kind,
    'event:' || p_event::text,
    true);
end
$$;

-- Sends what was gathered as one "refresh" message (every screen re-reads on any message).
create or replace function app.flush_broadcasts(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_kinds text[];
begin
  with gone as (delete from app.broadcast_pending where event_id = p_event returning kind)
  select array_agg(distinct kind order by kind) into v_kinds from gone;
  if v_kinds is null then
    return;
  end if;
  perform realtime.send(
    jsonb_build_object('kind', 'refresh', 'kinds', to_jsonb(v_kinds), 'event_id', p_event, 'at', now()),
    'refresh',
    'event:' || p_event::text,
    true);
end
$$;
revoke all on function app.flush_broadcasts(uuid) from public, anon, authenticated;

-- The heartbeat flushes first, even while the event is paused (a pause must not hold back a raise or a hire).
select app.patch_functions(
$o$  if not pg_try_advisory_xact_lock(hashtext('tick:' || p_event::text)) then
    return app.ok(jsonb_build_object('skipped', true));
  end if;$o$,
$n$  if not pg_try_advisory_xact_lock(hashtext('tick:' || p_event::text)) then
    return app.ok(jsonb_build_object('skipped', true));
  end if;
  -- Messages gathered since the last beat (raises, hires) go out as one.
  perform app.flush_broadcasts(p_event);$n$);

-- An automatic hold tells every screen that the times moved.
select app.patch_functions(
$o$      perform app.shift_schedule(p_event, v_at, (now() + interval '2 minutes') - v_at);$o$,
$n$      perform app.shift_schedule(p_event, v_at, (now() + interval '2 minutes') - v_at);
      -- Every screen re-reads its times (before, the projector showed the old ones for up to a minute).
      perform app.broadcast(p_event, 'extended', jsonb_build_object('held', true));$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261214000078'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
