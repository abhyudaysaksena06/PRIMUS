-- Switches for the 20 Nov changes.
--
-- Every behaviour added for the 600-team night has an on/off switch on the Run page, so the organisers can turn one
-- off during the night without a deploy. A switch that is off leaves the game exactly as it was before the change.
-- Kinds: SCALE (needed to run 200 teams per track), RULE (changes how the game plays: off until rehearsed),
-- DISPLAY (changes only what screens show). Unknown keys are refused; an event that never set a key uses its default.

alter table public.events add column if not exists features jsonb not null default '{}'::jsonb;
alter table public.events add constraint events_features_object check (jsonb_typeof(features) = 'object');

-- The known switches. A builder adding a switch adds one line here.
create or replace function app.feature_catalog()
returns table (key text, label text, on_by_default boolean, kind text, sort int)
language sql immutable
as $$
  values
    ('draw_checked_in', 'Squad draw uses only checked-in teams (the smallest track sets the number of squads)', true, 'SCALE', 10),
    ('practice_verified', 'Practice market: one simulated company per checked-in Finance team', true, 'SCALE', 20),
    ('draft_by_sector', 'Round 3 draft: one queue per sector, all at the same time', true, 'SCALE', 30),
    ('draft_random_fallback', 'Round 3 draft: a missed pick gets a random statement with room', true, 'RULE', 40),
    ('broadcast_coalesce', 'Screens get at most one event-wide update per second', true, 'SCALE', 50),
    ('snapshots', 'Back up the event after every phase, trading round and score release', true, 'SCALE', 60),
    ('judge_auto', 'Judging starts by itself when a writing deadline passes', false, 'RULE', 70),
    ('hire_base_rate', 'An unhired company gets a random firm at that firm''s base rate', false, 'RULE', 80),
    ('hire_min_bid', 'Offers worth less than a firm''s base rate (its minimum bid) are refused', false, 'RULE', 90),
    ('submit_last_5', 'Submit opens only in the last 5 minutes of a writing window', false, 'RULE', 100),
    ('paste_block', 'Editors block paste and drop', true, 'DISPLAY', 110),
    ('paste_flag', 'Flag drafts that grow too fast to have been typed', true, 'RULE', 120),
    ('crisis_popup', 'Crisis pop-ups at the reveal and when the card opens', true, 'DISPLAY', 130),
    ('leaderboard', 'Live leaderboard (PRIMUS Rating) for teams and the projector', true, 'DISPLAY', 140)
$$;
revoke all on function app.feature_catalog() from public, anon, authenticated;

-- Is a switch on for this event? (its own setting, else the default; unknown keys are off)
create or replace function app.feature_on(p_event uuid, p_key text)
returns boolean
language sql stable
as $$
  select coalesce((select (e.features ->> p_key)::boolean from public.events e where e.id = p_event),
                  (select c.on_by_default from app.feature_catalog() c where c.key = p_key),
                  false)
$$;
revoke all on function app.feature_on(uuid, text) from public, anon, authenticated;

-- Every switch with its state, as one object (event_status carries it to every screen).
create or replace function app.features_of(p_event uuid)
returns jsonb
language sql stable
as $$
  select coalesce(jsonb_object_agg(c.key, coalesce((e.features ->> c.key)::boolean, c.on_by_default)), '{}'::jsonb)
    from app.feature_catalog() c
    left join public.events e on e.id = p_event
$$;
revoke all on function app.features_of(uuid) from public, anon, authenticated;

-- Turn a switch on or off (organisers). Logged, and every screen is told so it re-reads.
create or replace function public.set_feature(p_event uuid, p_key text, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.events;
  v_label text;
begin
  perform app.require_organiser();
  select c.label into v_label from app.feature_catalog() c where c.key = p_key;
  if v_label is null then
    return app.fail('NO_SUCH_SWITCH', 'No such switch.');
  end if;
  if p_on is null then
    return app.fail('BAD_INPUT', 'Say on or off.');
  end if;
  select * into v_event from public.events where id = p_event for no key update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  update public.events set features = features || jsonb_build_object(p_key, p_on) where id = p_event;
  perform app.log_event(p_event, 'CONTROL', format('Switch %s: %s', case when p_on then 'on' else 'off' end, v_label));
  perform app.broadcast(p_event, 'features', jsonb_build_object('key', p_key, 'on', p_on));
  return app.ok(jsonb_build_object('features', app.features_of(p_event)));
end
$$;
revoke all on function public.set_feature(uuid, text, boolean) from public, anon;
grant execute on function public.set_feature(uuid, text, boolean) to authenticated;

-- The switches with labels and state, for the Run page (staff and the projector login; teams get none).
create or replace function public.feature_switches(p_event uuid)
returns table (key text, label text, kind text, is_on boolean, on_by_default boolean)
language sql stable security definer set search_path = ''
as $$
  select c.key, c.label, c.kind, coalesce((e.features ->> c.key)::boolean, c.on_by_default), c.on_by_default
    from app.feature_catalog() c
    join public.events e on e.id = p_event
   where app.is_staff() or app.sees_all_events()
   order by c.sort
$$;
revoke all on function public.feature_switches(uuid) from public, anon;
grant execute on function public.feature_switches(uuid) to authenticated;

-- Every screen already reads event_status: it now carries the switches too.
select app.patch_functions(
$o$    'drawn', v_event.drawn_at is not null,
    'server_time', now());$o$,
$n$    'drawn', v_event.drawn_at is not null,
    'features', app.features_of(p_event),
    'server_time', now());$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261206000070'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
