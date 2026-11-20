// Migration 070: the Run page switches. Defaults, setting one, who may, and every screen reading them.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Night } from "./night";
import { as } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

describe("switches", () => {
  test("defaults, set by an organiser, logged, read by every screen; teams and unknown keys refused", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const catalog = await n.q("select key, on_by_default from app.feature_catalog()");
    expect(catalog.length).toBeGreaterThanOrEqual(14);
    // A fresh event uses every default.
    for (const c of catalog) {
      expect((await n.one("select app.feature_on($1, $2) as on", [n.eventId, c.key])).on, c.key).toBe(c.on_by_default);
    }
    expect((await n.one("select app.feature_on($1, 'no_such_key') as on", [n.eventId])).on).toBe(false);

    // event_status (every screen) carries the whole map.
    const code = [...n.ev.teams.keys()][0]!;
    const status = await as(db.pool, n.team(code), async (c) => (await c.query("select public.event_status($1) as s", [n.eventId])).rows[0].s);
    expect(Object.keys(status.features).sort()).toEqual(catalog.map((c) => c.key).sort());
    expect(status.features.judge_auto).toBe(false);

    // An organiser turns one on; it is logged; the map and the Run page list follow.
    const r = await n.org("set_feature", n.eventId, "judge_auto", true);
    expect(r.features.judge_auto).toBe(true);
    expect((await n.one("select app.feature_on($1, 'judge_auto') as on", [n.eventId])).on).toBe(true);
    expect((await n.one("select count(*)::int as n from event_log where event_id = $1 and what like 'Switch on:%'", [n.eventId])).n).toBe(1);
    const list = await as(db.pool, n.lead, async (c) => (await c.query("select * from public.feature_switches($1)", [n.eventId])).rows);
    expect(list.find((s) => s.key === "judge_auto")).toMatchObject({ is_on: true, on_by_default: false, kind: "RULE" });
    // Off again.
    await n.org("set_feature", n.eventId, "judge_auto", false);
    expect((await n.one("select app.feature_on($1, 'judge_auto') as on", [n.eventId])).on).toBe(false);

    // Unknown key and missing value refused; a team may not set or list switches.
    expect(await n.call(n.lead, "set_feature", n.eventId, "no_such_key", true)).toMatchObject({ ok: false, code: "NO_SUCH_SWITCH" });
    expect(await n.call(n.lead, "set_feature", n.eventId, "judge_auto", null)).toMatchObject({ ok: false, code: "BAD_INPUT" });
    await expect(n.call(n.team(code), "set_feature", n.eventId, "judge_auto", true)).rejects.toThrow(/only an organiser/);
    const teamList = await as(db.pool, n.team(code), async (c) => (await c.query("select * from public.feature_switches($1)", [n.eventId])).rows);
    expect(teamList).toEqual([]);
  });
});
