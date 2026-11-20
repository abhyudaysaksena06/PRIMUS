-- Migration 091: from the 80-fund trading stress test (supabase/tests/trading-stress.test.ts). Trading functions
-- only; applies on top of 089 or 090.
--
-- A resent order is recognised before the throttle. The order ticket sends a client_ref so that a double click or
-- a retry after a lost answer returns the order already placed ("Already placed", duplicate: true) instead of a
-- second one. place_order checked the throttle (20 order actions per team per 10 s, every laptop of the fund
-- together) first, so a busy fund whose answer was lost got RATE_LIMITED ("Too many order actions") for an order
-- that was in fact placed, and could press Place again later and place it twice. The lookup of the reference is
-- now made first (read-only, the caller's own team); it is repeated under the team lock as before, for a first
-- attempt still in flight. A resent reference no longer counts against the throttle; anything new still does.

select app.patch_functions(
$o$  if not app.rate_limit(app.my_team_id(), 'orders', 20, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many order actions. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  if p_client_ref is not null then
    select * into v_order from public.orders where team_id = v_team.id and client_ref = p_client_ref;$o$,
$n$  if p_client_ref is not null then
    select * into v_order from public.orders where team_id = app.my_team_id() and client_ref = p_client_ref;
    if v_order.id is not null then
      return app.ok(jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true));
    end if;
  end if;
  if not app.rate_limit(app.my_team_id(), 'orders', 20, interval '10 seconds') then
    return app.fail('RATE_LIMITED', 'Too many order actions. Wait a few seconds.');
  end if;
  v_team := app.lock_caller_team();
  if p_client_ref is not null then
    select * into v_order from public.orders where team_id = v_team.id and client_ref = p_client_ref;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261227000091'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
