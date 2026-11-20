import { describe, expect, test } from "vitest";
import { autoText, type AutoJudgeRow } from "./auto-judge";

const row = (r: Partial<AutoJudgeRow>): AutoJudgeRow => ({
  type: "CRISIS_1", queued_at: "2026-11-20T16:00:05Z", submissions: 40, runs: 120, sealed_at: null, sealed_missing: null, ...r,
});

describe("judge automatically: what the clock did", () => {
  test("waiting, started, sealed, nothing to judge, released by hand", () => {
    expect(autoText(undefined, false)).toBe("Waits for the deadline");
    expect(autoText(undefined, true)).toBe("Released by hand");
    expect(autoText(row({}), false)).toBe("Started 21:30:05: 40 submissions, 120 runs · seals missing when the runs finish");
    expect(autoText(row({ sealed_at: "2026-11-20T16:07:00Z", sealed_missing: 3 }), false)).toBe(
      "Started 21:30:05: 40 submissions, 120 runs · 3 missing sealed as 0 (21:37:00)",
    );
    expect(autoText(row({ submissions: 0, runs: 0, sealed_at: "2026-11-20T16:00:05Z", sealed_missing: 0 }), false)).toBe(
      "Nothing to judge (21:30:05) · none missing (21:30:05)",
    );
  });
});
