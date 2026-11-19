-- Hiring is compulsory. A company that has not hired by its sub-round's HIRE_k deadline is matched to a firm by the
-- exchange at a base fee, so no company goes through a crisis without advice and no firm is left idle while a company
-- sits out. The match happens in the same step that closes hiring, before the open offers lapse.
--
-- The match is deterministic, so it can be explained and replayed: companies in ticker order take firms in order of
-- how few clients they already have this sub-round, then by team code. A firm still takes at most two clients.
--
-- The fee is cash only, at app.default_hire_fee(), and never more cash than the company has (a company that has spent
-- everything is matched for what is left, including nothing). It goes into escrow exactly as a negotiated fee does,
-- so the firm is paid at the due time if its memo is in, and refunded otherwise.

alter table public.engagements add column if not exists assigned boolean not null default false;

create or replace function app.default_hire_fee() returns bigint language sql immutable as $$ select 2250000::bigint $$;
revoke all on function app.default_hire_fee() from public, anon, authenticated;

create or replace function app.assign_default_firms(p_event uuid, p_k int)
returns int
language plpgsql
as $$
declare
  v_company record;
  v_firm uuid;
  v_fee bigint;
  v_cash bigint;
  v_eng public.engagements;
  v_txn uuid;
  v_done int := 0;
begin
  for v_company in
    select c.id, c.ticker, c.product_team_id from public.companies c
     where c.event_id = p_event
       and not exists (select 1 from public.engagements e where e.company_id = c.id and e.k = p_k)
     order by c.ticker nulls last, c.id
  loop
    -- The least busy firm this sub-round, then the lowest code: recomputed each time, so clients spread evenly.
    select t.id into v_firm from public.teams t
     where t.event_id = p_event and t.track = 'CONSULTING'
       and (select count(*) from public.engagements e where e.firm_team_id = t.id and e.k = p_k) < 2
     order by (select count(*) from public.engagements e where e.firm_team_id = t.id and e.k = p_k), t.code collate "C"
     limit 1;
    exit when v_firm is null; -- every firm is full: the rest keep going without one.

    select cash_cents into v_cash from public.teams where id = v_company.product_team_id;
    v_fee := least(app.default_hire_fee(), greatest(coalesce(v_cash, 0), 0));
    v_txn := gen_random_uuid();
    insert into public.engagements (event_id, k, company_id, firm_team_id, cash_cents, shares, assigned)
    values (p_event, p_k, v_company.id, v_firm, v_fee, 0, true)
    returning * into v_eng;
    if v_fee > 0 then
      update public.teams set cash_cents = cash_cents - v_fee where id = v_company.product_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents + v_fee where id = p_event;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo) values
        (p_event, v_txn, 'ESCROW_HOLD', v_company.product_team_id, v_company.id, -v_fee, 'engagements', v_eng.id, 'Assigned firm: fee into escrow'),
        (p_event, v_txn, 'ESCROW_HOLD', null, v_company.id, v_fee, 'engagements', v_eng.id, 'Held by the exchange');
    end if;
    insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, cash_cents, shares, details)
    values (p_event, v_txn, 'HIRE', format('%s was assigned a firm (%s)', coalesce(v_company.ticker, 'A company'),
              case when p_k = 5 then 'Round 3' else 'crisis ' || p_k end),
            v_company.id, v_company.ticker, v_fee, 0, jsonb_build_object('k', p_k, 'firm', v_firm, 'assigned', true));
    perform app.broadcast_offer(p_event, jsonb_build_object('assigned', true), v_firm, v_company.product_team_id);
    v_done := v_done + 1;
  end loop;
  return v_done;
end
$$;
revoke all on function app.assign_default_firms(uuid, int) from public, anon, authenticated;

-- Hook it into the step that closes hiring, before the open offers lapse.
select app.patch_functions(
$old$    if v_sub.hiring_closed_at is null and app.deadline_passed(p_event, ('HIRE_' || v_k)::public.deadline_code) then
      update public.offers set status = 'LAPSED', decided_at = now(), updated_at = now()
       where event_id = p_event and offers.k = v_k and status = 'OPEN';$old$,
$new$    if v_sub.hiring_closed_at is null and app.deadline_passed(p_event, ('HIRE_' || v_k)::public.deadline_code) then
      n := app.assign_default_firms(p_event, v_k);
      if n > 0 then v_actions := v_actions || ('firms assigned ' || v_k || ': ' || n); end if;
      update public.offers set status = 'LAPSED', decided_at = now(), updated_at = now()
       where event_id = p_event and offers.k = v_k and status = 'OPEN';$new$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261127000061'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
