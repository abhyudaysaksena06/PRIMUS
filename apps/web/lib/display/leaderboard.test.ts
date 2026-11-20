import { describe, expect, test } from "vitest";
import { changeText, leaderboardMissing, parseLeaderboard, ratingText } from "./leaderboard";

describe("leaderboard rows", () => {
  test("parsed best first; numbers from strings; bad rows dropped", () => {
    const rows = parseLeaderboard([
      { company_id: "b", ticker: "BBB", name: "Bee", sector: "Health", rating: "1012.4", rank: 2, change: -1, rounds: 2 },
      { company_id: "a", ticker: "AAA", name: "Ay", sector: "Fintech", rating: 1050, rank: 1, change: 3, rounds: 2 },
      { company_id: "x", ticker: "", rating: 999, rank: 3 },
      null,
      { ticker: "NOID", rating: 900, rank: 4 },
    ]);
    expect(rows.map((r) => r.ticker)).toEqual(["AAA", "BBB"]);
    expect(rows[1]).toMatchObject({ rating: 1012.4, rank: 2, change: -1, rounds: 2, sector: "Health" });
  });

  test("anything that is not a list is no rows", () => {
    expect(parseLeaderboard(null)).toEqual([]);
    expect(parseLeaderboard({ error: "x" })).toEqual([]);
  });

  test("a missing function is told apart from a real error", () => {
    expect(leaderboardMissing({ code: "PGRST202", message: "Could not find the function public.leaderboard(p_event)" })).toBe(true);
    expect(leaderboardMissing({ code: "42883", message: "function public.leaderboard(uuid) does not exist" })).toBe(true);
    expect(leaderboardMissing({ code: "42501", message: "permission denied" })).toBe(false);
    expect(leaderboardMissing(null)).toBe(false);
  });

  test("change and rating text", () => {
    expect(changeText(3)).toBe("▲ 3");
    expect(changeText(-2)).toBe("▼ 2");
    expect(changeText(0)).toBe("—");
    expect(ratingText(1041.6)).toBe("1,042");
  });
});
