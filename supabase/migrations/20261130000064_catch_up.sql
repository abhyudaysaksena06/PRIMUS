-- Round 3 evens out the market: the weaker a company stands going into Round 3, the more its solution moves its price.
--
-- Until now a released solution's price rise was scaled by its rank among the companies on the same statement
-- (1st ×1, 2nd ×0.75, 3rd ×0.5, 4th–5th ×0.25). The organisers want Round 3 to pull the field together instead:
-- every company in Round 3 is ranked by its score so far (app.score_so_far: the PRD and the four crisis plans,
-- averaged, the same order as the draft), across the whole event, and its price rise is scaled from ×1.25 for the
-- weakest down to ×0.25 for the strongest, evenly spaced in between. With 50 companies that is a step of about 0.02.
--
-- Unchanged: a falling tier (a weak solution) applies in full, a company scores its own tier from its own solution, and
-- a company alone in Round 3 gets its full tier. Companies with the same score so far get the same multiplier (the
-- higher of their places). The score so far does not change during Round 3, so the order is fixed once Round 3 starts.

create or replace function app.release_tier_bp(p_company uuid, p_type public.submission_type)
returns integer
language plpgsql stable
as $$
declare
  v_bp int;
  v_event uuid;
  v_place int;
  v_n int;
begin
  select coalesce(s.tier_bp, 0) into v_bp from public.scores s where s.company_id = p_company and s.type = p_type;
  v_bp := coalesce(v_bp, 0);
  if p_type <> 'SOLUTION' or v_bp <= 0 then
    return v_bp;
  end if;
  select c.event_id into v_event from public.companies c where c.id = p_company;
  -- Place 1 is the weakest score so far; ties share the lower place, so they get the same (higher) multiplier.
  select r.place, r.n into v_place, v_n from (
    select d.company_id, count(*) over () as n, rank() over (order by app.score_so_far(d.company_id)) as place
      from public.draft_picks d
     where d.event_id = v_event) r
   where r.company_id = p_company;
  if v_n is null or v_n <= 1 then
    return v_bp;
  end if;
  -- ×1.25 at place 1 down to ×0.25 at place n: bp × (1.25 − (place − 1) / (n − 1)), in whole basis points.
  return (v_bp * (125 * (v_n - 1) - 100 * (v_place - 1))) / (100 * (v_n - 1));
end
$$;
revoke all on function app.release_tier_bp(uuid, public.submission_type) from public, anon, authenticated;

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261130000064'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
