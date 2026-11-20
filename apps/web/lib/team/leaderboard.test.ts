import { describe, expect, test } from "vitest";
import { badgeText, leaderboardOpen, moveText, parseLeaderboard } from "./leaderboard";

describe("leaderboard", () => {
  test("rows are read defensively and sorted by rank", () => {
    const rows = parseLeaderboard([
      { company_id: "b", ticker: "BBB", name: "Bee", sector: "FMCG", rating: "1012.5", rank: "2", change: -1, rounds: 1 },
      { company_id: "a", ticker: "AAA", name: null, sector: null, rating: 1034, rank: 1, change: 3, rounds: "1" },
      { company_id: null, rating: 1000, rank: 3 }, // no company: dropped
      { company_id: "c", rating: "x", rank: 4 }, // no rating: dropped
      "junk",
    ]);
    expect(rows.map((r) => r.company_id)).toEqual(["a", "b"]);
    expect(rows[1]).toEqual({ company_id: "b", ticker: "BBB", name: "Bee", sector: "FMCG", rating: 1012.5, rank: 2, change: -1, rounds: 1 });
    expect(parseLeaderboard(null)).toEqual([]);
    expect(parseLeaderboard({ rows: [] })).toEqual([]);
  });

  test("open once a released score counts", () => {
    expect(leaderboardOpen([])).toBe(false);
    expect(leaderboardOpen(parseLeaderboard([{ company_id: "a", rating: 1000, rank: 1, rounds: 0 }]))).toBe(false);
    expect(leaderboardOpen(parseLeaderboard([{ company_id: "a", rating: 1000, rank: 1, rounds: 1 }]))).toBe(true);
  });

  test("the header badge: rating, rank and the move", () => {
    expect(badgeText({ rating: 1034.4, rank: 12, change: 3 })).toBe("Rating 1,034 · #12 ▲3");
    expect(badgeText({ rating: 987, rank: 40, change: -2 })).toBe("Rating 987 · #40 ▼2");
    expect(badgeText({ rating: 1000, rank: 1, change: 0 })).toBe("Rating 1,000 · #1");
    expect(badgeText({ rating: 1000, rank: 1, change: null })).toBe("Rating 1,000 · #1");
    expect(moveText(5)).toBe("▲5");
  });
});
