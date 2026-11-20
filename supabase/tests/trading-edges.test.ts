// Adversarial edges of the trading algorithm (docs/system/TRADING-ALGORITHM.md, "Edges"), through the real game
// functions. Each test names the question it answers. Night.clearRound compares every clearing with the engine's
// clearRound (prices, cash, collateral, every position), and checkInvariants checks the ledger.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { allocateIpo, applyTier, buyReserve, clearingPrice, sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { createTestDb } from "./pg";
import { holdTx, settle, value, waitForLockWaiters } from "./race";
import { movePrice, toPressure } from "./trading-setup";
import { rowsAs, service } from "./helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const price = async (n: { one: (s: string, p: unknown[]) => Promise<any> }, id: string) =>
  (await n.one("select market_price from companies where id = $1", [id])).market_price as number;

describe("prices never reach 0 (round_prices.market_after > 0 can never stop the clearing)", () => {
  test("31 kinds of push on a 5¢ and a 1¢ stock: −10% rounds, the −5% reveal, −20% tiers; the floor is 1¢", async () => {
    const { n, squads: s } = await toPressure(db.pool, 6, "edges-floor");
    const [a, b] = [s[0]!.company_id, s[1]!.company_id];
    // 5¢: a full −10% round gives 4.5¢, which rounds half-up to 5¢ (prices of a few cents are sticky, never 0);
    // 1¢: 0.9¢ rounds to 1¢.
    await movePrice(db.pool, n.eventId, a, 5);
    await movePrice(db.pool, n.eventId, b, 1, 1);
    await n.openRound(1);
    await n.orderNet(a, -10_000, s.slice(1).map((q) => q.f_code));
    await n.orderNet(b, -10_000, [s[0]!, ...s.slice(2)].map((q) => q.f_code));
    const r1 = await n.clearRound(1);
    expect(r1.companies[a]).toMatchObject({ cappedNet: -10_000, newPrice: 5 });
    expect(r1.companies[b]).toMatchObject({ cappedNet: -10_000, newPrice: 1 });
    await n.openRound(2);
    await n.clearRound(2);
    // The −5% crisis reveal at 1¢ (market and AI price).
    await n.deadlinePassed("REVEAL_2");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.one("select market_price, ai_price from companies where id = $1", [b])).toEqual({ market_price: 1, ai_price: 1 });
    expect(await price(n, a)).toBe(5); // 5 × 0.95 = 4.75 → 5
    // Every multiplier the game has is ≥ ×0.8; anything ≥ ×0.5 keeps 1¢ at 1¢.
    const rows = await n.q("select app.apply_tier(1, b) as p from unnest(array[-2000, -1000, -500, -4999]) b");
    expect(rows.map((r) => Number(r.p))).toEqual([1, 1, 1, 1]);
    expect(Number((await n.one("select app.clearing_price(1, -1000000) as p", [])).p)).toBe(1);
    expect((await n.one("select min(market_after) as m from round_prices where event_id = $1", [n.eventId])).m).toBeGreaterThanOrEqual(1);
    await n.checkInvariants();
  }, 240_000);
});

