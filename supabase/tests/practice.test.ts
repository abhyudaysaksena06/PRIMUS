// The Round 1 practice market for Finance funds (migration 058): it opens with BUILD (six made-up stocks, $60,000 per
// fund), prices step on the heartbeat, orders fill at once, it closes at the IPO, and when Round 2 starts each fund's
// result (cash plus holdings at the last prices) is added to its fund cash, with the books still balanced.

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

describe("practice market", () => {
  test("opens at BUILD, trades, steps, closes at the IPO and settles into Round 2", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("practice");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const [a, b] = [await n.squad(1), await n.squad(2)];
    const fundA = n.team(a.f_code);

    // Not open before BUILD.
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select id from practice_stocks where event_id = $1", [n.eventId])).toEqual([]);

    await n.advanceTo("BUILD");
    await n.ok(n.lead, "tick", n.eventId);
    const stocks = await n.q("select id, symbol, price_cents from practice_stocks where event_id = $1 order by symbol", [n.eventId]);
    expect(stocks.map((s) => s.symbol)).toEqual(["CRDP", "GRFR", "LUMR", "NVRB", "SKRT", "VGRD"]);
    expect(await n.q("select team_id, cash_cents::int as cash from practice_accounts where event_id = $1 order by team_id", [n.eventId])).toHaveLength(3);
    expect((await n.one("select practice_step from events where id = $1", [n.eventId])).practice_step).toBe(0);

    const nvrb = stocks.find((s) => s.symbol === "NVRB")!;
    const price = Number(nvrb.price_cents);
    // Only funds trade; quantities and cash are checked.
    expect(await n.call(n.team(a.p_code), "practice_trade", nvrb.id, "BUY", 10)).toMatchObject({ ok: false, code: "NOT_A_FUND" });
    expect(await n.call(fundA, "practice_trade", nvrb.id, "BUY", 0)).toMatchObject({ ok: false, code: "BAD_QUANTITY" });
    expect(await n.call(fundA, "practice_trade", nvrb.id, "BUY", 100_000)).toMatchObject({ ok: false, code: "NO_CASH" });
    expect(await n.call(fundA, "practice_trade", nvrb.id, "SELL", 1)).toMatchObject({ ok: false, code: "NOT_ENOUGH_SHARES" });
    expect(await n.ok(fundA, "practice_trade", nvrb.id, "BUY", 100)).toMatchObject({ side: "BUY", qty: 100, price_cents: price });
    await n.ok(fundA, "practice_trade", nvrb.id, "SELL", 40);
    expect(await n.one("select qty, cost_cents::int as cost from practice_holdings where team_id = $1", [n.teamId(a.f_code)])).toEqual({
      qty: 60,
      cost: 60 * price,
    });
    expect(Number((await n.one("select cash_cents from practice_accounts where team_id = $1", [n.teamId(a.f_code)])).cash_cents)).toBe(6_000_000 - 60 * price);

    // A fund reads its own account only; every team of the event reads the market.
    const seen = await as(db.pool, n.team(b.f_code), async (cl) => ({
      accounts: (await cl.query("select team_id from practice_accounts")).rows,
      stocks: (await cl.query("select id from practice_stocks")).rows.length,
      trades: (await cl.query("select id from practice_trades")).rows.length,
    }));
    expect(seen).toEqual({
      accounts: [{ team_id: n.teamId(b.f_code) }],
      stocks: 6,
      trades: 0,
    });

    // A step: every stock gets a new price row.
    await n.q("update events set practice_stepped_at = now() - interval '1 minute' where id = $1", [n.eventId]);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select practice_step from events where id = $1", [n.eventId])).practice_step).toBe(1);
    expect((await n.one("select count(*)::int as c from practice_prices where event_id = $1 and step = 1", [n.eventId])).c).toBe(6);
    await n.ok(n.lead, "tick", n.eventId); // not yet time for another step
    expect((await n.one("select practice_step from events where id = $1", [n.eventId])).practice_step).toBe(1);

    // Closed from the IPO on.
    const sq = [a, b, await n.squad(3)];
    for (const [i, s] of sq.entries()) {
      await n.ok(
        n.team(s.p_code),
        "save_draft",
        "PITCH",
        {
          company_name: `Pr Co ${i}`,
          ticker: ["PRA", "PRB", "PRC"][i],
          problem: "A real problem.",
        },
        0,
      );
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const s of sq) await n.judge(s.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    expect(await n.call(fundA, "practice_trade", nvrb.id, "BUY", 1)).toMatchObject({ ok: false, code: "PRACTICE_CLOSED" });

    // Round 2: the results are added to the funds' cash, once.
    const cashOf = async (code: string) => Number((await n.one("select cash_cents from teams where id = $1", [n.teamId(code)])).cash_cents);
    const cashBefore = await cashOf(a.f_code);
    const cashBeforeB = await cashOf(b.f_code);
    const lastPrice = Number((await n.one("select price_cents from practice_stocks where id = $1", [nvrb.id])).price_cents);
    await n.advanceTo("PRESSURE");
    await n.ok(n.lead, "tick", n.eventId);
    await n.ok(n.lead, "tick", n.eventId);
    const expected = 6_000_000 - 60 * price + 60 * lastPrice;
    expect(Number((await n.one("select final_value_cents from practice_accounts where team_id = $1", [n.teamId(a.f_code)])).final_value_cents)).toBe(expected);
    expect(Number((await n.one("select cash_cents from teams where id = $1", [n.teamId(a.f_code)])).cash_cents)).toBe(cashBefore + expected);
    expect(await cashOf(b.f_code)).toBe(cashBeforeB + 6_000_000); // B never traded: its $60,000 back
    expect(
      (await n.one("select count(*)::int as c from ledger_entries where event_id = $1 and kind = 'PRACTICE' and team_id is not null", [n.eventId])).c,
    ).toBe(3);
    expect((await n.one("select count(*)::int as c from bulletins where event_id = $1 and title = 'Practice market settled'", [n.eventId])).c).toBe(1);
    expect(await n.q("select message from error_log where event_id = $1 and source = 'practice'", [n.eventId])).toEqual([]);
    await n.checkInvariants();
  });

  test("an event with the practice market turned off never opens it", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await n.q("update events set practice_enabled = false where id = $1", [n.eventId]);
    const seed = sha256Hex("off");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    await n.advanceTo("BUILD");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select id from practice_stocks where event_id = $1", [n.eventId])).toEqual([]);
    expect(await n.q("select team_id from practice_accounts where event_id = $1", [n.eventId])).toEqual([]);
    const s = await n.squad(1);
    expect(await n.call(n.team(s.f_code), "practice_trade", "00000000-0000-4000-8000-000000000000", "BUY", 1)).toMatchObject({
      ok: false,
      code: "PRACTICE_CLOSED",
    });
  });
});
