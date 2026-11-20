-- Migration 087 (20 Nov): two resets on the Run page.
--   Test reset  = public.reset_event(event, slug)                  (085/086): wipes play, keeps every registration.
--   Final reset = public.reset_event(event, 'FINAL ' || slug, true): the same, and the test teams are unregistered:
--                 back to their blank card (placeholder name, no members, not checked in, off the team list), so
--                 they stay out of the night's squad draw. A test team is one whose members' roll numbers all start
--                 with TEST- (the test teams set up on 20 Nov: P01-P03, C01-C03, F01-F03). Real registrations stay.

create or replace function public.reset_event(p_event uuid, p_confirm text, p_final boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_payload jsonb;
  v_teams jsonb;
  v_members jsonb;
  v_roster jsonb;
  v_statements jsonb;
  v_test text[] := '{}';
  v_new uuid;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if p_confirm is distinct from (case when p_final then 'FINAL ' else '' end) || v_event.slug then
    return app.fail('CONFIRM', format('Type %s exactly to reset it.', (case when p_final then 'FINAL ' else '' end) || v_event.slug));
  end if;
  select payload into v_payload from app.seed_payloads where slug = v_event.slug;
  if v_payload is null then
    return app.fail('NO_PAYLOAD', 'This event was created before resets were possible: it cannot be reset. Create it again with its SQL file.');
  end if;
  if v_event.is_rehearsal then
    v_payload := app.shift_payload(v_payload, (now() + interval '5 minutes') - (v_payload -> 'event' ->> 'starts_at')::timestamptz);
  end if;

  -- The test teams (final reset only): every member's roll number starts with TEST-.
  if p_final then
    select coalesce(array_agg(t.code), '{}') into v_test
      from public.teams t
     where t.event_id = p_event
       and exists (select 1 from public.members m where m.team_id = t.id)
       and not exists (select 1 from public.members m where m.team_id = t.id and coalesce(m.roll_number, '') not like 'TEST-%');
  end if;

  -- What the registration desk did, by team code (the test teams left out on a final reset).
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'checked_in', t.checked_in_at is not null)), '[]')
    into v_teams from public.teams t where t.event_id = p_event and not (t.code = any(v_test));
  select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('team_code', t.code)), '[]')
    into v_members from public.members m join public.teams t on t.id = m.team_id where m.event_id = p_event and not (t.code = any(v_test));
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('team_code', t.code)), '[]')
    into v_roster from public.roster r left join public.teams t on t.id = r.team_id
   where r.event_id = p_event and not (coalesce(t.code, '') = any(v_test));
  select coalesce(jsonb_agg(to_jsonb(s)), '[]') into v_statements from public.problem_statements s where s.event_id = p_event;

  -- Wipe (as purge_event, for an event in any phase).
  insert into public.audit_log (event_id, actor_role, action, entity, entity_id, before)
  values (p_event, 'organiser', case when p_final then 'final reset' else 'reset' end, 'events', p_event::text,
          jsonb_build_object('slug', v_event.slug, 'phase', v_event.current_phase, 'test_teams', to_jsonb(v_test)));
  perform set_config('app.allow_purge', 'on', true);
  delete from public.accounts a using public.teams t where a.team_id = t.id and t.event_id = p_event;
  delete from public.events where id = p_event;
  perform set_config('app.allow_purge', 'off', true);

  -- Build it again, then put the desk's work, the statements and the settings back.
  v_new := public.seed_event(v_payload);
  update public.events
     set features = v_event.features, desk_check_in = v_event.desk_check_in, registration_open = v_event.registration_open,
         manual_starts = v_event.manual_starts, hold_steps = v_event.hold_steps, auto_advance = v_event.auto_advance
   where id = v_new;
  update public.teams t set name = x.name, checked_in_at = case when x.checked_in then now() end
    from jsonb_to_recordset(v_teams) as x(code text, name text, checked_in boolean)
   where t.event_id = v_new and t.code = x.code;
  insert into public.members
  select (jsonb_populate_record(null::public.members, x || jsonb_build_object(
            'event_id', v_new, 'team_id', (select t.id from public.teams t where t.event_id = v_new and t.code = x ->> 'team_code')))).*
    from jsonb_array_elements(v_members) x
   where exists (select 1 from public.teams t where t.event_id = v_new and t.code = x ->> 'team_code');
  insert into public.roster
  select (jsonb_populate_record(null::public.roster, x || jsonb_build_object(
            'event_id', v_new, 'team_id', (select t.id from public.teams t where t.event_id = v_new and t.code = x ->> 'team_code')))).*
    from jsonb_array_elements(v_roster) x;
  insert into public.problem_statements
  select (jsonb_populate_record(null::public.problem_statements, x || jsonb_build_object('event_id', v_new))).*
    from jsonb_array_elements(v_statements) x;

  perform app.log_event(v_new, 'CONTROL', case when p_final
    then format('Final reset: everything played was wiped and %s test teams unregistered; real registrations, settings and Round 3 statements kept', cardinality(v_test))
    else 'Reset to new: everything played was wiped; registrations, settings and Round 3 statements kept' end);
  return app.ok(jsonb_build_object('event_id', v_new, 'slug', v_event.slug, 'test_teams_unregistered', to_jsonb(v_test)));
end
$$;
revoke all on function public.reset_event(uuid, text, boolean) from public, anon;
grant execute on function public.reset_event(uuid, text, boolean) to authenticated;

-- The two-argument test reset is the same function with p_final off.
create or replace function public.reset_event(p_event uuid, p_confirm text)
returns jsonb
language sql security definer set search_path = ''
as $$ select public.reset_event(p_event, p_confirm, false) $$;
revoke all on function public.reset_event(uuid, text) from public, anon;
grant execute on function public.reset_event(uuid, text) to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261223000087'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
