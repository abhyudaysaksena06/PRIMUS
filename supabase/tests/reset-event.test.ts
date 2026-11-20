// Reset to new (migration 085): the live event is wiped back to Setup and built again from its creation payload; the
// registration desk's work (names, members, check-ins, team list) and the event's settings are kept; a typed
// confirmation is required; only organisers can reset.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

describe("reset the live event to new", () => {
  test("wipes play, keeps logins, registrations and settings; asks for the slug; organisers only", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const slug = (await n.one("select slug from events where id = $1", [n.eventId])).slug as string;
    // Make it the live event (as created by pnpm event-sql), payload included.
    await n.q("update events set is_rehearsal = false where id = $1", [n.eventId]);
    await n.q("update app.seed_payloads set payload = jsonb_set(payload, '{event,is_rehearsal}', 'false') where slug = $1", [slug]);
    const plannedCheckin = (await n.one("select starts_at from phases where event_id = $1 and code = 'CHECKIN'", [n.eventId])).starts_at;
    const logins = await n.q("select code, user_id from teams t join accounts a on a.team_id = t.id where t.event_id = $1 order by code", [n.eventId]);

    // The desk registers the test teams (3 per track); the team list has a row; a switch is changed.
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    // The draw needs 3 checked-in teams per track: the test setup registers 3 per track.
    const codes = (await n.q("select code from teams where event_id = $1 order by code", [n.eventId])).map((r) => r.code as string);
    for (const [i, code] of codes.entries()) {
      await n.ok(n.lead, "desk_check_in", n.eventId, null, code, `Test ${i + 1}`, JSON.stringify([{ full_name: `Member ${i + 1}`, roll_number: `R${i + 1}` }]));
    }
    await n.org("set_feature", n.eventId, "submit_last_5", true);
    // Round 3 statements uploaded after creation (Content page) survive the reset too (migration 086).
    await n.q("insert into problem_statements (event_id, number, title, body, cap, sector) select $1, 1, 'S1', 'Body', 7, (select sector from problem_cards where event_id = $1 limit 1)", [n.eventId]);
    const rosterBefore = (await n.one("select count(*)::int as c from roster where event_id = $1", [n.eventId])).c;

    // Play: the draw and Round 1.
    const seed = sha256Hex("reset-event");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    await n.advanceTo("BUILD");
    expect((await n.one("select count(*)::int as c from squads where event_id = $1", [n.eventId])).c).toBe(3);

    // Teams cannot reset; a wrong confirmation is refused and changes nothing.
    const team = n.team(codes[0]!);
    await expect(n.call(team, "reset_event", n.eventId, slug)).rejects.toThrow(/only an organiser/);
    expect((await n.call(n.lead, "reset_event", n.eventId, "nope")).code).toBe("CONFIRM");
    expect((await n.one("select current_phase from events where id = $1", [n.eventId])).current_phase).toBe("BUILD");

    const r = await n.ok(n.lead, "reset_event", n.eventId, slug);
    const id = r.event_id as string;
    const ev = await n.one("select slug, is_rehearsal, current_phase, seed_commitment, desk_check_in, features from events where id = $1", [id]);
    // 093: the published seed commitment survives every reset.
    expect(ev).toMatchObject({ slug, is_rehearsal: false, current_phase: "SETUP", seed_commitment: sha256Hex(seed), desk_check_in: true });
    expect(ev.features).toMatchObject({ submit_last_5: true });
    expect((await n.one("select count(*)::int as c from events where slug = $1", [slug])).c).toBe(1);
    // Same logins; play gone; planned times kept for a live event.
    expect(await n.q("select code, user_id from teams t join accounts a on a.team_id = t.id where t.event_id = $1 order by code", [id])).toEqual(logins);
    expect((await n.one("select count(*)::int as c from squads where event_id = $1", [id])).c).toBe(0);
    expect((await n.one("select starts_at from phases where event_id = $1 and code = 'CHECKIN'", [id])).starts_at).toEqual(plannedCheckin);
    // The desk's work is kept: names, members, check-ins, the team list.
    const reg = await n.q("select code, name, checked_in_at is not null as checked from teams where event_id = $1 and code = any($2) order by code", [id, codes]);
    expect(reg.map((x) => [x.code, x.checked])).toEqual([...codes].sort().map((c) => [c, true]));
    expect(reg.every((x) => /^Test \d+$/.test(x.name))).toBe(true);
    expect((await n.one("select count(*)::int as c from members where event_id = $1", [id])).c).toBe(codes.length);
    expect((await n.one("select count(*)::int as c from roster where event_id = $1", [id])).c).toBe(rosterBefore);
    expect((await n.q("select what from event_log where event_id = $1", [id])).map((x) => x.what)).toContain(
      "Reset to new: everything played was wiped; registrations, settings and Round 3 statements kept",
    );
    expect((await n.one("select count(*)::int as c from problem_statements where event_id = $1", [id])).c).toBe(1);
    // A checked-in team can sign in and act again at once.
    const again = await n.one("select app.team_admitted(id) as ok from teams where event_id = $1 and code = $2", [id, codes[0]]);
    expect(again.ok).toBe(true);
  });

  test("final reset: test teams (TEST- roll numbers) are unregistered, real registrations stay; needs FINAL <slug>", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const slug = (await n.one("select slug from events where id = $1", [n.eventId])).slug as string;
    await n.q("update events set is_rehearsal = false where id = $1", [n.eventId]);
    await n.q("update app.seed_payloads set payload = jsonb_set(payload, '{event,is_rehearsal}', 'false') where slug = $1", [slug]);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    const commitment = sha256Hex(sha256Hex("final-reset"));
    await n.org("set_seed_commitment", n.eventId, commitment);
    const codes = (await n.q("select code from teams where event_id = $1 order by code", [n.eventId])).map((r) => r.code as string);
    const [real, ...tests] = codes;
    for (const code of tests) {
      await n.ok(n.lead, "desk_check_in", n.eventId, null, code, `Test ${code}`, JSON.stringify([{ full_name: `Tester ${code}`, roll_number: `TEST-${code}` }]));
    }
    await n.ok(n.lead, "desk_check_in", n.eventId, null, real, "Real Team", JSON.stringify([{ full_name: "Asha", roll_number: "R100" }]));
    // A test reset keeps the test teams; the final reset needs "FINAL <slug>".
    let r = await n.ok(n.lead, "reset_event", n.eventId, slug);
    let id = r.event_id as string;
    expect((await n.one("select count(*)::int as c from teams where event_id = $1 and checked_in_at is not null", [id])).c).toBe(codes.length);
    expect((await n.call(n.lead, "reset_event", id, slug, true)).code).toBe("CONFIRM");
    r = await n.ok(n.lead, "reset_event", id, `FINAL ${slug}`, true);
    id = r.event_id as string;
    expect([...(r.test_teams_unregistered as string[])].sort()).toEqual([...tests].sort());
    // 093: neither the test reset nor the final reset removes the seed commitment.
    expect((await n.one("select seed_commitment from events where id = $1", [id])).seed_commitment).toBe(commitment);
    const checked = (await n.q("select code, name from teams where event_id = $1 and checked_in_at is not null", [id]));
    expect(checked).toEqual([{ code: real, name: "Real Team" }]);
    expect((await n.q("select roll_number from members where event_id = $1", [id])).map((m) => m.roll_number)).toEqual(["R100"]);
    expect((await n.q("select what from event_log where event_id = $1", [id])).map((x) => x.what).join(" ")).toMatch(/Final reset: .* test teams unregistered/);
  });
});
