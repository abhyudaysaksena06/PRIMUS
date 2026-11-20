-- One device per team (organisers, 21 Nov): a team login works on one device at a time. Signing in revokes the
-- team's other sessions (the app calls signOut scope "others"); this migration makes a revoked session useless at
-- once instead of when its access token expires: every team action refuses it, and the team pages sign it out.

-- True when the caller's session still exists (or the token carries no session id, e.g. service calls).
create or replace function app.session_alive()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'session_id', '') = ''
      or exists (select 1 from auth.sessions s where s.id = (auth.jwt() ->> 'session_id')::uuid)
$$;
revoke all on function app.session_alive() from public, anon;
grant execute on function app.session_alive() to authenticated, service_role;

create or replace function public.my_session_alive()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.session_alive() $$;
revoke all on function public.my_session_alive() from public, anon;
grant execute on function public.my_session_alive() to authenticated;

-- Every team action locks the caller's team row through this: a signed-out device is refused here.
create or replace function app.lock_caller_team()
returns public.teams
language plpgsql
set search_path = ''
as $$
declare
  v public.teams;
begin
  if not app.session_alive() then
    raise exception 'This team is signed in on another device. Sign in again to continue here.' using errcode = '42501';
  end if;
  select t.* into v from public.accounts a join public.teams t on t.id = a.team_id
   where a.user_id = auth.uid() and app.team_admitted(t.id)
   for no key update of t;
  return v;
end
$$;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270109000104'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
