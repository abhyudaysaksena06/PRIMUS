// The crisis room (PRIMUS Rounds 2 and 3): which sub-round is under way, its timeline, whether hiring, writing and
// rating are open, what each side of an offer may do, and where the Round 3 draft stands. Pure: the page reads the
// rows (lib/team/crisis-data.ts) and these functions decide what it shows. The database enforces every rule again.

import { equityText } from "./equity";
import { subroundName, type DeadlineCode, type PhaseCode } from "@msim/engine";
import { deadlinePassed, type PauseState } from "./squad";

export type Deadlines = Partial<Record<DeadlineCode, string>>;

/** The time of sub-round k's step (HIRE, DUE, RATE or REVEAL), or null. */
export function stepAt(d: Deadlines, step: "REVEAL" | "HIRE" | "DUE" | "RATE", k: number): string | null {
  return d[`${step}_${k}` as DeadlineCode] ?? null;
}

export interface SubroundRow {
  k: number;
  revealed_at: string | null;
  hiring_closed_at: string | null;
  due_closed_at: string | null;
  rated_at: string | null;
}

export interface OfferRow {
  id: string;
  k: number;
  company_id: string;
  firm_team_id: string;
  cash_cents: number;
  shares: number;
  note: string;
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | "LAPSED";
  turn: "FIRM" | "COMPANY";
  /** Who sent the first offer: the company, or a firm pitching it (migration 62). */
  opened_by: "COMPANY" | "FIRM";
  company_counters: number;
  firm_counters: number;
  updated_at: string;
}

export interface EngagementRow {
  id: string;
  k: number;
  company_id: string;
  firm_team_id: string;
  cash_cents: number;
  shares: number;
  escrow: "HELD" | "RELEASED" | "REFUNDED";
  rating: number | null;
  rating_default: boolean;
  bonus_cents: number | null;
}

export interface DraftPickRow {
  company_id: string;
  pick_no: number;
  score_avg: number;
  opens_at: string;
  closes_at: string;
  statement_id: string | null;
  picked_at: string | null;
  by_default: boolean;
  /** The pick's queue when the draft runs by sector (migration 077: the company's sector, lower case); null: one queue. */
  sector?: string | null;
  /**
   * Not a picker (migration 088): beyond the 10 lowest-scoring companies of its sector. It never picks; it is given a
   * statement at random, spread evenly across the sector's statements, when the sector's pickers are done.
   */
  auto?: boolean;
}

/** How many companies of each sector pick in a draft run by sector (app.draft_pickers, migration 088). */
export const DRAFT_PICKERS = 10;

/** The draft rule in words, for the team page, the projector and the admin panel (migration 088). */
export const DRAFT_RULE =
  "The 10 lowest-scoring companies in each sector pick a statement, lowest first, 20 seconds each, each statement once. Every other company in the sector is given a statement at random, spread evenly across the ten.";

export const MAX_COUNTERS = 3;
/** A firm takes at most two clients per sub-round. */
export const FIRM_CLIENTS_PER_SUBROUND = 2;

/** The sub-round under way: in Round 2 the latest revealed crisis, in Round 3 the solution (5); else none. */
export function currentSubround(phase: PhaseCode, subrounds: readonly SubroundRow[]): number | null {
  if (phase === "SATURATION") return 5;
  if (phase !== "PRESSURE") return null;
  const revealed = subrounds.filter((s) => s.k >= 1 && s.k <= 4 && s.revealed_at !== null).map((s) => s.k);
  return revealed.length ? Math.max(...revealed) : null;
}

export interface TimelineStep {
  code: DeadlineCode;
  label: string;
  at: string | null;
  passed: boolean;
}

/** The sub-round's steps in order: the reveal (Round 3: the end of the draft), hiring, due, ratings. */
export function subroundTimeline(k: number, deadlines: Deadlines, nowMs: number, pause: PauseState): TimelineStep[] {
  const steps: [DeadlineCode, string][] = [
    [k === 5 ? "DRAFT" : (`REVEAL_${k}` as DeadlineCode), k === 5 ? "Draft ends" : "Crisis revealed"],
    [`HIRE_${k}` as DeadlineCode, "Hiring closes"],
    [`DUE_${k}` as DeadlineCode, k === 5 ? "Solution due" : "Plan and memo due"],
    [`RATE_${k}` as DeadlineCode, "Ratings close"],
  ];
  return steps.map(([code, label]) => {
    const at = deadlines[code] ?? null;
    return { code, label, at, passed: at !== null && deadlinePassed(at, nowMs, pause) };
  });
}

const passed = (d: Deadlines, code: DeadlineCode, nowMs: number, p: PauseState) => {
  const at = d[code];
  return at !== undefined && deadlinePassed(at, nowMs, p);
};

