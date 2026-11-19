-- The crisis is sealed until hiring closes.
--
-- Until now a sub-round dealt every company its crisis card and the card was readable at once, so a company knew what
-- it was facing before it hired a firm, and the firms knew what they were bidding on. Teams shopped for a specialist
-- in the exact crisis they had drawn, which made hiring a lookup rather than a judgement.
--
-- Now nobody in the event sees a card until that sub-round's hiring window has closed: the hire is made blind, on the
-- firm's track record and its pitch, and the crisis lands on everybody at the same moment. Staff still see the cards
-- throughout, because the organisers need them to run the night, and the display role is unchanged.
--
-- The reveal itself is untouched: the cards are still dealt when the sub-round opens, every price still falls 5% and
-- the bulletin still announces it. Only the reading of the card waits. Because the crisis_cards deck is readable in a
-- PRIMUS event only through a row of subround_crises, hiding that row hides the card's text with it.

create or replace function app.hiring_closed(p_event uuid, p_k int)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subrounds s
     where s.event_id = p_event and s.k = p_k and s.hiring_closed_at is not null)
$$;
revoke all on function app.hiring_closed(uuid, int) from public, anon;
grant execute on function app.hiring_closed(uuid, int) to authenticated;

drop policy if exists subround_crises_read on public.subround_crises;
create policy subround_crises_read on public.subround_crises for select to authenticated
  using ((select app.is_staff())
     or (event_id = (select app.my_event_id()) and app.hiring_closed(event_id, k)));

create or replace function public.schema_version()
returns text
language sql immutable
set search_path = ''
as $$ select '20261129000063'::text $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
