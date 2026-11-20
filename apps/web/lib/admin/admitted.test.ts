import { describe, expect, test } from "vitest";
import { admittedOnly, nextFreeCard } from "./admitted";

const cards = [
  { id: "1", code: "P01", track: "PRODUCT", checked_in_at: "2026-11-20T14:00:00Z" },
  { id: "2", code: "P02", track: "PRODUCT", checked_in_at: null },
  { id: "3", code: "P10", track: "PRODUCT", checked_in_at: null },
  { id: "4", code: "C01", track: "CONSULTING", checked_in_at: null, disqualified: true },
  { id: "5", code: "C02", track: "CONSULTING", checked_in_at: null },
];

describe("admittedOnly", () => {
  test("desk check-in on: only the checked-in teams are listed and counted", () => {
    expect(admittedOnly(cards, true).map((t) => t.code)).toEqual(["P01"]);
  });
  test("a team appears as soon as the desk checks it in", () => {
    const after = cards.map((t) => (t.code === "P02" ? { ...t, checked_in_at: "2026-11-20T14:05:00Z" } : t));
    expect(admittedOnly(after, true).map((t) => t.code)).toEqual(["P01", "P02"]);
  });
  test("desk check-in off: every team, exactly as before", () => {
    expect(admittedOnly(cards, false)).toEqual(cards);
  });
});

describe("nextFreeCard", () => {
  test("the lowest unused code of the track, in the database's order (length, then code)", () => {
    expect(nextFreeCard(cards, "PRODUCT")).toBe("P02");
    expect(nextFreeCard([{ code: "P100", track: "PRODUCT" }, { code: "P99", track: "PRODUCT" }], "PRODUCT")).toBe("P99");
  });
  test("skips disqualified cards; null when the track has none left", () => {
    expect(nextFreeCard(cards, "CONSULTING")).toBe("C02");
    expect(nextFreeCard(cards, "FINANCE")).toBeNull();
  });
});
