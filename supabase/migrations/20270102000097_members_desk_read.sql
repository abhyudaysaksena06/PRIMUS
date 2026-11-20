-- The registration desk reads members (organisers, 20 Nov): its page shows the participants against the 675 cap
-- (096), so the desk role may read public.members like it already reads teams (teams_desk_read) and the team list
-- (roster_desk_read). Read only; the desk still writes members only through desk_check_in.

drop policy if exists members_desk_read on public.members;
create policy members_desk_read on public.members for select to authenticated
  using ((select app.has_role(variadic array['REGISTRATION'])));

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270102000097'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
