import { describe, expect, test } from "vitest";
import { tickerItems, type TickerInput } from "./ticker";

const base: TickerInput = {
  phase: "ROUNDS_1_4",
  nowMs: Date.parse("2026-11-14T18:30:00Z"),
  lastRound: null,
  bulletins: [],
  dealsSigned: 0,
  squads: 50,
  deadlines: [],
  clock: (iso) => iso.slice(11, 16),
};

describe("tickerItems", () => {
  test("the last round's three biggest rises and falls, by percentage, ties by ticker; unchanged prices left out", () => {
    const items = tickerItems({
      ...base,
      lastRound: {
        number: 3,
        moves: [
          { ticker: "AQS", before: 1050, after: 1082 },
          { ticker: "BBB", before: 1000, after: 1100 },
          { ticker: "CCC", before: 1000, after: 1010 },
          { ticker: "DDD", before: 1000, after: 1020 },
          { ticker: "EEE", before: 1000, after: 950 },
          { ticker: "FFF", before: 1000, after: 1000 },
        ],
      },
    });
    expect(items.map((i) => [i.tag, i.text])).toEqual([
      ["Round 3 ▲", "BBB +10%  ·  AQS +3.05%  ·  DDD +2%"],
      ["Round 3 ▼", "EEE −5%"],
    ]);
  });

  test("a round where nothing moved says so", () => {
    expect(tickerItems({ ...base, lastRound: { number: 1, moves: [{ ticker: "AQS", before: 1050, after: 1050 }] } }).map((i) => i.text)).toEqual(["No price moved this round."]);
  });

  test("bulletins, the deals count during the rescue, and the next deadline (never the internal flash tier)", () => {
    const items = tickerItems({
      ...base,
      phase: "RESCUE_2",
      bulletins: [{ kind: "CRISIS", title: "Every company is hit" }],
      dealsSigned: 12,
      deadlines: [
        { code: "FEE", at: "2026-11-14T18:00:00Z" },
        { code: "FLASH_TIER", at: "2026-11-14T18:40:00Z" },
        { code: "DEAL_BONUS", at: "2026-11-14T21:15:00Z" },
        { code: "DEAL", at: "2026-11-14T21:30:00Z" },
      ],
    });
    expect(items.map((i) => [i.tag, i.text])).toEqual([
      ["CRISIS", "Every company is hit"],
      ["Rescue", "12 of 50 rescue deals signed"],
      ["Next", "Deal bonus cut-off at 21:15"],
    ]);
  });

  describe("PRIMUS", () => {
    // Crisis 2 of a night whose Round 2 starts 22:45 (17:15Z): crisis 2 at 00:15, hiring 00:35, plans 01:20, rating 01:35.
    const schedule = [
      { code: "REVEAL_2", at: "2026-11-20T18:45:00Z" },
      { code: "HIRE_2", at: "2026-11-20T19:05:00Z" },
      { code: "DUE_2", at: "2026-11-20T19:50:00Z" },
      { code: "RATE_2", at: "2026-11-20T20:05:00Z" },
      { code: "REVEAL_3", at: "2026-11-20T20:15:00Z" },
      { code: "DRAFT", at: "2026-11-20T23:30:00Z" },
      { code: "HIRE_5", at: "2026-11-20T23:45:00Z" },
      { code: "DUE_5", at: "2026-11-21T00:30:00Z" },
    ] as TickerInput["deadlines"];
    const at = (iso: string): TickerInput => ({ ...base, format: "PRIMUS", phase: "PRESSURE", deadlines: schedule, nowMs: Date.parse(iso), squads: 200, dealsSigned: 3 });

    test("the crisis step and its time, with how many have hired while hiring is open; no rescue deals; no duplicate Next", () => {
      const items = tickerItems({ ...at("2026-11-20T18:50:00Z"), hiring: { hired: 57, companies: 200 }, bulletins: [{ kind: "CRISIS", title: "Crisis 2: every company is hit" }] });
      expect(items.map((i) => [i.tag, i.text])).toEqual([
        ["Crisis 2", "Hiring closes at 19:05"],
        ["Hiring", "57 of 200 companies hired"],
        ["CRISIS", "Crisis 2: every company is hit"],
      ]);
    });

    test("each step in turn: plans due, rating closes, the next reveal, then Round 3", () => {
      const text = (iso: string) => tickerItems({ ...at(iso), hiring: { hired: 200, companies: 200 } }).map((i) => `${i.tag}: ${i.text}`);
      expect(text("2026-11-20T19:06:00Z")).toEqual(["Crisis 2: Plans due at 19:50"]);
      expect(text("2026-11-20T19:51:00Z")).toEqual(["Crisis 2: Rating closes at 20:05"]);
      expect(text("2026-11-20T20:06:00Z")).toEqual(["Crisis 3: Starts at 20:15: every price −5%, trading halted 5 min"]);
      expect(tickerItems({ ...at("2026-11-20T23:31:00Z"), phase: "SATURATION", hiring: { hired: 12, companies: 200 } }).map((i) => `${i.tag}: ${i.text}`)).toEqual([
        "Round 3: Hiring closes at 23:45",
        "Hiring: 12 of 200 companies hired",
      ]);
      expect(text("2026-11-21T00:00:00Z")).toEqual(["Round 3: Solutions due at 00:30"]);
    });

    test("the top 3 by Rating when given; nothing about Rating or steps on a classic night", () => {
      const leaders = [{ ticker: "AAA", rating: 1062.4 }, { ticker: "BBB", rating: 1040 }, { ticker: "CCC", rating: 1001 }, { ticker: "DDD", rating: 990 }];
      expect(tickerItems({ ...at("2026-11-20T19:06:00Z"), leaders }).find((i) => i.key === "rating")?.text).toBe("1. AAA 1,062  ·  2. BBB 1,040  ·  3. CCC 1,001");
      const classic = tickerItems({ ...at("2026-11-20T19:06:00Z"), format: "CLASSIC", phase: "RESCUE_1", leaders });
      expect(classic.map((i) => i.key)).toEqual(["deals", "next"]);
    });

    test("no step before IPO or after the close", () => {
      expect(tickerItems({ ...at("2026-11-20T18:50:00Z"), phase: "READING" }).some((i) => i.key === "step")).toBe(false);
      expect(tickerItems({ ...at("2026-11-20T18:50:00Z"), phase: "CLOSE" }).some((i) => i.key === "step")).toBe(false);
    });
  });

  test("no deals count before the crisis or after the close", () => {
    expect(tickerItems({ ...base, phase: "IPO", dealsSigned: 0 }).some((i) => i.key === "deals")).toBe(false);
    expect(tickerItems({ ...base, phase: "SETTLEMENT", dealsSigned: 50 }).some((i) => i.key === "deals")).toBe(false);
  });
});
