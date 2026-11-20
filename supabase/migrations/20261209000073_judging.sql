-- Judging runs itself; the PRIMUS leaderboard; PRIMUS appeals, awards and results (migration 073).
--
-- 1. Judge automatically (switch judge_auto, a RULE switch: off until its rehearsal check passed). On a PRIMUS night
--    the heartbeat (public.tick → app.primus_tick, which runs after the tick has auto-submitted the drafts that were
--    due) judges each written type once its deadline has passed: PITCH and MEMO (Round 1), CRISIS_k and ADVICE_k
--    (Round 2), SOLUTION and ADVICE_5 (Round 3).
--      a. Queue: runs 1–3 for every current submission of a drawn company that has no run yet (start_judging's own
--         statement), so nothing is queued twice; a draft auto-submitted a tick late is queued on that tick. The first
--         queue of a type is logged: "Judging started by itself for …".
--      b. Seal: once no run of the type is queued or running (every run DONE or FAILED), the companies with no on-time
--         submission get their 0 (seal_missing_scores' own statement), once, logged: "Missing scores sealed for …".
--    The release stays an organiser's click: it moves prices. Off: nothing happens by itself (start, seal and release
--    by hand, exactly as before). public.judge_auto keeps what was done per type (the Judge page shows it); an error
--    never stops the heartbeat (it goes to error_log, once a minute at most, and the next tick tries again).
-- 2. public.leaderboard: the PRIMUS Rating of every company (switch leaderboard for teams and the projector; staff
--    always).
-- 3. apply_appeal on PRIMUS types: a released crisis plan or solution has no classic plan tier, so applying its appeal
--    raised "no plan tier is recorded" and the only way out was to dismiss it. It now moves the price by the change in
--    the tier (the Round 3 leveller included); an advice memo's appeal pays or takes back the change in the firm's bonus.
-- 4. Awards on a PRIMUS night: "best turnaround" and "best rescue plan" read classic-only data (every company tied for
--    the turnaround). PRIMUS has its own equivalents (see app.compute_rankings).
-- 5. Results and rankings: once the squads are drawn, only teams in a squad are ranked (an absent team had no company,
--    and its empty closing price stopped the settlement).

-- ───────────────────────────── 1. Judging runs itself ─────────────────────────────

-- What the clock did per type: when it queued the judging (and how much, late arrivals included) and when it sealed
-- the missing scores. Staff read it (the Judge page).
create table public.judge_auto (
  event_id uuid not null references public.events (id) on delete cascade,
  type public.submission_type not null,
  queued_at timestamptz not null default now(),
  submissions int not null default 0,
  runs int not null default 0,
  sealed_at timestamptz,
  sealed_missing int,
  primary key (event_id, type)
);
alter table public.judge_auto enable row level security;
create policy judge_auto_read on public.judge_auto for select to authenticated using ((select app.is_staff()));
revoke all on public.judge_auto from anon, authenticated;
grant select on public.judge_auto to authenticated;

-- A judged type as the Judge page names it (for the event log).
create or replace function app.judge_type_title(p_type public.submission_type)
returns text
language sql immutable strict parallel safe
as $$
  select case
    when p_type = 'PITCH' then 'Pitch'
    when p_type = 'MEMO' then 'Crisis memo'
    when p_type = 'PLAN' then 'Plan'
    when p_type = 'FLASH' then 'Flash'
    when p_type = 'SOLUTION' then 'Round 3 solution'
    when p_type = 'ADVICE_5' then 'Advice memo (Round 3)'
    when app.submission_kind(p_type) = 'CRISIS' then format('Crisis %s response plan', app.subround_of(p_type))
    else format('Advice memo (Crisis %s)', app.subround_of(p_type))
  end
$$;
revoke all on function app.judge_type_title(public.submission_type) from public, anon, authenticated;

create or replace function app.auto_judge_tick(p_event uuid)
returns text[]
language plpgsql
as $$
declare
  v_actions text[] := '{}';
  v_type public.submission_type;
  v_state public.judge_auto;
  v_title text;
  v_runs int;
  v_subs int;
  v_sealed int;