/** Hiring is open for sub-round k (app.hiring_subround): after the reveal (Round 3: after the draft), before HIRE_k. */
export function hiringOpen(k: number | null, phase: PhaseCode, deadlines: Deadlines, nowMs: number, p: PauseState): boolean {
  if (k === null) return false;
  if (k === 5) return phase === "SATURATION" && passed(deadlines, "DRAFT", nowMs, p) && !passed(deadlines, "HIRE_5", nowMs, p);
  return phase === "PRESSURE" && !passed(deadlines, `HIRE_${k}` as DeadlineCode, nowMs, p);
}

/** A company rates its firm after the due time and until ratings close. */
export function ratingOpen(k: number, deadlines: Deadlines, nowMs: number, p: PauseState): boolean {
  return passed(deadlines, `DUE_${k}` as DeadlineCode, nowMs, p) && !passed(deadlines, `RATE_${k}` as DeadlineCode, nowMs, p);
}

export type OfferSide = "COMPANY" | "FIRM";
export type OfferMove = "ACCEPT" | "DECLINE" | "COUNTER" | "WITHDRAW";

/** What this side may do with an offer now (respond_offer): the side whose turn it is answers; the company withdraws. */
export function offerMoves(o: OfferRow, side: OfferSide, hiring: boolean): OfferMove[] {
  if (o.status !== "OPEN" || !hiring) return [];
  const moves: OfferMove[] = [];
  if (o.turn === side) {
    moves.push("ACCEPT", "DECLINE");
    if (countersLeft(o, side) > 0) moves.push("COUNTER");
  }
  if (side === "COMPANY") moves.push("WITHDRAW");
  return moves;
}

export function countersLeft(o: OfferRow, side: OfferSide): number {
  return Math.max(0, MAX_COUNTERS - (side === "COMPANY" ? o.company_counters : o.firm_counters));
}

export const OFFER_STATUS_TONE = { OPEN: "amber", ACCEPTED: "green", DECLINED: "red", WITHDRAWN: "slate", LAPSED: "slate" } as const;

/** "$1,250.50" or "1250.5" → cents; null when it is not an amount. */
export function parseDollars(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Whole shares from a field (empty is 0); null when it is not a whole number. */
export function parseShares(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[,\s]/g, "");
  if (s === "") return 0;
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

/** Round 3 fees are worth 5–20% of the company's cash (app.offer_problem). */
export function feeBand(cashCents: number): { min: number; max: number } {
  return { min: Math.ceil(cashCents * 0.05), max: Math.floor(cashCents * 0.2) };
}

/** An offer's terms in words, equity first: "5% (5,000 shares)", "$500.00 + 0.1% (100 shares)". */
export function termsText(cash: string, shares: number): string {
  if (shares === 0) return cash;
  const sh = equityText(shares);
  return cash === "$0.00" ? sh : `${cash} + ${sh}`;
}

export interface DraftState {
  /**
   * The pick on the clock in my queue (my sector's when the draft runs by sector; without a company of my own, the
   * first pick still to make), or null when that queue is done or the draft has not started.
   */
  current: DraftPickRow | null;
  mine: DraftPickRow | null;
  myTurn: boolean;
  /** Picks before mine in my queue still to be made (only pickers pick). */
  ahead: number;
  /** Where I pick in my queue (1 = first), and how many pickers the queue has. */
  place: number | null;
  queueSize: number;
  /** My company is not a picker: it is given a statement at random when my sector's pickers are done (088). */
  auto: boolean;
  /** How many companies of my queue are given a statement at random. */
  others: number;
  /** My queue's pickers are all done. */
  pickersDone: boolean;
  /** The draft runs one queue per sector, all at the same time. */
  bySector: boolean;
  /** Every pick has been made (the whole draft, every sector). */
  done: boolean;
}

/** A pick's queue: its sector when the draft runs by sector, else the one queue (""). */
const queueOf = (p: { sector?: string | null }) => p.sector ?? "";

export function draftState(picks: readonly DraftPickRow[], myCompanyId: string | null): DraftState {
  const ordered = [...picks].sort((a, b) => a.pick_no - b.pick_no);
  const bySector = ordered.some((p) => p.sector !== null && p.sector !== undefined);
  const mine = myCompanyId ? (ordered.find((p) => p.company_id === myCompanyId) ?? null) : null;
  const sameQueue = mine ? ordered.filter((p) => queueOf(p) === queueOf(mine)) : ordered;
  const queue = sameQueue.filter((p) => !p.auto);
  const current = queue.find((p) => p.statement_id === null) ?? null;
  const ahead = mine && mine.statement_id === null ? queue.filter((p) => p.statement_id === null && p.pick_no < mine.pick_no).length : 0;
  return {
    current,
    mine,
    myTurn: !!current && !!mine && !mine.auto && current.company_id === mine.company_id,
    ahead,
    place: mine && !mine.auto ? queue.indexOf(mine) + 1 : null,
    queueSize: queue.length,
    auto: !!mine?.auto,
    others: sameQueue.length - queue.length,
    pickersDone: queue.length > 0 && queue.every((p) => p.statement_id !== null),
    bySector,
    done: ordered.length > 0 && ordered.every((p) => p.statement_id !== null),
  };
}

/**
 * The pick on the clock in every queue (one per sector when the draft runs by sector), with its queue's number of
 * pickers, the pickers still to pick, and how many others the sector has (given a statement at random, 088).
 */
export function draftHeads<T extends Pick<DraftPickRow, "company_id" | "pick_no" | "statement_id" | "sector" | "auto">>(
  picks: readonly T[],
): { pick: T; queue: string; place: number; size: number; left: number; others: number }[] {
  const ordered = [...picks].sort((a, b) => a.pick_no - b.pick_no);
  const queues = [...new Set(ordered.map(queueOf))].sort();
  return queues.flatMap((q) => {
    const inQueue = ordered.filter((p) => queueOf(p) === q);
    const all = inQueue.filter((p) => !p.auto);
    const head = all.find((p) => p.statement_id === null);
    return head
      ? [{ pick: head, queue: q, place: all.indexOf(head) + 1, size: all.length, left: all.filter((p) => p.statement_id === null).length, others: inQueue.length - all.length }]
      : [];
  });
}

/**
 * The draft can end before its deadline (every company has picked). Hiring and writing for Round 3 open at that
 * moment (app.subround_open), so the screens count the draft's end from then: the deadlines with DRAFT brought
 * forward to just before now.
 */
export function withDraftEnd(deadlines: Deadlines, picks: readonly DraftPickRow[], nowMs: number): Deadlines {
  const over = picks.length > 0 && picks.every((p) => p.statement_id !== null);
  if (!over || !deadlines.DRAFT || Date.parse(deadlines.DRAFT) <= nowMs) return deadlines;
  return { ...deadlines, DRAFT: new Date(nowMs - 1000).toISOString() };
}

/** Same sector, ignoring case and spaces (as app.norm_sector). */
export const sameSector = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The statements this company may draft: its own sector's when the statements have sectors, else all. */
export function draftableStatements<T extends { sector: string | null }>(statements: readonly T[], mySector: string | null): T[] {
  if (!statements.some((s) => s.sector)) return [...statements];
  return statements.filter((s) => sameSector(s.sector, mySector));
}

/** How many companies picked each statement. */
export function statementCounts(picks: readonly DraftPickRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of picks) if (p.statement_id) m.set(p.statement_id, (m.get(p.statement_id) ?? 0) + 1);
  return m;
}

