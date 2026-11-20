// What the crisis pop-ups need (switch crisis_popup; app/team/crisis-splash.tsx), read as the team on a PRIMUS
// event's Round 2: the crisis under way (the latest revealed sub-round), its card once hiring has closed (the card is
// sealed until then, migration 063, so RLS returns it only from that moment), and, in the first minutes after the
// reveal, the category every company shares (public.crisis_category) and when the cards open (HIRE_k).

import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { SHOW_FOR_MS, type CrisisPopups, type SplashCard } from "@/lib/team/crisis-popup";

type CardRow = { category: string; title: string; body: string };

/** The latest revealed crisis (1–4) and when its hiring closed; read by every team (RLS: its own event). */
export async function loadCrisisPopups(
  ctx: Pick<TeamContext, "team" | "event" | "status" | "company">,
  deadlines: readonly { code: string; at: string }[] | null,
): Promise<{ card: SplashCard | null; popups: CrisisPopups }> {
  const { team, event, status } = ctx;
  const none = { card: null, popups: { reveal: null, track: team.track, dueAt: null } };
  const sb = await supabaseServer();
  const { data: sr } = await sb
    .from("subrounds")
    .select("k, revealed_at, hiring_closed_at")
    .eq("event_id", event.id)
    .not("revealed_at", "is", null)
    .lte("k", 4)
    .order("k", { ascending: false })
    .limit(1)
    .maybeSingle<{ k: number; revealed_at: string; hiring_closed_at: string | null }>();
  if (!sr) return none;
  const at = (code: string) => deadlines?.find((d) => d.code === code)?.at ?? null;
  const popups: CrisisPopups = { reveal: null, track: team.track, dueAt: at(`DUE_${sr.k}`) };

  // The card: once hiring has closed, for the squad's company, while this crisis is the current one.
  let card: SplashCard | null = null;
  if (sr.hiring_closed_at && ctx.company) {
    const { data: dealt } = await sb
      .from("subround_crises")
      .select("k, crisis_cards(category, title, body)")
      .eq("company_id", ctx.company.id)
      .eq("k", sr.k)
      .maybeSingle<{ k: number; crisis_cards: CardRow | CardRow[] | null }>();
    const c = dealt ? (Array.isArray(dealt.crisis_cards) ? dealt.crisis_cards[0] : dealt.crisis_cards) : null;
    if (c) card = { eventId: event.id, teamId: team.id, k: sr.k, category: c.category, title: c.title, body: c.body, revealedAt: sr.revealed_at };
  }

  // The reveal: only while hiring is open, and only in its first minutes (the pop-up shows for 2 minutes).
  const age = Date.parse(status.server_time) - Date.parse(sr.revealed_at);
  if (!sr.hiring_closed_at && age >= -5_000 && age <= SHOW_FOR_MS + 30_000) {
    const { data: category, error } = await sb.rpc("crisis_category", { p_event: event.id, p_k: sr.k });
    popups.reveal = {
      eventId: event.id,
      teamId: team.id,
      k: sr.k,
      revealedAt: sr.revealed_at,
      category: !error && typeof category === "string" && category !== "" ? category : null,
      cardsOpenAt: at(`HIRE_${sr.k}`),
      tradingAt: status.trading !== "OPEN" ? (status.next_round?.opens_at ?? null) : null,
    };
  }
  return { card, popups };
}
