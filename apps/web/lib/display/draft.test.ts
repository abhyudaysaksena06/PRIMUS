import { describe, expect, test } from "vitest";
import { DRAFT_POLL_MS, parseDraftHeads, sameSector } from "./draft";

describe("the draft clock on the projector", () => {
  test("one head per sector, by sector; bad rows dropped", () => {
    expect(
      parseDraftHeads({
        by_sector: true,
        heads: [
          { sector: "Health", ticker: "MEDX", closes_at: "2026-11-20T23:20:20Z", pick_no: 4 },
          { sector: "Fintech", ticker: "PAYS", closes_at: "2026-11-20T23:20:15Z" },
          { sector: "Climate", ticker: "SUNR", closes_at: "not a time" },
          { sector: "Retail" },
          null,
        ],
      }),
    ).toEqual([
      { sector: "Fintech", ticker: "PAYS", closes_at: "2026-11-20T23:20:15Z" },
      { sector: "Health", ticker: "MEDX", closes_at: "2026-11-20T23:20:20Z" },
    ]);
  });

  test("the pickers and the others of each sector (migration 088)", () => {
    expect(parseDraftHeads({ heads: [{ sector: "fmcg", ticker: "LOWA", closes_at: "2026-11-20T23:20:15Z", place: 3, queue: 10, others: 57 }] })).toEqual([
      { sector: "fmcg", ticker: "LOWA", closes_at: "2026-11-20T23:20:15Z", place: 3, queue: 10, others: 57 },
    ]);
  });

  test("no function or no heads: the single queue", () => {
    expect(parseDraftHeads(null)).toEqual([]);
    expect(parseDraftHeads({ by_sector: false })).toEqual([]);
  });

  test("polls every 3 s; sectors match whatever the case and spaces", () => {
    expect(DRAFT_POLL_MS).toBe(3000);
    expect(sameSector(" Health ", "health")).toBe(true);
    expect(sameSector("Health", "Fintech")).toBe(false);
  });
});
