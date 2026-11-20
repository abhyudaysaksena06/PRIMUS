-- Migration 086 (20 Nov): Reset to new (085) keeps the Round 3 statements. They are uploaded on the Content page after
-- the event is created, so rebuilding from the creation payload dropped them; the organisers reset after testing and
-- must not have to upload them again.

select app.patch_one_function('public.reset_event(uuid, text)'::regprocedure,
  $f$  v_new uuid;
begin$f$,
  $t$  v_new uuid;
  v_statements jsonb;
begin$t$);
select app.patch_one_function('public.reset_event(uuid, text)'::regprocedure,
  $f$    into v_roster from public.roster r left join public.teams t on t.id = r.team_id where r.event_id = p_event;
$f$,
  $t$    into v_roster from public.roster r left join public.teams t on t.id = r.team_id where r.event_id = p_event;
  select coalesce(jsonb_agg(to_jsonb(s)), '[]') into v_statements from public.problem_statements s where s.event_id = p_event;
$t$);
select app.patch_one_function('public.reset_event(uuid, text)'::regprocedure,
  $f$  perform app.log_event(v_new, 'CONTROL', 'Reset to new: everything played was wiped; registrations and settings kept');$f$,
  $t$  insert into public.problem_statements
  select (jsonb_populate_record(null::public.problem_statements, x || jsonb_build_object('event_id', v_new))).*
    from jsonb_array_elements(v_statements) x;
  perform app.log_event(v_new, 'CONTROL', 'Reset to new: everything played was wiped; registrations, settings and Round 3 statements kept');$t$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261222000086'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