describe("a short after spikes: collateral above cash", () => {
  test("buys and new shorts are refused, sells and covers go through, the clearing never stops, money balances", async () => {
    const { n, squads: s } = await toPressure(db.pool, 6, "edges-spike");
    const [a, b] = [s[0]!, s[1]!];
    const fund = n.team(b.f_code); // squad 2's fund; it may trade every company but B
    await n.openRound(1);
    await n.ok(fund, "place_order", a.company_id, "SHORT", 2_000);
    for (const q of s.slice(2)) await n.ok(fund, "place_order", q.company_id, "BUY", 4_000);
    await n.clearRound(1);
    // +10% rounds and +25% tiers: A goes to $150 (as releases would move it), collateral 3,000 × $150 = $450,000.
    await movePrice(db.pool, n.eventId, a.company_id, 15_000);
    const t = await n.one("select cash_cents, collateral_cents from teams where id = $1", [n.teamId(b.f_code)]);
    expect(Number(t.collateral_cents)).toBe(45_000_000);
    expect(Number(t.cash_cents)).toBeLessThan(45_000_000); // a collateral deficit: available cash is negative
    await n.openRound(2);
    expect(await n.call(fund, "place_order", s[2]!.company_id, "BUY", 1)).toMatchObject({ ok: false, code: "COLLATERAL_DEFICIT" });
    expect(await n.call(fund, "place_order", s[3]!.company_id, "SHORT", 1)).toMatchObject({ ok: false, code: "COLLATERAL_DEFICIT" });
    await n.ok(fund, "place_order", s[2]!.company_id, "SELL", 1_000);
    await n.clearRound(2);
    // Still short: A goes to $250. Covering all 2,000 now costs more than the fund's cash; it is allowed (it is the
    // loss on the short) and leaves cash below zero; nothing in the clearing depends on cash being positive.
    await movePrice(db.pool, n.eventId, a.company_id, 25_000);
    await n.openRound(3);
    await n.ok(fund, "place_order", a.company_id, "COVER", 2_000);
    await n.clearRound(3);
    const after = await n.one("select cash_cents, collateral_cents from teams where id = $1", [n.teamId(b.f_code)]);
    expect(Number(after.collateral_cents)).toBe(0);
    expect(Number(after.cash_cents)).toBeLessThan(0);
    // With cash < collateral (0) it can buy nothing until it sells.
    await n.openRound(4);
    expect(await n.call(fund, "place_order", s[3]!.company_id, "BUY", 1)).toMatchObject({ ok: false, code: "COLLATERAL_DEFICIT" });
    await n.ok(fund, "place_order", s[3]!.company_id, "SELL", 4_000);
    await n.clearRound(4);
    await n.checkInvariants();
  }, 240_000);
});

describe("edits and cancels racing the clearing", () => {
  test("a cancel and an edit that commit while the clearing waits for the fund are honoured: the book read is the committed one", async () => {
    // (The other order, the clearing first and the edit or cancel then refused, is review-races CONC-2.)
    const { n, squads: s } = await toPressure(db.pool, 4, "edges-race");
    await n.openRound(1);
    const fund = n.team(s[1]!.f_code);
    const keep = (await n.ok(fund, "place_order", s[0]!.company_id, "BUY", 300)).order.id;
    const drop = (await n.ok(fund, "place_order", s[2]!.company_id, "BUY", 200)).order.id;
    const edit = await holdTx(db.pool, fund, async (c) => {
      await c.query("select public.edit_order($1, 120) as r", [keep]);
      return (await c.query("select public.cancel_order($1) as r", [drop])).rows[0].r;
    });
    expect(await edit.started).toMatchObject({ ok: true });
    await n.q("update rounds set closes_at = now() - interval '1 millisecond' where event_id = $1 and number = 1", [n.eventId]);
    const tick = settle(n.call(n.lead, "tick", n.eventId));
    await waitForLockWaiters(db.pool, 1); // the clearing waits for the fund's row
    await edit.commit();
    expect(value(await tick, "tick")).toMatchObject({ ok: true });
    const o = await n.q("select id, status, qty from orders where id = any($1) order by qty", [[keep, drop]]);
    expect(o).toEqual([
      { id: keep, status: "FILLED", qty: 120 },
      { id: drop, status: "CANCELLED", qty: 200 },
    ]);
    const rp = await n.one("select buy_qty from round_prices rp join rounds r on r.id = rp.round_id where r.event_id = $1 and r.number = 1 and rp.company_id = $2", [n.eventId, s[0]!.company_id]);
    expect(rp.buy_qty).toBe(120);
    await n.checkInvariants();
  }, 240_000);
});

