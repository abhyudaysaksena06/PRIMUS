// Migration 095: at most app.track_cap() (90) admitted teams per track at the desk. The cap is lowered to 2 here.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const one = (name: string) => JSON.stringify([{ full_name: name, roll_number: null }]);

describe("the desk's cap per track", () => {
  test("the cap is 90 by default", async () => {
    expect((await db.pool.query("select app.track_cap() as c")).rows[0].c).toBe(90);
  });

  test("a third Product team is refused at a cap of 2; edits still work; a check-out frees a place; other tracks unaffected", async () => {
    const n = await Night.create(db.pool, 3);
    await n.q("create or replace function app.track_cap() returns int language sql immutable set search_path = '' as $$ select 2 $$");
    try {
      await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
      const codes = (track: string) => n.ev.plan.teams.filter((t) => t.track === track).map((t) => t.code).sort();
      const [p1, p2, p3] = codes("PRODUCT");
      await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p1, "One", one("A"));
      await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p2, "Two", one("B"));
      const full = await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", p3, "Three", one("C"));
      expect(full.code).toBe("TRACK_FULL");
      expect((await n.one("select checked_in_at from teams where event_id = $1 and code = $2", [n.eventId, p3])).checked_in_at).toBeNull();
      // Correcting an admitted team is not an admission.
      await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p1, "One renamed", JSON.stringify([{ full_name: "A" }, { full_name: "Z" }]), null, true);
      // Another track has its own cap.
      await n.ok(n.lead, "desk_check_in", n.eventId, "CONSULTING", codes("CONSULTING")[0], "Firm", one("D"));
      // Checking one out frees a place.
      const id = (await n.one("select id from teams where event_id = $1 and code = $2", [n.eventId, p2])).id;
      await n.ok(n.lead, "desk_check_out", n.eventId, id);
      await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p3, "Three", one("C"));
    } finally {
      await n.q("create or replace function app.track_cap() returns int language sql immutable set search_path = '' as $$ select 90 $$");
    }
  });
});
