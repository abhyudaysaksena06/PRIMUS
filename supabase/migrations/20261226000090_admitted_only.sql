-- No team is shown anywhere until the registration desk has checked it in (events.desk_check_in on).
--
-- The 600 login cards (P/C/F 01–200, "Product Team P01", ...) exist before the night. Row-level security already lets
-- a team read only its own row of public.teams, so other teams' names and codes reach a team or the projector only
-- through the security-definer functions below; they now leave out every team that is not admitted (app.team_admitted:
-- the event does not require the desk, or the desk checked the team in) unless it sits in a drawn squad. With the desk
-- off (classic and rehearsal events) nothing changes. Staff pages filter in the app (lib/admin/admitted.ts).
--
-- The desk: a card code typed for a walk-in team must belong to the track chosen at the desk.

-- A team that may be listed: admitted, or seated in a squad by the draw.
create or replace function app.team_listed(p_team uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.team_admitted(p_team)
      or exists (select 1 from public.squads s
                  where p_team in (s.product_team_id, s.consulting_team_id, s.finance_team_id))
$$;
revoke all on function app.team_listed(uuid) from public, anon, authenticated;

-- The firm directory (hiring): before the draw only the Consulting teams the desk has admitted.
create or replace function public.firm_values(p_event uuid)
returns table (team_id uuid, code text, name text, cash_cents bigint, fee_share_value_cents bigint, value_cents bigint,
               clients integer, avg_rating numeric, base_rate_bp integer, min_bid_cents bigint)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.code, t.name, t.cash_cents,
         coalesce((select sum(h.qty::bigint * coalesce(c.market_price, 0)) from public.holdings h
                     join public.companies c on c.id = h.company_id where h.team_id = t.id and h.lot = 'FEE'), 0)::bigint,
         t.cash_cents + coalesce((select sum(h.qty::bigint * coalesce(c.market_price, 0)) from public.holdings h
                     join public.companies c on c.id = h.company_id where h.team_id = t.id and h.lot = 'FEE'), 0)::bigint,
         (select count(*) from public.engagements e where e.firm_team_id = t.id)::int,
         (select round(avg(e.rating), 2) from public.engagements e where e.firm_team_id = t.id and e.rating is not null),
         app.firm_base_rate(t.id),
         -- For a Product team: the firm's base rate of its own company at today's price (null for anyone else).
         app.firm_base_rate(t.id)::bigint * 10
           * (select c.market_price from public.companies c where c.product_team_id = app.my_team_id() and c.event_id = p_event)
    from public.teams t
   where t.event_id = p_event and t.track = 'CONSULTING'
     and (p_event = app.my_event_id() or app.is_staff())
     and ((select e.drawn_at from public.events e where e.id = p_event) is null
          or exists (select 1 from public.squads s where s.consulting_team_id = t.id))
     and app.team_listed(t.id)
   order by 6 desc, t.code
$$;
revoke all on function public.firm_values(uuid) from public, anon;
grant execute on function public.firm_values(uuid) to authenticated;

-- The final rankings (teams, the projector, /api/rankings): only the teams that played.
create or replace function public.rankings(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_phase public.phase_code;
begin
  select current_phase into v_phase from public.events where id = p_event;
  if v_phase is null then
    return null;
  end if;
  if not ((app.is_staff() and v_phase >= 'SETTLEMENT')
          or ((app.sees_all_events() or app.my_event_id() = p_event) and v_phase >= 'AWARDS')) then
    return null;
  end if;
  return jsonb_build_object(
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'track', r.track, 'final_value_cents', r.final_value_cents, 'start_value_cents', r.start_value_cents,
               'return_bp', r.return_bp, 'rank', r.rank, 'eligible', r.eligible,
               'teams', jsonb_build_object('code', t.code, 'name', t.name))
             order by r.track, r.rank nulls last, t.code collate "C")
        from public.results r join public.teams t on t.id = r.team_id
       where r.event_id = p_event and app.team_listed(t.id)), '[]'::jsonb),
    'awards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', a.code, 'place', a.place, 'metric', a.metric,
               'teams', case when t.id is null or not app.team_listed(t.id) then null
                             else jsonb_build_object('code', t.code, 'name', t.name) end,
               'companies', case when c.id is null then null else jsonb_build_object('ticker', c.ticker, 'name', c.name) end)
             order by a.code collate "C", a.place)
        from public.awards a
        left join public.teams t on t.id = a.team_id
        left join public.companies c on c.id = a.company_id
       where a.event_id = p_event), '[]'::jsonb));
end
$$;
grant execute on function public.rankings(uuid) to authenticated;

-- The desk: a typed card of another track than the one chosen is refused (a walk-in Product team must not land on C07).
select app.patch_functions(
$o$    if v_team.checked_in_at is not null and not coalesce(p_edit, false) then
      return app.fail('CARD_TAKEN', format('Card %s is already checked in to %s.', v_code, v_team.name));
    end if;$o$,
$n$    if v_team.checked_in_at is not null and not coalesce(p_edit, false) then
      return app.fail('CARD_TAKEN', format('Card %s is already checked in to %s: choose another card.', v_code, v_team.name));
    end if;
    if p_track is not null and v_team.track <> p_track and not coalesce(p_edit, false) then
      return app.fail('WRONG_TRACK', format('Card %s is a %s card, not %s: type a card of the team''s track.',
        v_code, initcap(v_team.track::text), initcap(p_track::text)));
    end if;$n$);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261226000090'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
