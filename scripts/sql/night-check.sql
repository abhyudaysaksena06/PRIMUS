-- PRIMUS night check: read-only. Paste into Supabase -> SQL Editor and press Run after the catch-up SQL and the
-- event SQL. It changes nothing. Every row should read OK; anything else says what to fix.
-- Set the event slug on the next line if it is not primus-2026.
with ev as (select * from public.events where slug = 'primus-2026'),
expected as (select '20261220000084'::text as v),
checks as (
  select 1 as n, 'Schema version' as item, public.schema_version() as found, (select v from expected) as want,
         public.schema_version() = (select v from expected) as ok
  union all
  select 2, 'Heartbeat job (pg_cron msim-tick)',
         coalesce((select schedule from cron.job where jobname = 'msim-tick'), 'missing'), 'every 2 seconds',
         exists (select 1 from cron.job where jobname = 'msim-tick' and active)
  union all
  select 3, 'Heartbeat ran in the last minute',
         coalesce((select to_char(max(start_time), 'HH24:MI:SS') from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = 'msim-tick'), 'never'), 'a time in the last minute',
         exists (select 1 from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                  where j.jobname = 'msim-tick' and d.start_time > now() - interval '1 minute')
  union all
  select 4, 'Event exists', coalesce((select name || ' (' || slug || ')' from ev), 'missing'), 'primus-2026', exists (select 1 from ev)
  union all
  select 5, 'Event format', coalesce((select format from ev), '-'), 'PRIMUS', (select format = 'PRIMUS' from ev)
  union all
  select 6, 'Live event, not a rehearsal', coalesce((select (not is_rehearsal)::text from ev), '-'), 'true', (select not is_rehearsal from ev)
  union all
  select 7, 'Start time (IST)', coalesce((select to_char(starts_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') from ev), '-'),
         '2026-11-20 20:00', (select to_char(starts_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') = '2026-11-20 20:00' from ev)
  union all
  select 8, 'Registration desk on', coalesce((select desk_check_in::text from ev), '-'), 'true', (select desk_check_in from ev)
  union all
  select 9, 'Phase', coalesce((select current_phase::text from ev), '-'), 'SETUP before the start', true
  union all
  select 10, 'Teams per track',
         coalesce((select string_agg(track::text || ' ' || c, ', ' order by track) from
                    (select track, count(*) c from public.teams where event_id = (select id from ev) group by track) t), 'none'),
         '3 to 200 in each of the three tracks',
         (select count(*) = 3 and bool_and(c between 3 and 200) from
            (select track, count(*) c from public.teams where event_id = (select id from ev) group by track) t)
  union all
  select 11, 'Teams checked in at the desk',
         (select count(*)::text from public.teams where event_id = (select id from ev) and checked_in_at is not null),
         'rises as teams arrive', true
  union all
  select 12, 'Problem cards', (select count(*)::text from public.problem_cards where event_id = (select id from ev)), 'at least 3',
         (select count(*) >= 3 from public.problem_cards where event_id = (select id from ev))
  union all
  select 13, 'Crisis cards', (select count(*)::text from public.crisis_cards where event_id = (select id from ev)), 'at least 12',
         (select count(*) >= 12 from public.crisis_cards where event_id = (select id from ev))
  union all
  select 14, 'Seed commitment set', coalesce((select (seed_commitment is not null)::text from ev), '-'), 'true',
         (select seed_commitment is not null from ev)
  union all
  select 15, 'Tick errors in the last hour',
         (select count(*)::text from public.error_log where at > now() - interval '1 hour'), '0',
         (select count(*) = 0 from public.error_log where at > now() - interval '1 hour')
  union all
  select 16, 'Other events on the database',
         coalesce((select string_agg(slug, ', ') from public.events where slug <> 'primus-2026'), 'none'),
         'none, or only rehearsals', not exists (select 1 from public.events where slug <> 'primus-2026' and not is_rehearsal)
  union all
  select 17, 'Backup job (pg_cron msim-snapshot) on, ran in the last minute',
         coalesce((select case when j.active then 'on' else 'off' end || ', last ran ' ||
                          coalesce((select to_char(max(d.start_time), 'HH24:MI:SS') from cron.job_run_details d where d.jobid = j.jobid), 'never')
                     from cron.job j where j.jobname = 'msim-snapshot'), 'missing'),
         'on, a time in the last minute',
         exists (select 1 from cron.job j join cron.job_run_details d on d.jobid = j.jobid
                  where j.jobname = 'msim-snapshot' and j.active and d.start_time > now() - interval '1 minute')
)
select n, item, found, want, case when ok then 'OK' when ok is null then 'CHECK (no event)' else 'FIX' end as result
  from checks order by n;
