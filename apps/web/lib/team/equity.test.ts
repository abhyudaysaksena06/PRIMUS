import { describe, expect, test } from "vitest";
import { equityText, parsePct, pctOf, stakeValue } from "./equity";

describe("equity", () => {
  test("a percentage becomes shares out of 100,000", () => {
    expect(parsePct("5")).toBe(5000);
    expect(parsePct("2.5")).toBe(2500);
    expect(parsePct("0.01")).toBe(10);
    expect(parsePct(" 10 % ")).toBe(10000);
    expect(parsePct("")).toBe(0);
    expect(parsePct("100")).toBe(100000);
    expect(parsePct("100.01")).toBeNull();
    expect(parsePct("1.234")).toBeNull();
    expect(parsePct("five")).toBeNull();
    expect(parsePct("-1")).toBeNull();
    expect(pctOf(5000)).toBe(5);
  });

  test("in words, and its value at a price", () => {
    expect(equityText(5000)).toBe("5% (5,000 shares)");
    expect(equityText(2500)).toBe("2.5% (2,500 shares)");
    expect(equityText(10)).toBe("0.01% (10 shares)");
    // The organisers' example: 10% of a company worth Rs 1,00,000 is worth Rs 10,000.
    expect(stakeValue(10_000, 100)).toBe(1_000_000); // 10,000 shares at 1.00 = 10,000.00
    expect(stakeValue(5000, null)).toBeNull();
  });
});
