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

-- Fix 1 (hiring, 071). Round 3 (k = 5) keeps its 5–20%-of-cash band: no firm minimum bid there. The draw charges Round 3
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

-- Fix 2 (draft, 077). A pause stops the clock for the draft too: resume moves every pick not yet made by the pause's
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

-- Fix 3 (heartbeat). One step that raises no longer rolls the whole tick back, every 2 seconds, for ever: each step of
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

-- Fix 4 (desk). The desk rule (check-in required) is fixed once the squads are drawn: the draw and the hiring draw
-- counted who was present under it.
select app.patch_one_function('public.set_desk_check_in(uuid, boolean)'::regprocedure,
$o$  perform app.require_desk();$o$,
$n$  perform app.require_desk();
  if exists (select 1 from public.events e where e.id = p_event and e.drawn_at is not null) then
    return app.fail('DRAWN', 'The desk rule cannot change after the squad draw.');
  end if;$n$);

-- Fix 5 (realtime budget). The gathered "refresh" goes out at most every 5 seconds: only once the oldest waiting kind
-- is 5 seconds old.
select app.patch_one_function('app.flush_broadcasts(uuid)'::regprocedure,
$o$  with gone as (delete from app.broadcast_pending where event_id = p_event returning kind)$o$,
$n$  if not exists (select 1 from app.broadcast_pending b where b.event_id = p_event and b.at <= now() - interval '5 seconds') then
    return;
  end if;
  with gone as (delete from app.broadcast_pending where event_id = p_event returning kind)$n$);

-- Fix 6 (hiring close). The staff screens hear one 'offers' message after the pass, not one per assigned company (the
-- two teams of each engagement still hear theirs).
create or replace function app.broadcast_offer(p_event uuid, p_payload jsonb, p_firm uuid, p_product uuid, p_staff boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_msg jsonb := coalesce(p_payload, '{}'::jsonb)
                 || jsonb_build_object('firm', p_firm, 'product', p_product, 'kind', 'offers', 'event_id', p_event, 'at', now());
begin
  perform realtime.send(v_msg, 'offers', 'team:' || p_firm::text, true);
  perform realtime.send(v_msg, 'offers', 'team:' || p_product::text, true);
  if p_staff then
    perform realtime.send(v_msg, 'offers', 'staff:' || p_event::text, true);
  end if;
end
$$;
revoke all on function app.broadcast_offer(uuid, jsonb, uuid, uuid, boolean) from public, anon, authenticated;
select app.patch_one_function(f::regprocedure, $o$v_firm, v_company.product_team_id);$o$, $n$v_firm, v_company.product_team_id, false);$n$)
  from unnest(array['app.assign_firms_by_draw(uuid, integer)', 'app.assign_default_firms(uuid, integer)']) f;
select app.patch_one_function(f::regprocedure,
$o$    perform app.broadcast(p_event, 'hire_locked', jsonb_build_object('k', p_k, 'assigned', true));$o$,
$n$    perform app.broadcast(p_event, 'hire_locked', jsonb_build_object('k', p_k, 'assigned', true));
    perform app.broadcast_staff(p_event, 'offers');$n$)
  from unnest(array['app.assign_firms_by_draw(uuid, integer)', 'app.assign_default_firms(uuid, integer)']) f;

-- Fix 7 (roles, 074). Re-running a type's judging (it discards the runs and scores) is an organiser's decision again.
select app.patch_one_function('public.rerun_judging(uuid, public.submission_type, text)'::regprocedure,
$o$  perform app.require_judge_ops();$o$, $n$  perform app.require_organiser();$n$);

-- Fix 8 (paste flag, 072). A save that adds more than 120 words within 60 seconds of the previous save is noted, and so
-- is a first save of more than 120 words.
select app.patch_one_function('app.flag_fast_draft(public.teams, public.submission_drafts, public.submission_type, jsonb)'::regprocedure,
$o$  if p_draft.id is null or p_draft.version < 1 or not app.feature_on(p_team.event_id, 'paste_flag') then$o$,
$n$  if p_draft.id is null or not app.feature_on(p_team.event_id, 'paste_flag') then$n$);
select app.patch_one_function('app.flag_fast_draft(public.teams, public.submission_drafts, public.submission_type, jsonb)'::regprocedure,
$o$  if v_seconds >= 10 then$o$,
$n$  if p_draft.version >= 1 and v_seconds >= 60 then$n$);
select app.patch_one_function('app.flag_fast_draft(public.teams, public.submission_drafts, public.submission_type, jsonb)'::regprocedure,
$o$round(greatest(v_seconds, 0), 1)$o$,
$n$round(least(greatest(v_seconds, 0), 99999), 1)$n$);

