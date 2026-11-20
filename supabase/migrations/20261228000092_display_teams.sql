-- The projector's Teams spotlight: every listed team of the event (app.team_listed: checked in at the desk when the
-- event requires it, or seated in a squad by the draw), one card each, with only what is already public:
--   · every team: its code, name and track (the organisers show the teams in the hall tonight);
--   · Product: its company's ticker, name and sector, from READING on (when companies and sectors become public);
--   · Consulting: the firm's base rate (app.firm_base_rate, as the firm directory shows it) and its number of clients
--     (companies that have hired it; never the fee or the cash);
--   · Finance: the fund's name only (cash and positions stay private until AWARDS).
-- Callable by staff, the display account and the event's own teams. A placeholder card (not checked in, not seated)
-- never appears.

create or replace function public.display_teams(p_event uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'code', t.code,
             'name', t.name,
             'track', t.track,
             'company', case when t.track = 'PRODUCT' and pub.ok then (
               select jsonb_build_object('id', c.id, 'ticker', c.ticker, 'name', c.name,
                                         'sector', nullif(btrim(pc.sector), ''))
                 from public.companies c
                 left join public.squads s on s.id = c.squad_id
                 left join public.problem_cards pc on pc.id = s.chosen_card_id
                where c.product_team_id = t.id and c.event_id = p_event and c.ticker is not null
                limit 1) end,
             'base_rate_bp', case when t.track = 'CONSULTING' then app.firm_base_rate(t.id) end,
             'clients', case when t.track = 'CONSULTING'
                          then (select count(distinct e.company_id) from public.engagements e where e.firm_team_id = t.id)::int end)
           order by case t.track when 'PRODUCT' then 1 when 'CONSULTING' then 2 else 3 end,
                    length(t.code), t.code collate "C"),
         '[]'::jsonb)
    from public.teams t
   cross join lateral (select (select current_phase from public.events e where e.id = p_event) >= 'READING' as ok) pub
   where t.event_id = p_event
     and (app.is_staff() or app.sees_all_events() or app.my_event_id() = p_event)
     and app.team_listed(t.id)
$$;
revoke all on function public.display_teams(uuid) from public, anon;
grant execute on function public.display_teams(uuid) to authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261228000092'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
