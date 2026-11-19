// Compulsory hiring and the registration desk. When hiring closes, a company that has not hired is matched to a firm
// (app.assign_default_firms). On a live night the desk is on, and a team that never checked in at the desk cannot sign
// in, so it can write nothing: a no-show firm must not be handed a client, and a no-show company must not be charged
// the base fee or take a firm's place.

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

describe("compulsory hiring with the registration desk on", () => {
  test("only checked-in firms are assigned, and only checked-in companies are charged", async () => {
    const n = await Night.create(db.pool, 4, "PRIMUS");
    const seed = sha256Hex("desk-hiring");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    const s = [await n.squad(1), await n.squad(2), await n.squad(3), await n.squad(4)];
    await n.advanceTo("BUILD");
    for (const [i, q] of s.entries()) {
      await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Desk Co ${i}`, ticker: ["DKA", "DKB", "DKC", "DKD"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const q of s) await n.judge(q.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);

    // The desk is on and everyone is checked in except squad 1's firm and squad 4's company (no-shows).
    // The absent firm is the one the match would pick first (the lowest code), so the test cannot pass by luck.
    const absentFirm = (await n.one(
      "select id from teams where event_id = $1 and track = 'CONSULTING' order by code collate \"C\" limit 1", [n.eventId])).id;
    const absentCompanyTeam = n.teamId(s[3]!.p_code);
    await n.q("update events set desk_check_in = true where id = $1", [n.eventId]);
    await n.q("update teams set checked_in_at = now() where event_id = $1 and id not in ($2, $3)", [n.eventId, absentFirm, absentCompanyTeam]);
    const absentCash = BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [absentCompanyTeam])).c);

    await n.deadlinePassed("HIRE_1");
    await n.ok(n.lead, "tick", n.eventId);

    const engaged = await n.q("select company_id, firm_team_id from engagements where event_id = $1 and k = 1", [n.eventId]);
    // The three present companies each got a firm, and none of them got the firm that never turned up.
    for (const q of s.slice(0, 3)) {
      const e = engaged.find((r) => r.company_id === q.company_id);
      expect(e, `company of squad ${q.squad_no}`).toBeDefined();
      expect(e!.firm_team_id).not.toBe(absentFirm);
    }
    // The absent company was not matched, and kept its cash.
    expect(engaged.find((r) => r.company_id === s[3]!.company_id)).toBeUndefined();
    expect(BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [absentCompanyTeam])).c)).toBe(absentCash);
  });

  test("with the desk off (a rehearsal), every team counts as present", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("desk-off");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const s = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    for (const [i, q] of s.entries()) {
      await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Off Co ${i}`, ticker: ["OFA", "OFB", "OFC"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const q of s) await n.judge(q.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select desk_check_in from events where id = $1", [n.eventId])).desk_check_in).toBe(false);
    await n.deadlinePassed("HIRE_1");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select count(*)::int as c from engagements where event_id = $1 and k = 1 and assigned", [n.eventId])).toEqual([{ c: 3 }]);
  });
});
