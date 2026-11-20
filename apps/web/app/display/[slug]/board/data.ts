// What the ticker board reads, as the display account (RLS: companies are public from READING; rounds, round prices
// and phases always). Two queries in parallel: the companies, and the last cleared round with its clearing rows
// embedded (a round_prices row with a round is a CLEARING row). Before READING only the planned start of READING.

import { supabaseServer } from "@/lib/supabase/server";
import type { BoardCompany, BoardMoveRow } from "@/lib/display/board";
import { parseDisplayTeams, type DisplayTeam, type UpdateHire, type UpdateMove } from "@/lib/display/rotation";

export interface BoardRound {
  number: number;
  cleared_at: string | null;
  round_prices: BoardMoveRow[];
}

export interface BoardData {
  companies: BoardCompany[];
  /** The most recently cleared round (null before any round has cleared). */
  round: BoardRound | null;
}

export async function loadBoard(eventId: string): Promise<BoardData> {
  const sb = await supabaseServer();
  const [companies, round] = await Promise.all([
    sb.from("companies").select("id, ticker, name, ipo_price, market_price, closing_price").eq("event_id", eventId).not("ticker", "is", null),
    sb
      .from("rounds")
      .select("number, cleared_at, round_prices(company_id, market_before, market_after, buy_qty, sell_qty, short_qty, cover_qty)")
      .eq("event_id", eventId)
      .eq("status", "CLEARED")
      .eq("round_prices.kind", "CLEARING")
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle<BoardRound>(),
  ]);
  for (const r of [companies, round]) if (r.error) throw new Error(`Could not read the board: ${r.error.message}`);
  return { companies: (companies.data ?? []) as BoardCompany[], round: round.data ?? null };
}

/**
 * What the sector columns read on top of the board: each listed company's sector (public.company_sectors, which joins
 * the squads, so only drawn companies have one), the recorded price moves (newest first) and the hires (never the
 * firm: team names stay hidden). Null when the sectors cannot be read (an older database): the screen keeps the tiles.
 */
export interface SectorBoardData {
  sectors: Map<string, string>;
  moves: UpdateMove[];
  hires: UpdateHire[];
}

/** The newest rows read: a full night is about 15 moves a company, so this covers 600 companies' latest. */
const UPDATES_READ = 10_000;

export async function loadSectorBoard(eventId: string): Promise<SectorBoardData | null> {
  const sb = await supabaseServer();
  const [sec, moves, hires] = await Promise.all([
    sb.rpc("company_sectors", { p_event: eventId }),
    sb
      .from("round_prices")
      .select("company_id, kind, subround, tier_bp, market_before, market_after, created_at, rounds(number)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(UPDATES_READ),
    sb.from("engagements").select("company_id, k, created_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(UPDATES_READ),
  ]);
  if (sec.error) return null;
  const sectors = new Map(
    ((sec.data ?? []) as { company_id: string; sector: string | null }[]).filter((r) => r.sector?.trim()).map((r) => [r.company_id, r.sector!]),
  );
  type MoveRow = Omit<UpdateMove, "round"> & { rounds: { number: number } | null };
  // A failed read of the moves or the hires leaves the updates out, never the columns.
  return {
    sectors,
    moves: moves.error
      ? []
      : ((moves.data ?? []) as unknown as MoveRow[]).map(({ rounds, ...m }) => ({
          ...m,
          market_before: m.market_before === null ? null : Number(m.market_before),
          market_after: Number(m.market_after),
          round: rounds?.number ?? null,
        })),
    hires: hires.error ? [] : ((hires.data ?? []) as UpdateHire[]),
  };
}

/** The Teams spotlight's list (public.display_teams, migration 092); null on an older database or a failed read. */
export async function loadDisplayTeams(eventId: string): Promise<DisplayTeam[] | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("display_teams", { p_event: eventId });
  return error ? null : parseDisplayTeams(data);
}

/** When READING is planned to start (phases.starts_at; it moves with a pause or an extension). */
export async function loadReadingStart(eventId: string): Promise<string | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb.from("phases").select("starts_at").eq("event_id", eventId).eq("code", "READING").maybeSingle<{ starts_at: string }>();
  if (error) throw new Error(`Could not read the schedule: ${error.message}`);
  return data?.starts_at ?? null;
}
