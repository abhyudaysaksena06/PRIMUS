// The projector's two views from READING on, switched by hand on the screen (a corner toggle or the "T" key, kept per
// screen in the browser): SECTORS, the screen split into one column per sector of the squad draw, each column listing
// its companies with their latest update and paging so that every company is shown in turn; and TEAMS, a spotlight
// of one registered entry at a time, SPOTLIGHT_MS each, looping through all of them. Pages and cards follow the server
// clock, so every projector on the same view shows the same page and card, and a reload carries on. Pure.

import { divRoundHalfUp } from "@msim/engine";
import { pageIndex, type BoardTile } from "./board";

// ───────────────────────────── The timings (all in one place) ─────────────────────────────

/** How long one spotlight card stays on screen in the Teams view. */
export const SPOTLIGHT_MS = 5_000;
/** The window a sector column pages through all its pages in (each page between the two bounds below). */
export const COLUMNS_WINDOW_MS = 5 * 60_000;
/** A sector column's page stays at least this long (readable from the back of the hall)… */
export const COLUMN_PAGE_MIN_MS = 8_000;
/** …and at most this long (when there are few pages, they still turn). */
export const COLUMN_PAGE_MAX_MS = 15_000;
/** The view toggle shows for this long after the mouse moves, then hides (it must not show on the projected image). */
export const TOGGLE_HIDE_MS = 3_000;

// ───────────────────────────── The view toggle ─────────────────────────────

export type ScreenView = "sectors" | "teams";
export const DEFAULT_VIEW: ScreenView = "sectors";
/** The browser storage key of the chosen view (per screen). */
export const VIEW_STORAGE_KEY = "primus.display.view";

/** A stored value read back: anything but a known view is the default. */
export function parseView(stored: string | null | undefined): ScreenView {
  return stored === "teams" || stored === "sectors" ? stored : DEFAULT_VIEW;
}

export const otherView = (v: ScreenView): ScreenView => (v === "sectors" ? "teams" : "sectors");

/** The key that toggles the view: T (either case), not with a modifier (Ctrl+T and the like stay the browser's). */
export function isToggleKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return (e.key === "t" || e.key === "T") && !e.ctrlKey && !e.metaKey && !e.altKey;
}

// ───────────────────────────── Paging ─────────────────────────────

/** The spotlight card on screen at server time `nowMs` of `count`: a new one every SPOTLIGHT_MS, looping. */
export function spotlightIndex(nowMs: number, count: number, cardMs = SPOTLIGHT_MS): number | null {
  if (count <= 0) return null;
  return pageIndex(nowMs, count, cardMs);
}

/**
 * How long each page of a column with `pages` pages stays, so that all its pages are shown within
 * COLUMNS_WINDOW_MS: the window ÷ pages, between COLUMN_PAGE_MIN_MS and COLUMN_PAGE_MAX_MS.
 */
export function columnPageMs(pages: number, windowMs = COLUMNS_WINDOW_MS): number {
  if (pages <= 1) return windowMs;
  return Math.min(COLUMN_PAGE_MAX_MS, Math.max(COLUMN_PAGE_MIN_MS, Math.floor(windowMs / pages)));
}

/** The page of a column on screen at server time `nowMs`: every page in turn, the same on every screen. */
export function columnPageAt(nowMs: number, pages: number, windowMs = COLUMNS_WINDOW_MS): number {
  return pageIndex(nowMs, pages, columnPageMs(pages, windowMs));
}

// ───────────────────────────── Column density ─────────────────────────────

export type ColumnDensity = "roomy" | "dense";

export interface ColumnLayout {
  density: ColumnDensity;
  /** Rows on one page of the column. */
  rows: number;
}

/**
 * Rows a column holds per page: roomy two-line rows (price and the latest update under it) while every sector fits
 * on one page of roomy rows, else dense one-line rows. `compact`: less height (a bulletin or the pause strip shows).
 * Every column of the screen uses the same layout, so the rows line up across the columns.
 */
export function columnLayout(largestSector: number, compact = false): ColumnLayout {
  const roomy = compact ? 6 : 8;
  return largestSector <= roomy ? { density: "roomy", rows: roomy } : { density: "dense", rows: compact ? 13 : 16 };
}

// ───────────────────────────── The latest update of a company ─────────────────────────────

/** A recorded price move as the display reads it (public: round_prices). */
export interface UpdateMove {
  company_id: string;
  kind: string;
  subround: number | null;
  tier_bp: number | null;
  market_before: number | null;
  market_after: number;
  created_at: string;
  /** For a CLEARING row: the round's number. */
  round: number | null;
}

/** A hire (public to the display: engagements), never the firm's name (team names stay hidden until AWARDS). */
export interface UpdateHire {
  company_id: string;
  k: number;
  created_at: string;
}

export interface CompanyUpdate {
  /** What happened, for the room: "Crisis 2 plan verdict", "Round 3 cleared", "Hired a firm · Crisis 1". */
  text: string;
  /** The move it made, in basis points of the price before (half-up); null when it moved no price. */
  moveBp: number | null;
  at: string;
}

const crisisOf = (k: number | null) => (k === 5 ? "Round 3" : k ? `Crisis ${k}` : "Crisis");

/** The words for a recorded move. */
export function moveText(m: Pick<UpdateMove, "kind" | "subround" | "round">): string {
  switch (m.kind) {
    case "IPO":
      return "Listed · IPO price set";
    case "CLEARING":
      return m.round ? `Round ${m.round} cleared` : "Round cleared";
    case "CRISIS":
      return "Crisis shock";
    case "SUB_SHOCK":
      return `${crisisOf(m.subround)} revealed`;
    case "SUB_TIER":
      return m.subround === 5 ? "Solution verdict released" : `${crisisOf(m.subround)} plan verdict released`;
    case "PLAN_TIER":
      return "Crisis plan verdict released";
    case "FLASH_TIER":
      return "Flash verdict released";
    case "CLOSE":
      return "Closing price";
    case "APPEAL":
      return "Technical appeal";
    default:
      return "Price update";
  }
}

