import { describe, expect, test } from "vitest";
import type { DeadlineCode, PhaseCode, Track } from "@msim/engine";
import { homePlan, nextDeadline, submitOpensNote, teamTimeline, type HomeFacts } from "./home";

describe("a firm assigned by the draw", () => {
  test("Home says so instead of 'You hired'", () => {
    const eng = { firm: "XC01", cash: 50000, shares: 0, escrow: "HELD" as const };
    const f = (assigned?: boolean) => facts("PRODUCT", "PRESSURE", "22:55", { primus: { k: 1, hiringK: 1, workOpen: false, engagement: { ...eng, assigned } } });
    expect(homePlan(f(true)).now.find((t) => t.key === "HIRE")!.detail).toMatch(/^Assigned by the draw: XC01, for \$500\.00\./);
    expect(homePlan(f(false)).now.find((t) => t.key === "HIRE")!.detail).toMatch(/^You hired XC01 for \$500\.00\./);
  });
});

// 20 Nov 2026, IST (UTC+05:30).
const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00+05:30`).toISOString();

function facts(track: Track, phase: PhaseCode, now: string, extra: Partial<HomeFacts> = {}): HomeFacts {
  const deadlines: { code: DeadlineCode; at: string }[] = [
    { code: "PITCH", at: at("22:00") },
    { code: "REVEAL_1", at: at("22:45") },
    { code: "HIRE_1", at: at("23:05") },
    { code: "DUE_1", at: at("23:50") },
    { code: "RATE_1", at: at("23:59") },
  ];
  return {
    format: "PRIMUS",
    primus: null,
    track,
    phase,
    paused: false,
    pausedAt: null,
    nowMs: Date.parse(at(now)),
    drawn: true,
    crisisApplied: false,
    ipoAllocated: false,
    marketClosed: false,
    flashBulletinPublished: false,
    released: {},
    deadlines,
    phaseStarts: { SQUAD_DRAW: at("21:00") },
    openRound: null,
    nextRound: null,
    progress: { problemPicked: true, oneCase: true, submitted: {}, fee: null, deal: null, calls: { 1: { made: 0, total: 0 }, 2: { made: 0, total: 0 }, 3: { made: 0, total: 0 } }, ipoBids: 0, unanswered: 0 },
    ...extra,
  };
}

describe("my timeline", () => {
  test("every deadline of the team in time order: passed, the next one, later ones", () => {
    const t = teamTimeline(facts("PRODUCT", "PRESSURE", "23:10"));
    expect(t.map((i) => [i.key, i.state])).toEqual([
      ["SQUAD_DRAW", "past"],
      ["PITCH", "past"],
      ["REVEAL_1", "past"],
      ["HIRE_1", "past"],
      ["DUE_1", "next"],
      ["RATE_1", "later"],
    ]);
    expect(nextDeadline(facts("PRODUCT", "PRESSURE", "23:10"))).toEqual({ title: "Crisis 1 plan and memos due", at: at("23:50") });
  });

  test("each track its own deadlines and names; nothing left: no next deadline", () => {
    const c = teamTimeline(facts("CONSULTING", "BUILD", "21:30"));
    expect(c.map((i) => i.key)).toEqual(["SQUAD_DRAW", "PITCH", "HIRE_1", "DUE_1"]);
    expect(c[1]).toMatchObject({ title: "Crisis memo due (with the PRDs)", state: "next" });
    const f = teamTimeline(facts("FINANCE", "BUILD", "21:30"));
    expect(f.map((i) => i.key)).toEqual(["SQUAD_DRAW", "REVEAL_1"]);
    expect(f[1]!.title).toContain("prices fall 5%, trading halts 5 min");
    expect(nextDeadline(facts("FINANCE", "PRESSURE", "23:30"))).toBeNull();
  });

  test("a paused event: a deadline after the pause has not passed", () => {
    const t = teamTimeline(facts("PRODUCT", "PRESSURE", "23:55", { paused: true, pausedAt: at("23:40") }));
    expect(t.find((i) => i.key === "DUE_1")!.state).toBe("next");
  });
});

describe("submit_last_5 on Home", () => {
  test("before Submit opens, the task says when; off or open: nothing", () => {
    const f = facts("PRODUCT", "PRESSURE", "23:20", { submitLast5: true });
    expect(submitOpensNote(f, "DUE_1")).toBe(" Submit opens at 23:45; your last saved draft is submitted for you at 23:50.");
    expect(submitOpensNote({ ...f, nowMs: Date.parse(at("23:46")) }, "DUE_1")).toBe("");
    expect(submitOpensNote({ ...f, submitLast5: false }, "DUE_1")).toBe("");
  });
});
