// The Round 3 draft clock (rpc draft_clock, migration 077): with one queue per sector, the company on the clock in
// each sector. Draft picks no longer reach the projector over realtime, so the board polls while a draft runs.
// Tolerant: a database without the function, or odd rows, give no heads and the board shows the single queue.

/** How often the projector re-reads the draft while it runs. */
export const DRAFT_POLL_MS = 3_000;

export interface DraftHead {
  sector: string;
  ticker: string;
  closes_at: string;
  /** Where the company on the clock picks among its sector's pickers, and how many pickers there are (088). */
  place?: number;
  queue?: number;
  /** The sector's companies beyond its pickers: each is given a statement at random when the pickers are done (088). */
  others?: number;
}

/** The heads of the sector queues, by sector name. */
export function parseDraftHeads(data: unknown): DraftHead[] {
  const heads = (data as { heads?: unknown } | null)?.heads;
  if (!Array.isArray(heads)) return [];
  const out: DraftHead[] = [];
  for (const h of heads as Record<string, unknown>[]) {
    if (!h || typeof h.sector !== "string" || typeof h.ticker !== "string" || typeof h.closes_at !== "string") continue;
    if (Number.isNaN(Date.parse(h.closes_at))) continue;
    const head: DraftHead = { sector: h.sector, ticker: h.ticker, closes_at: h.closes_at };
    for (const k of ["place", "queue", "others"] as const) if (typeof h[k] === "number") head[k] = h[k] as number;
    out.push(head);
  }
  return out.sort((a, b) => a.sector.localeCompare(b.sector));
}

/** Same sector? (case and spaces ignored, as the statements' sectors are typed by hand) */
export function sameSector(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}
