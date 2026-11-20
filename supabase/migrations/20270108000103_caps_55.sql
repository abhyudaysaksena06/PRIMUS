-- New caps (organisers, 20 Nov): at most 55 admitted teams per track (was 54, migration 102) and at most 165 teams in
-- all (55 squads). Teams already admitted are untouched.

create or replace function app.track_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 55 $$;

create or replace function app.team_cap()
returns int
language sql immutable
set search_path = ''
as $$ select 165 $$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270108000103'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