begin
  if not app.feature_on(p_event, 'judge_auto') then
    return v_actions;
  end if;
  for v_type in
    select t.type
      from unnest(array['PITCH', 'MEMO', 'CRISIS_1', 'ADVICE_1', 'CRISIS_2', 'ADVICE_2', 'CRISIS_3', 'ADVICE_3',
                        'CRISIS_4', 'ADVICE_4', 'SOLUTION', 'ADVICE_5']::public.submission_type[]) with ordinality t(type, ord)
     where not exists (select 1 from public.judge_auto a where a.event_id = p_event and a.type = t.type and a.sealed_at is not null)
       and app.scoring_closed(p_event, t.type)
     order by t.ord
  loop
    begin
      v_title := app.judge_type_title(v_type);
      select * into v_state from public.judge_auto where event_id = p_event and type = v_type;
      if app.score_released(p_event, v_type) then
        -- Released by hand before the clock got to it: nothing is left to do for this type.
        insert into public.judge_auto (event_id, type, sealed_at, sealed_missing) values (p_event, v_type, now(), 0)
        on conflict (event_id, type) do update set sealed_at = now(), sealed_missing = coalesce(public.judge_auto.sealed_missing, 0);
        continue;
      end if;

      -- a. Queue runs 1–3 for every current submission of a drawn company with no run yet (start_judging's statement).
      with subs as (
        select s.id, s.company_id from public.submissions s join public.companies c on c.id = s.company_id
         where s.event_id = p_event and s.type = v_type and s.superseded_at is null and c.squad_id is not null
           and not exists (select 1 from public.judge_runs j where j.submission_id = s.id)
      ), ins as (
        insert into public.judge_runs (event_id, submission_id, company_id, type, generation, run_no)
        select p_event, s.id, s.company_id, v_type, 1, n from subs s cross join generate_series(1, 3) n
        returning submission_id
      )
      select count(*), count(distinct submission_id) into v_runs, v_subs from ins;
      if v_state.event_id is null then
        insert into public.judge_auto (event_id, type, submissions, runs) values (p_event, v_type, v_subs, v_runs);
        perform app.log_event(p_event, 'CONTROL', format('Judging started by itself for %s: %s.', v_title,
          case when v_subs = 0 then 'no submissions to judge'
               else format('%s submission%s, %s runs', v_subs, case when v_subs = 1 then '' else 's' end, v_runs) end));
        v_actions := v_actions || format('judging started %s: %s', v_type, v_subs);
      elsif v_subs > 0 then
        update public.judge_auto set submissions = submissions + v_subs, runs = runs + v_runs where event_id = p_event and type = v_type;
        perform app.log_event(p_event, 'CONTROL', format('Judging started by itself for %s: %s more submission%s, %s runs.', v_title,
          v_subs, case when v_subs = 1 then '' else 's' end, v_runs));
        v_actions := v_actions || format('judging started %s: %s more', v_type, v_subs);
      end if;
      if v_runs > 0 then
        perform app.broadcast_staff(p_event, 'judge');
        continue;
      end if;

      -- b. Every run of the type has finished (DONE or FAILED): the companies with no on-time submission get their 0
      --    (seal_missing_scores' statement), once.
      continue when exists (select 1 from public.judge_runs j
                             where j.event_id = p_event and j.status in ('QUEUED', 'RUNNING') and j.type = v_type);
      insert into public.scores (event_id, company_id, type, status, run_totals, median, missing, late, capped, penalty,
                                 final_score, tier_bp, rationale)
      select p_event, c.id, v_type, 'SEALED', '{}', null, true, false, false, 0, 0, app.tier_bp(v_type, 0), 'No on-time submission.'
        from public.companies c
       where c.event_id = p_event and c.squad_id is not null
         and (app.current_submission(c.id, v_type)).id is null
         and not exists (select 1 from public.scores s where s.company_id = c.id and s.type = v_type)
      on conflict (company_id, type) do nothing;
      get diagnostics v_sealed = row_count;
      update public.judge_auto set sealed_at = now(), sealed_missing = v_sealed where event_id = p_event and type = v_type;
      perform app.log_event(p_event, 'CONTROL', format('Missing scores sealed for %s: %s.', v_title,
        case when v_sealed = 0 then 'none missing'
             else format('0 for %s with no submission', case when v_sealed = 1 then '1 company' else v_sealed || ' companies' end) end));
      perform app.broadcast_staff(p_event, 'judge');
      v_actions := v_actions || format('missing sealed %s: %s', v_type, v_sealed);
    exception when others then
      -- Never stop the heartbeat: record it (once a minute at most) and try again on the next tick.
      if not exists (select 1 from public.error_log e where e.event_id = p_event and e.source = 'judge_auto'
                       and e.message = sqlerrm and e.at > now() - interval '1 minute') then
        insert into public.error_log (event_id, source, message, context)
        values (p_event, 'judge_auto', sqlerrm, jsonb_build_object('sqlstate', sqlstate, 'type', v_type));
      end if;
    end;
  end loop;
  return v_actions;
end
$$;
revoke all on function app.auto_judge_tick(uuid) from public, anon, authenticated;

-- The hook: app.primus_tick runs it first, in every phase (Round 1's deadline passes in BUILD). The tick calls
-- primus_tick after app.auto_submit_due_drafts, so what was due has been submitted.
do $$
begin
  if app.patch_functions(
$o$  if v_event.format <> 'PRIMUS' or v_event.current_phase not in ('PRESSURE', 'SATURATION') then$o$,
$n$  -- Judging runs itself (switch judge_auto, migration 073), in every phase, after the tick's auto-submit.
  if v_event.format = 'PRIMUS' then
    v_actions := v_actions || app.auto_judge_tick(p_event);
  end if;
  if v_event.format <> 'PRIMUS' or v_event.current_phase not in ('PRESSURE', 'SATURATION') then$n$) <> 1 then
    raise exception 'migration 073: app.primus_tick must be the only function patched';
  end if;
end
$$;

-- ───────────────────────────── 2. The leaderboard (PRIMUS Rating) ─────────────────────────────
-- Every company of a drawn squad starts at 1,000. Each released score of PITCH, CRISIS_1..CRISIS_4 and SOLUTION adds
-- delta = round(50 × z), clipped to ±100, where z = (the company's score − the mean) / the population standard deviation
-- among the companies of the same sector (its problem card's) with a released score of that type; a spread of 0 (a
-- sector of one, or equal scores) gives z = 0. round() takes halves away from zero. change = the delta of the company's
-- most recently released type; rounds = how many deltas it has. rank: by rating, ties share a rank, listed by ticker.
-- Staff see it always; the event's teams and the projector only while the switch leaderboard is on (otherwise no rows).
create or replace function public.leaderboard(p_event uuid)
returns table (company_id uuid, ticker text, name text, sector text, rating int, rank int, change int, rounds int)
language sql stable security definer set search_path = ''
as $$
  with seen as (
    select 1 as ok
     where app.is_staff()
        or ((app.sees_all_events() or app.my_event_id() = p_event) and app.feature_on(p_event, 'leaderboard'))
  ), co as (
    select c.id, c.ticker, c.name, nullif(btrim(pc.sector), '') as sector, coalesce(app.norm_sector(pc.sector), '') as sector_key
      from public.companies c
      join public.squads s on s.id = c.squad_id
      left join public.problem_cards pc on pc.id = s.chosen_card_id
     where c.event_id = p_event and exists (select 1 from seen)
  ), released as (
    select co.id, sc.type, sc.released_at, sc.final_score,
           avg(sc.final_score) over w as mean, stddev_pop(sc.final_score) over w as sd
      from co join public.scores sc on sc.company_id = co.id
     where sc.status = 'RELEASED' and sc.final_score is not null
       and sc.type in ('PITCH', 'CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4', 'SOLUTION')
    window w as (partition by sc.type, co.sector_key)
  ), deltas as (
    select r.id, r.type, r.released_at,
           case when coalesce(r.sd, 0) = 0 then 0
                else greatest(-100, least(100, round(50 * (r.final_score - r.mean) / r.sd)))::int end as delta
      from released r
  ), totals as (
    select d.id, sum(d.delta)::int as total, count(*)::int as n,
           (array_agg(d.delta order by d.released_at desc, d.type desc))[1] as latest
      from deltas d
     group by d.id
  )
  select co.id, co.ticker, co.name, co.sector, 1000 + coalesce(t.total, 0),
         (rank() over (order by 1000 + coalesce(t.total, 0) desc))::int,
         coalesce(t.latest, 0), coalesce(t.n, 0)
    from co left join totals t on t.id = co.id
   order by 1000 + coalesce(t.total, 0) desc, co.ticker collate "C" nulls last, co.id
$$;
revoke all on function public.leaderboard(uuid) from public, anon;
grant execute on function public.leaderboard(uuid) to authenticated;

-- ───────────────────────────── 3. Appeals of PRIMUS scores ─────────────────────────────
-- An appeal applied after the release of a PRIMUS score (apply_appeal checks the appeal, the event and the runs first):
--   · a crisis plan (CRISIS_k) or the solution: the score changes, and the price moves by the change in the tier the
--     release applied, new − old, both by app.release_tier_bp (the solution's with the Round 3 leveller at the
--     company's place). Before the close the market and AI prices move now (between rounds, like a release); after the
--     close the closing market and AI prices move, the closing price is their average again, and the shorts covered at
--     the close pay the new closing price. The move is recorded as an APPEAL price row of sub-round k.
--   · an advice memo (ADVICE_k): no price moves; the firm's bonus paid at the release (the plan-bonus rule on the
--     score) is paid or taken back by the difference.
-- After settlement, results and awards are computed again. Before the release no organiser step is needed: the new runs
-- replace the sealed score as soon as they are done (finish_judge_run).
create or replace function app.apply_primus_appeal(p_a public.appeals, p_event public.events, p_c public.companies,
                                                   p_score public.scores, p_s jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_k int := app.subround_of(p_a.type);
  v_advice boolean := app.submission_kind(p_a.type) = 'ADVICE';
  v_final int := (p_s ->> 'final')::int;
  v_moved boolean;
  v_old_bp int;
  v_new_bp int;
  v_d int := 0;
  v_ai_new int;
  v_market_new int;
  v_close_market_new int;
  v_close_new int;
  v_close_delta bigint := 0;
  v_txn uuid := gen_random_uuid();
  v_cover bigint := 0;
  v_bonus bigint := 0;
  v_eng public.engagements;
  v_effects jsonb;
begin
  -- The release moved this company's price (its SUB_TIER row of sub-round k), so the appeal moves it too.
  v_moved := not v_advice
             and exists (select 1 from public.round_prices rp where rp.company_id = p_c.id and rp.kind = 'SUB_TIER' and rp.subround = v_k);
  if v_moved and p_event.market_closed_at is null and (app.open_round(p_event.id)).id is not null then
    return app.fail('TRADING_OPEN', 'Apply this appeal between rounds, while trading is closed.');
  end if;
  if v_moved then
    v_old_bp := app.release_tier_bp(p_c.id, p_a.type);
  end if;

  -- The score (its release time stays: the verdicts were shown when they were).
  update public.scores
     set generation = p_a.generation, run_totals = array(select x::smallint from jsonb_array_elements_text(p_s -> 'run_totals') x),
         median = (p_s ->> 'median')::smallint, capped = (p_s ->> 'capped')::boolean, penalty = (p_s ->> 'penalty')::smallint,
         final_score = v_final, tier_bp = (p_s ->> 'tier_bp')::int, breakdown = p_s -> 'breakdown',
         rationale = p_s ->> 'rationale', updated_at = now()
   where id = p_score.id;

  if v_moved then
    v_new_bp := app.release_tier_bp(p_c.id, p_a.type);
    v_d := v_new_bp - v_old_bp;
  end if;
  if v_d <> 0 then
    perform set_config('app.price_writer', 'APPEAL', true);
    v_ai_new := greatest(1, app.apply_tier(p_c.ai_price, v_d));
    if p_c.closing_price is null then
      v_market_new := greatest(1, app.apply_tier(p_c.market_price, v_d));
      update public.companies set market_price = v_market_new, ai_price = v_ai_new where id = p_c.id;
      perform app.recalculate_collateral(p_c.event_id);
    else
      v_close_market_new := greatest(1, app.apply_tier(p_c.closing_market_price, v_d));
      v_close_new := app.avg_half_up(v_close_market_new, v_ai_new);
      v_close_delta := v_close_new - p_c.closing_price;
      update public.companies set closing_market_price = v_close_market_new, ai_price = v_ai_new, closing_price = v_close_new
       where id = p_c.id;
    end if;
    -- One APPEAL row per company and sub-round (round_prices_once_uq); a second appeal of the same score is in the
    -- public ledger only.
    insert into public.round_prices (event_id, company_id, kind, subround, market_before, market_after, ai_before, ai_after, tier_bp)
    values (p_c.event_id, p_c.id, 'APPEAL', v_k, coalesce(p_c.closing_price, p_c.market_price), coalesce(v_close_new, v_market_new),
            p_c.ai_price, v_ai_new, v_new_bp)
    on conflict do nothing;
  end if;

  -- Shorts covered at the close pay the new closing price for the shares they covered.
  if v_close_delta <> 0 then
    create temporary table if not exists _appeal_cover (team_id uuid, qty bigint) on commit drop;
    truncate _appeal_cover;
    insert into _appeal_cover
    select team_id, sum(share_delta)::bigint from public.ledger_entries
     where company_id = p_c.id and kind = 'SHORT_CLOSE' and team_id is not null
     group by team_id having sum(share_delta) <> 0;
    select coalesce(sum(qty * v_close_delta), 0) into v_cover from _appeal_cover;
    if v_cover <> 0 then
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, memo)
      select p_c.event_id, v_txn, 'SHORT_CLOSE', team_id, p_c.id, 'SHORT', -(qty * v_close_delta), 0, v_close_new,
             'Technical appeal: shorts covered at the new closing price'
        from _appeal_cover;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, price_cents, memo)
      values (p_c.event_id, v_txn, 'SHORT_CLOSE', null, p_c.id, v_cover, 0, v_close_new,
              'Technical appeal: shorts covered at the new closing price (exchange)');
      update public.teams t set cash_cents = t.cash_cents - x.qty * v_close_delta from _appeal_cover x where t.id = x.team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents + v_cover where id = p_c.event_id;
    end if;
  end if;

  -- An advice memo: the bonus paid to the firm at the release changes with the score.
  if v_advice then
    select * into v_eng from public.engagements e
     where e.company_id = p_c.id and e.k = v_k and e.bonus_cents is not null for no key update;
    if v_eng.id is not null then
      v_bonus := app.plan_bonus(v_final) - app.plan_bonus(coalesce(p_score.final_score, 0));
      if v_bonus <> 0 then
        update public.engagements set bonus_cents = bonus_cents + v_bonus where id = v_eng.id;
        insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, ref_table, ref_id, memo) values
          (p_c.event_id, v_txn, 'BONUS_ADVICE', v_eng.firm_team_id, p_c.id, v_bonus, 'engagements', v_eng.id,
           format('Technical appeal: advice bonus for %s instead of %s', v_final, coalesce(p_score.final_score, 0))),
          (p_c.event_id, v_txn, 'BONUS_ADVICE', null, p_c.id, -v_bonus, null, null, 'Paid by the exchange');
        update public.teams set cash_cents = cash_cents + v_bonus where id = v_eng.firm_team_id;
        update public.events set exchange_cash_cents = exchange_cash_cents - v_bonus where id = p_c.event_id;
      end if;
    end if;
  end if;

  if p_event.settled_at is not null then
    perform app.compute_results(p_c.event_id);
    perform app.compute_rankings(p_c.event_id);
  end if;

  v_effects := jsonb_build_object(
    'score', jsonb_build_object('from', p_score.final_score, 'to', v_final),
    'tier_bp', jsonb_build_object('from', coalesce(v_old_bp, p_score.tier_bp), 'to', coalesce(v_new_bp, (p_s ->> 'tier_bp')::int)),
    'ai_price', jsonb_build_object('from', p_c.ai_price, 'to', coalesce(v_ai_new, p_c.ai_price)),
    'market_price', case when v_market_new is not null then jsonb_build_object('from', p_c.market_price, 'to', v_market_new) end,
    'closing_price', case when v_close_new is not null then jsonb_build_object('from', p_c.closing_price, 'to', v_close_new) end,
    -- plan_bonus_cents: the change in the firm's advice bonus (the plan-bonus rule), as the Judge page reads it.
    'short_cover_cents', v_cover, 'plan_bonus_cents', v_bonus, 'calls', '[]'::jsonb,
    'settled', p_event.settled_at is not null);
  update public.appeals set status = 'APPLIED', decided_by = auth.uid(), decided_at = now(), effects = v_effects where id = p_a.id;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, price_cents, details)
  values (p_c.event_id, v_txn, 'APPEAL', format('Technical appeal: %s %s score %s → %s', p_c.ticker, lower(app.judge_type_title(p_a.type)),
                                                p_score.final_score, v_final),
          p_c.id, p_c.ticker, coalesce(v_close_new, v_market_new, p_c.closing_price, p_c.market_price), v_effects - 'calls');
  perform app.broadcast(p_c.event_id, 'appeal', jsonb_build_object('company_id', p_c.id, 'type', p_a.type));
  perform app.broadcast_staff(p_c.event_id, 'judge');
  return app.ok(jsonb_build_object('effects', v_effects));
end
$$;
revoke all on function app.apply_primus_appeal(public.appeals, public.events, public.companies, public.scores, jsonb) from public, anon, authenticated;

-- apply_appeal as it was (migrations 020/022), with the PRIMUS types handed to app.apply_primus_appeal once the
-- appeal, the event and the runs are checked.
create or replace function public.apply_appeal(p_appeal uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.appeals;
  v_event public.events;
  v_c public.companies;
  v_score public.scores;
  v_s jsonb;
  v_squad public.squads;
  v_plan_old int;
  v_flash_old int;
  v_plan_new int;
  v_flash_new int;
  v_flash_released boolean;
  v_base int;
  v_ai_check int;
  v_ai_new int;
  v_close_new int;
  v_delta int := 0;
  v_txn uuid := gen_random_uuid();
  v_cover bigint := 0;
  v_bonus bigint := 0;
  v_calls jsonb := '[]'::jsonb;
  v_effects jsonb;
begin
  perform app.require_organiser();
  select * into v_a from public.appeals where id = p_appeal;
  if v_a.id is null then
    raise exception 'no such appeal';
  end if;
  select * into v_event from public.events where id = v_a.event_id for no key update;
  perform app.lock_judging(v_a.submission_id::text);
  select * into v_a from public.appeals where id = p_appeal for no key update;
  if v_a.status <> 'READY' or not v_a.after_release then
    return app.fail('NOT_READY', 'This appeal has no new score waiting to be applied.');
  end if;
  if v_event.current_phase >= 'AWARDS' then
    return app.fail('TOO_LATE', 'Appeals are decided before the awards.');
  end if;
  select * into v_c from public.companies where id = v_a.company_id for no key update;
  select * into v_score from public.scores where company_id = v_a.company_id and type = v_a.type for no key update;
  if v_score.status is distinct from 'RELEASED' or v_score.submission_id is distinct from v_a.submission_id then
    return app.fail('STALE', 'The released score no longer matches this appeal.');
  end if;
  v_s := app.score_from_runs(v_a.company_id, v_a.type, v_a.submission_id, v_a.generation);
  if v_s ->> 'state' <> 'COMPLETE' then
    raise exception 'the appeal''s runs are not complete';
  end if;

  -- A PRIMUS score (a Round 2 crisis plan or advice memo, the Round 3 solution) has no plan tier: its own rule.
  if app.subround_of(v_a.type) is not null then
    return app.apply_primus_appeal(v_a, v_event, v_c, v_score, v_s);
  end if;

  -- The AI price before the plan tier never changes; the released tiers are applied to it again. The old tiers must
  -- reproduce today's AI price (nothing else moves it), so the new one differs only by this score.
  select ai_before into v_base from public.round_prices where company_id = v_c.id and kind = 'PLAN_TIER';
  if v_base is null then
    raise exception 'no plan tier is recorded for %', v_c.ticker;
  end if;
  v_flash_released := exists (select 1 from public.scores where company_id = v_c.id and type = 'FLASH' and status = 'RELEASED');
  v_plan_old := (select tier_bp from public.scores where company_id = v_c.id and type = 'PLAN');
  v_flash_old := (select tier_bp from public.scores where company_id = v_c.id and type = 'FLASH');
  v_plan_new := case when v_a.type = 'PLAN' then (v_s ->> 'tier_bp')::int else v_plan_old end;
  v_flash_new := case when v_a.type = 'FLASH' then (v_s ->> 'tier_bp')::int else v_flash_old end;
  v_ai_check := app.apply_tier(v_base, v_plan_old);
  v_ai_new := app.apply_tier(v_base, v_plan_new);
  if v_flash_released then
    v_ai_check := app.apply_tier(v_ai_check, v_flash_old);
    v_ai_new := app.apply_tier(v_ai_new, v_flash_new);
  end if;
  if v_ai_check is distinct from v_c.ai_price then
    raise exception 'the AI price of % (%) does not follow from its tiers (%)', v_c.ticker, v_c.ai_price, v_ai_check;
  end if;
  if v_c.closing_price is not null then
    v_close_new := app.avg_half_up(v_c.closing_market_price, v_ai_new);
    v_delta := v_close_new - v_c.closing_price;
  end if;

  -- The score (its release time stays: the verdicts were shown when they were).
  update public.scores
     set generation = v_a.generation, run_totals = array(select x::smallint from jsonb_array_elements_text(v_s -> 'run_totals') x),
         median = (v_s ->> 'median')::smallint, capped = (v_s ->> 'capped')::boolean, penalty = (v_s ->> 'penalty')::smallint,
         final_score = (v_s ->> 'final')::smallint, tier_bp = (v_s ->> 'tier_bp')::int, breakdown = v_s -> 'breakdown',
         rationale = v_s ->> 'rationale', updated_at = now()
   where id = v_score.id;

  perform set_config('app.price_writer', 'APPEAL', true);
  update public.companies set ai_price = v_ai_new, closing_price = coalesce(v_close_new, closing_price) where id = v_c.id;
  insert into public.round_prices (event_id, company_id, kind, market_before, market_after, ai_before, ai_after, tier_bp)
  values (v_c.event_id, v_c.id, 'APPEAL', coalesce(v_c.closing_price, v_c.market_price), coalesce(v_close_new, v_c.market_price),
          v_c.ai_price, v_ai_new, (v_s ->> 'tier_bp')::int);

  -- Shorts covered at the close pay the new closing price for the shares they covered.
  if v_delta <> 0 then
    create temporary table if not exists _appeal_cover (team_id uuid, qty bigint) on commit drop;
    truncate _appeal_cover;
    insert into _appeal_cover
    select team_id, sum(share_delta)::bigint from public.ledger_entries
     where company_id = v_c.id and kind = 'SHORT_CLOSE' and team_id is not null
     group by team_id having sum(share_delta) <> 0;
    select coalesce(sum(qty * v_delta), 0) into v_cover from _appeal_cover;
    if v_cover <> 0 then
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, memo)
      select v_c.event_id, v_txn, 'SHORT_CLOSE', team_id, v_c.id, 'SHORT', -(qty * v_delta), 0, v_close_new,
             'Technical appeal: shorts covered at the new closing price'
        from _appeal_cover;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, share_delta, price_cents, memo)
      values (v_c.event_id, v_txn, 'SHORT_CLOSE', null, v_c.id, v_cover, 0, v_close_new, 'Technical appeal: shorts covered at the new closing price (exchange)');
      update public.teams t set cash_cents = t.cash_cents - x.qty * v_delta from _appeal_cover x where t.id = x.team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents + v_cover where id = v_c.event_id;
    end if;
  end if;

  -- Consultant call 3 compares the price after the flash tier with the closing price.
  if v_close_new is not null then
    create temporary table if not exists _appeal_calls (id uuid, team_id uuid, earnings bigint) on commit drop;
    truncate _appeal_calls;
    insert into _appeal_calls select id, consultant_team_id, earnings_cents from public.calls where company_id = v_c.id and call_no = 3;
    perform app.judge_calls(v_c.event_id, 3);
    select coalesce(jsonb_agg(jsonb_build_object('team_id', x.team_id, 'cents', k.earnings_cents - x.earnings)), '[]'::jsonb) into v_calls
      from _appeal_calls x join public.calls k on k.id = x.id where k.earnings_cents is distinct from x.earnings;
    -- Call earnings were paid at settlement: pay or take back the difference.
    if v_event.settled_at is not null and jsonb_array_length(v_calls) > 0 then
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo)
      select v_c.event_id, v_txn, 'CALL_EARNINGS', (x ->> 'team_id')::uuid, v_c.id, (x ->> 'cents')::bigint,
             'Technical appeal: call 3 judged at the new closing price'
        from jsonb_array_elements(v_calls) x;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo)
      select v_c.event_id, v_txn, 'CALL_EARNINGS', null, v_c.id, -sum((x ->> 'cents')::bigint), 'Paid by the exchange'
        from jsonb_array_elements(v_calls) x;
      update public.teams t set cash_cents = t.cash_cents + y.cents
        from (select (x ->> 'team_id')::uuid as team_id, sum((x ->> 'cents')::bigint) as cents
                from jsonb_array_elements(v_calls) x group by 1) y where t.id = y.team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents
             - (select sum((x ->> 'cents')::bigint) from jsonb_array_elements(v_calls) x) where id = v_c.event_id;
    end if;
  end if;

  -- The plan bonus was paid at settlement: pay or take back the difference.
  if v_event.settled_at is not null and v_a.type = 'PLAN' then
    v_bonus := app.plan_bonus((v_s ->> 'final')::int) - app.plan_bonus(v_score.final_score);
    if v_bonus <> 0 then
      select * into v_squad from public.squads where id = v_c.squad_id;
      insert into public.ledger_entries (event_id, txn_id, kind, team_id, company_id, cash_delta_cents, memo) values
        (v_c.event_id, v_txn, 'BONUS_PLAN', v_squad.consulting_team_id, v_c.id, v_bonus,
         format('Technical appeal: plan bonus for %s instead of %s', v_s ->> 'final', v_score.final_score)),
        (v_c.event_id, v_txn, 'BONUS_PLAN', null, v_c.id, -v_bonus, 'Paid by the exchange');
      update public.teams set cash_cents = cash_cents + v_bonus where id = v_squad.consulting_team_id;
      update public.events set exchange_cash_cents = exchange_cash_cents - v_bonus where id = v_c.event_id;
      insert into public.public_ledger (event_id, txn_id, kind, label, company_id, cash_cents, details)
      values (v_c.event_id, v_txn, 'BONUS_PLAN', app.event_label(v_squad.number, 'consultant plan bonus (appeal)'), v_c.id, v_bonus,
              jsonb_build_object('squad', v_squad.number));
    end if;
  end if;

  if v_event.settled_at is not null then
    perform app.compute_results(v_c.event_id);
    perform app.compute_rankings(v_c.event_id);
  end if;

  v_effects := jsonb_build_object(
    'score', jsonb_build_object('from', v_score.final_score, 'to', (v_s ->> 'final')::int),
    'tier_bp', jsonb_build_object('from', v_score.tier_bp, 'to', (v_s ->> 'tier_bp')::int),
    'ai_price', jsonb_build_object('from', v_c.ai_price, 'to', v_ai_new),
    'closing_price', case when v_close_new is not null then jsonb_build_object('from', v_c.closing_price, 'to', v_close_new) end,
    'short_cover_cents', v_cover, 'plan_bonus_cents', v_bonus, 'calls', v_calls,
    'settled', v_event.settled_at is not null);
  update public.appeals set status = 'APPLIED', decided_by = auth.uid(), decided_at = now(), effects = v_effects where id = v_a.id;
  insert into public.public_ledger (event_id, txn_id, kind, label, company_id, ticker, price_cents, details)
  values (v_c.event_id, v_txn, 'APPEAL', format('Technical appeal: %s %s score %s → %s', v_c.ticker, lower(v_a.type::text),
                                                v_score.final_score, v_s ->> 'final'),
          v_c.id, v_c.ticker, coalesce(v_close_new, v_ai_new), v_effects - 'calls');
  perform app.broadcast(v_c.event_id, 'appeal', jsonb_build_object('company_id', v_c.id, 'type', v_a.type));
  perform app.broadcast_staff(v_c.event_id, 'judge');
  return app.ok(jsonb_build_object('effects', v_effects));
