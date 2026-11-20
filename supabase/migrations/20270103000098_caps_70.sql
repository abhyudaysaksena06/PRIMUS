-- New caps (organisers, 20 Nov): at most 70 admitted teams per track (was 90, migration 095) and at most 210 teams
-- in all. The desk refuses the 71st team of a track (TRACK_FULL) and any team past 210 (TEAMS_FULL). The 675
-- participant cap (096) is unchanged. Teams already admitted are untouched; corrections and check-outs still work.

create or replace function app.track_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 70 $$;

create or replace function app.team_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 210 $$;
revoke all on function app.team_cap() from public, anon, authenticated;

select app.patch_functions(
$o$    if v_team.checked_in_at is null and not coalesce(p_edit, false) then
      perform pg_advisory_xact_lock(hashtext('track_cap:' || v_team.event_id::text || ':' || v_team.track::text));$o$,
$n$    if v_team.checked_in_at is null and not coalesce(p_edit, false)
       and (select count(*) from public.teams t3 where t3.event_id = v_team.event_id and t3.checked_in_at is not null) >= app.team_cap() then
      return app.fail('TEAMS_FULL', format('The event already has %s admitted teams, the most allowed. Check a team out first to free a place.', app.team_cap()));
    end if;
    if v_team.checked_in_at is null and not coalesce(p_edit, false) then
      perform pg_advisory_xact_lock(hashtext('track_cap:' || v_team.event_id::text || ':' || v_team.track::text));$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270103000098'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
