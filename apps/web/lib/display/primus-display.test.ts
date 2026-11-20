// The projector on a PRIMUS night: which releases take the screen, the crisis reveal takeover, the reveal's card
// counts, and page-by-page reads past PostgREST's 1,000-row limit.

import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => ({}) }));
vi.mock("@/lib/event-status", () => ({ loadEventStatus: async () => ({}) }));

import { activeTakeover, isVerdictType, TAKEOVER_SECONDS, VERDICT_TITLES, verdictSubround, type TakeoverMoments } from "./takeover";
import { revealCategories } from "./takeovers";
import { readAllPages } from "./frame";

const NONE: TakeoverMoments = { drawnAt: null, crisisAt: null, verdicts: [], flashAt: null, closedAt: null, awardsAt: null };
const T0 = Date.parse("2026-11-20T18:45:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("PRIMUS releases", () => {
  test("plans and solutions take the screen; memos and advice do not", () => {
    for (const t of ["PITCH", "PLAN", "FLASH", "CRISIS_1", "CRISIS_4", "SOLUTION"]) expect(isVerdictType(t), t).toBe(true);
    for (const t of ["MEMO", "ADVICE_1", "ADVICE_5", "CRISIS_5"]) expect(isVerdictType(t), t).toBe(false);
  });

  test("each release reads its own sub-round's SUB_TIER prices", () => {
    expect(verdictSubround("CRISIS_3")).toBe(3);
    expect(verdictSubround("SOLUTION")).toBe(5);
    expect(verdictSubround("PLAN")).toBeNull();
    expect(VERDICT_TITLES.CRISIS_2).toBe("Crisis 2 verdicts: plans move prices");
  });
});

describe("the crisis reveal takeover", () => {
  const moments: TakeoverMoments = { ...NONE, reveals: [{ k: 1, at: iso(T0 - 5_400_000) }, { k: 2, at: iso(T0) }] };

  test("up for 60 s after the latest reveal, with its crisis number; then the board", () => {
    expect(TAKEOVER_SECONDS.REVEAL).toBe(60);
    expect(activeTakeover(moments, T0 + 10_000)).toMatchObject({ kind: "REVEAL", k: 2, until: iso(T0 + 60_000) });
    expect(activeTakeover(moments, T0 + 60_000)).toBeNull();
    expect(activeTakeover(moments, T0 - 1000)).toBeNull(); // crisis 1 ended long ago
  });

  test("a verdict released after the reveal replaces it", () => {
    const m = { ...moments, verdicts: [{ type: "CRISIS_1" as const, at: iso(T0 + 20_000) }] };
    expect(activeTakeover(m, T0 + 30_000)).toMatchObject({ kind: "VERDICTS", type: "CRISIS_1" });
  });

  test("the cards' categories, most drawn first; sealed cards are not counted", () => {
    expect(
      revealCategories([
        { crisis_cards: { category: "Regulation" } },
        { crisis_cards: [{ category: "Data breach" }] },
        { crisis_cards: { category: "Data breach" } },
        { crisis_cards: null },
      ]),
    ).toEqual([
      { category: "Data breach", count: 2 },
      { category: "Regulation", count: 1 },
    ]);
    expect(revealCategories([{ crisis_cards: null }])).toEqual([]);
  });
});

describe("paged reads", () => {
  test("reads page after page until a short page", async () => {
    const rows = Array.from({ length: 2_450 }, (_, i) => i);
    const asked: [number, number][] = [];
    const r = await readAllPages(async (from, to) => {
      asked.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(r.data).toHaveLength(2_450);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  test("an exact multiple needs one more (empty) page; an error stops and is returned", async () => {
    const r = await readAllPages(async (from) => ({ data: from < 2 ? [from, from + 1] : [], error: null }), 2);
    expect(r.data).toEqual([0, 1]);
    const e = await readAllPages(async (from) => (from === 0 ? { data: [1, 2], error: null } : { data: null, error: { message: "boom" } }), 2);
    expect(e).toEqual({ data: [1, 2], error: { message: "boom" } });
  });
});
