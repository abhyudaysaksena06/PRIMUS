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
  test("the caps are 70 per track and 210 teams by default (098)", async () => {
    expect((await db.pool.query("select app.track_cap() as c")).rows[0].c).toBe(70);
    expect((await db.pool.query("select app.team_cap() as c")).rows[0].c).toBe(210);
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
      await n.q("create or replace function app.track_cap() returns int language sql immutable set search_path = '' as $$ select 70 $$");
    }
  });
});

describe("the desk's cap on participants (096)", () => {
  test("the cap is 675 by default", async () => {
    expect((await db.pool.query("select app.participant_cap() as c")).rows[0].c).toBe(675);
  });

  test("admitting or growing a team past the cap is refused; shrinking is allowed; a check-out frees places", async () => {
    const n = await Night.create(db.pool, 3);
    await n.q("create or replace function app.participant_cap() returns int language sql immutable set search_path = '' as $$ select 4 $$");
    try {
      await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
      const codes = (track: string) => n.ev.plan.teams.filter((t) => t.track === track).map((t) => t.code).sort();
      const two = (a: string) => JSON.stringify([{ full_name: `${a}1` }, { full_name: `${a}2` }]);
      const [p1] = codes("PRODUCT");
      const [c1] = codes("CONSULTING");
      const [f1] = codes("FINANCE");
      await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p1, "P", two("p"));
      await n.ok(n.lead, "desk_check_in", n.eventId, "CONSULTING", c1, "C", two("c")); // 4 of 4
      expect((await n.call(n.lead, "desk_check_in", n.eventId, "FINANCE", f1, "F", two("f"))).code).toBe("PARTICIPANTS_FULL");
      // Growing an admitted team past the cap is refused; shrinking it is fine.
      expect((await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", p1, "P", JSON.stringify([{ full_name: "a" }, { full_name: "b" }, { full_name: "c" }]), null, true)).code).toBe("PARTICIPANTS_FULL");
      await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p1, "P", JSON.stringify([{ full_name: "solo" }]), null, true); // 3 of 4
      await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", f1, "F", JSON.stringify([{ full_name: "f1" }])); // 4 of 4
      const id = (await n.one("select id from teams where event_id = $1 and code = $2", [n.eventId, c1])).id;
      await n.ok(n.lead, "desk_check_out", n.eventId, id); // 2 of 4
      await n.ok(n.lead, "desk_check_in", n.eventId, "CONSULTING", codes("CONSULTING")[1], "C2", two("d"));
    } finally {
      await n.q("create or replace function app.participant_cap() returns int language sql immutable set search_path = '' as $$ select 675 $$");
    }
  });
});

describe("the desk's cap on teams in all (098)", () => {
  test("a team past the total cap is refused, whatever its track; a check-out frees a place", async () => {
    const n = await Night.create(db.pool, 3);
    await n.q("create or replace function app.team_cap() returns int language sql immutable set search_path = '' as $$ select 2 $$");
    try {
      await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
      const codes = (track: string) => n.ev.plan.teams.filter((t) => t.track === track).map((t) => t.code).sort();
      await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", codes("PRODUCT")[0], "P", one("a"));
      await n.ok(n.lead, "desk_check_in", n.eventId, "CONSULTING", codes("CONSULTING")[0], "C", one("b"));
      expect((await n.call(n.lead, "desk_check_in", n.eventId, "FINANCE", codes("FINANCE")[0], "F", one("c"))).code).toBe("TEAMS_FULL");
      const id = (await n.one("select id from teams where event_id = $1 and code = $2", [n.eventId, codes("PRODUCT")[0]])).id;
      await n.ok(n.lead, "desk_check_out", n.eventId, id);
      await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", codes("FINANCE")[0], "F", one("c"));
    } finally {
      await n.q("create or replace function app.team_cap() returns int language sql immutable set search_path = '' as $$ select 210 $$");
    }
  });
});
