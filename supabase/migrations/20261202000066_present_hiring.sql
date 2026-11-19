-- Compulsory hiring counts only teams that are at the event.
--
-- When a sub-round's hiring closes, app.assign_default_firms matches every company that has not hired to a firm at the
-- base fee. On a live night the registration desk is on (events.desk_check_in), and a team that never checked in at
-- the desk cannot sign in at all. The match ignored that, so:
--   - a no-show firm could be handed a client it would never write for (the client then goes through the crisis with
--     no advice, and the escrow is only refunded at the due time), and
--   - a no-show company was charged the base fee and took one of a firm's two places.
-- Now, while the desk is on, only checked-in companies are matched and only checked-in firms are used. With the desk
-- off (a rehearsal) every team counts as present, exactly as before.
--
-- The company's cash is also read with its row locked, so a trade committing at the same moment cannot make the fee
-- larger than the cash that is left.

select app.patch_functions(
$o$     where c.event_id = p_event
       and not exists (select 1 from public.engagements e where e.company_id = c.id and e.k = p_k)
     order by c.ticker nulls last, c.id$o$,
$n$     where c.event_id = p_event
       and not exists (select 1 from public.engagements e where e.company_id = c.id and e.k = p_k)
       and (not (select ev.desk_check_in from public.events ev where ev.id = p_event)
            or exists (select 1 from public.teams pt where pt.id = c.product_team_id and pt.checked_in_at is not null))
     order by c.ticker nulls last, c.id$n$);

select app.patch_functions(
$o$     where t.event_id = p_event and t.track = 'CONSULTING'
       and (select count(*) from public.engagements e where e.firm_team_id = t.id and e.k = p_k) < 2$o$,
$n$     where t.event_id = p_event and t.track = 'CONSULTING'
       and (t.checked_in_at is not null or not (select ev.desk_check_in from public.events ev where ev.id = p_event))
       and (select count(*) from public.engagements e where e.firm_team_id = t.id and e.k = p_k) < 2$n$);

select app.patch_functions(
$o$    select cash_cents into v_cash from public.teams where id = v_company.product_team_id;
    v_fee := case when p_k = 5$o$,
$n$    select cash_cents into v_cash from public.teams where id = v_company.product_team_id for update;
    v_fee := case when p_k = 5$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261202000066'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
