-- The hiring marketplace opens up. Two changes, both small, both in the database so no screen can go round them.
--
-- 1. Any Consulting firm and any Product company can talk before there is a deal. Until now the thread opened only
--    once an engagement existed, so teams had to agree terms across the hall and then chat. Now the thread is the
--    place they negotiate. Who may read a thread is unchanged: the two teams and the staff, nobody else.
--
-- 2. A firm can make the first offer. Until now only a company could open, and a firm could only counter, which made
--    the market one-sided: a firm with time on its hands had no way to pitch. make_offer_to is the mirror image of
--    make_offer, with the same checks, and the turn starts with the company.
--
-- Accepting stays the moment a deal closes: one side proposes terms, the other accepts, and the accept is binding.
--
-- The cap on a company's open offers goes from 3 to 5, and now counts only the offers the company itself opened.
-- Without that, a popular company could be locked out of offering by the pitches it had received.

alter table public.offers add column if not exists opened_by text not null default 'COMPANY' check (opened_by in ('COMPANY', 'FIRM'));

select app.patch_functions(
  '  if (select count(*) from public.offers where company_id = v_company.id and k = v_k and status = ''OPEN'') >= 3 then
    return app.fail(''TOO_MANY_OFFERS'', ''You can have at most 3 open offers at once. Withdraw one or wait for an answer.'');
  end if;',
  '  if (select count(*) from public.offers where company_id = v_company.id and k = v_k and status = ''OPEN''
         and opened_by = ''COMPANY'') >= 5 then
    return app.fail(''TOO_MANY_OFFERS'', ''You can have at most 5 open offers at once. Withdraw one or wait for an answer.'');
  end if;');

-- The pair may talk: the caller is one of the two sides and both are in the same event. No engagement needed.
create or replace function app.in_hire_pair(p_company uuid, p_firm uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.companies c join public.teams f on f.id = p_firm
     where c.id = p_company and f.event_id = c.event_id and f.track = 'CONSULTING'
       and (p_firm = app.my_team_id() or c.product_team_id = app.my_team_id()))
$$;

create or replace function public.post_hire_message(p_company uuid, p_firm uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_phase public.phase_code;
  v_m public.hire_messages;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can post in a hire chat' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if not app.in_hire_pair(p_company, p_firm) then
    return app.reject(v_team.event_id, 'post_hire_message', 'NOT_YOUR_THREAD', 'This thread is not yours.');
  end if;
  select current_phase into v_phase from public.events where id = v_team.event_id;
  if v_phase >= 'AWARDS' then
    return app.reject(v_team.event_id, 'post_hire_message', 'CHAT_CLOSED', 'The chat has closed.');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 or length(btrim(p_body)) > 500 then
    return app.reject(v_team.event_id, 'post_hire_message', 'BAD_LENGTH', 'Messages are 1 to 500 characters.');
  end if;
  if not app.rate_limit(v_team.id, 'chat', 20, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many messages in a minute.');
  end if;
  insert into public.hire_messages (event_id, company_id, firm_team_id, team_id, body)
  values (v_team.event_id, p_company, p_firm, v_team.id, btrim(p_body))
  returning * into v_m;
  return app.ok(jsonb_build_object('message_id', v_m.id));
end
$$;

-- A firm pitches a company: the same rules as a company's own offer, but the company answers first.
create or replace function public.make_offer_to(p_company uuid, p_cash bigint, p_shares integer, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams;
  v_company public.companies;
  v_k smallint;
  v_problem text;
  v_offer public.offers;
begin
  if app.my_team_id() is null then
    raise exception 'only a team can make an offer' using errcode = '42501';
  end if;
  if app.too_fast(app.my_team_id()) then
    return app.fail('RATE_LIMITED', app.too_fast_message());
  end if;
  v_team := app.lock_caller_team();
  if v_team.track <> 'CONSULTING' then
    return app.fail('NOT_ALLOWED', 'Only a Consulting firm pitches a company.');
  end if;
  select * into v_company from public.companies where id = p_company and event_id = v_team.event_id for no key update;
  if v_company.id is null then
    return app.fail('NO_SUCH_COMPANY', 'No such company.');
  end if;
  v_k := app.hiring_subround(v_team.event_id);
  if v_k is null then
    return app.fail('HIRING_CLOSED', 'Hiring is not open now.');
  end if;
  if exists (select 1 from public.engagements where company_id = v_company.id and k = v_k) then
    return app.fail('ALREADY_HIRED', 'That company has already hired a firm this sub-round.');
  end if;
  if (select count(*) from public.engagements where firm_team_id = v_team.id and k = v_k) >= 2 then
    return app.fail('FIRM_FULL', 'You already have two clients this sub-round.');
  end if;
  if exists (select 1 from public.offers where company_id = v_company.id and firm_team_id = v_team.id and k = v_k and status = 'OPEN') then
    return app.fail('OFFER_OPEN', 'You already have an open offer with that company.');
  end if;
  v_problem := app.offer_problem(v_company, v_k, coalesce(p_cash, 0), coalesce(p_shares, 0));
  if v_problem is not null then
    return app.fail('BAD_TERMS', v_problem);
  end if;
  insert into public.offers (event_id, k, company_id, firm_team_id, cash_cents, shares, note, turn, opened_by)
  values (v_team.event_id, v_k, v_company.id, v_team.id, coalesce(p_cash, 0), coalesce(p_shares, 0),
          left(btrim(coalesce(p_note, '')), 300), 'COMPANY', 'FIRM')
  returning * into v_offer;
  perform app.broadcast_offer(v_team.event_id, '{}'::jsonb, v_team.id, v_company.product_team_id);
  return app.ok(jsonb_build_object('offer', to_jsonb(v_offer)));
end
$$;

revoke all on function public.make_offer_to(uuid, bigint, integer, text) from public, anon;
grant execute on function public.make_offer_to(uuid, bigint, integer, text) to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261128000062'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
