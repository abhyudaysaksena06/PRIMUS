-- Migration 085 (20 Nov): "Reset to new" for the live event, from the Run page. The organisers test the final platform
-- on the real event with a few registered teams, then reset it and run the night on it.
--
-- public.reset_event(event, confirm)   organisers only; confirm must be the event's slug, typed. Everything played is
--   wiped (phases, squads, companies, submissions, scores, orders, money, chats, backups...) and the event is built
--   again from the payload it was created with, so the plan, cards, logins and decks are as at creation. What the
--   registration desk did is kept: every team's name and members, which teams are checked in, and the team list
--   (roster). The event's settings stay as set (switches, desk rule, registration open, manual starts, holds,
--   auto-advance). A rehearsal's plan starts again 5 minutes from now; a live event keeps its planned times.
--
-- seed_event now keeps the payload of every event (it kept only rehearsals'), so a live event created from now on can
-- be reset. An event created before this migration has no payload: the reset refuses with NO_PAYLOAD.

select app.patch_one_function('public.seed_event(jsonb)'::regprocedure,
  '  if v_rehearsal then
    insert into app.seed_payloads (slug, payload) values (v_e ->> ''slug'', p)
    on conflict (slug) do update set payload = excluded.payload, saved_at = now();
  end if;',
  '  insert into app.seed_payloads (slug, payload) values (v_e ->> ''slug'', p)
  on conflict (slug) do update set payload = excluded.payload, saved_at = now();');

create or replace function public.reset_event(p_event uuid, p_confirm text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_payload jsonb;
  v_teams jsonb;
  v_members jsonb;
  v_roster jsonb;
  v_new uuid;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if p_confirm is distinct from v_event.slug then
    return app.fail('CONFIRM', format('Type the event''s name exactly (%s) to reset it.', v_event.slug));
  end if;
  select payload into v_payload from app.seed_payloads where slug = v_event.slug;
  if v_payload is null then
    return app.fail('NO_PAYLOAD', 'This event was created before resets were possible: it cannot be reset. Create it again with its SQL file.');
  end if;
  if v_event.is_rehearsal then
    v_payload := app.shift_payload(v_payload, (now() + interval '5 minutes') - (v_payload -> 'event' ->> 'starts_at')::timestamptz);
  end if;

  -- What the registration desk did, by team code.
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'checked_in', t.checked_in_at is not null)), '[]')
    into v_teams from public.teams t where t.event_id = p_event;
  select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('team_code', t.code)), '[]')
    into v_members from public.members m join public.teams t on t.id = m.team_id where m.event_id = p_event;
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('team_code', t.code)), '[]')
    into v_roster from public.roster r left join public.teams t on t.id = r.team_id where r.event_id = p_event;

  -- Wipe (as purge_event, for an event in any phase).
  insert into public.audit_log (event_id, actor_role, action, entity, entity_id, before)
  values (p_event, 'organiser', 'reset', 'events', p_event::text,
          jsonb_build_object('slug', v_event.slug, 'phase', v_event.current_phase));
  perform set_config('app.allow_purge', 'on', true);
  delete from public.accounts a using public.teams t where a.team_id = t.id and t.event_id = p_event;
  delete from public.events where id = p_event;
  perform set_config('app.allow_purge', 'off', true);

  -- Build it again, then put the desk's work and the settings back.
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

  perform app.log_event(v_new, 'CONTROL', 'Reset to new: everything played was wiped; registrations and settings kept');
  return app.ok(jsonb_build_object('event_id', v_new, 'slug', v_event.slug));
end
$$;
revoke all on function public.reset_event(uuid, text) from public, anon;
grant execute on function public.reset_event(uuid, text) to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261221000085'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
