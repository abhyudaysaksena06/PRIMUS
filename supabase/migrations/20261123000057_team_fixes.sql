-- Team fixes (from Kartik's review, PRs #15, #17, #20): rebuilt as a new migration, since migrations already run in
-- production are never edited.
--   1. Hire chat: 30 messages a minute per team (was 20).
--   2. A company may have at most 3 open offers to firms at once in a sub-round.
--   3. Prompt injection: a squad's first submission with a line aimed at the judge loses 5 points (was 0); the second
--      and later still lose 10. The engine's injectionPenalty (packages/engine/src/judge.ts) matches.

-- 1 ─────────────────────────────── Hire chat rate ───────────────────────────────
select app.patch_functions(
  'if not app.rate_limit(v_team.id, ''chat'', 20, interval ''1 minute'') then
    return app.fail(''RATE_LIMITED'', ''Too many messages in a minute.'');
  end if;
  insert into public.hire_messages',
  'if not app.rate_limit(v_team.id, ''chat'', 30, interval ''1 minute'') then
    return app.fail(''RATE_LIMITED'', ''Too many messages in a minute (the limit is 30).'');
  end if;
  insert into public.hire_messages');

-- 2 ─────────────────────────────── At most 3 open offers ───────────────────────────────
select app.patch_functions(
  '    return app.fail(''OFFER_OPEN'', ''You already have an open offer with that firm.'');
  end if;',
  '    return app.fail(''OFFER_OPEN'', ''You already have an open offer with that firm.'');
  end if;
  if (select count(*) from public.offers where company_id = v_company.id and k = v_k and status = ''OPEN'') >= 3 then
    return app.fail(''TOO_MANY_OFFERS'', ''You can have at most 3 open offers at once. Withdraw one or wait for an answer.'');
  end if;');

-- 3 ─────────────────────────────── First injection costs 5 ───────────────────────────────
create or replace function app.injection_penalty(p_type public.submission_type, p_pitch boolean, p_plan boolean, p_flash boolean)
returns integer
language sql immutable parallel safe
as $$
  select case
    when p_type not in ('PITCH', 'PLAN', 'FLASH') then 0 -- PRIMUS types: app.company_injection_penalty
    when not coalesce(case p_type when 'PITCH' then p_pitch when 'PLAN' then p_plan else p_flash end, false) then 0
    when (coalesce(p_pitch, false)::int
          + (p_type in ('PLAN', 'FLASH') and coalesce(p_plan, false))::int
          + (p_type = 'FLASH' and coalesce(p_flash, false))::int) >= 2 then 10
    else 5
  end
$$;

select app.patch_functions(
  '  return case when v_count >= 2 then 10 else 0 end;',
  '  return case when v_count >= 2 then 10 when v_count = 1 then 5 else 0 end;');

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261123000057'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
