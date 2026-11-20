// Anti-saturation guardrails (migration 069): a one-round cooling-off after a ±10% round on a PRIMUS night, and the
// raise caps (10% of a company per fund through raises, one raise per fund per crisis).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
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

async function toCrisis1(n: Night, squads: number, tag: string) {
  const seed = sha256Hex(tag);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, String(squads));
  const s = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Cool Co ${i}`, ticker: ["CLA", "CLB", "CLC", "CLD", "CLE"][i], problem: "A real problem." }, 0);
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
  return s;
}

describe("cooling-off after a ±10% round", () => {
  test("a company that moved the full 10% takes no orders for one round; the others trade; then it reopens", async () => {
    const n = await Night.create(db.pool, 5, "PRIMUS");
    const [a, b, c, d, e] = await toCrisis1(n, 5, "cooling");
    // Round 1: four funds buy 12,000 shares of A's company (over the 10,000 cap: +10%); 3,000 of B's (+3%).
    await n.openRound(1);
    await n.orderNet(a!.company_id, 12_000, [b!.f_code, c!.f_code, d!.f_code, e!.f_code]);
    await n.orderNet(b!.company_id, 3_000, [c!.f_code]);
    const r1 = await n.clearRound(1);
    expect(r1.companies[a!.company_id]!.cappedNet).toBe(10_000);

    // Round 2: A's company is cooling off: every kind of order is refused, with the reason; B's trades as usual.
    await n.openRound(2);
    for (const [type, qty] of [["BUY", 100], ["SELL", 100]] as const) {
      expect(await n.call(n.team(b!.f_code), "place_order", a!.company_id, type, qty)).toMatchObject({ ok: false, code: "COOLING_OFF" });
    }
    const msg = await n.call(n.team(c!.f_code), "place_order", a!.company_id, "SHORT", 100);
    expect(msg).toMatchObject({ ok: false, code: "COOLING_OFF" });
    expect(String(msg.message)).toContain("cooling off for one round");
    await n.ok(n.team(d!.f_code), "place_order", b!.company_id, "BUY", 100);
    // The trade desk reads which companies are cooling off: the same companies the order check refuses.
    const cooling = await as(db.pool, n.team(c!.f_code), async (cl) =>
      (await cl.query("select public.cooling_off_companies($1) as ids", [n.eventId])).rows[0].ids as string[]);
    expect(cooling).toEqual([a!.company_id]);
    const refused = await n.q("select id from companies where event_id = $1 and app.cooling_off(id) order by id", [n.eventId]);
    expect(refused.map((r) => r.id)).toEqual(cooling);
    const r2 = await n.clearRound(2);
    expect(r2.companies[a!.company_id]!.net).toBe(0);

    // Round 3: the cooling-off is over.
    await n.openRound(3);
    await n.ok(n.team(b!.f_code), "place_order", a!.company_id, "SELL", 100);
    expect(await as(db.pool, n.team(c!.f_code), async (cl) =>
      (await cl.query("select public.cooling_off_companies($1) as ids", [n.eventId])).rows[0].ids as string[])).toEqual([]);
    await n.clearRound(3);
    await n.checkInvariants();
  });

  test("a classic night has no cooling-off", async () => {
    const n = await Night.create(db.pool, 4, "CLASSIC");
    expect((await n.one("select format from events where id = $1", [n.eventId])).format).toBe("CLASSIC");
    const anyCompany = await n.q("select app.cooling_off(id) as c from companies where event_id = $1 limit 1", [n.eventId]);
    for (const r of anyCompany) expect(r.c).toBe(false);
  });
});

describe("raise caps", () => {
  test("one raise per fund per crisis, and at most 10% of a company through raises", async () => {
    const n = await Night.create(db.pool, 4, "PRIMUS");
    const [a, b, c] = await toCrisis1(n, 4, "raise-caps");
    const fund = n.team(c!.f_code);
    // A sells 8% to C's fund; B's raise is then refused for C's fund in the same crisis.
    const ra = (await n.ok(n.team(a!.p_code), "post_raise", 8_000, "")).raise;
    const rb = (await n.ok(n.team(b!.p_code), "post_raise", 1_000, "")).raise;
    await n.ok(fund, "fund_raise", ra.id);
    expect(await n.call(fund, "fund_raise", rb.id)).toMatchObject({ ok: false, code: "ONE_RAISE" });
    expect((await n.one("select status from raises where id = $1", [rb.id])).status).toBe("OPEN");

    // Next crisis: A raises 5% more; C's fund already holds 8,000 of A through raises: 13,000 would pass 10%.
    for (const code of ["HIRE_1", "DUE_1", "RATE_1"]) await n.deadlinePassed(code);
    await n.ok(n.lead, "tick", n.eventId);
    await n.deadlinePassed("REVEAL_2");
    await n.ok(n.lead, "tick", n.eventId);
    const ra2 = (await n.ok(n.team(a!.p_code), "post_raise", 5_000, "")).raise;
    expect(await n.call(fund, "fund_raise", ra2.id)).toMatchObject({ ok: false, code: "RAISE_CAP" });
    // 2,000 more is within 10%.
    await n.ok(n.team(a!.p_code), "cancel_raise", ra2.id);
    const ra3 = (await n.ok(n.team(a!.p_code), "post_raise", 2_000, "")).raise;
    await n.ok(fund, "fund_raise", ra3.id);
    expect((await n.one("select qty from holdings where team_id = $1 and company_id = $2 and lot = 'SQUAD'", [n.teamId(c!.f_code), a!.company_id])).qty).toBe(10_000);
  });
});