describe("IPO oversubscription", () => {
  test("an uneven oversubscribed book: pro rata to 10 shares, remainders stay with the exchange, ledger balanced", async () => {
    const asks = [4_000, 4_000, 4_000, 4_000, 4_000, 4_000, 3_999, 3_333, 3_001, 2_999, 2_501];
    const { n, squads: s } = await toPressure(db.pool, 12, "edges-ipo", { bids: (i): Record<number, number> => (i === 0 ? {} : { 0: asks[i - 1]! }) });
    const c = s[0]!.company_id;
    const bids = await n.q("select team_id, qty_requested, qty_allocated from ipo_bids where company_id = $1 order by team_id", [c]);
    const expected = allocateIpo(bids.map((b) => ({ qty: b.qty_requested })));
    expect(bids.map((b) => b.qty_allocated)).toEqual(expected.map((e) => e.allocated));
    const sum = bids.reduce((x, b) => x + b.qty_allocated, 0);
    expect(asks.reduce((x, q) => x + q, 0)).toBe(39_833);
    expect(sum).toBeLessThanOrEqual(35_000);
    expect(sum).toBeGreaterThan(35_000 - 10 * asks.length);
    for (const b of bids) expect(b.qty_allocated % 10).toBe(0);
    // The fund of squad 1 cannot bid for its own company.
    expect((await n.one("select count(*)::int as c from ipo_bids where company_id = $1 and team_id = $2", [c, n.teamId(s[0]!.f_code)])).c).toBe(0);
    await n.checkInvariants();
  }, 300_000);
});

describe("cooling-off boundaries", () => {
  test("exactly +10,000 and −10,000 cool off, 9,999 does not; the first round has none; one quiet round ends it", async () => {
    const { n, squads: s } = await toPressure(db.pool, 7, "edges-cool");
    const [a, b, c] = [s[0]!.company_id, s[1]!.company_id, s[2]!.company_id];
    const funds = s.slice(3).map((q) => q.f_code);
    await n.openRound(1);
    expect((await n.q("select id from companies where event_id = $1 and app.cooling_off(id)", [n.eventId])).length).toBe(0);
    await n.orderNet(a, 10_000, funds);
    await n.orderNet(b, -10_000, [...funds, s[2]!.f_code]);
    await n.orderNet(c, 9_999, funds);
    const r1 = await n.clearRound(1);
    expect([r1.companies[a]!.cappedNet, r1.companies[b]!.cappedNet, r1.companies[c]!.cappedNet]).toEqual([10_000, -10_000, 9_999]);
    await n.openRound(2);
    for (const id of [a, b]) {
      for (const type of ["BUY", "SELL", "SHORT", "COVER"]) {
        expect(await n.call(n.team(funds[0]!), "place_order", id, type, 10)).toMatchObject({ ok: false, code: "COOLING_OFF" });
      }
    }
    await n.ok(n.team(s[1]!.f_code), "place_order", c, "BUY", 10);
    const cooling = (await rowsAs<{ ids: string[] }>(db.pool, n.team(funds[0]!), "select public.cooling_off_companies($1) as ids", [n.eventId]))[0]!.ids;
    expect(cooling).toEqual([a, b].sort());
    await n.clearRound(2);
    await n.openRound(3);
    expect((await n.q("select id from companies where event_id = $1 and app.cooling_off(id)", [n.eventId])).length).toBe(0);
    await n.ok(n.team(funds[0]!), "place_order", a, "SELL", 10);
    await n.clearRound(3);
    await n.checkInvariants();
  }, 240_000);
});