export interface StatementGroup {
  id: string;
  number: number;
  title: string;
  cap: number;
  /** The companies on this statement, the highest score so far first. */
  companies: { id: string; label: string; scoreAvg: number; mine: boolean }[];
}

/** Who competes with whom: each statement with the companies that picked it (or were given it). */
export function statementGroups(
  statements: readonly { id: string; number: number; title: string; cap: number }[],
  picks: readonly DraftPickRow[],
  label: (companyId: string) => string,
  myCompanyId: string | null = null,
): StatementGroup[] {
  return statements.map((s) => ({
    id: s.id,
    number: s.number,
    title: s.title,
    cap: s.cap,
    companies: picks
      .filter((p) => p.statement_id === s.id)
      .map((p) => ({ id: p.company_id, label: label(p.company_id), scoreAvg: p.score_avg, mine: p.company_id === myCompanyId }))
      .sort((a, b) => b.scoreAvg - a.scoreAvg || a.label.localeCompare(b.label)),
  }));
}

/**
 * A statement's crowd, in words. Since migration 064 sharing a statement no longer splits the price move: each
 * company's solution moves its own price, a rise scaled by its standing going into Round 3 (app.release_tier_bp).
 */
export function shareText(n: number): string {
  if (n <= 0) return "Nobody here yet.";
  if (n === 1) return "1 company here.";
  return `${n} companies here: each is judged on its own solution, and sharing a statement does not cut anyone's price move.`;
}

/** 1 → "1st", 2 → "2nd"… */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** The sub-rounds to list in the history: every one before k that has started. */
export function pastSubrounds(k: number | null, subrounds: readonly SubroundRow[]): number[] {
  return subrounds
    .filter((s) => (k === null || s.k < k) && (s.revealed_at !== null || s.k === 5) && s.k !== k)
    .filter((s) => s.k < 5)
    .map((s) => s.k)
    .sort((a, b) => b - a);
}

export const subroundTitle = (k: number) => (k === 5 ? "Round 3 · the solution" : `Round 2 · ${subroundName(k)}`);

/**
 * Is sub-round k's crisis card still sealed? A card is dealt when the sub-round opens but nobody in the event may read
 * it until that sub-round's hiring window has closed, so the hire is made blind. The database enforces this (the card
 * simply is not there to read); this only tells the screens to say "sealed" rather than "none dealt yet".
 */
export function crisisSealed(subrounds: readonly SubroundRow[], k: number): boolean {
  const s = subrounds.find((r) => r.k === k);
  return !!s && s.revealed_at !== null && s.hiring_closed_at === null;
}
