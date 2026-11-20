// Migration 100: the organisers' Activity page. A desk check-in by a registration account, a phase advance by an
// organiser and a switch each appear in staff_activity with the right actor; only organisers may read it; the roster
// and the Round 3 statements are now audited too, and a failing logger never blocks the action.

import { randomUUID } from "node:crypto";
import { sha256Hex } from "@msim/engine";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Night } from "./night";
import { rowsAs, user, type Caller } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
let n: Night;
let desk: Caller;
let deskId: string;

interface Row {
  at: string;
  actor_id: string;
  actor_email: string;
  actor_name: string;
  actor_role: string;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  rows: number;
  changes: Record<string, { from?: unknown; to?: unknown }> & { what?: string };
}

const activity = (caller: Caller, actor: string | null = null) =>
  rowsAs<Row>(db.pool, caller, "select * from public.staff_activity($1, $2)", [n.eventId, actor]);

beforeAll(async () => {
  db = await createTestDb();
  n = await Night.create(db.pool, 3);
  deskId = randomUUID();
  await db.pool.query("insert into auth.users (id, email) values ($1, 'registration01@example.org')", [deskId]);
  await db.pool.query("insert into accounts (user_id, role, display_name) values ($1, 'REGISTRATION', 'Desk one')", [deskId]);
  desk = user(deskId);
});
afterAll(async () => {
  await db?.drop();
});

describe("staff activity", () => {
  test("a desk check-in, a phase advance and a switch each show, with who did it", async () => {
    const leadId = n.ev.staff.get("lead@example.org")!;
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    const code = n.ev.plan.teams[0]!.code;
    await n.ok(desk, "desk_check_in", n.eventId, null, code, "Alpha", JSON.stringify([{ full_name: "Asha" }]));
    await n.org("set_seed_commitment", n.eventId, sha256Hex("staff-activity-seed"));
    const from = await n.phase();
    await n.q("update phases set starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours' where event_id = $1 and seq > (select seq from phases where event_id = $1 and code = $2)", [n.eventId, from]);
    const adv = await n.call(n.lead, "advance_phase", n.eventId, from);
    expect(adv.ok, JSON.stringify(adv)).toBe(true);
    await n.call(n.lead, "set_feature", n.eventId, "judge_auto", true);

    const rows = await activity(n.lead);
    // The check-in: one line for the team, by the desk, with what changed.
    const checkIn = rows.find((r) => r.entity === "teams" && r.action === "update" && r.changes.checked_in_at);
    expect(checkIn).toMatchObject({ actor_id: deskId, actor_email: "registration01@example.org", actor_name: "Desk one", actor_role: "REGISTRATION" });
    expect(checkIn!.entity_label).toBe(`${code} · Alpha`);
    expect(checkIn!.changes.name).toMatchObject({ to: "Alpha" });
    // The members it added are one line, not one per member.
    expect(rows.filter((r) => r.entity === "members" && r.actor_id === deskId)).toHaveLength(1);
    // The phase advance, by the lead organiser.
    const phase = rows.find((r) => r.entity === "events" && r.changes.current_phase);
    expect(phase).toMatchObject({ actor_id: leadId, actor_role: "ORGANISER", actor_email: "lead@example.org" });
    expect(phase!.changes.current_phase).toMatchObject({ from });
    // The switch.
    const feature = rows.find((r) => r.entity === "events" && r.changes.features);
    expect(feature).toMatchObject({ actor_id: leadId, actor_role: "ORGANISER" });
    // Newest first.
    const times = rows.map((r) => new Date(r.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // No team's own actions.
    expect(rows.every((r) => r.actor_role !== "TEAM")).toBe(true);

    // Filtered to one account.
    const mine = await activity(n.lead, deskId);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.actor_id === deskId)).toBe(true);
    // Paged.
    const older = await rowsAs<Row>(db.pool, n.lead, "select * from public.staff_activity($1, null, 2, null)", [n.eventId]);
    expect(older).toHaveLength(2);
    const next = await rowsAs<Row>(db.pool, n.lead, "select * from public.staff_activity($1, null, 500, $2)", [n.eventId, older[1]!.at]);
    expect(next.every((r) => new Date(r.at) < new Date(older[1]!.at))).toBe(true);
  });

  test("the staff list; only organisers may read either", async () => {
    const staff = await rowsAs<{ email: string; role: string }>(db.pool, n.lead, "select * from public.staff_accounts()");
    expect(staff.map((s) => s.email)).toEqual(expect.arrayContaining(["lead@example.org", "registration01@example.org", "fairness@example.org"]));
    expect(staff.every((s) => s.role !== "TEAM")).toBe(true);
    const team = n.team(n.ev.plan.teams[1]!.code);
    for (const caller of [desk, n.fairness, team]) {
      await expect(activity(caller)).rejects.toThrow(/only an organiser/);
      await expect(rowsAs(db.pool, caller, "select * from public.staff_accounts()")).rejects.toThrow(/only an organiser/);
    }
  });

  test("roster edits are audited; a failing logger does not block the action", async () => {
    await n.ok(desk, "import_roster", n.eventId, JSON.stringify([{ team_name: "Roster one", track: "Product", members: [] }]), false);
    const rows = await activity(n.lead, deskId);
    expect(rows.find((r) => r.entity === "roster" && r.action === "insert")).toMatchObject({ actor_role: "REGISTRATION" });

    // Break the logger's insert for one transaction (a check that every audit row fails): the roster edit still lands.
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("alter table audit_log add constraint audit_off check (false) not valid");
      await c.query("insert into roster (event_id, number, team_name, track) values ($1, 99, 'Roster two', 'PRODUCT')", [n.eventId]);
      expect((await c.query("select count(*)::int as c from roster where event_id = $1 and number = 99", [n.eventId])).rows[0].c).toBe(1);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
