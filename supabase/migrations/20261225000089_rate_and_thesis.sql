-- Two rules the organisers decided for 20 Nov: the consulting base rate follows every released memo score, and each
-- Finance team writes a Round 3 investment thesis.
--
-- 1. Base rate (app.firm_base_rate, migration 071). The score in
--        basis points = clamp(200 + 4 × (score − 50), 100, 400)       (rounded to the nearest basis point)
--    is now the AVERAGE of the firm's released Round 1 memo (MEMO) score and every released advice memo score so far
--    (ADVICE_1 … ADVICE_5 of the firm's engagements: a firm with 2 clients in a crisis has 2 advice scores, each
--    counted once). Only RELEASED scores with a final score count; none at all → 200 (2%). So the rate is recalculated
--    after each crisis's advice scores are released. Every consumer calls the one function: the minimum bid
--    (app.min_bid_problem), the hiring draw's fee (app.assign_firms_by_draw) and firm_values (base_rate_bp,
--    min_bid_cents). A fee already agreed or drawn keeps its terms.
--
-- 2. The Round 3 investment thesis (submission type THESIS, switch finance_thesis, a RULE switch, on by default).
--    - Written by the squad's Finance team (one per fund), kept with its squad's company like the firm's memo (MEMO):
--      save_draft / submit_submission, the four sections of app.template_fields('THESIS'), 150 to 500 words.
--    - Open with the Round 3 work (app.subround_open(5): from the end of the draft to DUE_5, 06:00), due with the
--      solution (DUE_5); Submit opens in the last 5 minutes under submit_last_5; a saved draft is submitted at the
--      deadline (app.auto_submit_due_drafts, unchanged: it follows app.submission_deadline); paste flags as every
--      editor (app.flag_fast_draft in save_draft).
--    - Judged like the others: 3 runs (5 when they spread), prompts/THESIS.md, the context lists the Round 3
--      companies (ticker, sector, statement) so the judge can check the thesis names real ones. judge_auto queues it
--      after the solutions and advice memos, and seals a 0 for a fund that sent nothing.
--    - Released by an organiser on the Judge page (one click, release_scores), from Round 3 until the appeals. It pays
--      each fund $500 × (score − 50) in cash (−$25,000 to +$25,000), ledger kind BONUS_THESIS, balanced by the
--      exchange ('Paid by the exchange') exactly as the advice bonus. A missing thesis is sealed at 0, as every missing
--      piece is, and so costs the fund $25,000. It moves no price. Cash counts in the fund's final value; after
--      settlement the results are computed again.
--    - An appeal after release pays or takes back the change in the bonus (apply_appeal → app.apply_primus_appeal).
--    - Switch off: no Finance team may write it, judge_auto skips it and release_scores refuses it.
--
-- New enum values cannot be USED in the transaction that adds them, and the catch-up file runs every migration in one
-- transaction. So nothing below casts 'THESIS' or 'BONUS_THESIS' while this migration runs: SQL functions compare the
-- type as text (p_type::text = 'THESIS'), and the new values appear only in PL/pgSQL bodies, which are planned when
-- they first run (in a later transaction). The THESIS draft row of a squad drawn before this migration is created on
-- its first save (save_draft), since this migration cannot insert one.

alter type public.submission_type add value if not exists 'THESIS';
alter type public.ledger_kind add value if not exists 'BONUS_THESIS';

-- ─────────────── 1. Base rate ───────────────

create or replace function app.firm_base_rate(p_firm uuid)
returns integer
language sql stable
as $$
  select coalesce(
    (select greatest(100, least(400, round(200 + 4 * (avg(x.score) - 50))))::int
       from (
         -- The Round 1 memo: the firm's own squad company (scores are kept per company).
         select sc.final_score as score
           from public.squads s
           join public.companies c on c.squad_id = s.id
           join public.scores sc on sc.company_id = c.id and sc.type = 'MEMO' and sc.status = 'RELEASED'
          where s.consulting_team_id = p_firm and sc.final_score is not null
         union all
         -- Every advice memo: each engagement's client company, the type of its sub-round.
         select sc.final_score
           from public.engagements e
           join public.scores sc on sc.company_id = e.company_id and sc.type = app.advice_type(e.k) and sc.status = 'RELEASED'
          where e.firm_team_id = p_firm and sc.final_score is not null) x
     -- No released score at all: no row (greatest/least would skip the null average), so 2%.
     having count(*) > 0),
    200)
$$;
revoke all on function app.firm_base_rate(uuid) from public, anon, authenticated;

