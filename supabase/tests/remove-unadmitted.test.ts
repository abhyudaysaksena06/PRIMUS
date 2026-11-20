// Migration 101: after registration the organisers remove every card the desk did not admit (remove_unadmitted):
// the team, its login (auth.users) and account, its members and everything else of it go; the team list stays,
// unlinked. Admitted teams, staff and other events are untouched; it refuses non-organisers, a wrong confirmation,
// desk check-in off and a drawn event; a second run removes nothing; the squad draw and a reset to new work after it.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { createTestDb } from "./pg";
import { rowsAs, user, type Caller } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
let registration: Caller;
beforeAll(async () => {
  db = await createTestDb();
  const id = randomUUID();
  await db.pool.query("insert into auth.users (id, email) values ($1, 'registration-rm@example.org')", [id]);
  await db.pool.query("insert into accounts (user_id, role, display_name) values ($1, 'REGISTRATION', 'Registration desk')", [id]);
  registration = user(id);
});
afterAll(async () => {
  await db?.drop();
});

const one = (name: string) => JSON.stringify([{ full_name: name, roll_number: null }]);
const codesOf = (n: Night, track: string) =>
  n.ev.plan.teams.filter((t) => t.track === track).map((t) => t.code).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));

/** Desk on; admits the first `counts` cards of each track. Returns the admitted and the unadmitted codes. */
async function admit(n: Night, counts: { PRODUCT: number; CONSULTING: number; FINANCE: number }) {
  await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
  const admitted: string[] = [];
  const left: string[] = [];
  for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
    const codes = codesOf(n, track);
    for (const [i, code] of codes.entries()) {
      if (i < counts[track]) {
        await n.ok(n.lead, "desk_check_in", n.eventId, track, code, `Team ${code}`, one(`Member ${code}`));
        admitted.push(code);
      } else left.push(code);
    }
  }
  return { admitted, left };
}

const count = async (n: Night, sql: string, params: unknown[]) => (await n.one(`select count(*)::int as c ${sql}`, params)).c as number;

