import { describe, expect, test } from "vitest";
import { pastRounds, type PastInput, type PastSubmission } from "./past-rounds";

const s = (company_id: string, type: PastSubmission["type"]): PastSubmission => ({
  company_id,
  type,
  content: { impact: "x" },
  submitted_at: "2026-11-20T18:20:00Z",
  word_count: 1,
  auto_submitted: false,
});
const base = (over: Partial<PastInput>): PastInput => ({
  track: "PRODUCT",
  companyId: "me",
  closed: (c) => ["PITCH", "DUE_1", "DUE_2"].includes(c),
  submissions: [],
  scores: [],
  moves: [],
  clients: [],
  ...over,
});

describe("past rounds", () => {
  test("Product: the finished rounds newest first, with its text, released score and price move", () => {
    const r = pastRounds(
      base({
        submissions: [s("me", "PITCH"), s("me", "CRISIS_1"), s("other", "CRISIS_2")],
        scores: [{ company_id: "me", type: "CRISIS_1", final_score: 72 }, { company_id: "me", type: "PITCH", final_score: null }],
        moves: [{ company_id: "me", subround: 1, tier_bp: 500 }],
      }),
    );
    expect(r.map((x) => x.title)).toEqual(["Crisis 2 of 4", "Crisis 1 of 4", "Round 1"]);
    expect(r[1]!.entries[0]).toMatchObject({ label: "Your response plan", score: 72, moveBp: 500, moveOf: "your price" });
    expect(r[1]!.entries[0]!.submission?.type).toBe("CRISIS_1");
    expect(r[0]!.entries[0]).toMatchObject({ submission: null, score: null, moveBp: null }); // nothing sent, not scored yet
    expect(r[2]!.entries[0]).toMatchObject({ label: "Your PRD", score: null, moveBp: null });
  });

  test("Consulting: its crisis memo, then one advice memo per client; Finance: none", () => {
    const r = pastRounds(
      base({
        track: "CONSULTING",
        closed: (c) => c === "PITCH" || c === "DUE_1",
        submissions: [s("me", "MEMO"), s("c1", "ADVICE_1")],
        scores: [{ company_id: "c1", type: "ADVICE_1", final_score: 64 }],
        moves: [{ company_id: "c1", subround: 1, tier_bp: -300 }],
        clients: [
          { k: 1, company_id: "c1", ticker: "ABC" },
          { k: 2, company_id: "c2", ticker: "XYZ" },
        ],
      }),
    );
    expect(r.map((x) => x.title)).toEqual(["Crisis 1 of 4", "Round 1"]);
    expect(r[0]!.entries).toHaveLength(1);
    expect(r[0]!.entries[0]).toMatchObject({ label: "Your advice memo for ABC", score: 64, moveBp: -300, moveOf: "ABC" });
    expect(r[1]!.entries[0]).toMatchObject({ label: "Your crisis memo", type: "MEMO" });
    expect(pastRounds(base({ track: "FINANCE" }))).toEqual([]);
  });

  test("Round 3 is the solution", () => {
    const r = pastRounds(base({ closed: (c) => c === "DUE_5", submissions: [s("me", "SOLUTION")] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Round 3: the final problem" });
    expect(r[0]!.entries[0]).toMatchObject({ label: "Your solution", type: "SOLUTION" });
  });
});