end
$$;
revoke all on function public.apply_appeal(uuid) from public, anon;
grant execute on function public.apply_appeal(uuid) to authenticated;

-- ───────────────────────────── 4 and 5. Results, rankings and awards ─────────────────────────────

-- The average of a company's four released crisis response plan scores (a missing or unreleased one counts 0).
create or replace function app.crisis_plan_average(p_company uuid)
returns numeric
language sql stable
as $$
  select round(coalesce(sum(s.final_score) filter (where s.status = 'RELEASED'), 0) / 4.0, 2)
    from public.scores s
   where s.company_id = p_company and s.type in ('CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4')
$$;
revoke all on function app.crisis_plan_average(uuid) from public, anon, authenticated;

-- compute_results as it was, ranking only teams in a squad once the squads are drawn: a team absent at the draw
-- (not checked in, or one more than the squads) had no company, client or fund in the game; its company's empty
-- closing price used to stop the settlement.
create or replace function app.compute_results(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_drawn boolean := coalesce((select drawn_at is not null from public.events where id = p_event), false);
begin
  delete from public.results where event_id = p_event;

  -- Product: retained shares × closing price + cash. Tie-break: higher plan score.
  insert into public.results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, tiebreak, eligible, details)
  select p_event, t.id, 'PRODUCT', coalesce(h.qty, 0)::bigint * c.closing_price + t.cash_cents,
         60000::bigint * c.ipo_price + 5000000,
         app.return_bp(coalesce(h.qty, 0)::bigint * c.closing_price + t.cash_cents, 60000::bigint * c.ipo_price + 5000000),
         jsonb_build_object('plan_score', app.plan_score(c.id)), not t.disqualified,
         jsonb_build_object('retained', coalesce(h.qty, 0), 'cash', t.cash_cents, 'closing_price', c.closing_price, 'company_id', c.id)
    from public.teams t join public.companies c on c.product_team_id = t.id
    left join public.holdings h on h.team_id = t.id and h.company_id = c.id and h.lot = 'RETAINED'
   where t.event_id = p_event and t.track = 'PRODUCT' and (not v_drawn or c.squad_id is not null);

  -- Consulting: cash (fee cash and bonuses) + fee shares × closing price. Tie-break: its squad company's plan score.
  insert into public.results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, tiebreak, eligible, details)
  select p_event, t.id, 'CONSULTING', t.cash_cents + coalesce(h.qty, 0)::bigint * coalesce(c.closing_price, 0), 0, null,
         jsonb_build_object('plan_score', app.plan_score(c.id)), not t.disqualified,
         jsonb_build_object('cash', t.cash_cents, 'fee_shares', coalesce(h.qty, 0), 'closing_price', c.closing_price, 'company_id', c.id)
    from public.teams t join public.squads s on s.consulting_team_id = t.id join public.companies c on c.squad_id = s.id
    left join public.holdings h on h.team_id = t.id and h.company_id = c.id and h.lot = 'FEE'
   where t.event_id = p_event and t.track = 'CONSULTING';

  -- Finance: cash + long shares × closing price − short shares × closing price (shorts were covered at the close,
  -- so they are already in cash). Ranked by return on $500,000; tie-break: smaller largest single position.
  -- The AI-price valuation (best-judging fund) adds back the cost of covering and values every position at the AI price.
  insert into public.results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, tiebreak, eligible, details)
  select p_event, t.id, 'FINANCE', t.cash_cents + coalesce(p.long_value, 0), 50000000,
         app.return_bp(t.cash_cents + coalesce(p.long_value, 0), 50000000),
         jsonb_build_object('largest_position', coalesce(p.largest, 0)), not t.disqualified,
         jsonb_build_object('cash', t.cash_cents, 'long_value', coalesce(p.long_value, 0),
                            'ai_value', t.cash_cents + coalesce(p.cover_cost, 0) + coalesce(p.long_ai, 0) - coalesce(p.short_ai, 0))
    from public.teams t
    left join (
      select x.team_id,
             sum(x.long_qty::bigint * x.closing) as long_value,
             max(greatest(x.long_qty::bigint * x.closing, x.short_qty::bigint * x.closing)) as largest,
             sum(x.short_qty::bigint * x.closing) as cover_cost,
             sum(x.long_qty::bigint * x.ai) as long_ai,
             sum(x.short_qty::bigint * x.ai) as short_ai
        from (
          select h.team_id, h.company_id, c.closing_price as closing, c.ai_price as ai,
                 coalesce(sum(h.qty) filter (where h.lot in ('EXCHANGE', 'SQUAD')), 0) as long_qty,
                 coalesce(max(sc.qty), 0) as short_qty
            from public.holdings h join public.companies c on c.id = h.company_id
            left join (select l.team_id, l.company_id, sum(l.share_delta) as qty from public.ledger_entries l
                        where l.event_id = p_event and l.kind = 'SHORT_CLOSE' group by l.team_id, l.company_id) sc
                   on sc.team_id = h.team_id and sc.company_id = h.company_id
           where h.event_id = p_event and h.lot in ('EXCHANGE', 'SQUAD', 'SHORT')
           group by h.team_id, h.company_id, c.closing_price, c.ai_price) x
       group by x.team_id) p on p.team_id = t.id
   where t.event_id = p_event and t.track = 'FINANCE'
     and (not v_drawn or exists (select 1 from public.squads s where s.finance_team_id = t.id));
  perform app.primus_results(p_event);