describe("remove the teams not admitted", () => {
  test("removes exactly the unadmitted cards and their logins; keeps admitted teams, logins, members, the list, staff, other events", async () => {
    const n = await Night.create(db.pool, 4, "PRIMUS");
    const other = await Night.create(db.pool, 3, "PRIMUS");
    const { admitted, left } = await admit(n, { PRODUCT: 3, CONSULTING: 3, FINANCE: 4 });
    expect(left).toHaveLength(2);
    // The team list: one row linked to an admitted team (by the desk), one uploaded row still unlinked, and one linked
    // to a card that is not admitted (as an older desk could leave it).
    await n.ok(n.lead, "import_roster", n.eventId, JSON.stringify([{ team_name: "Listed", members: [] }, { team_name: "Stale", members: [] }]), false);
    const stale = await n.one("select id from roster where event_id = $1 and team_name = 'Stale'", [n.eventId]);
    await n.q("update roster set team_id = $1 where id = $2", [n.teamId(left[0]!), stale.id]);
    const rosterBefore = await count(n, "from roster where event_id = $1", [n.eventId]);
    const staffBefore = await count(n, "from accounts where team_id is null", []);
    const otherTeams = await count(n, "from teams where event_id = $1", [other.eventId]);
    const removedUsers = left.map((c) => n.ev.teams.get(c)!.userId);
    const removedTeams = left.map((c) => n.teamId(c));
    expect(await n.call(n.team(left[0]!), "my_desk_status")).toEqual({ team: true, admitted: false });

    const r = await n.ok(n.lead, "remove_unadmitted", n.eventId, `REMOVE ${n.ev.plan.event.slug}`);
    expect(r).toMatchObject({ teams: 2, logins: 2 });

    // Gone: the teams, their accounts, their logins, their members, their companies.
    expect(await count(n, "from teams where id = any($1)", [removedTeams])).toBe(0);
    expect(await count(n, "from accounts where user_id = any($1)", [removedUsers])).toBe(0);
    expect(await count(n, "from auth.users where id = any($1)", [removedUsers])).toBe(0);
    expect(await count(n, "from members where team_id = any($1)", [removedTeams])).toBe(0);
    expect(await count(n, "from companies where product_team_id = any($1)", [removedTeams])).toBe(0);
    expect(await count(n, "from ledger_entries where team_id = any($1)", [removedTeams])).toBe(0);
    // A removed card can no longer sign in: no login, no account, nothing to read.
    const gone = n.team(left[0]!);
    expect(await n.call(gone, "my_desk_status")).toEqual({ team: false, admitted: false });
    expect(await rowsAs(db.pool, gone, "select id from teams")).toEqual([]);

    // Kept: every admitted team with its login, account and members; the whole list; staff; the other event.
    expect((await n.q("select code from teams where event_id = $1 order by code", [n.eventId])).map((t) => t.code)).toEqual([...admitted].sort());
    const keptUsers = admitted.map((c) => n.ev.teams.get(c)!.userId);
    expect(await count(n, "from auth.users where id = any($1)", [keptUsers])).toBe(admitted.length);
    expect(await count(n, "from accounts where user_id = any($1) and team_id is not null", [keptUsers])).toBe(admitted.length);
    expect(await count(n, "from members where event_id = $1", [n.eventId])).toBe(admitted.length);
    expect(await count(n, "from roster where event_id = $1", [n.eventId])).toBe(rosterBefore);
    expect((await n.one("select team_id from roster where id = $1", [stale.id])).team_id).toBeNull();
    expect(await count(n, "from accounts where team_id is null", [])).toBe(staffBefore);
    expect(await count(n, "from teams where event_id = $1", [other.eventId])).toBe(otherTeams);
    expect(await n.call(n.team(admitted[0]!), "my_desk_status")).toEqual({ team: true, admitted: true });
    await n.checkInvariants();

    // Audited; the desk has no free card left, and says why.
    const log = await n.one("select actor_user_id, before from audit_log where event_id = $1 and action = 'remove_unadmitted'", [n.eventId]);
    expect(log.before).toMatchObject({ teams: 2, logins: 2 });
    expect(log.actor_user_id).toBe(n.ev.staff.get("lead@example.org"));
    expect(await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "Walk in", one("W"))).toMatchObject({
      ok: false, code: "NO_FREE_CARD", message: "No free card — all unused cards were removed.",
    });

    // Idempotent.
    expect(await n.ok(n.lead, "remove_unadmitted", n.eventId, `REMOVE ${n.ev.plan.event.slug}`)).toMatchObject({ teams: 0, logins: 0 });
    expect(await count(n, "from teams where event_id = $1", [n.eventId])).toBe(admitted.length);
  });

  test("refusals: not an organiser, the wrong confirmation, desk check-in off, every card drawn, after the draw", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const slug = n.ev.plan.event.slug;
    const before = await count(n, "from teams where event_id = $1", [n.eventId]);

    expect(await n.call(n.lead, "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).toMatchObject({ ok: false, code: "DESK_OFF" });
    expect((await n.call(n.lead, "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).message).toMatch(/turn desk check-in on first/);
    await admit(n, { PRODUCT: 3, CONSULTING: 3, FINANCE: 2 });
    await expect(n.call(registration, "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).rejects.toThrow(/only an organiser/);
    await expect(n.call(n.fairness, "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).rejects.toThrow(/only an organiser/);
    await expect(n.call(n.team(codesOf(n, "PRODUCT")[0]!), "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).rejects.toThrow(/only an organiser/);
    expect(await n.call(n.lead, "remove_unadmitted", n.eventId, slug)).toMatchObject({ ok: false, code: "CONFIRM" });
    expect(await n.call(n.lead, "remove_unadmitted", n.eventId, `REMOVE other`)).toMatchObject({ ok: false, code: "CONFIRM" });
    await n.org("set_feature", n.eventId, "draw_checked_in", false);
    expect(await n.call(n.lead, "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).toMatchObject({ ok: false, code: "DRAW_ALL" });
    await n.org("set_feature", n.eventId, "draw_checked_in", true);
    expect(await count(n, "from teams where event_id = $1", [n.eventId])).toBe(before);

    const seed = sha256Hex("remove-after-draw");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    // Only 2 Finance teams are checked in: the draw needs 3; admit the third, then draw.
    await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", codesOf(n, "FINANCE")[2], "Third", one("T"));
    await n.org("run_lottery", n.eventId, seed, "4");
    expect(await n.call(n.lead, "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).toMatchObject({ ok: false, code: "DRAWN" });
    expect(await count(n, "from teams where event_id = $1", [n.eventId])).toBe(before);
  });

  test("the squad draw afterwards seats only the admitted teams; a reset to new rebuilds only the remaining cards", async () => {
    const n = await Night.create(db.pool, 5, "PRIMUS");
    const slug = n.ev.plan.event.slug;
    const { admitted } = await admit(n, { PRODUCT: 4, CONSULTING: 3, FINANCE: 5 });
    expect(await n.ok(n.lead, "remove_unadmitted", n.eventId, `REMOVE ${slug}`)).toMatchObject({ teams: 3, logins: 3 });
    expect(await n.org("draw_preview", n.eventId)).toMatchObject({ drawn: false, squads: 3 });

    // Reset to new after the removal: only the admitted cards come back, still admitted, with their logins.
    const r = await n.ok(n.lead, "reset_event", n.eventId, slug);
    const id = r.event_id as string;
    const rebuilt = await n.q("select code, checked_in_at from teams where event_id = $1 order by code", [id]);
    expect(rebuilt.map((t) => t.code)).toEqual([...admitted].sort());
    expect(rebuilt.every((t) => t.checked_in_at !== null)).toBe(true);
    expect((await n.one("select unadmitted_removed_at from events where id = $1", [id])).unadmitted_removed_at).not.toBeNull();
    const reset = new Night(db.pool, { ...n.ev, eventId: id });
    expect(await n.call(reset.team(admitted[0]!), "my_desk_status")).toEqual({ team: true, admitted: true });

    const seed = sha256Hex("remove-then-draw");
    await reset.org("set_seed_commitment", id, sha256Hex(seed));
    await reset.advanceTo("SQUAD_DRAW");
    expect((await reset.org("run_lottery", id, seed, "2")).squads).toBe(3);
    const seated = await n.q(
      `select p.code as p, c.code as c, f.code as f from squads s
         join teams p on p.id = s.product_team_id join teams c on c.id = s.consulting_team_id join teams f on f.id = s.finance_team_id
        where s.event_id = $1`,
      [id],
    );
    expect(seated).toHaveLength(3);
    for (const s of seated) for (const code of [s.p, s.c, s.f]) expect(admitted).toContain(code);
    const rec = await n.one("select left_out from draw_records where event_id = $1", [id]);
    expect([rec.left_out.product.length, rec.left_out.consulting.length, rec.left_out.finance.length]).toEqual([1, 0, 2]);
    await reset.checkInvariants();
  });
});
