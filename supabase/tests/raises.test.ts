// Round 2 equity raises (migration 067): a Product company sells a stake to a Finance fund at the market price.

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

async function toRound2(n: Night, squads: number) {
  const seed = sha256Hex("raises");
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, String(squads));
  const s = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Raise Co ${i}`, ticker: ["RSA", "RSB", "RSC"][i], problem: "A real problem." }, 0);
    await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const q of s) await n.judge(q.company_id, "PITCH", [60, 60, 60]);
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  // Before Round 2 a raise is refused.
  expect(await n.call(n.team(s[0]!.p_code), "post_raise", 5000, "")).toMatchObject({ ok: false, code: "RAISE_CLOSED" });
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  await n.deadlinePassed("REVEAL_1");
  await n.ok(n.lead, "tick", n.eventId);
  return s;
}

const cash = async (n: Night, id: string) => BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [id])).c);
const qty = async (n: Night, team: string, company: string, lot: string) =>
  Number((await n.one("select coalesce(sum(qty), 0)::int as q from holdings where team_id = $1 and company_id = $2 and lot = $3", [team, company, lot])).q);

describe("equity raises", () => {
  test("a company sells a stake to a fund at the market price, once per crisis, above its 40% floor", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const [a, b, c] = await toRound2(n, 3);
    const product = n.team(a!.p_code);
    const productId = n.teamId(a!.p_code);
    const fundB = n.team(b!.f_code);
    const fundBId = n.teamId(b!.f_code);

    // Only Product raises; the terms are 1%–10%.
    expect(await n.call(fundB, "post_raise", 5000, "")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(product, "post_raise", 500, "")).toMatchObject({ ok: false, code: "BAD_TERMS" });
    expect(await n.call(product, "post_raise", 10_001, "")).toMatchObject({ ok: false, code: "BAD_TERMS" });

    const posted = await n.ok(product, "post_raise", 5000, "5% for a second supplier");
    const raise = posted.raise;
    expect(raise).toMatchObject({ status: "OPEN", shares: 5000, k: 1 });
    const price = Number((await n.one("select market_price from companies where id = $1", [a!.company_id])).market_price);
    expect(Number(posted.value_cents)).toBe(5000 * price);
    expect(await n.call(product, "post_raise", 2000, "")).toMatchObject({ ok: false, code: "RAISE_OPEN" });

    // Every team in the event can see it.
    expect(await n.q("select id from raises where event_id = $1", [n.eventId])).toHaveLength(1);

    // A fund cannot fund its own squad's company, and a Product team cannot fund at all.
    expect(await n.call(n.team(a!.f_code), "fund_raise", raise.id)).toMatchObject({ ok: false, code: "OWN_SQUAD" });
    expect(await n.call(n.team(c!.p_code), "fund_raise", raise.id)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });

    const fundCash = await cash(n, fundBId);
    const productCash = await cash(n, productId);
    const retained = await qty(n, productId, a!.company_id, "RETAINED");
    const funded = await n.ok(fundB, "fund_raise", raise.id);
    const value = BigInt(5000 * price);
    expect(funded.raise).toMatchObject({ status: "FUNDED", funded_by: fundBId, price_cents: price, cash_cents: Number(value) });
    expect(await cash(n, fundBId)).toBe(fundCash - value);
    expect(await cash(n, productId)).toBe(productCash + value);
    expect(await qty(n, productId, a!.company_id, "RETAINED")).toBe(retained - 5000);
    expect(await qty(n, fundBId, a!.company_id, "SQUAD")).toBe(5000);
    // A second fund is too late.
    expect(await n.call(n.team(c!.f_code), "fund_raise", raise.id)).toMatchObject({ ok: false, code: "RAISE_CLOSED" });
    // The books: every team's cash and every holding equal the sum of their ledger lines.
    expect(await n.q(`select t.id from teams t where t.event_id = $1
        and t.cash_cents <> coalesce((select sum(cash_delta_cents) from ledger_entries l where l.team_id = t.id), 0)`, [n.eventId])).toEqual([]);
    expect(await n.q(`select h.id from holdings h where h.event_id = $1
        and h.qty <> coalesce((select sum(share_delta) from ledger_entries l where l.team_id = h.team_id and l.company_id = h.company_id and l.lot = h.lot), 0)`, [n.eventId])).toEqual([]);
    expect(await n.q("select kind, ticker, shares from public_ledger where event_id = $1 and kind = 'RAISE'", [n.eventId])).toEqual([{ kind: "RAISE", ticker: "RSA", shares: 5000 }]);

    // Once per crisis.
    expect(await n.call(product, "post_raise", 1000, "")).toMatchObject({ ok: false, code: "ALREADY_RAISED" });

    // The 40% floor: C may sell at most what keeps 40,000 shares.
    const retainedC = await qty(n, n.teamId(c!.p_code), c!.company_id, "RETAINED");
    const room = retainedC - 40_000;
    if (room < 10_000) {
      const r = await n.call(n.team(c!.p_code), "post_raise", Math.min(10_000, Math.ceil((room + 10) / 10) * 10), "");
      expect(r).toMatchObject({ ok: false, code: "BAD_TERMS" });
    }

    // A company may cancel its open raise.
    const rc = (await n.ok(n.team(c!.p_code), "post_raise", 1000, "")).raise;
    expect(await n.call(product, "cancel_raise", rc.id)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    await n.ok(n.team(c!.p_code), "cancel_raise", rc.id);
    expect(await n.call(fundB, "fund_raise", rc.id)).toMatchObject({ ok: false, code: "RAISE_CLOSED" });

    // A fund without the cash is refused, and nothing moves.
    const rb = (await n.ok(n.team(b!.p_code), "post_raise", 10_000, "")).raise;
    await n.q("update teams set cash_cents = 100 where id = $1", [n.teamId(c!.f_code)]);
    expect(await n.call(n.team(c!.f_code), "fund_raise", rb.id)).toMatchObject({ ok: false, code: "FUND_CASH" });
    expect((await n.one("select status from raises where id = $1", [rb.id])).status).toBe("OPEN");

    // The next crisis: the open raise from Crisis 1 lapses; A may raise again in Crisis 2.
    await n.deadlinePassed("HIRE_1");
    await n.deadlinePassed("DUE_1");
    await n.deadlinePassed("RATE_1");
    await n.ok(n.lead, "tick", n.eventId);
    await n.deadlinePassed("REVEAL_2");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.call(n.team(a!.f_code), "fund_raise", rb.id)).toMatchObject({ ok: false, code: "RAISE_CLOSED" });
    expect((await n.one("select status from raises where id = $1", [rb.id])).status).toBe("LAPSED");
    expect((await n.ok(product, "post_raise", 1000, "")).raise).toMatchObject({ k: 2 });
  });
});