end
$$;
revoke all on function app.compute_results(uuid) from public, anon, authenticated;

-- compute_rankings as it was, with PRIMUS equivalents of the two company awards (the classic ones read the post-crisis
-- price and the plan score, which a PRIMUS night does not have: every company tied for the turnaround):
--   · Best turnaround (PRIMUS): the largest rise from the company's lowest market price since crisis 1's reveal (its
--     −5% shock included, then every clearing and score tier) to its closing price, compared exactly. A tie goes to the
--     higher crisis plan average (below); a tie on both shares the award. The metric keeps the classic keys
--     (post_crisis_price is that lowest price), so screens show "lowest → close (+x%)".
--   · Best rescue plan (PRIMUS): the highest average of the four released crisis response plan scores (a missing one
--     counts 0; at least one must be released). A tie goes to the higher released Round 3 solution score, then the
--     ticker (A before Z). The metric's score is that average rounded; average keeps two decimals.
-- Only companies of drawn squads whose product team is not disqualified; results hold only drawn teams.
create or replace function app.compute_rankings(p_event uuid)
returns void
language plpgsql
as $$
declare
  v_primus boolean := coalesce((select format = 'PRIMUS' from public.events where id = p_event), false);
begin
  -- Only rows that change are written.
  update public.results r set eligible = not t.disqualified from public.teams t
   where t.id = r.team_id and r.event_id = p_event and r.eligible is distinct from not t.disqualified;
  update public.results r set rank = x.rnk
    from (select id, case when eligible then rank() over (partition by track, eligible order by final_value_cents desc,
                   case when track = 'FINANCE' then -(tiebreak ->> 'largest_position')::numeric
                        else (tiebreak ->> 'plan_score')::numeric end desc) end as rnk
            from public.results where event_id = p_event) x
   where r.id = x.id and r.rank is distinct from x.rnk;

  delete from public.awards where event_id = p_event;
  insert into public.awards (event_id, code, place, team_id, metric)
  select p_event, track || '_TOP3', rank, team_id, jsonb_build_object('final_value', final_value_cents, 'return_bp', return_bp)
    from public.results where event_id = p_event and eligible and rank <= 3;

  if v_primus then
    with shock as (
      select rp.company_id, min(rp.id) as from_id from public.round_prices rp
       where rp.event_id = p_event and rp.kind = 'SUB_SHOCK' and rp.subround = 1
       group by rp.company_id
    ), low as (
      select rp.company_id, min(rp.market_after) as low_price
        from public.round_prices rp join shock s on s.company_id = rp.company_id
       where rp.event_id = p_event and rp.kind in ('SUB_SHOCK', 'SUB_TIER', 'CLEARING') and rp.id >= s.from_id
       group by rp.company_id
    ), cand as (
      select c.id, c.product_team_id, c.closing_price, l.low_price, app.crisis_plan_average(c.id) as plan_avg
        from public.companies c join public.teams t on t.id = c.product_team_id join low l on l.company_id = c.id
       where c.event_id = p_event and c.squad_id is not null and c.closing_price is not null and not t.disqualified
    )
    insert into public.awards (event_id, code, place, company_id, team_id, metric)
    select p_event, 'BEST_TURNAROUND', 1, a.id, a.product_team_id,
           jsonb_build_object('closing_price', a.closing_price, 'post_crisis_price', a.low_price, 'low_price', a.low_price,
                              'plan_average', a.plan_avg)
      from cand a
     where not exists (
       select 1 from cand b
        where b.closing_price::numeric * a.low_price > a.closing_price::numeric * b.low_price
           or (b.closing_price::numeric * a.low_price = a.closing_price::numeric * b.low_price and b.plan_avg > a.plan_avg));

    with cand as (
      select c.id, c.product_team_id, c.ticker, app.crisis_plan_average(c.id) as plan_avg,
             coalesce((select s.final_score from public.scores s
                        where s.company_id = c.id and s.type = 'SOLUTION' and s.status = 'RELEASED'), 0) as solution,
             array(select coalesce(s.final_score, 0)
                     from unnest(array['CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4']::public.submission_type[]) with ordinality k(type, ord)
                     left join public.scores s on s.company_id = c.id and s.type = k.type and s.status = 'RELEASED'
                    order by k.ord) as plans
        from public.companies c join public.teams t on t.id = c.product_team_id
       where c.event_id = p_event and c.squad_id is not null and not t.disqualified
         and exists (select 1 from public.scores s where s.company_id = c.id and s.status = 'RELEASED'
                        and s.type in ('CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4'))
    )
    insert into public.awards (event_id, code, place, company_id, team_id, metric)
    select p_event, 'BEST_RESCUE_PLAN', 1, a.id, a.product_team_id,
           jsonb_build_object('score', round(a.plan_avg)::int, 'average', a.plan_avg, 'crisis_scores', to_jsonb(a.plans),
                              'solution', a.solution)
      from cand a
     where not exists (
       select 1 from cand b
        where b.plan_avg > a.plan_avg
           or (b.plan_avg = a.plan_avg and b.solution > a.solution)
           or (b.plan_avg = a.plan_avg and b.solution = a.solution and b.ticker collate "C" < a.ticker collate "C"));
  else
    -- Best turnaround: highest closing ÷ post-crisis price (compared exactly); tie → higher plan score.
    insert into public.awards (event_id, code, place, company_id, team_id, metric)
    select p_event, 'BEST_TURNAROUND', 1, a.id, a.product_team_id,
           jsonb_build_object('closing_price', a.closing_price, 'post_crisis_price', a.post_crisis_price)
      from public.companies a join public.teams ta on ta.id = a.product_team_id
     where a.event_id = p_event and a.closing_price is not null and not ta.disqualified
       and not exists (
         select 1 from public.companies b join public.teams tb on tb.id = b.product_team_id
          where b.event_id = p_event and b.closing_price is not null and not tb.disqualified
            and (b.closing_price::numeric * a.post_crisis_price > a.closing_price::numeric * b.post_crisis_price
                 or (b.closing_price::numeric * a.post_crisis_price = a.closing_price::numeric * b.post_crisis_price
                     and app.plan_score(b.id) > app.plan_score(a.id))));

    -- Best rescue plan: highest final plan score; tie → higher raw median, then the ticker (A before Z).
    insert into public.awards (event_id, code, place, company_id, team_id, metric)
    select p_event, 'BEST_RESCUE_PLAN', 1, s.company_id, c.product_team_id, jsonb_build_object('score', s.final_score, 'median', s.median)
      from public.scores s join public.companies c on c.id = s.company_id join public.teams t on t.id = c.product_team_id
     where s.event_id = p_event and s.type = 'PLAN' and not t.disqualified
       and not exists (
         select 1 from public.scores s2 join public.companies c2 on c2.id = s2.company_id join public.teams t2 on t2.id = c2.product_team_id
          where s2.event_id = p_event and s2.type = 'PLAN' and not t2.disqualified
            and (s2.final_score > s.final_score
                 or (s2.final_score = s.final_score and coalesce(s2.median, 0) > coalesce(s.median, 0))
                 or (s2.final_score = s.final_score and coalesce(s2.median, 0) = coalesce(s.median, 0)
                     and c2.ticker collate "C" < c.ticker collate "C")));
  end if;

  -- Best-judging fund: highest value at AI prices only; tie → smaller largest position.
  insert into public.awards (event_id, code, place, team_id, metric)
  select p_event, 'BEST_JUDGING_FUND', 1, r.team_id,
         jsonb_build_object('ai_value', (r.details ->> 'ai_value')::bigint,
                            'return_bp', app.return_bp((r.details ->> 'ai_value')::bigint, 50000000))
    from public.results r
   where r.event_id = p_event and r.track = 'FINANCE' and r.eligible
     and not exists (
       select 1 from public.results r2
        where r2.event_id = p_event and r2.track = 'FINANCE' and r2.eligible
          and ((r2.details ->> 'ai_value')::bigint > (r.details ->> 'ai_value')::bigint
               or ((r2.details ->> 'ai_value')::bigint = (r.details ->> 'ai_value')::bigint
                   and (r2.tiebreak ->> 'largest_position')::bigint < (r.tiebreak ->> 'largest_position')::bigint)));
end
$$;
revoke all on function app.compute_rankings(uuid) from public, anon, authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261209000073'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
