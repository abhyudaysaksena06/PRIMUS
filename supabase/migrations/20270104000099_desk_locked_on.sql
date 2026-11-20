-- Desk check-in stays on for a live event (organisers, 20 Nov): only teams the registration desk admitted can sign in,
-- are listed anywhere, and are entered in the squad draw. Someone switched it off on the live night by mistake, which
-- opened every printed card and put all 600 cards back into the draw. set_desk_check_in now refuses to switch it off
-- for a live (non-rehearsal) event; a rehearsal can still switch it either way.

select app.patch_one_function('public.set_desk_check_in(uuid, boolean)'::regprocedure,
$o$  perform app.require_desk();
  if exists$o$,
$n$  perform app.require_desk();
  if not coalesce(p_on, false) and exists (select 1 from public.events e where e.id = p_event and not e.is_rehearsal) then
    return app.fail('DESK_LOCKED', 'Desk check-in stays on for the live event: only admitted teams sign in and are drawn.');
  end if;
  if exists$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270104000099'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
