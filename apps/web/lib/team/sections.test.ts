import { describe, expect, test } from "vitest";
import { TEAM_SECTIONS, sectionAllowed } from "./sections";

describe("team sections", () => {
  test("every track has home and the public sections; each has its own tools", () => {
    for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
      expect(TEAM_SECTIONS[track].map((s) => s.label)).toEqual(expect.arrayContaining(["Home", "Market", "Q&A", "Ledger", "Bulletins", "Judging", "Rescue", "Chat"]));
      // The judge's prompts are published to every team, after Bulletins and the Newsroom (TushKum's Final-Frontend).
      expect(TEAM_SECTIONS[track].map((s) => s.label).slice(-3)).toEqual(["Bulletins", "Newsroom", "Judging"]);
      expect(sectionAllowed(track, "/judging")).toBe(true);
    }
    expect(sectionAllowed("FINANCE", "/trade")).toBe(true);
    expect(sectionAllowed("PRODUCT", "/trade")).toBe(false);
    expect(sectionAllowed("CONSULTING", "/calls")).toBe(true);
    expect(sectionAllowed("FINANCE", "/squad")).toBe(false);
  });
});
