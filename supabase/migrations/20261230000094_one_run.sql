-- One judge run per document (organisers, 20 Nov: cost). The AI judge now scores each submission ONCE, and the score
-- of a submission is that run's total (the median of one run). Until now every path queued runs 1–3, and runs 4–5
-- were added when the first three spread more than 10 points; sealing took the median of 3 or 5.
--
-- app.judge_runs() is the number of runs queued per submission (and per calibration sample): 1. Every path that
-- queues runs uses generate_series(1, app.judge_runs()): start_judging, app.auto_judge_tick, rerun_judging (the
-- re-run and appeal path), start_calibration. The extra runs 4–5 are queued only when app.judge_runs() > 1
-- (finish_judge_run, finish_calibration_run, app.score_from_runs), so never tonight; app.needs_extra_runs keeps its
-- rule (it mirrors the engine's needsExtraRuns). app.score_from_runs counts run 1 only while app.judge_runs() = 1,
-- so a generation is complete with its one DONE run, and the score is that run's total.
--
-- Runs 2–5 still queued from before this migration (none are expected) are removed, so the judge does not spend
-- calls on them; any that finish anyway are ignored by the score.

create or replace function app.judge_runs()
returns int
language sql immutable parallel safe
set search_path = ''
as $$ select 1 $$;
revoke all on function app.judge_runs() from public, anon, authenticated;
grant execute on function app.judge_runs() to service_role;

-- ── Queueing: runs 1..judge_runs() ──
select app.patch_one_function('public.start_judging(uuid, public.submission_type)'::regprocedure,
  'cross join generate_series(1, 3) n', 'cross join generate_series(1, app.judge_runs()) n');

select app.patch_one_function('app.auto_judge_tick(uuid)'::regprocedure,
  'cross join generate_series(1, 3) n', 'cross join generate_series(1, app.judge_runs()) n');
select app.patch_one_function('app.auto_judge_tick(uuid)'::regprocedure,
  '-- a. Queue runs 1–3 for every', '-- a. Queue runs 1..app.judge_runs() for every');
select app.patch_one_function('app.auto_judge_tick(uuid)'::regprocedure,
  $o$format('%s submission%s, %s runs', v_subs, case when v_subs = 1 then '' else 's' end, v_runs)$o$,
  $n$format('%s submission%s, %s run%s', v_subs, case when v_subs = 1 then '' else 's' end, v_runs, case when v_runs = 1 then '' else 's' end)$n$);
select app.patch_one_function('app.auto_judge_tick(uuid)'::regprocedure,
  $o$%s more submission%s, %s runs.', v_title,
          v_subs, case when v_subs = 1 then '' else 's' end, v_runs));$o$,
  $n$%s more submission%s, %s run%s.', v_title,
          v_subs, case when v_subs = 1 then '' else 's' end, v_runs, case when v_runs = 1 then '' else 's' end));$n$);

select app.patch_one_function('public.rerun_judging(uuid, public.submission_type, text)'::regprocedure,
  'from generate_series(1, 3) n;', 'from generate_series(1, app.judge_runs()) n;');

select app.patch_one_function('public.start_calibration(uuid, jsonb)'::regprocedure,
  'r from generate_series(1, 3) r;', 'r from generate_series(1, app.judge_runs()) r;');
select app.patch_one_function('public.start_calibration(uuid, jsonb)'::regprocedure,
  'n := n + 3;', 'n := n + app.judge_runs();');

-- ── No runs 4–5 while judge_runs() = 1 ──
select app.patch_one_function('public.finish_judge_run(uuid, jsonb)'::regprocedure,
  'v_run.generation, n from generate_series(4, 5) n',
  'v_run.generation, n from generate_series(4, 5) n where app.judge_runs() > 1');

select app.patch_one_function('public.finish_calibration_run(uuid, jsonb)'::regprocedure,
  'if v_nos = array[1, 2, 3] and app.needs_extra_runs(v_totals) then',
  'if app.judge_runs() > 1 and v_nos = array[1, 2, 3] and app.needs_extra_runs(v_totals) then');

-- ── Scoring: one DONE run completes a generation; its total is the score ──
select app.patch_one_function('app.score_from_runs(uuid, public.submission_type, uuid, smallint)'::regprocedure,
  $o$j.generation = p_gen and j.status = 'DONE';$o$,
  $n$j.generation = p_gen and j.status = 'DONE'
     and (app.judge_runs() > 1 or j.run_no = 1);$n$);
select app.patch_one_function('app.score_from_runs(uuid, public.submission_type, uuid, smallint)'::regprocedure,
  $o$if v_nos = array[1, 2, 3] and app.needs_extra_runs(v_totals) then
    return jsonb_build_object('state', 'NEEDS_EXTRA', 'runs', 3);$o$,
  $n$if app.judge_runs() > 1 and v_nos = array[1, 2, 3] and app.needs_extra_runs(v_totals) then
    return jsonb_build_object('state', 'NEEDS_EXTRA', 'runs', 3);$n$);
select app.patch_one_function('app.score_from_runs(uuid, public.submission_type, uuid, smallint)'::regprocedure,
  'if v_nos not in (array[1, 2, 3], array[1, 2, 3, 4, 5]) then',
  'if v_nos not in (array(select generate_series(1, app.judge_runs())), array[1, 2, 3, 4, 5]) then');

select app.patch_one_function('public.seal_score(uuid, public.submission_type)'::regprocedure,
  $o$'The judge needs 3 runs within 10 points, or 5 runs.'$o$,
  $n$'The judge run of this submission has not finished.'$n$);

-- ── Runs 2–5 still waiting from before: not needed any more ──
delete from public.judge_runs where status = 'QUEUED' and run_no > app.judge_runs();
delete from public.calibration_runs where status = 'QUEUED' and run_no > app.judge_runs();

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261230000094'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
