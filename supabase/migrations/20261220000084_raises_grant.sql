-- Migration 084 (20 Nov): teams could not read public.raises on the live project ("permission denied for table
-- raises"), so every crisis room, firm page and hire chat failed. Migration 067 made the table and its read policy
-- but no grant: the test database's Supabase stub grants every new table by default, the live project does not. The
-- grant was applied by hand on live first (20 Nov, 11:2x IST); this records it. The policy still decides the rows.
grant select on public.raises to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261220000084'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
