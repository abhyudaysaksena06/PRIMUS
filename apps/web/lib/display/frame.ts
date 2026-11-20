// What every frame of the big screen needs, read as the display account (RLS: the public set only, never a team's
// private rows): the event, where it is (event_status), the latest bulletin and the moments that start takeovers.

import { cache } from "react";
import { notFound } from "next/navigation";
import type { PhaseCode } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { loadEventStatus, type EventStatus } from "@/lib/event-status";
import { isVerdictType, type TakeoverMoments, type VerdictType } from "./takeover";

/** PostgREST returns at most 1,000 rows per request: reads that can be longer are taken in pages. */
export const PAGE_ROWS = 1000;

/** Every row of a read that may exceed one page (`page(from, to)` reads rows from..to inclusive, in a stable order). */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageRows = PAGE_ROWS,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += pageRows) {
    const r = await page(from, from + pageRows - 1);
    if (r.error) return { data: out, error: r.error };
    const rows = r.data ?? [];
    out.push(...rows);
    if (rows.length < pageRows) return { data: out, error: null };
  }
}

export interface DisplayEvent {
  id: string;
  slug: string;
  name: string;
  is_rehearsal: boolean;
  clock_speed: number;
  current_phase: PhaseCode;
  phase_started_at: string | null;
  seed_commitment: string | null;
  seed_revealed: string | null;
  dice: string | null;
  drawn_at: string | null;
  crisis_applied_at: string | null;
  market_closed_at: string | null;
  /** CLASSIC or PRIMUS (Rounds 2 and 3 as crisis sub-rounds and the draft). */
  format: "CLASSIC" | "PRIMUS";
}

export interface DisplayBulletin {
  id: string;
  kind: string;
  title: string;
  body: string;
  published_at: string;
}

export interface DisplayFrame {
  event: DisplayEvent;
  status: EventStatus;
  bulletin: DisplayBulletin | null;
  moments: TakeoverMoments;
}

export const loadDisplayEvent = cache(async (slug: string): Promise<DisplayEvent> => {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("events")
    .select(
      "id, slug, name, is_rehearsal, clock_speed, current_phase, phase_started_at, seed_commitment, seed_revealed, dice, drawn_at, crisis_applied_at, market_closed_at, format",
    )
    .eq("slug", slug)
    .maybeSingle<DisplayEvent>();
  if (error) throw new Error(`Could not read the event: ${error.message}`);
  if (!data) notFound();
  return data;
});

export async function loadDisplayFrame(slug: string): Promise<DisplayFrame> {
  const event = await loadDisplayEvent(slug);
  const sb = await supabaseServer();
  const [status, latest, released, flash, reveals] = await Promise.all([
    loadEventStatus(event.id),
    sb
      .from("bulletins")
      .select("id, kind, title, body, published_at")
      .eq("event_id", event.id)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle<DisplayBulletin>(),
    // RLS shows released scores only. One row per company and type: at 200 companies and PRIMUS's types, thousands.
    readAllPages<{ type: string; released_at: string }>((from, to) =>
      sb.from("scores").select("type, released_at").eq("event_id", event.id).not("released_at", "is", null).order("id").range(from, to),
    ),
    sb
      .from("bulletins")
      .select("published_at")
      .eq("event_id", event.id)
      .eq("kind", "FLASH")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ published_at: string }>(),
    // PRIMUS: when each crisis sub-round was revealed (none on a classic night).
    sb.from("subrounds").select("k, revealed_at").eq("event_id", event.id).not("revealed_at", "is", null).lte("k", 4),
  ]);
  for (const r of [latest, released, flash, reveals]) if (r.error) throw new Error(`Could not read the screen: ${r.error.message}`);

  const firstRelease = new Map<VerdictType, string>();
  for (const s of released.data) {
    // Memos and advice move no price: their release does not take the screen.
    if (!isVerdictType(s.type)) continue;
    const seen = firstRelease.get(s.type);
    // The release itself (every score of a type is released in one transaction); a later re-release of a single
    // score after an appeal does not bring the verdicts back.
    if (!seen || Date.parse(s.released_at) < Date.parse(seen)) firstRelease.set(s.type, s.released_at);
  }
  return {
    event,
    status,
    bulletin: latest.data ?? null,
    moments: {
      drawnAt: event.drawn_at,
      crisisAt: event.crisis_applied_at,
      reveals: ((reveals.data ?? []) as { k: number; revealed_at: string }[]).map((r) => ({ k: r.k, at: r.revealed_at })),
      verdicts: [...firstRelease].map(([type, at]) => ({ type, at })),
      flashAt: flash.data?.published_at ?? null,
      closedAt: event.market_closed_at,
      awardsAt: event.current_phase === "AWARDS" ? (event.phase_started_at ?? status.server_time) : null,
    },
  };
}
