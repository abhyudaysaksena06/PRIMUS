-- At most 675 participants in all (organisers, 20 Nov): the registration desk refuses to admit a team, or to add
-- members to an admitted one, when the members of every admitted team would then pass app.participant_cap()
-- (PARTICIPANTS_FULL). Taking members away is always allowed. The count is taken under a lock per event, so two
-- desks cannot pass the cap together. With the 90-per-track cap (095).

create or replace function app.participant_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 675 $$;
revoke all on function app.participant_cap() from public, anon, authenticated;

select app.patch_functions(
$o$    if v_team.checked_in_at is null and not coalesce(p_edit, false) then
      perform pg_advisory_xact_lock(hashtext('track_cap:' || v_team.event_id::text || ':' || v_team.track::text));$o$,
$n$    perform pg_advisory_xact_lock(hashtext('participant_cap:' || v_team.event_id::text));
    if (select count(*) from public.members m join public.teams t2 on t2.id = m.team_id
         where t2.event_id = v_team.event_id and t2.checked_in_at is not null and t2.id <> v_team.id) + v_n > app.participant_cap()
       and v_n > coalesce((select count(*) from public.members m where m.team_id = v_team.id and v_team.checked_in_at is not null), 0) then
      return app.fail('PARTICIPANTS_FULL', format('The event already has %s participants, the most allowed (%s). This team (%s member%s) does not fit: check a team out or remove members first.',
        (select count(*) from public.members m join public.teams t2 on t2.id = m.team_id
          where t2.event_id = v_team.event_id and t2.checked_in_at is not null and t2.id <> v_team.id),
        app.participant_cap(), v_n, case when v_n = 1 then '' else 's' end));
    end if;
    if v_team.checked_in_at is null and not coalesce(p_edit, false) then
      perform pg_advisory_xact_lock(hashtext('track_cap:' || v_team.event_id::text || ':' || v_team.track::text));$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270101000096'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