select app.patch_one_function('app.feature_catalog()'::regprocedure,
$o$'Offers worth less than a firm''s base rate (its minimum bid) are refused'$o$,
$n$'Offers worth less than a firm''s base rate (its minimum bid) are refused; the base rate follows the average of the firm''s Round 1 memo and every advice memo score released so far'$n$);

-- ─────────────── 2. The investment thesis ───────────────

-- The switch (the Run page lists every line of the catalog). The same patch renames paste_block's label: the team
-- pages also block copying, cutting and right-click under that switch.
select app.patch_one_function('app.feature_catalog()'::regprocedure,
$o$    ('paste_block', 'Editors block paste and drop', true, 'DISPLAY', 110),$o$,
$n$    ('finance_thesis', 'Round 3: each Finance team writes an investment thesis (150–500 words, judged); its bonus is $500 × (score − 50)', true, 'RULE', 105),
    ('paste_block', 'Editors block paste and drop; team pages block copying, cutting and right-click', true, 'DISPLAY', 110),$n$);

-- On for every PRIMUS event already seeded (new events get the default, on).
update public.events set features = features || '{"finance_thesis": true}'::jsonb
 where format = 'PRIMUS' and not (features ? 'finance_thesis');

-- Its rules: due with the solution, at most 500 words, four sections, its rubric, no price move.
select app.patch_one_function('app.submission_deadline(public.submission_type)'::regprocedure,
$o$  select case when p_type in ('PITCH', 'MEMO') then 'PITCH'$o$,
$n$  select case when p_type in ('PITCH', 'MEMO') then 'PITCH'
              when p_type::text = 'THESIS' then 'DUE_5'$n$);

select app.patch_one_function('app.word_limit(public.submission_type)'::regprocedure,
$o$when 'ADVICE' then 500 else 100 end$o$,
$n$when 'ADVICE' then 500 when 'THESIS' then 500 else 100 end$n$);

select app.patch_one_function('app.template_fields(public.submission_type)'::regprocedure,
$o$    ('ADVICE', 4, 'fit', 'Why it fits your company')$o$,
$n$    ('ADVICE', 4, 'fit', 'Why it fits your company'),
    ('THESIS', 1, 'backing', 'What we back for the close'),
    ('THESIS', 2, 'evidence', 'The evidence'),
    ('THESIS', 3, 'positioning', 'How the fund is positioned'),
    ('THESIS', 4, 'risks', 'Risks and what would change our view')$n$);

select app.patch_one_function('app.rubric(public.submission_type)'::regprocedure,
$o$    when 'ADVICE' then '{"diagnosis": 25, "actionable_advice": 30, "evidence": 20, "fit": 15, "clarity": 10}'::jsonb$o$,
$n$    when 'ADVICE' then '{"diagnosis": 25, "actionable_advice": 30, "evidence": 20, "fit": 15, "clarity": 10}'::jsonb
    when 'THESIS' then '{"thesis": 25, "evidence": 30, "portfolio_logic": 20, "risks": 15, "clarity": 10}'::jsonb$n$);

select app.patch_one_function('app.tier_bp(public.submission_type, integer)'::regprocedure,
$o$    when 'ADVICE' then 0$o$,
$n$    when 'ADVICE' then 0
    when 'THESIS' then 0$n$);

-- The fund's own work: never an injection offence of the company (its lines are still removed).
select app.patch_one_function('app.company_injection_penalty(uuid, public.submission_type)'::regprocedure,
$o$  if app.submission_kind(p_type) in ('MEMO', 'ADVICE') or$o$,
$n$  if app.submission_kind(p_type) in ('MEMO', 'ADVICE', 'THESIS') or$n$);

select app.patch_one_function('app.judge_type_title(public.submission_type)'::regprocedure,
$o$    when p_type = 'ADVICE_5' then 'Advice memo (Round 3)'$o$,
$n$    when p_type = 'ADVICE_5' then 'Advice memo (Round 3)'
    when p_type::text = 'THESIS' then 'Investment thesis (Round 3)'$n$);

-- The fund's bonus for a thesis score, in cents: $500 × (score − 50), −$25,000 to +$25,000.
create or replace function app.thesis_bonus(p_score integer)
returns bigint
language sql immutable parallel safe strict
as $$
  select 50000::bigint * (greatest(0, least(100, p_score)) - 50)
$$;
revoke all on function app.thesis_bonus(integer) from public, anon, authenticated;