-- Fix 9 (hold, 050). A crisis whose reveal time is already here (the organiser's "Start now" sets it to a second ago, and
-- its own tick may have been skipped while another held the heartbeat's lock) is never held back again.
select app.patch_one_function('app.hold_tick(uuid)'::regprocedure,
$o$                                  where s.event_id = p_event and s.k = substr(d.code::text, 8)::int and s.revealed_at is not null)$o$,
$n$                                  where s.event_id = p_event and s.k = substr(d.code::text, 8)::int and s.revealed_at is not null)
                     and d.at > now()$n$);
select app.patch_one_function('app.hold_tick(uuid)'::regprocedure,
$o$    if v_at is not null and v_at < now() + interval '1 minute' then$o$,
$n$    if v_at is not null and v_at > now() and v_at < now() + interval '1 minute' then$n$);

-- Fix 10 (hiring draw). The eligible firms are locked, in id order, before their clients are counted: an accept that
-- commits meanwhile cannot give a firm a third client.
select app.patch_one_function('app.assign_firms_by_draw(uuid, integer)'::regprocedure,
$o$  select s.seed into v_seed from public.event_secrets s where s.event_id = p_event;$o$,
$n$  select s.seed into v_seed from public.event_secrets s where s.event_id = p_event;
  perform 1 from public.teams t
   where t.event_id = p_event and t.track = 'CONSULTING'
     and (not v_event.desk_check_in or t.checked_in_at is not null)
     and exists (select 1 from public.squads s where s.consulting_team_id = t.id)
   order by t.id
     for no key update;$n$);

-- Fix 11 (restores, 075). No restore while a round is open (trading would go back under the teams' feet): approving
-- refuses with ROUND_OPEN, and the runner checks again.
select app.patch_one_function('public.approve_restore(bigint, boolean, text)'::regprocedure,
$o$  if v_r.snapshot_id is null then
    return app.fail('NO_BACKUP', 'That backup no longer exists.');$o$,
$n$  if exists (select 1 from public.rounds r where r.event_id = v_r.event_id and r.status = 'OPEN') then
    return app.fail('ROUND_OPEN', 'A trading round is open. Restore between rounds.');
  end if;
  if v_r.snapshot_id is null then
    return app.fail('NO_BACKUP', 'That backup no longer exists.');$n$);
select app.patch_one_function('app.restore_snapshot(bigint)'::regprocedure,
$o$    raise exception 'The event was resumed before the restore ran. Pause it and ask again.';
  end if;$o$,
$n$    raise exception 'The event was resumed before the restore ran. Pause it and ask again.';
  end if;
  if exists (select 1 from public.rounds r where r.event_id = v_s.event_id and r.status = 'OPEN') then
    raise exception 'A trading round is open. Restore between rounds.';
  end if;$n$);

-- Fix 12 (leak, 041). Which crisis each company drew: the projector, organisers and the fairness officer at any time;
-- the registration, judge and crisis desks only once that sub-round's hiring has closed (as the teams).
drop policy if exists subround_crises_display on public.subround_crises;
create policy subround_crises_display on public.subround_crises for select to authenticated
  using ((select app.has_role('DISPLAY', 'ORGANISER', 'FAIRNESS'))
         or ((select app.sees_all_events()) and app.hiring_closed(event_id, k::int)));

-- Fix 13 (judging, 073). With judging on its own, a run queued for over 2 minutes means no worker is taking runs: the
-- error log says so, at most every 2 minutes.
select app.patch_one_function('app.auto_judge_tick(uuid)'::regprocedure,
$o$  if not app.feature_on(p_event, 'judge_auto') then
    return v_actions;
  end if;$o$,
$n$  if not app.feature_on(p_event, 'judge_auto') then
    return v_actions;
  end if;
  if exists (select 1 from public.judge_runs j
              where j.event_id = p_event and j.status = 'QUEUED' and j.created_at < now() - interval '2 minutes')
     and not exists (select 1 from public.error_log e
                      where e.event_id = p_event and e.source = 'judge_auto' and e.message like 'Judge queue stalled%'
                        and e.at > now() - interval '2 minutes') then
    insert into public.error_log (event_id, source, message)
    values (p_event, 'judge_auto', format('Judge queue stalled: %s runs waiting; is a worker running?',
            (select count(*) from public.judge_runs j where j.event_id = p_event and j.status = 'QUEUED')));
  end if;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261217000081'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
