-- After registration (organisers, 20 Nov): remove from the portal every team (login card) the registration desk did
-- not admit. public.remove_unadmitted(event, 'REMOVE <slug>') deletes, for each team of the event whose checked_in_at
-- is null: its login (the auth.users row; on Supabase that cascades to auth.identities, auth.sessions and their
-- refresh tokens, auth.mfa_factors and auth.one_time_tokens), its account (accounts.user_id on delete cascade), the
-- team row and everything that references it. Every foreign key to public.teams is "on delete cascade" except
-- roster.team_id and raises.funded_by ("on delete set null"): the uploaded team list is kept, only unlinked. The
-- team's starting-cash ledger transactions are removed whole and the exchange's cash is given back, so money stays
-- conserved. Admitted teams, staff accounts and other events are never touched.
--
-- Only an organiser, only before the squad draw, only with desk check-in on, only while the draw uses the checked-in
-- teams (switch draw_checked_in: with it off every card would be drawn, and the tracks no longer have equal numbers of
-- cards). A second run removes nothing. events.unadmitted_removed_at records that it ran: the desk then says "No free
-- card — all unused cards were removed" (walk-ins can no longer get a card).
--
-- Reset to new (085/087) rebuilds the event from its saved seed payload: the removed cards are taken out of that
-- payload too (and the payload is marked "unadmitted_removed", which lets seed_event accept tracks of unequal size),
-- so a later reset rebuilds only the cards that remain, with their logins, and keeps unadmitted_removed_at.

alter table public.events add column if not exists unadmitted_removed_at timestamptz;

create or replace function public.remove_unadmitted(p_event uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_teams uuid[];
  v_codes text[];
  v_users uuid[];
  v_cash bigint;
  v_logins int;
begin
  perform app.require_organiser();
  select * into v_event from public.events where id = p_event for update;
  if v_event.id is null then
    return app.fail('NO_EVENT', 'No such event.');
  end if;
  if v_event.drawn_at is not null then
    return app.fail('DRAWN', 'The squads have been drawn: teams can no longer be removed.');
  end if;
  if not v_event.desk_check_in then
    return app.fail('DESK_OFF', 'Desk check-in is off: turn desk check-in on first, so the admitted teams are the ones kept.');
  end if;
  if not app.feature_on(p_event, 'draw_checked_in') then
    return app.fail('DRAW_ALL', 'The squad draw is set to draw every card: turn on "Squad draw uses only checked-in teams" first.');
  end if;
  if p_confirm is distinct from 'REMOVE ' || v_event.slug then
    return app.fail('CONFIRM', format('Type REMOVE %s exactly to remove the teams not admitted.', v_event.slug));
  end if;

  -- The cards nobody admitted, locked (a check-in running at the same moment either wins, and its team is kept, or
  -- waits and then finds no card).
  select coalesce(array_agg(t.id), '{}'), coalesce(array_agg(t.code), '{}') into v_teams, v_codes
    from (select x.id, x.code from public.teams x
           where x.event_id = p_event and x.checked_in_at is null
           order by x.code for update) t;

  if exists (select 1 from public.ledger_entries l where l.team_id = any (v_teams) and l.kind <> 'STARTING_CASH') then
    return app.fail('HAS_GAME_DATA', 'Some of these teams already have game money movements: nothing was removed.');
  end if;

  -- Their logins: team accounts only (a staff account has no team).
  select coalesce(array_agg(a.user_id), '{}') into v_users
    from public.accounts a where a.team_id = any (v_teams) and a.role = 'TEAM';
  v_logins := cardinality(v_users);
  select coalesce(sum(t.cash_cents), 0) into v_cash from public.teams t where t.id = any (v_teams);

  insert into public.audit_log (event_id, actor_user_id, actor_role, action, entity, entity_id, before)
  values (p_event, auth.uid(), 'organiser', 'remove_unadmitted', 'events', p_event::text,
          jsonb_build_object('slug', v_event.slug, 'teams', cardinality(v_teams), 'logins', v_logins, 'codes', to_jsonb(v_codes)));

  perform set_config('app.allow_purge', 'on', true);
  update public.roster set team_id = null where team_id = any (v_teams);
  delete from public.ledger_entries l
   where l.txn_id in (select l2.txn_id from public.ledger_entries l2 where l2.team_id = any (v_teams));
  update public.events set exchange_cash_cents = exchange_cash_cents + v_cash, unadmitted_removed_at = coalesce(unadmitted_removed_at, now())
   where id = p_event;
  delete from auth.users u where u.id = any (v_users);
  delete from public.accounts a where a.team_id = any (v_teams);
  delete from public.teams t where t.id = any (v_teams);
  perform set_config('app.allow_purge', 'off', true);

  -- A later reset to new rebuilds only the cards that remain.
  update app.seed_payloads sp
     set payload = sp.payload
           || jsonb_build_object('unadmitted_removed', true)
           || jsonb_build_object('teams', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(sp.payload -> 'teams') with ordinality j(x, o)
                                                     where not (x ->> 'code' = any (v_codes))), '[]'::jsonb))
   where sp.slug = v_event.slug;

  if cardinality(v_teams) > 0 then
    perform app.log_event(p_event, 'CONTROL', format('Removed %s teams not admitted at the desk (%s logins)', cardinality(v_teams), v_logins));
  end if;
  return app.ok(jsonb_build_object('teams', cardinality(v_teams), 'logins', v_logins));
end
$$;
revoke all on function public.remove_unadmitted(uuid, text) from public, anon;
grant execute on function public.remove_unadmitted(uuid, text) to authenticated;

-- seed_event: a payload whose unadmitted cards were removed may have tracks of unequal size (and fewer than 3).
select app.patch_functions(
$o$  if not (v_n_product = v_n_consulting and v_n_consulting = v_n_finance) then$o$,
$n$  if not (v_n_product = v_n_consulting and v_n_consulting = v_n_finance) and not coalesce((p ->> 'unadmitted_removed')::boolean, false) then$n$, 1);
select app.patch_functions(
$o$  if v_n_product not between 3 and 200 then$o$,
$n$  if v_n_product not between 3 and 200 and not coalesce((p ->> 'unadmitted_removed')::boolean, false) then$n$, 1);

-- Reset to new keeps the record that the unadmitted cards were removed.
select app.patch_functions(
$o$         seed_commitment = coalesce(v_event.seed_commitment, seed_commitment)$o$,
$n$         seed_commitment = coalesce(v_event.seed_commitment, seed_commitment), unadmitted_removed_at = v_event.unadmitted_removed_at$n$, 1);

-- The desk, once the unused cards are gone.
select app.patch_functions(
$o$      return app.fail('NO_FREE_CARD', 'Every login card of this track is already checked in.');$o$,
$n$      return app.fail('NO_FREE_CARD', case when (select e.unadmitted_removed_at from public.events e where e.id = p_event) is not null
        then 'No free card — all unused cards were removed.' else 'Every login card of this track is already checked in.' end);$n$, 1);

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20270106000101'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