-- Who writes it, and when: the squad's Finance team, while the Round 3 work is open, with the switch on.
select app.patch_one_function('app.submission_window(public.teams, public.submission_type)'::regprocedure,
$o$  deadline_code := app.submission_deadline(p_type);
$o$,
$n$  deadline_code := app.submission_deadline(p_type);
  if p_type::text = 'THESIS' then
    allowed := p_team.track = 'FINANCE' and app.feature_on(p_team.event_id, 'finance_thesis');
    open := v_event.drawn_at is not null and coalesce(app.subround_open(v_event.id, 5), false);
    return;
  end if;
$n$);

-- A squad drawn before a type existed has no draft row for it: the first save creates it (the squad draw creates
-- one per type, so for every other type nothing changes).
select app.patch_one_function('public.save_draft(public.submission_type, jsonb, integer)'::regprocedure,
$o$  select * into v_draft from public.submission_drafts where squad_id = v_squad.id and type = p_type for no key update;
$o$,
$n$  select * into v_draft from public.submission_drafts where squad_id = v_squad.id and type = p_type for no key update;
  if v_draft.id is null then
    insert into public.submission_drafts (event_id, squad_id, company_id, type)
    select v_squad.event_id, v_squad.id, c.id, p_type from public.companies c where c.squad_id = v_squad.id
    on conflict (squad_id, type) do nothing;
    select * into v_draft from public.submission_drafts where squad_id = v_squad.id and type = p_type for no key update;
  end if;
$n$);

-- At least 150 words, like an advice memo (065).
select app.patch_one_function('public.submit_submission(public.submission_type)'::regprocedure,
$o$  if v_words > v_limit then
    return app.reject(v_team.event_id, 'submit', 'TOO_LONG', format('At most %s words (you have %s).', v_limit, v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
$o$,
$n$  if v_words > v_limit then
    return app.reject(v_team.event_id, 'submit', 'TOO_LONG', format('At most %s words (you have %s).', v_limit, v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
  if p_type::text = 'THESIS' and v_words < 150 then
    return app.reject(v_team.event_id, 'submit', 'TOO_SHORT', format('An investment thesis is at least 150 words (you have %s).', v_words),
                      jsonb_build_object('type', p_type, 'words', v_words));
  end if;
$n$);

-- judge_auto: after the solutions and the advice memos, while the switch is on.
select app.patch_one_function('app.auto_judge_tick(uuid)'::regprocedure,
$o$                        'CRISIS_4', 'ADVICE_4', 'SOLUTION', 'ADVICE_5']::public.submission_type[]) with ordinality t(type, ord)
     where not exists$o$,
$n$                        'CRISIS_4', 'ADVICE_4', 'SOLUTION', 'ADVICE_5', 'THESIS']::public.submission_type[]) with ordinality t(type, ord)
     where (t.type::text <> 'THESIS' or app.feature_on(p_event, 'finance_thesis'))
       and not exists$n$);