describe("raises", () => {
  test("before crisis 1 is revealed a raise belongs to crisis 1 (one per company and per fund), and the floor counts escrow", async () => {
    const { n, squads: s } = await toPressure(db.pool, 4, "edges-raise");
    // toPressure revealed crisis 1; go back to just before it for this case: a new event would cost a minute, so the
    // reveal is undone on the subround row only (raise_k reads revealed_at).
    await n.q("update subrounds set revealed_at = null where event_id = $1 and k = 1", [n.eventId]);
    expect((await n.one("select app.raise_k($1) as k", [n.eventId])).k).toBe(1);
    const [a, b, c] = s;
    const ra = (await n.ok(n.team(a.p_code), "post_raise", 2_000, "")).raise;
    expect(ra.k).toBe(1); // 0 before migration 079: a second raise in crisis 1 was then allowed
    await n.ok(n.team(c.f_code), "fund_raise", ra.id);
    await n.q("update subrounds set revealed_at = now() where event_id = $1 and k = 1", [n.eventId]);
    expect(await n.call(n.team(a.p_code), "post_raise", 1_000, "")).toMatchObject({ ok: false, code: "ALREADY_RAISED" });
    // Fee shares promised to a firm (escrow HELD) count against the 40,000-share floor.
    const firm = n.teamId(s[3]!.c_code);
    await n.q("insert into engagements (event_id, k, company_id, firm_team_id, cash_cents, shares, escrow) values ($1, 1, $2, $3, 0, 12000, 'HELD')", [n.eventId, b.company_id, firm]);
    expect(await n.call(n.team(b.p_code), "post_raise", 8_010, "")).toMatchObject({ ok: false, code: "BAD_TERMS" });
    const rb = (await n.ok(n.team(b.p_code), "post_raise", 8_000, "")).raise; // exactly 40,000 left
    // More fee shares promised before the fund pays: the raise lapses instead of breaking the floor.
    await n.q("update engagements set shares = shares + 10 where company_id = $1 and k = 1", [b.company_id]);
    expect(await n.call(n.team(a.f_code), "fund_raise", rb.id)).toMatchObject({ ok: false, code: "BAD_TERMS" });
    expect((await n.one("select status from raises where id = $1", [rb.id])).status).toBe("LAPSED");
    expect((await n.one("select qty from holdings where company_id = $1 and lot = 'RETAINED'", [b.company_id])).qty).toBe(60_000);
  }, 240_000);
});

describe("practice market", () => {
  test("a fund under 150% cover can still sell and cover (migration 079); buys and shorts are refused", async () => {
    const night = await Night.create(db.pool, 4, "PRIMUS");
    const seed = sha256Hex("edges-practice");
    await night.org("set_seed_commitment", night.eventId, sha256Hex(seed));
    await night.advanceTo("SQUAD_DRAW");
    await night.org("run_lottery", night.eventId, seed, "4");
    const f = (await night.squad(1)).f_code;
    const products = await night.q("select id from teams where event_id = $1 and track = 'PRODUCT' order by code", [night.eventId]);
    await night.advanceTo("BUILD");
    const start = new Date(Date.now() - 60_000);
    const rows = products.map((p, i) => ({ ticker: p.id, prices: Array.from({ length: 30 }, () => (i === 0 ? 1_000 : 2_000)) }));
    await night.ok(service, "practice_prepare", night.eventId, start.toISOString(), 5, JSON.stringify(rows));
    const fund = night.team(f);
    const [t0, t1] = [products[0].id, products[1].id];
    await night.ok(fund, "practice_trade", t0, "SHORT", 2_000); // cash $120,000; shorts $20,000
    await night.ok(fund, "practice_trade", t1, "BUY", 4_000); // cash $40,000 ≥ 150% × $20,000
    // The shorted price rises to $15: shorts $30,000 need $45,000; the fund has $40,000.
    await night.q("update practice_ticks set price_cents = 1500 where ticker_team_id = $1", [t0]);
    expect(await night.call(fund, "practice_trade", products[3].id, "BUY", 1)).toMatchObject({ ok: false, code: "NO_CASH" });
    expect(await night.call(fund, "practice_trade", products[2].id, "SHORT", 1)).toMatchObject({ ok: false, code: "NO_CASH" });
    expect(await night.call(fund, "practice_trade", t1, "SELL", 100)).toMatchObject({ ok: true, cash: 4_200_000 });
    expect(await night.call(fund, "practice_trade", t0, "COVER", 100)).toMatchObject({ ok: true, position: -1_900 });
    // A cover still needs the cash to pay for it.
    expect(await night.call(fund, "practice_trade", t1, "SELL", 3_900)).toMatchObject({ ok: true });
    await night.q("update practice_ticks set price_cents = 100000 where ticker_team_id = $1", [t0]);
    expect(await night.call(fund, "practice_trade", t0, "COVER", 1_900)).toMatchObject({ ok: false, code: "NO_CASH" });
  }, 240_000);
});

