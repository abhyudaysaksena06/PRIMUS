-- Fixes from the deep review of tonight's build (20 Nov).
--
-- F7 (trading audit): a score release was refused only while app.open_round found an open round, which misses a round
-- past its close that the heartbeat has not cleared yet (up to ~2 s). The plan release falls due as round 5 of each
-- sub-round closes, so a release in that window moved the price the pending book then cleared at (buys filled above
-- their reserve; orders placed before the release filled at post-release prices). Now any round still OPEN refuses.

select app.patch_functions(
$o$  if (app.open_round(p_event)).id is not null then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');$o$,
$n$  if (app.open_round(p_event)).id is not null
     or exists (select 1 from public.rounds r where r.event_id = p_event and r.status = 'OPEN') then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');$n$, 2);

-- F1 (hiring, 071). Round 3 (k = 5) keeps its 5–20%-of-cash band: no firm minimum bid there. The draw charges Round 3
-- the old fee (10% of cash, no shares, as with the switch off), not the base rate. Crises 1–4: when the 40,000-share
-- floor blocks the base-rate shares, the cash fallback is capped at the base fee ($22,500) and the company's cash.
select app.patch_one_function('public.make_offer(uuid, bigint, integer, text)'::regprocedure,
$o$  v_problem := app.min_bid_problem(v_company, p_firm, coalesce(p_cash, 0), coalesce(p_shares, 0), false);$o$,
$n$  v_problem := case when v_k = 5 then null else app.min_bid_problem(v_company, p_firm, coalesce(p_cash, 0), coalesce(p_shares, 0), false) end;$n$);
select app.patch_one_function('public.make_offer_to(uuid, bigint, integer, text)'::regprocedure,
$o$  v_problem := app.min_bid_problem(v_company, v_team.id, coalesce(p_cash, 0), coalesce(p_shares, 0), true);$o$,
$n$  v_problem := case when v_k = 5 then null else app.min_bid_problem(v_company, v_team.id, coalesce(p_cash, 0), coalesce(p_shares, 0), true) end;$n$);
select app.patch_one_function('public.respond_offer(uuid, text, bigint, integer)'::regprocedure,
$o$    v_problem := app.min_bid_problem(v_company, v_offer.firm_team_id, p_cash, p_shares, v_side = 'FIRM');$o$,
$n$    v_problem := case when v_offer.k = 5 then null else app.min_bid_problem(v_company, v_offer.firm_team_id, p_cash, p_shares, v_side = 'FIRM') end;$n$);
select app.patch_one_function('public.respond_offer(uuid, text, bigint, integer)'::regprocedure,
$o$  v_problem := app.min_bid_problem(v_company, v_offer.firm_team_id, v_offer.cash_cents, v_offer.shares, v_side = 'FIRM');$o$,
$n$  v_problem := case when v_offer.k = 5 then null else app.min_bid_problem(v_company, v_offer.firm_team_id, v_offer.cash_cents, v_offer.shares, v_side = 'FIRM') end;$n$);

select app.patch_one_function('app.assign_firms_by_draw(uuid, integer)'::regprocedure,
$o$    if v_retained - v_promised - v_shares >= app.min_retained_shares() then
      v_fee := 0;
    else
      -- The floor blocks the shares: their value in cash at today's price, never more than the company has.
      v_fee := least(v_shares::bigint * coalesce(v_company.market_price, 0), greatest(coalesce(v_cash, 0), 0));
      v_shares := 0;
    end if;$o$,
$n$    if p_k = 5 then
      -- Round 3 keeps its old fee: 10% of cash, no shares (as with the switch off).
      v_fee := greatest(coalesce(v_cash, 0), 0) / 10;
      v_shares := 0;
    elsif v_retained - v_promised - v_shares >= app.min_retained_shares() then
      v_fee := 0;
    else
      -- The floor blocks the shares: their value in cash at today's price, never more than the base fee or the cash.
      v_fee := least(v_shares::bigint * coalesce(v_company.market_price, 0), app.default_hire_fee(), greatest(coalesce(v_cash, 0), 0));
      v_shares := 0;
    end if;$n$);

-- F2 (draft, 077). A pause stops the clock for the draft too: resume moves every pick not yet made by the pause's
-- length (the delta the schedule moves by), and no statement can be picked while the event is paused.
select app.patch_one_function('public.resume_event(uuid)'::regprocedure,
$o$  update public.events set paused = false, paused_at = null where id = p_event;$o$,
$n$  update public.draft_picks
     set opens_at = opens_at + (now() - v_event.paused_at), closes_at = closes_at + (now() - v_event.paused_at)
   where event_id = p_event and statement_id is null;
  update public.events set paused = false, paused_at = null where id = p_event;$n$);
select app.patch_one_function('public.pick_statement(uuid)'::regprocedure,
$o$  perform 1 from public.events where id = v_team.event_id for no key update;$o$,
$n$  perform 1 from public.events where id = v_team.event_id for no key update;
  if (select e.paused from public.events e where e.id = v_team.event_id) then
    return app.fail('PAUSED', 'The event is paused. Pick when it resumes.');
  end if;$n$);

-- F3 (heartbeat). One step that raises no longer rolls the whole tick back, every 2 seconds, for ever: each step of
-- app.primus_tick (judging, each reveal, the draft, each sub-round's hiring close, due time and ratings) and of
-- public.tick (each round's clearing, the hold, the PRIMUS steps) runs in its own sub-transaction. A step that fails
-- is undone alone, logged (at most once a minute per step, source 'tick:<step>') and, its done-marker unset, tried
-- again on the next beat; the others go ahead, and the broadcasts are still flushed.
create or replace function app.tick_step_failed(p_event uuid, p_step text, p_message text, p_state text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.error_log e
                  where e.event_id = p_event and e.source = 'tick:' || p_step and e.at > now() - interval '1 minute') then
    insert into public.error_log (event_id, source, message, context)
    values (p_event, 'tick:' || p_step, coalesce(p_message, 'error'), jsonb_build_object('sqlstate', p_state));
  end if;
end
$$;
revoke all on function app.tick_step_failed(uuid, text, text, text) from public, anon, authenticated;

select app.patch_one_function('app.primus_tick(uuid)'::regprocedure,
$o$    v_actions := v_actions || app.auto_judge_tick(p_event);$o$,
$n$    begin
      v_actions := v_actions || app.auto_judge_tick(p_event);
    exception when others then
      perform app.tick_step_failed(p_event, 'judge', sqlerrm, sqlstate);
    end;$n$);
select app.patch_one_function('app.primus_tick(uuid)'::regprocedure,
$o$      if app.deadline_passed(p_event, ('REVEAL_' || v_k)::public.deadline_code) and app.reveal_subround(p_event, v_k) then
        v_actions := v_actions || ('revealed crisis ' || v_k);
      end if;$o$,
$n$      begin
        if app.deadline_passed(p_event, ('REVEAL_' || v_k)::public.deadline_code) and app.reveal_subround(p_event, v_k) then
          v_actions := v_actions || ('revealed crisis ' || v_k);
        end if;
      exception when others then
        perform app.tick_step_failed(p_event, 'reveal_' || v_k, sqlerrm, sqlstate);
      end;$n$);
select app.patch_one_function('app.primus_tick(uuid)'::regprocedure,
$o$  if v_event.current_phase = 'SATURATION' and app.draft_tick(p_event) > 0 then
    v_actions := v_actions || 'draft defaults'::text;
  end if;$o$,
$n$  begin
    if v_event.current_phase = 'SATURATION' and app.draft_tick(p_event) > 0 then
      v_actions := v_actions || 'draft defaults'::text;
    end if;
  exception when others then
    perform app.tick_step_failed(p_event, 'draft', sqlerrm, sqlstate);
  end;$n$);
select app.patch_one_function('app.primus_tick(uuid)'::regprocedure,
$o$    if v_sub.hiring_closed_at is null and app.deadline_passed(p_event, ('HIRE_' || v_k)::public.deadline_code) then
      n := app.assign_default_firms(p_event, v_k);
      if n > 0 then v_actions := v_actions || ('firms assigned ' || v_k || ': ' || n); end if;
      update public.offers set status = 'LAPSED', decided_at = now(), updated_at = now()
       where event_id = p_event and offers.k = v_k and status = 'OPEN';
      update public.subrounds set hiring_closed_at = now() where event_id = p_event and subrounds.k = v_k;
      v_actions := v_actions || ('hiring closed ' || v_k);
      perform app.broadcast(p_event, 'subround', jsonb_build_object('k', v_k, 'step', 'hiring_closed'));
    end if;$o$,
$n$    begin
      if v_sub.hiring_closed_at is null and app.deadline_passed(p_event, ('HIRE_' || v_k)::public.deadline_code) then
        n := app.assign_default_firms(p_event, v_k);
        if n > 0 then v_actions := v_actions || ('firms assigned ' || v_k || ': ' || n); end if;
        update public.offers set status = 'LAPSED', decided_at = now(), updated_at = now()
         where event_id = p_event and offers.k = v_k and status = 'OPEN';
        update public.subrounds set hiring_closed_at = now() where event_id = p_event and subrounds.k = v_k;
        v_actions := v_actions || ('hiring closed ' || v_k);
        perform app.broadcast(p_event, 'subround', jsonb_build_object('k', v_k, 'step', 'hiring_closed'));
      end if;
    exception when others then
      perform app.tick_step_failed(p_event, 'hire_' || v_k, sqlerrm, sqlstate);
    end;$n$);
select app.patch_one_function('app.primus_tick(uuid)'::regprocedure,
$o$    if v_sub.due_closed_at is null and app.deadline_passed(p_event, ('DUE_' || v_k)::public.deadline_code) then
      n := app.settle_engagements(p_event, v_k);
      update public.subrounds set due_closed_at = now() where event_id = p_event and subrounds.k = v_k;
      v_actions := v_actions || ('escrow settled ' || v_k || ': ' || n);
      perform app.broadcast(p_event, 'subround', jsonb_build_object('k', v_k, 'step', 'due'));
    end if;$o$,
$n$    begin
      if v_sub.due_closed_at is null and app.deadline_passed(p_event, ('DUE_' || v_k)::public.deadline_code) then
        n := app.settle_engagements(p_event, v_k);
        update public.subrounds set due_closed_at = now() where event_id = p_event and subrounds.k = v_k;
        v_actions := v_actions || ('escrow settled ' || v_k || ': ' || n);
        perform app.broadcast(p_event, 'subround', jsonb_build_object('k', v_k, 'step', 'due'));
      end if;
    exception when others then
      perform app.tick_step_failed(p_event, 'due_' || v_k, sqlerrm, sqlstate);
    end;$n$);
select app.patch_one_function('app.primus_tick(uuid)'::regprocedure,
$o$    if v_sub.rated_at is null and app.deadline_passed(p_event, ('RATE_' || v_k)::public.deadline_code) then
      update public.engagements set rating = 3, rating_default = true, rated_at = now()
       where event_id = p_event and engagements.k = v_k and rating is null;
      update public.subrounds set rated_at = now() where event_id = p_event and subrounds.k = v_k;
      v_actions := v_actions || ('ratings closed ' || v_k);
      perform app.broadcast(p_event, 'subround', jsonb_build_object('k', v_k, 'step', 'rated'));
    end if;$o$,
$n$    begin
      if v_sub.rated_at is null and app.deadline_passed(p_event, ('RATE_' || v_k)::public.deadline_code) then
        update public.engagements set rating = 3, rating_default = true, rated_at = now()
         where event_id = p_event and engagements.k = v_k and rating is null;
        update public.subrounds set rated_at = now() where event_id = p_event and subrounds.k = v_k;
        v_actions := v_actions || ('ratings closed ' || v_k);
        perform app.broadcast(p_event, 'subround', jsonb_build_object('k', v_k, 'step', 'rated'));
      end if;
    exception when others then
      perform app.tick_step_failed(p_event, 'rate_' || v_k, sqlerrm, sqlstate);
    end;$n$);
select app.patch_one_function('public.tick(uuid)'::regprocedure,
$o$      perform app.clear_round(r.id);
      v_actions := v_actions || ('cleared ' || r.number);$o$,
$n$      begin
        perform app.clear_round(r.id);
        v_actions := v_actions || ('cleared ' || r.number);
      exception when others then
        perform app.tick_step_failed(p_event, 'clear_round_' || r.number, sqlerrm, sqlstate);
      end;$n$);
select app.patch_one_function('public.tick(uuid)'::regprocedure,
$o$    v_actions := v_actions || app.hold_tick(p_event);
    v_actions := v_actions || app.primus_tick(p_event);$o$,
$n$    begin
      v_actions := v_actions || app.hold_tick(p_event);
    exception when others then
      perform app.tick_step_failed(p_event, 'hold', sqlerrm, sqlstate);
    end;
    begin
      v_actions := v_actions || app.primus_tick(p_event);
    exception when others then
      perform app.tick_step_failed(p_event, 'primus', sqlerrm, sqlstate);
    end;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261217000081'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
