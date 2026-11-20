-- At most 90 admitted teams per track (organisers, 20 Nov): the registration desk refuses to admit a 91st Product,
-- Consulting or Finance team (TRACK_FULL). Teams already admitted, corrections to them (p_edit) and check-outs are
-- untouched; checking a team out frees its place. Two desks admitting at once cannot pass the cap together: the
-- count is taken under a transaction lock per event and track.

create or replace function app.track_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 90 $$;
revoke all on function app.track_cap() from public, anon, authenticated;

select app.patch_functions(
$o$    if p_track is not null and v_team.track <> p_track and not coalesce(p_edit, false) then
      return app.fail('WRONG_TRACK', format('Card %s is a %s card, not %s: type a card of the team''s track.',
        v_code, initcap(v_team.track::text), initcap(p_track::text)));
    end if;$o$,
$n$    if p_track is not null and v_team.track <> p_track and not coalesce(p_edit, false) then
      return app.fail('WRONG_TRACK', format('Card %s is a %s card, not %s: type a card of the team''s track.',
        v_code, initcap(v_team.track::text), initcap(p_track::text)));
    end if;
    if v_team.checked_in_at is null and not coalesce(p_edit, false) then
      perform pg_advisory_xact_lock(hashtext('track_cap:' || v_team.event_id::text || ':' || v_team.track::text));
      if (select count(*) from public.teams t2
           where t2.event_id = v_team.event_id and t2.track = v_team.track and t2.checked_in_at is not null) >= app.track_cap() then
        return app.fail('TRACK_FULL', format('%s already has %s admitted teams, the most allowed. Check a team out first to free a place.',
          initcap(v_team.track::text), app.track_cap()));
      end if;
    end if;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261231000095'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