describe("Finance return on zero capital", () => {
  test("app.primus_results does not divide by zero (the settlement used to fail)", async () => {
    const { n, squads: s } = await toPressure(db.pool, 3, "edges-capital");
    const team = n.teamId(s[0]!.f_code);
    // A fund whose capital received sums to 0 (as a reversed starting cash would leave it).
    await n.q(
      `with t as (select gen_random_uuid() as txn)
       insert into ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
       select $1::uuid, txn, 'STARTING_CASH'::ledger_kind, $2::uuid, -50000000, 'reversed' from t union all
       select $1::uuid, txn, 'STARTING_CASH'::ledger_kind, null, 50000000, 'reversed' from t`,
      [n.eventId, team],
    );
    await n.q(
      `insert into results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, tiebreak, eligible, details)
       values ($1, $2, 'FINANCE', 1000, 50000000, 0, '{}', true, '{}')`,
      [n.eventId, team],
    );
    await n.q("select app.primus_results($1)", [n.eventId]);
    expect(await n.one("select start_value_cents, return_bp from results where team_id = $1", [team])).toEqual({ start_value_cents: "0", return_bp: null });
  }, 240_000);
});

describe("score releases and pending books", () => {
  // KNOWN FLAW, outside the trading functions (release_primus / release_scores, not this workstream's files): the
  // "no release while trading is open" guard uses app.open_round, which ignores a round past its closing time that
  // the tick has not cleared yet (up to ~2 s, longer if the tick is slow). A release in that window moves the price
  // the pending book then clears at: buys fill up to 37.5% above the price they reserved for. The fix is one line in
  // both functions (refuse while any round of the event has status OPEN). test.fails passes while the flaw is there;
  // when it is fixed this test fails and should become a plain test.
  test.fails("a release is refused while a closed round waits for its clearing", async () => {
    const { n, squads: s } = await toPressure(db.pool, 3, "edges-release");
    await n.openRound(1);
    await n.ok(n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "BUY", 1_000);
    await n.q("update rounds set closes_at = now() - interval '1 millisecond' where event_id = $1 and number = 1", [n.eventId]);
    for (const q of s) {
      await n.q(
        `insert into scores (event_id, company_id, type, status, final_score, tier_bp) values ($1, $2, 'CRISIS_1', 'SEALED', 95, 2500)
         on conflict (company_id, type) do update set status = 'SEALED', final_score = 95, tier_bp = 2500`,
        [n.eventId, q.company_id],
      );
    }
    const r = await n.one("select app.release_primus($1, 'CRISIS_1') as r", [n.eventId]);
    expect(r.r).toMatchObject({ ok: false, code: "TRADING_OPEN" });
  }, 240_000);
});