/** (after − before) × 10,000 ÷ before, rounded half-up away from zero; null without a price before. */
export function moveBpOf(before: number | null, after: number): number | null {
  if (before === null || before <= 0) return null;
  return divRoundHalfUp((after - before) * 10_000, before);
}

/** Each company's latest update: its newest price move or hire (a hire on the same instant comes second). */
export function latestUpdates(moves: readonly UpdateMove[], hires: readonly UpdateHire[]): Map<string, CompanyUpdate> {
  const out = new Map<string, CompanyUpdate>();
  const offer = (id: string, u: CompanyUpdate) => {
    const was = out.get(id);
    if (!was || Date.parse(u.at) > Date.parse(was.at)) out.set(id, u);
  };
  for (const m of moves) offer(m.company_id, { text: moveText(m), moveBp: m.kind === "IPO" ? null : moveBpOf(m.market_before, m.market_after), at: m.created_at });
  for (const h of hires) offer(h.company_id, { text: `Hired a firm · ${crisisOf(h.k)}`, moveBp: null, at: h.created_at });
  return out;
}

// ───────────────────────────── The sector columns ─────────────────────────────

/** The draw's sectors, in the order the organisers want them across the screen; any other sector after, by name. */
export const SECTOR_ORDER = ["fmcg", "aviation", "luxury"] as const;

export interface SectorRow extends BoardTile {
  update: CompanyUpdate | null;
}

export interface SectorColumn {
  sector: string;
  rows: SectorRow[];
}

const rank = (s: string) => {
  const i = (SECTOR_ORDER as readonly string[]).indexOf(s.trim().toLowerCase());
  return i < 0 ? SECTOR_ORDER.length : i;
};

/**
 * One column per sector with its companies (ticker order, as the tiles). Only companies the draw placed in a sector
 * (`sectors`: company id → sector, from public.company_sectors, which joins the squads) are listed: a company with
 * no squad or no sector is never shown. Empty when no company has a sector yet (before the draw).
 */
export function sectorColumns(tiles: readonly BoardTile[], sectors: ReadonlyMap<string, string>, updates: ReadonlyMap<string, CompanyUpdate>): SectorColumn[] {
  const by = new Map<string, SectorColumn>();
  for (const t of tiles) {
    const s = sectors.get(t.id)?.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    const col = by.get(k) ?? { sector: s, rows: [] };
    col.rows.push({ ...t, update: updates.get(t.id) ?? null });
    by.set(k, col);
  }
  return [...by.values()].sort((a, b) => rank(a.sector) - rank(b.sector) || (a.sector < b.sector ? -1 : a.sector > b.sector ? 1 : 0));
}

// ───────────────────────────── The Teams spotlight ─────────────────────────────

/** A team as public.display_teams (migration 092) gives it: only listed teams, only public facts, never cash. */
export interface DisplayTeam {
  code: string;
  name: string;
  track: "PRODUCT" | "CONSULTING" | "FINANCE";
  company: { id: string; ticker: string | null; name: string | null; sector: string | null } | null;
  base_rate_bp: number | null;
  clients: number | null;
}

/** One spotlight card: a team (code, name, track and its track's facts), or a company when no team list is read. */
export type SpotlightEntry =
  | { track: "PRODUCT"; key: string; code: string | null; name: string | null; sector: string | null; row: SectorRow | null }
  | { track: "CONSULTING"; key: string; code: string; name: string; baseRateBp: number | null; clients: number }
  | { track: "FINANCE"; key: string; code: string; name: string };

/** The rows of `display_teams` read back: anything malformed is left out. */
export function parseDisplayTeams(data: unknown): DisplayTeam[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (t): t is DisplayTeam =>
      !!t && typeof t === "object" && typeof t.code === "string" && typeof t.name === "string" && ["PRODUCT", "CONSULTING", "FINANCE"].includes(t.track),
  );
}

/**
 * The spotlight's cards. With the team list (`teams`, in its order: Product, Consulting, Finance, by code): one card
 * per listed team, a Product card carrying its company's row from the columns (price, change, latest update). Without
 * it (null: an older database), every company of every column, sector by sector.
 */
export function spotlightCards(columns: readonly SectorColumn[], teams: readonly DisplayTeam[] | null = null): SpotlightEntry[] {
  const rows = new Map<string, { row: SectorRow; sector: string }>();
  for (const c of columns) for (const row of c.rows) rows.set(row.id, { row, sector: c.sector });
  if (teams === null) {
    return [...rows.values()].map(({ row, sector }) => ({ track: "PRODUCT", key: row.id, code: null, name: null, sector, row }));
  }
  return teams.map((t): SpotlightEntry => {
    if (t.track === "PRODUCT") {
      const found = t.company ? rows.get(t.company.id) : undefined;
      return { track: "PRODUCT", key: t.code, code: t.code, name: t.name, sector: found?.sector ?? t.company?.sector ?? null, row: found?.row ?? null };
    }
    if (t.track === "CONSULTING") return { track: "CONSULTING", key: t.code, code: t.code, name: t.name, baseRateBp: t.base_rate_bp, clients: t.clients ?? 0 };
    return { track: "FINANCE", key: t.code, code: t.code, name: t.name };
  });
}
