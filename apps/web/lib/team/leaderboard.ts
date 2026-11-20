// The live leaderboard (PRIMUS Rating, switch `leaderboard`): read from the database's `leaderboard` function, one row per
// company: its rating (from 1,000; each released score moves it), its rank and how many places it moved at the last
// release (`change`: positive = up). Read defensively: if the function is missing or fails, or no score has been
// released, the team screens show that the leaderboard opens after the first scores.

import type { SupabaseClient } from "@supabase/supabase-js";
import { count } from "@/lib/format";

export interface LeaderRow {
  company_id: string;
  ticker: string | null;
  name: string | null;
  sector: string | null;
  rating: number;
  rank: number;
  /** Places moved at the last release (positive: up), or null. */
  change: number | null;
  /** Released scores counted in the rating. */
  rounds: number;
}

export const LEADERBOARD_CLOSED = "The leaderboard opens after the first scores are released.";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The rows the function returned, checked field by field; rows without a company, rating or rank are dropped. */
export function parseLeaderboard(data: unknown): LeaderRow[] {
  if (!Array.isArray(data)) return [];
  const rows: LeaderRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = text(r.company_id);
    const rating = num(r.rating);
    const rank = num(r.rank);
    if (!id || rating === null || rank === null) continue;
    const change = num(r.change);
    rows.push({ company_id: id, ticker: text(r.ticker), name: text(r.name), sector: text(r.sector), rating, rank, change, rounds: num(r.rounds) ?? 0 });
  }
  return rows.sort((a, b) => a.rank - b.rank || b.rating - a.rating || (a.ticker ?? "").localeCompare(b.ticker ?? ""));
}

/** The leaderboard is open once a score has been released (some row counts at least one). */
export const leaderboardOpen = (rows: readonly LeaderRow[]): boolean => rows.some((r) => r.rounds > 0);

/** "▲3", "▼2" or "" (no move, or not known). */
export function moveText(change: number | null): string {
  if (!change) return "";
  return change > 0 ? `▲${count(change)}` : `▼${count(-change)}`;
}

/** The header badge: "Rating 1,034 · #12 ▲3". */
export function badgeText(row: Pick<LeaderRow, "rating" | "rank" | "change">): string {
  const move = moveText(row.change);
  return `Rating ${count(Math.round(row.rating))} · #${count(row.rank)}${move ? ` ${move}` : ""}`;
}

/** The leaderboard rows, or null when the function failed (missing on an older database, or an error). */
export async function loadLeaderboard(sb: SupabaseClient, eventId: string): Promise<LeaderRow[] | null> {
  try {
    const { data, error } = await sb.rpc("leaderboard", { p_event: eventId });
    if (error) return null;
    return parseLeaderboard(data);
  } catch {
    return null;
  }
}