describe("200 companies × 200 funds", () => {
  test("a full book (40,000 orders) clears in one tick, equal to the engine; quantities and amounts in range; the leveller ranks once", async () => {
    const { n } = await toPressure(db.pool, 3, "edges-scale");
    const extra = 197; // + the 3 seeded = 200 companies and 200 funds
    await n.openRound(1);
    const round = await n.one("select id from rounds where event_id = $1 and number = 1", [n.eventId]);
    const c = await db.pool.connect();
    const t0 = performance.now();
    try {
      await c.query("begin");
      await c.query("select set_config('app.price_writer', 'IPO', true)");
      await c.query(
        `insert into teams (event_id, code, track, name) select $1, 'QX' || g, 'PRODUCT', 'Synthetic product ' || g from generate_series(100, 99 + $2) g`,
        [n.eventId, extra],
      );
      await c.query(
        `insert into teams (event_id, code, track, name) select $1, 'QY' || g, 'FINANCE', 'Synthetic fund ' || g from generate_series(100, 99 + $2) g`,
        [n.eventId, extra],
      );
      // Prices $5–$20 with every last digit (the reserve's rounding case included).
      await c.query(
        `insert into companies (event_id, product_team_id, ticker, ipo_price, market_price, ai_price, exchange_inventory)
         select $1, t.id, 'Q' || chr(65 + (g / 676) % 26) || chr(65 + (g / 26) % 26) || chr(65 + g % 26), p, p, p, 100000
           from (select id, substr(code, 3)::int as g from teams where event_id = $1 and code like 'QX%') t,
                lateral (select 500 + (t.g * 37) % 1500 as p) x`,
        [n.eventId],
      );
      // Each synthetic fund: $10,000,000 of capital and 2,000 shares of every synthetic company, bought as at an IPO.
      await c.query(
        `with f as (select id, gen_random_uuid() as txn from teams where event_id = $1 and code like 'QY%')
         insert into ledger_entries (event_id, txn_id, kind, team_id, cash_delta_cents, memo)
         select $1::uuid, txn, 'STARTING_CASH'::ledger_kind, id, 1000000000, 'Synthetic capital' from f union all
         select $1::uuid, txn, 'STARTING_CASH'::ledger_kind, null, -1000000000, 'Synthetic capital' from f`,
        [n.eventId],
      );
      await c.query(
        `with h as (select f.id as team_id, co.id as company_id, co.market_price as p, gen_random_uuid() as txn
                      from teams f, companies co, teams pt
                     where f.event_id = $1 and f.code like 'QY%' and co.event_id = $1 and pt.id = co.product_team_id and pt.code like 'QX%')
         , ins as (insert into holdings (event_id, team_id, company_id, lot, qty, cost_cents)
                   select $1, team_id, company_id, 'EXCHANGE', 2000, 2000::bigint * p from h)
         insert into ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, memo)
         select $1::uuid, txn, 'IPO_ALLOCATION'::ledger_kind, team_id, company_id, 'EXCHANGE'::lot_type, -2000::bigint * p, 2000, p, 'Synthetic' from h union all
         select $1::uuid, txn, 'IPO_ALLOCATION'::ledger_kind, null, company_id, null::lot_type, 2000::bigint * p, -2000, p, 'Synthetic' from h`,
        [n.eventId],
      );
      await c.query(
        `update teams t set cash_cents = (select sum(cash_delta_cents) from ledger_entries l where l.team_id = t.id)
          where t.event_id = $1 and t.code like 'QY%'`,
        [n.eventId],
      );
      await c.query(
        `update companies c set exchange_inventory = 100000 - 2000 * $2 where c.event_id = $1 and c.ticker like 'Q%'`,
        [n.eventId, extra],
      );
      await c.query(
        `update events set exchange_cash_cents = exchange_cash_cents
            + (select coalesce(sum(cash_delta_cents), 0) from ledger_entries where event_id = $1 and team_id is null and memo like 'Synthetic%')
          where id = $1`,
        [n.eventId],
      );
      // The book: every fund has an order in every company it may trade (the seeded funds too): 40,000 orders.
      await c.query("select set_config('app.price_writer', 'CLEARING', true)"); // skip the live range trigger while loading
      await c.query(
        `insert into orders (event_id, round_id, team_id, company_id, type, qty, entry_price, reserve_cents)
         select $1, $2, f.id, co.id, x.type, x.qty, co.market_price,
                case x.type when 'BUY' then app.buy_reserve(x.qty, co.market_price)
                            when 'SHORT' then app.short_reserve(x.qty, co.market_price) else 0 end
           from teams f cross join companies co
           left join holdings h on h.team_id = f.id and h.company_id = co.id and h.lot = 'EXCHANGE'
           cross join lateral (select case when coalesce(h.qty, 0) = 0 then (case when (hashtext(f.id::text || co.id::text) & 1) = 0 then 'BUY' else 'SHORT' end)
                                           else (array['BUY', 'SELL', 'SHORT', 'BUY'])[1 + (abs(hashtext(f.id::text || co.id::text)) % 4)] end::order_type as type,
                                      1 + abs(hashtext(co.id::text || f.id::text)) % (case when coalesce(h.qty, 0) = 0 then 1000 else 2000 end) as qty) x
          where f.event_id = $1 and f.track = 'FINANCE' and co.event_id = $1 and co.market_price is not null
            and co.id is distinct from app.squad_company_of(f.id)`,
        [n.eventId, round.id],
      );
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
    const loaded = performance.now() - t0;
    const counts = await n.one(
      `select (select count(*)::int from companies where event_id = $1) as companies,
              (select count(*)::int from teams where event_id = $1 and track = 'FINANCE') as funds,
              (select count(*)::int from orders where round_id = $2) as orders`,
      [n.eventId, round.id],
    );
    expect(counts.companies).toBe(200);
    expect(counts.funds).toBe(200);
    expect(counts.orders).toBeGreaterThan(39_000);

    await n.clearRound(1); // through the tick, compared with the engine fund by fund
    const ms = n.clearings.at(-1)!.ms;
    const sums = await n.one(
      `select max(buy_qty) as buy, max(abs(net_qty)) as net, max(market_after) as p,
              (select max(abs(cash_delta_cents)) from ledger_entries where round_id = $1) as cash
         from round_prices where round_id = $1`,
      [round.id],
    );
    console.info(`200 × 200: ${counts.orders} orders loaded in ${Math.round(loaded)} ms; the clearing tick took ${Math.round(ms)} ms; ` +
      `largest company buy ${sums.buy}, |net| ${sums.net}, ledger amount ${sums.cash}`);
    expect(sums.buy).toBeLessThan(2 ** 31);
    expect(ms).toBeLessThan(20_000); // the target is < 2 s on the live database; this runner shares 4 cores
    await n.checkInvariants();

    // The leveller at 200 companies: identical to the function it replaced, and how long a release spends ranking.
    await db.pool.query(
      `insert into draft_picks (event_id, company_id, pick_no, score_avg, opens_at, closes_at)
       select $1, id, row_number() over (order by id), 0, now(), now() from companies where event_id = $1`,
      [n.eventId],
    );
    await db.pool.query(
      `insert into scores (event_id, company_id, type, status, final_score, tier_bp)
       select $1, c.id, t.type, 'SEALED',
              case when abs(hashtext(c.id::text || t.type::text)) % 9 = 0 then null else abs(hashtext(t.type::text || c.id::text)) % 101 end,
              (array[2500, 2000, 1000, 500, 0, -1000, -2000])[1 + abs(hashtext(c.id::text)) % 7]
         from companies c cross join unnest(array['PITCH', 'CRISIS_1', 'CRISIS_2', 'CRISIS_3', 'CRISIS_4', 'SOLUTION']::submission_type[]) t(type)
        where c.event_id = $1 and abs(hashtext(c.id::text || t.type::text || 'x')) % 11 <> 0
       on conflict (company_id, type) do update set final_score = excluded.final_score, tier_bp = excluded.tier_bp`,
      [n.eventId],
    );
    const cl = await db.pool.connect();
    try {
      // The function as migration 064 left it, for comparison.
      await cl.query(`create function pg_temp.old_release_tier_bp(p_company uuid, p_type public.submission_type) returns integer
        language plpgsql stable as $$
        declare v_bp int; v_event uuid; v_place int; v_n int;
        begin
          select coalesce(s.tier_bp, 0) into v_bp from public.scores s where s.company_id = p_company and s.type = p_type;
          v_bp := coalesce(v_bp, 0);
          if p_type <> 'SOLUTION' or v_bp <= 0 then return v_bp; end if;
          select c.event_id into v_event from public.companies c where c.id = p_company;
          select r.place, r.n into v_place, v_n from (
            select d.company_id, count(*) over () as n, rank() over (order by app.score_so_far(d.company_id)) as place
              from public.draft_picks d where d.event_id = v_event) r
           where r.company_id = p_company;
          if v_n is null or v_n <= 1 then return v_bp; end if;
          return (v_bp * (125 * (v_n - 1) - 100 * (v_place - 1))) / (100 * (v_n - 1));
        end $$`);
      const timeIt = async (sql: string) => {
        const s0 = performance.now();
        const r = (await cl.query(sql, [n.eventId])).rows;
        return { rows: r, ms: performance.now() - s0 };
      };
      const oldR = await timeIt("select id, pg_temp.old_release_tier_bp(id, 'SOLUTION') as bp from companies where event_id = $1 order by id");
      const newR = await timeIt("select id, app.release_tier_bp(id, 'SOLUTION') as bp from companies where event_id = $1 order by id");
      const setR = await timeIt("select company_id as id, bp from app.release_tier_bps($1, 'SOLUTION') order by company_id");
      expect(newR.rows).toEqual(oldR.rows);
      expect(setR.rows).toEqual(oldR.rows);
      expect(new Set(oldR.rows.map((r) => r.bp)).size).toBeGreaterThan(20); // the leveller really spread the tiers
      for (const type of ["CRISIS_2", "PITCH"]) {
        const o = await cl.query("select pg_temp.old_release_tier_bp(id, $2) as bp from companies where event_id = $1 order by id", [n.eventId, type]);
        const m = await cl.query("select app.release_tier_bp(id, $2) as bp from companies where event_id = $1 order by id", [n.eventId, type]);
        expect(m.rows).toEqual(o.rows);
      }
      console.info(`leveller, 200 companies: before ${Math.round(oldR.ms)} ms, per-company now ${Math.round(newR.ms)} ms, ranked once ${Math.round(setR.ms)} ms`);
    } finally {
      cl.release();
    }
  }, 600_000);
});

describe("the reserve covers the worst fill (migration 079)", () => {
  test("a fund that buys with all its available cash at $10.05 is never below zero after a +10% round", async () => {
    const { n, squads: s } = await toPressure(db.pool, 6, "edges-reserve");
    const a = s[0]!.company_id;
    await movePrice(db.pool, n.eventId, a, 1_005);
    await n.openRound(1);
    // Fund 2 buys four other companies, then 4,000 of A: its reserve is the most those shares can cost.
    const fund = s[1]!;
    for (const q of s.slice(2)) await n.ok(n.team(fund.f_code), "place_order", q.company_id, "BUY", 4_000);
    const left = await n.one(
      `select t.cash_cents - t.collateral_cents - (select coalesce(sum(reserve_cents), 0) from orders o where o.team_id = t.id and o.status = 'PENDING') as a
         from teams t where t.id = $1`,
      [n.teamId(fund.f_code)],
    );
    expect(Number(left.a)).toBeGreaterThanOrEqual(buyReserve(4_000, 1_005));
    const order = (await n.ok(n.team(fund.f_code), "place_order", a, "BUY", 4_000)).order;
    expect(Number(order.reserve_cents)).toBe(4_000 * clearingPrice(1_005, 10_000)); // $44,240, not $44,220
    await n.orderNet(a, 6_000, s.slice(2).map((q) => q.f_code)); // the round's net is the full +10,000
    const r = await n.clearRound(1);
    expect(r.companies[a]!.newPrice).toBe(1_106);
    expect(applyTier(1_005, 1_000)).toBe(1_106);
    await n.checkInvariants();
  }, 240_000);
});

describe("the clearing's audit (migration 079)", () => {
  test("the clearing's row writes skip the per-row audit; the round is audited; later writes in the same transaction are audited again", async () => {
    const { n, squads: s } = await toPressure(db.pool, 3, "edges-audit");
    await n.openRound(1);
    const o = (await n.ok(n.team(s[1]!.f_code), "place_order", s[0]!.company_id, "BUY", 100)).order;
    const round = await n.one("select id from rounds where event_id = $1 and number = 1", [n.eventId]);
    const mark = (await n.one("select coalesce(max(id), 0) as id from audit_log", [])).id;
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("select app.clear_round($1, true)", [round.id]);
      await c.query("update teams set name = name || ' (renamed)' where id = $1", [n.teamId(s[1]!.f_code)]);
      await c.query("commit");
    } finally {
      c.release();
    }
    const rows = await n.q("select entity, entity_id, action from audit_log where id > $1 order by id", [mark]);
    expect(rows.filter((r) => r.entity === "orders")).toEqual([]);
    expect(rows.some((r) => r.entity === "rounds" && r.entity_id === round.id)).toBe(true);
    expect(rows.filter((r) => r.entity === "teams").map((r) => r.entity_id)).toEqual([n.teamId(s[1]!.f_code)]);
    expect((await n.one("select status from orders where id = $1", [o.id])).status).toBe("FILLED");
    await n.checkInvariants();
  }, 240_000);
});
