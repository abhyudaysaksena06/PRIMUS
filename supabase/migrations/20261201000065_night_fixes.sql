-- Fixes found in the backend review before the night. Each is a patch of a function that is already live, through
-- app.patch_functions (which refuses to run if the text it replaces is not there), so nothing else in those
-- functions changes.

-- 1 ─────────────────────── The hire chat: 30 messages a minute, in its own allowance ───────────────────────
-- Migration 062 rewrote post_hire_message from an older copy and put the limit back to 20, undoing migration 057
-- (Kartik's fix: 30). The hire chat also shared the 'chat' allowance with the squad chat, so a busy squad chat could
-- stop a team from answering an offer during hiring. It now has its own allowance of 30 a minute.
select app.patch_functions(
$o$  if not app.rate_limit(v_team.id, 'chat', 20, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many messages in a minute.');
  end if;
  insert into public.hire_messages$o$,
$n$  if not app.rate_limit(v_team.id, 'hire_chat', 30, interval '1 minute') then
    return app.fail('RATE_LIMITED', 'Too many messages in a minute (the limit is 30).');
  end if;
  insert into public.hire_messages$n$);

-- 2 ─────────────────────── An advice memo is at least 150 words ───────────────────────
-- With hiring compulsory, every firm has clients, and the fee in escrow was paid for any memo at all, even one word.
-- A firm's advice memo (ADVICE_1 … ADVICE_5) must now be at least 150 words (RULES.ADVICE_MIN_WORDS in the engine):
-- submit_for refuses a shorter one with the reason, and the escrow is paid only for a memo that long (an auto-submitted
-- draft that is shorter is refunded to the client, like a missing memo).
select app.patch_functions(
$o$  if v_words > app.word_limit(p_type) then
    return app.reject(v_team.event_id, 'submit', 'TOO_LONG', format('At most %s words (you have %s).', app.word_limit(p_type), v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
  update public.submissions set superseded_at = now() where company_id = p_company and type = p_type and superseded_at is null;
  insert into public.submissions (event_id, squad_id, company_id, type, content, body_text, word_count, submitted_by_team)$o$,
$n$  if v_words > app.word_limit(p_type) then
    return app.reject(v_team.event_id, 'submit', 'TOO_LONG', format('At most %s words (you have %s).', app.word_limit(p_type), v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
  if p_type::text like 'ADVICE_%' and v_words < 150 then
    return app.reject(v_team.event_id, 'submit', 'TOO_SHORT', format('An advice memo is at least 150 words (you have %s).', v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
  update public.submissions set superseded_at = now() where company_id = p_company and type = p_type and superseded_at is null;
  insert into public.submissions (event_id, squad_id, company_id, type, content, body_text, word_count, submitted_by_team)$n$);

select app.patch_functions(
$o$    v_paid := (app.current_submission(e.company_id, app.advice_type(p_k))).id is not null;$o$,
$n$    v_paid := coalesce((app.current_submission(e.company_id, app.advice_type(p_k))).word_count, 0) >= 150;$n$);

-- 3 ─────────────────────── The Round 3 assigned fee stays inside the Round 3 band ───────────────────────
-- A Round 3 fee must be worth 5% to 20% of the company's cash, but a company assigned a firm when Round 3 hiring
-- closed was charged the flat $22,500. In Round 3 the assigned fee is now 10% of the company's cash, the middle
-- of the band. Round 2's crises keep the flat $22,500.
select app.patch_functions(
$o$    v_fee := least(app.default_hire_fee(), greatest(coalesce(v_cash, 0), 0));$o$,
$n$    v_fee := case when p_k = 5 then greatest(coalesce(v_cash, 0), 0) / 10
                  else least(app.default_hire_fee(), greatest(coalesce(v_cash, 0), 0)) end;$n$);

-- 4 ─────────────────────── The equity floor's message ───────────────────────
-- The floor is 40,000 of 100,000 shares: a company keeps at least 40% of itself. The message said 60%.
select app.patch_functions(
$o$'A company keeps at least %s shares (60%% of itself). You have %s left to offer.'$o$,
$n$'A company keeps at least %s shares (40%% of itself). You have %s left to offer.'$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261201000065'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
