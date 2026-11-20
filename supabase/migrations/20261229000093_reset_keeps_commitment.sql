-- No reset removes the lottery's seed commitment (organisers, 20 Nov). reset_event rebuilds the event from its saved
-- payload and puts the switches and the desk settings back; it now puts the published seed commitment back too, for
-- the test reset and the final reset alike. The commitment can still be replaced on the Lottery page while the event
-- is in Setup (set_seed_commitment), as before.

select app.patch_one_function('public.reset_event(uuid, text, boolean)'::regprocedure,
$o$         manual_starts = v_event.manual_starts, hold_steps = v_event.hold_steps, auto_advance = v_event.auto_advance
   where id = v_new;$o$,
$n$         manual_starts = v_event.manual_starts, hold_steps = v_event.hold_steps, auto_advance = v_event.auto_advance,
         seed_commitment = coalesce(v_event.seed_commitment, seed_commitment)
   where id = v_new;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261229000093'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
