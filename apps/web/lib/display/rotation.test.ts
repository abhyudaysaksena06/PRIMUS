import { describe, expect, test } from "vitest";
import { pageCount } from "./board";
import type { BoardTile } from "./board";
import {
  COLUMNS_WINDOW_MS,
  COLUMN_PAGE_MAX_MS,
  COLUMN_PAGE_MIN_MS,
  DEFAULT_VIEW,
  SPOTLIGHT_MS,
  columnLayout,
  columnPageAt,
  columnPageMs,
  isToggleKey,
  latestUpdates,
  moveBpOf,
  moveText,
  otherView,
  parseView,
  sectorColumns,
  spotlightCards,
  spotlightIndex,
  type UpdateMove,
} from "./rotation";

const tile = (ticker: string): BoardTile => ({ id: ticker.toLowerCase(), ticker, name: `${ticker} Inc`, price: 1000, closing: false, changeBp: 0, move: null });

describe("the view toggle", () => {
  test("Sectors by default; anything stored but a known view is the default", () => {
    expect(DEFAULT_VIEW).toBe("sectors");
    expect(parseView(null)).toBe("sectors");
    expect(parseView("garbage")).toBe("sectors");
    expect(parseView("teams")).toBe("teams");
    expect(otherView("sectors")).toBe("teams");
    expect(otherView("teams")).toBe("sectors");
  });

  test("T toggles, not Ctrl+T or Cmd+T", () => {
    expect(isToggleKey({ key: "t" })).toBe(true);
    expect(isToggleKey({ key: "T" })).toBe(true);
    expect(isToggleKey({ key: "t", ctrlKey: true })).toBe(false);
    expect(isToggleKey({ key: "t", metaKey: true })).toBe(false);
    expect(isToggleKey({ key: "x" })).toBe(false);
  });
});

describe("the team spotlight", () => {
  test("5 s a card, looping through every card, the same on every screen", () => {
    expect(SPOTLIGHT_MS).toBe(5_000);
    expect(spotlightIndex(0, 0)).toBeNull();
    const seen = new Set<number>();
    for (let t = 0; t < 7 * SPOTLIGHT_MS; t += SPOTLIGHT_MS) seen.add(spotlightIndex(t, 7)!);
    expect(seen.size).toBe(7);
    expect(spotlightIndex(7 * SPOTLIGHT_MS, 7)).toBe(0);
    expect(spotlightIndex(SPOTLIGHT_MS - 1, 7)).toBe(0);
  });

  test("the cards are every company of every column, sector by sector", () => {
    const cols = sectorColumns([tile("AAA"), tile("BBB"), tile("CCC")], new Map([["aaa", "Luxury"], ["bbb", "FMCG"], ["ccc", "FMCG"]]), new Map());
    expect(spotlightCards(cols).map((c) => [c.sector, c.row.ticker])).toEqual([
      ["FMCG", "BBB"],
      ["FMCG", "CCC"],
      ["Luxury", "AAA"],
    ]);
  });
});

describe("column paging", () => {
  test("a page stays between the bounds, and all pages fit in the window for 200 companies", () => {
    const { rows } = columnLayout(200);
    const pages = pageCount(200, rows);
    const ms = columnPageMs(pages);
    expect(ms).toBeGreaterThanOrEqual(COLUMN_PAGE_MIN_MS);
    expect(ms).toBeLessThanOrEqual(COLUMN_PAGE_MAX_MS);
    expect(pages * ms).toBeLessThanOrEqual(COLUMNS_WINDOW_MS);
    const seen = new Set<number>();
    for (let t = 0; t < pages * ms; t += 1000) seen.add(columnPageAt(t, pages));
    expect(seen.size).toBe(pages);
  });

  test("one page never turns", () => {
    expect(columnPageAt(123_456, 1)).toBe(0);
  });

  test("roomy rows while every sector fits on one page, else dense; compact holds fewer", () => {
    expect(columnLayout(8)).toEqual({ density: "roomy", rows: 8 });
    expect(columnLayout(9)).toEqual({ density: "dense", rows: 16 });
    expect(columnLayout(6, true)).toEqual({ density: "roomy", rows: 6 });
    expect(columnLayout(200, true)).toEqual({ density: "dense", rows: 13 });
  });
});

describe("sector columns", () => {
  test("FMCG, Aviation, Luxury in that order, then any other by name; a company without a sector is never listed", () => {
    const tiles = ["AAA", "BBB", "CCC", "DDD", "EEE"].map(tile);
    const sectors = new Map([
      ["aaa", "Luxury"],
      ["bbb", "Aviation"],
      ["ccc", "fmcg"],
      ["ddd", "Energy"],
    ]);
    const cols = sectorColumns(tiles, sectors, new Map());
    expect(cols.map((c) => c.sector)).toEqual(["fmcg", "Aviation", "Luxury", "Energy"]);
    expect(cols.flatMap((c) => c.rows.map((r) => r.ticker))).not.toContain("EEE");
  });

  test("empty before the draw (no sectors)", () => {
    expect(sectorColumns([tile("AAA")], new Map(), new Map())).toEqual([]);
  });
});

describe("a company's latest update", () => {
  const mv = (over: Partial<UpdateMove>): UpdateMove => ({
    company_id: "a",
    kind: "CLEARING",
    subround: null,
    tier_bp: null,
    market_before: 1000,
    market_after: 1100,
    created_at: "2026-11-20T15:00:00Z",
    round: 2,
    ...over,
  });

  test("the words for each move", () => {
    expect(moveText(mv({}))).toBe("Round 2 cleared");
    expect(moveText(mv({ kind: "SUB_SHOCK", subround: 3 }))).toBe("Crisis 3 revealed");
    expect(moveText(mv({ kind: "SUB_TIER", subround: 2 }))).toBe("Crisis 2 plan verdict released");
    expect(moveText(mv({ kind: "SUB_TIER", subround: 5 }))).toBe("Solution verdict released");
    expect(moveText(mv({ kind: "IPO" }))).toBe("Listed · IPO price set");
  });

  test("the move in basis points, half-up", () => {
    expect(moveBpOf(1000, 1100)).toBe(1000);
    expect(moveBpOf(800, 799)).toBe(-13);
    expect(moveBpOf(null, 1000)).toBeNull();
  });

  test("the newest of the moves and the hires wins; a hire never names the firm", () => {
    const u = latestUpdates(
      [mv({}), mv({ kind: "SUB_TIER", subround: 1, created_at: "2026-11-20T16:00:00Z", market_before: 1100, market_after: 1045 })],
      [{ company_id: "a", k: 1, created_at: "2026-11-20T15:30:00Z" }, { company_id: "b", k: 2, created_at: "2026-11-20T15:30:00Z" }],
    );
    expect(u.get("a")).toEqual({ text: "Crisis 1 plan verdict released", moveBp: -500, at: "2026-11-20T16:00:00Z" });
    expect(u.get("b")).toEqual({ text: "Hired a firm · Crisis 2", moveBp: null, at: "2026-11-20T15:30:00Z" });
  });
});