-- What the judge reads with a thesis: every Round 3 company (ticker, sector, statement), the same for every fund.
create or replace function app.thesis_judge_context(p_event uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object('market', coalesce((
    select jsonb_agg(jsonb_build_object('ticker', c.ticker, 'sector', coalesce(nullif(btrim(ps.sector), ''), nullif(btrim(pc.sector), '')),
                                        'statement', ps.title)
                     order by coalesce(nullif(btrim(ps.sector), ''), nullif(btrim(pc.sector), '')) collate "C" nulls last,
                              c.ticker collate "C" nulls last, c.id)
      from public.companies c
      join public.squads s on s.id = c.squad_id
      left join public.problem_cards pc on pc.id = s.chosen_card_id
      left join public.draft_picks d on d.company_id = c.id
      left join public.problem_statements ps on ps.id = d.statement_id
     where c.event_id = p_event and c.ticker is not null), '[]'::jsonb))
$$;
revoke all on function app.thesis_judge_context(uuid) from public, anon, authenticated;

select app.patch_one_function('public.judge_input(uuid)'::regprocedure,
$o$  elsif app.subround_of(v_run.type) is not null then
    v_out := v_out || app.primus_judge_context(v_company.id, v_run.type);$o$,
$n$  elsif v_run.type::text = 'THESIS' then
    v_out := v_out || app.thesis_judge_context(v_company.event_id);
  elsif app.subround_of(v_run.type) is not null then
    v_out := v_out || app.primus_judge_context(v_company.id, v_run.type);$n$);

-- Release: the scores become visible and each fund is paid its bonus. No price moves.
create or replace function app.release_thesis(p_event uuid)
returns jsonb
language plpgsql
as $$
declare
  v_event public.events;
  v_txn uuid := gen_random_uuid();
  v_total bigint;
  v_n int;
begin
  select * into v_event from public.events where id = p_event;
  if not app.feature_on(p_event, 'finance_thesis') then
    return app.fail('SWITCH_OFF', 'The investment thesis is switched off on the Run page.');
  end if;
  if v_event.current_phase::text not in ('SATURATION', 'CLOSE', 'SETTLEMENT', 'APPEALS') then
    return app.fail('WRONG_PHASE', 'Investment thesis scores are released from Round 3 until the appeals.');
  end if;
  update public.scores set status = 'RELEASED', released_at = now(), released_by = auth.uid()
   where event_id = p_event and type::text = 'THESIS';
  get diagnostics v_n = row_count;

  create temporary table if not exists _tbonus (score_id uuid, team_id uuid, company_id uuid, amount bigint, memo text) on commit drop;
  truncate _tbonus;
  insert into _tbonus
  select sc.id, s.finance_team_id, c.id, app.thesis_bonus(coalesce(sc.final_score, 0)),
         format('Investment thesis bonus: $500 × (%s − 50)', coalesce(sc.final_score, 0))
    from public.scores sc
    join public.companies c on c.id = sc.company_id
    join public.squads s on s.id = c.squad_id
   where sc.event_id = p_event and sc.type::text = 'THESIS';
  insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo)
  select p_event, v_txn, 'BONUS_THESIS', team_id, company_id, amount, 'scores', score_id, memo from _tbonus where amount <> 0;
  select coalesce(sum(amount), 0) into v_total from _tbonus;
  if v_total <> 0 then
    insert into public.ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
    values (p_event, v_txn, 'BONUS_THESIS', null, -v_total, 'Paid by the exchange');
  end if;
  update public.teams t set cash_cents = t.cash_cents + x.amount
    from (select team_id, sum(amount) as amount from _tbonus group by team_id) x where t.id = x.team_id;
  update public.events set exchange_cash_cents = exchange_cash_cents - v_total where id = p_event;

  if v_event.settled_at is not null then
    perform app.compute_results(p_event);
    perform app.compute_rankings(p_event);
  end if;
  perform app.broadcast(p_event, 'verdicts', jsonb_build_object('type', 'THESIS', 'movers', '[]'::jsonb));
  return app.ok(jsonb_build_object('released', v_n, 'bonus_cents', v_total));
end
$$;
revoke all on function app.release_thesis(uuid) from public, anon, authenticated;

select app.patch_one_function('public.release_scores(uuid, public.submission_type)'::regprocedure,
$o$  if app.subround_of(p_type) is not null then
    return app.release_primus(p_event, p_type);
  end if;$o$,
$n$  if p_type::text = 'THESIS' then
    return app.release_thesis(p_event);
  end if;
  if app.subround_of(p_type) is not null then
    return app.release_primus(p_event, p_type);
  end if;$n$);

-- An appeal after release: no price, the fund's bonus follows the new score.
select app.patch_one_function('public.apply_appeal(uuid)'::regprocedure,
$o$  if app.subround_of(v_a.type) is not null then
    return app.apply_primus_appeal(v_a, v_event, v_c, v_score, v_s);$o$,
$n$  if app.subround_of(v_a.type) is not null or v_a.type::text = 'THESIS' then
    return app.apply_primus_appeal(v_a, v_event, v_c, v_score, v_s);$n$);

select app.patch_one_function('app.apply_primus_appeal(public.appeals, public.events, public.companies, public.scores, jsonb)'::regprocedure,
$o$  if p_event.settled_at is not null then
    perform app.compute_results(p_c.event_id);$o$,
$n$  -- An investment thesis: the bonus paid to the fund at the release changes with the score.
  if p_a.type::text = 'THESIS' then
    v_bonus := app.thesis_bonus(v_final) - app.thesis_bonus(coalesce(p_score.final_score, 0));
    if v_bonus <> 0 then
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo)
      select p_c.event_id, v_txn, 'BONUS_THESIS', s.finance_team_id, p_c.id, v_bonus, 'scores', p_score.id,
             format('Technical appeal: investment thesis bonus for %s instead of %s', v_final, coalesce(p_score.final_score, 0))
        from public.squads s where s.id = p_c.squad_id;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo)
      values (p_c.event_id, v_txn, 'BONUS_THESIS', null, p_c.id, -v_bonus, 'Paid by the exchange');
      update public.teams t set cash_cents = t.cash_cents + v_bonus from public.squads s where s.id = p_c.squad_id and t.id = s.finance_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents - v_bonus where id = p_c.event_id;
    end if;
  end if;

  if p_event.settled_at is not null then
    perform app.compute_results(p_c.event_id);$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261225000089'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
