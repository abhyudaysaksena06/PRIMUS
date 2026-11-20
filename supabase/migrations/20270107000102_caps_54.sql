-- New caps (organisers, 20 Nov): at most 54 admitted teams per track (was 70, migration 098) and at most 162 teams in
-- all (54 squads). Teams already admitted are untouched; corrections and check-outs still work.

create or replace function app.track_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 54 $$;

create or replace function app.team_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 162 $$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270107000102'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
