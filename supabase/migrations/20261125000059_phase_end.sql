-- The organiser sets the current phase's end to an exact time, earlier or later, and everything after it moves with
-- it. `extend_event` could only ever push the night later, in whole minutes; on the night an organiser also needs to
-- pull a phase in, because the briefing finished early or the schedule has drifted. The projector and every team
-- screen count down to the phase's end, so they follow this with no further work.
--
-- Nothing already past moves: a phase that has started keeps its start, an opened round keeps its opening time, and a
-- cleared round never moves. Bringing the schedule forward is refused if it would put a round's close or a deadline
-- in the past, so a submission window cannot be closed retroactively by a mistyped time.

-- A phase that has ended keeps both its times. Without this, a phase that was ended without ever being started —
-- SETUP, when the organiser advances past it before its nominal start — had its start moved while its end stayed,
-- which breaks the row's own check that the end is not before the start. `extend_event` then failed outright.
-- Found by the new test below; only the one `ended_at is null` is added.
create or replace function app.shift_schedule(p_event uuid, p_from timestamptz, p_delta interval, p_late boolean default false)
returns void
language plpgsql
as $$
begin
  if p_delta <= interval '0' then
    return;
  end if;
  -- Only what has not happened yet moves: a phase that has started keeps its start, a round that has
  -- opened keeps its opening time, and a cleared round never moves.
  update public.phases set ends_at = ends_at + p_delta where event_id = p_event and ends_at >= p_from and ended_at is null;
  update public.phases set starts_at = starts_at + p_delta where event_id = p_event and starts_at >= p_from and started_at is null and ended_at is null;
  update public.rounds set closes_at = closes_at + p_delta where event_id = p_event and closes_at >= p_from and status in ('SCHEDULED', 'OPEN');
  update public.rounds set opens_at = opens_at + p_delta where event_id = p_event and opens_at >= p_from and status = 'SCHEDULED';
  update public.deadlines set at = at + p_delta
   where event_id = p_event and at >= p_from
     and (not p_late or at > now() or not app.window_opened(p_event, code));
end
$$;

create or replace function public.set_phase_end(p_event uuid, p_ends_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_ends_at timestamptz;
  v_from timestamptz;
  v_delta interval;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for no key update;
  if not found then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  select p.ends_at into v_ends_at
    from public.phases p
   where p.event_id = p_event and p.code = v_event.current_phase and p.ended_at is null;
  if v_ends_at is null then
    return app.fail('NO_PHASE', 'The phase on now has no planned end to change.');
  end if;

  -- While paused, time stands still at the start of the pause: what was ahead then is what moves.
  v_from := case when v_event.paused then v_event.paused_at else now() end;
  if p_ends_at <= v_from + interval '1 minute' then
    return app.fail('TOO_SOON', 'Pick a time at least a minute away.');
  end if;

  v_delta := p_ends_at - v_ends_at;
  if v_delta = interval '0' then
    return app.ok(jsonb_build_object('ends_at', v_ends_at));
  end if;

  if v_delta > interval '0' then
    -- Later: the same path as extend_event, so a shift forward behaves exactly as it always has.
    perform app.shift_schedule(p_event, v_from, v_delta);
  else
    if exists (
      select 1 from public.rounds r
       where r.event_id = p_event and r.status in ('SCHEDULED', 'OPEN')
         and r.closes_at >= v_from and r.closes_at + v_delta <= v_from
    ) then
      return app.fail('ROUND_IN_PAST', 'That would close a trading round in the past. Pick a later time.');
    end if;
    if exists (
      select 1 from public.rounds r
       where r.event_id = p_event and r.status = 'OPEN'
         and r.closes_at >= v_from and r.closes_at + v_delta <= r.opens_at
    ) then
      return app.fail('ROUND_IN_PAST', 'That would close a trading round before it opened. Pick a later time.');
    end if;
    if exists (
      select 1 from public.deadlines d
       where d.event_id = p_event and d.at >= v_from and d.at + v_delta <= v_from
    ) then
      return app.fail('DEADLINE_IN_PAST', 'That would move a deadline into the past. Pick a later time.');
    end if;
    -- Starts move before ends here, the opposite of a shift later: both rows check that the end is not before the
    -- start, and moving the end in first would break that for a phase or round whose start has not moved yet.
    update public.phases set starts_at = starts_at + v_delta
     where event_id = p_event and starts_at >= v_from and started_at is null and ended_at is null;
    update public.phases set ends_at = ends_at + v_delta
     where event_id = p_event and ends_at >= v_from and ended_at is null;
    update public.rounds set opens_at = opens_at + v_delta
     where event_id = p_event and opens_at >= v_from and status = 'SCHEDULED';
    update public.rounds set closes_at = closes_at + v_delta
     where event_id = p_event and closes_at >= v_from and status in ('SCHEDULED', 'OPEN');
    update public.deadlines set at = at + v_delta
     where event_id = p_event and at >= v_from;
  end if;

  perform app.broadcast(p_event, 'extended', jsonb_build_object('minutes', round(extract(epoch from v_delta) / 60)));
  return app.ok(jsonb_build_object('ends_at', p_ends_at));
end
$$;

do $$
begin
  execute 'revoke all on function public.set_phase_end(uuid, timestamptz) from public, anon';
  execute 'grant execute on function public.set_phase_end(uuid, timestamptz) to authenticated, service_role';
end $$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261125000059'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
