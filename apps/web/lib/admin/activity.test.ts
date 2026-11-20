import { describe, expect, test } from "vitest";
import { activityAction, activityDetails, activityKind, featureChanges, filterActivity, showValue, type ActivityRow } from "./activity";

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 1,
  at: "2026-11-20T15:00:00Z",
  actor_id: "u1",
  actor_email: "registration01@example.org",
  actor_name: "Desk one",
  actor_role: "REGISTRATION",
  action: "update",
  entity: "teams",
  entity_id: "t1",
  entity_label: "P01 · Alpha",
  rows: 1,
  changes: {},
  ...over,
});

describe("activity lines", () => {
  test("desk check-in and check-out", () => {
    const inn = row({ changes: { checked_in_at: { from: null, to: "2026-11-20T15:00:00Z" }, name: { from: "P01", to: "Alpha" } } });
    expect(activityAction(inn)).toBe("Checked in team");
    expect(activityKind(inn)).toBe("Desk");
    expect(activityDetails(inn)).toContain("name: P01 → Alpha");
    expect(activityAction(row({ changes: { checked_in_at: { from: "x", to: null } } }))).toBe("Checked out team");
  });

  test("phase, pause and switches", () => {
    const phase = row({ entity: "events", actor_role: "ORGANISER", changes: { current_phase: { from: "LOBBY", to: "READING" } } });
    expect(activityAction(phase)).toBe("Phase LOBBY → READING");
    expect(activityKind(phase)).toBe("Phase & clock");
    expect(activityAction(row({ entity: "events", changes: { paused: { from: false, to: true } } }))).toBe("Paused the event");
    const sw = row({ entity: "events", changes: { features: { from: { judge_auto: false, x: 1 }, to: { judge_auto: true, x: 1 } } } });
    expect(activityAction(sw)).toBe("Switch judge auto on");
    expect(activityKind(sw)).toBe("Switches");
    expect(activityDetails(sw)).toEqual([]);
  });

  test("event log lines, judge runs, refusals and the generic line", () => {
    expect(activityAction(row({ entity: "event_log", action: "insert", changes: { what: "Paused the event", kind: "CONTROL" } }))).toBe("Paused the event");
    expect(activityAction(row({ entity: "judge_runs", action: "insert", changes: { runs: { to: 12 } } }))).toBe("Queued judge runs (12)");
    const refused = row({ action: "rejected", entity: "desk_check_in", changes: { code: { to: "CARD_TAKEN" } } });
    expect(activityAction(refused)).toBe("Refused: desk check in");
    expect(activityKind(refused)).toBe("Refused");
    expect(activityAction(row({ entity: "members", action: "insert", rows: 4 }))).toBe("Added members (4 rows)");
    expect(activityDetails(row({ entity: "bulletins", action: "delete", changes: { title: { from: "Old" } } }))).toEqual(["title was Old"]);
  });

  test("values and the details limit", () => {
    expect(showValue(null)).toBe("—");
    expect(showValue({ a: 1 })).toBe('{"a":1}');
    expect(showValue("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
    const many = row({ changes: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, { to: i }])) });
    expect(activityDetails(many)).toHaveLength(7);
    expect(activityDetails(many).at(-1)).toBe("+3 more");
    expect(featureChanges({ from: { a: true }, to: { a: false, b: true } })).toEqual(["a off", "b on"]);
  });

  test("filters by kind and text", () => {
    const rows = [
      row({ id: 1, changes: { checked_in_at: { from: null, to: "x" } } }),
      row({ id: 2, entity: "events", entity_label: "Night", actor_name: "Lead", actor_email: "full01@example.org", actor_role: "ORGANISER", changes: { current_phase: { from: "A", to: "B" } } }),
    ];
    expect(filterActivity(rows, { kind: "Desk" }).map((r) => r.id)).toEqual([1]);
    expect(filterActivity(rows, { q: "full01" }).map((r) => r.id)).toEqual([2]);
    expect(filterActivity(rows, { q: "alpha" }).map((r) => r.id)).toEqual([1]);
    expect(filterActivity(rows, {})).toHaveLength(2);
  });
});
