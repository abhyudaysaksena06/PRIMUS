// The PRIMUS Rating leaderboard (rpc `leaderboard`, the live-leaderboard migration): rows for the admin tab and the
// projector's bottom reel. Pure and tolerant: a database without the function, or odd rows, never break a screen.

export interface LeaderboardRow {
  company_id: string;
  ticker: string;
  name: string;
  sector: string | null;
  rating: number;
  rank: number;
  /** Movement since the previous release, as the database reports it (positive = up). */
  change: number;
  /** Released rounds counted so far. */
  rounds: number;
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** The rows, best first (rank, then rating); rows without a company or ticker are dropped. */
export function parseLeaderboard(data: unknown): LeaderboardRow[] {
  if (!Array.isArray(data)) return [];
  const rows: LeaderboardRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r.company_id !== "string" || typeof r.ticker !== "string" || !r.ticker) continue;
    rows.push({
      company_id: r.company_id,
      ticker: r.ticker,
      name: typeof r.name === "string" ? r.name : r.ticker,
      sector: typeof r.sector === "string" ? r.sector : null,
      rating: num(r.rating, 1000),
      rank: num(r.rank, Number.MAX_SAFE_INTEGER),
      change: num(r.change),
      rounds: num(r.rounds),
    });
  }
  return rows.sort((a, b) => a.rank - b.rank || b.rating - a.rating || a.ticker.localeCompare(b.ticker));
}

/** Did the call fail only because this database has no `leaderboard` function yet? */
export function leaderboardMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "");
}

/** "▲ 3", "▼ 2" or "—". */
export function changeText(change: number): string {
  if (!change) return "—";
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}`;
}

/** A Rating as shown: whole points with thousands separators ("1,042"). */
export function ratingText(rating: number): string {
  return Math.round(rating).toLocaleString("en-US");
}
