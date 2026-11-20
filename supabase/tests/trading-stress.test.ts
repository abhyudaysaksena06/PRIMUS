// The market under a full house: a PRIMUS night with 80 squads (80 Finance funds, 80 listed companies), every fund
// trading at once from two sessions of its own (two laptops), through the real game functions as the team's own
// authenticated session (RLS and SECURITY DEFINER as in production). Rounds are cleared by the heartbeat's path
// (public.tick), and every clearing is compared with the engine's clearRound (Night.clearRound: every price, cash,
// collateral and position). Between rounds: a score release moves prices, a crisis reveal drops them 5%.
//
// What is checked, round by round:
//   * every call returns a verdict: no deadlock, serialization failure or other error ever reaches a team;
//   * refusals are the rule-book's (insider, oversell, limits, cooling-off, cash), each edge case reached;
//   * the pending book never breaks an entry rule, although two sessions of a fund race each other;
//   * the clearing equals the engine (one price per company, the ±10% cap, every fill), no order left pending, no
//     order in a cooling-off company filled, and every fund's cash ≥ 0;
//   * the ledger: cash and shares conserved, every transaction balanced (Night.checkInvariants);
//   * a round boundary: orders keep arriving while the round closes and three ticks race to clear it: exactly one
//     clearing; every accepted order filled in that round at its price; the late ones refused; a second clear_round
//     is a no-op.
// Latency of place_order under the 80-fund load is printed (p50 / p95 / max).
//
// Knobs: TRADING_STRESS_FUNDS (default 80), TRADING_STRESS_ORDERS (orders per session per round, default 5).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import pg from "pg";
import { clearingPrice } from "@msim/engine";
import { createTestDb } from "./pg";
import { as, type Caller } from "./helpers";
import { movePrice, noWaits, resetRateLimits, toPressure } from "./trading-setup";
import type { Night } from "./night";

const FUNDS = Number(process.env.TRADING_STRESS_FUNDS ?? 80);
const PER_SESSION = Number(process.env.TRADING_STRESS_ORDERS ?? 5);

let db: Awaited<ReturnType<typeof createTestDb>>;
let load: pg.Pool;
beforeAll(async () => {
  db = await createTestDb();
  // One connection per session in flight (two per fund), as the API's pool would hold them.
  load = new pg.Pool({ connectionString: db.url, max: Math.min(2 * FUNDS, 110) });
  load.on("error", () => {});
});
afterAll(async () => {
  await load?.end();
  await db?.drop();
});

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)]! };
}

type Fund = { code: string; id: string; caller: Caller; own: string };
type Outcome = { fn: string; kind: string; code: string; ms: number; err?: string; order?: any };

const latencies: number[] = [];
const codes = new Map<string, number>();
const errors: string[] = [];
let peak = 0;
let inflight = 0;

/** One call as the team, in its own transaction on the load pool; never throws (errors are collected). */
async function call(f: Fund, fn: string, kind: string, ...args: unknown[]): Promise<Outcome> {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  inflight++;
  peak = Math.max(peak, inflight);
  const t0 = performance.now();
  try {
    const r = await as(load, f.caller, async (c) => (await c.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r, { commit: true });
    const ms = performance.now() - t0;
    if (fn === "place_order") latencies.push(ms);
    const code = r.ok ? "OK" : r.code;
    codes.set(`${kind} ${code}`, (codes.get(`${kind} ${code}`) ?? 0) + 1);
    return { fn, kind, code, ms, order: r.order };
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    errors.push(`${fn} ${kind}: ${err}`);
    return { fn, kind, code: "ERROR", ms: performance.now() - t0, err };
  } finally {
    inflight--;
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0;
};

/** What each kind of attempt may answer (anything else fails the test). */
const ALLOWED: Record<string, string[]> = {
  random: ["OK", "INSUFFICIENT_CASH", "LONG_LIMIT", "SHORT_LIMIT", "SHORT_EXPOSURE", "NOT_ENOUGH_SHARES", "NOT_ENOUGH_SHORT", "COLLATERAL_DEFICIT", "COOLING_OFF", "RATE_LIMITED"],
  insider: ["INSIDER", "COOLING_OFF"],
  oversell: ["NOT_ENOUGH_SHARES", "COOLING_OFF"],
  overcover: ["NOT_ENOUGH_SHORT", "COOLING_OFF"],
  longlimit: ["LONG_LIMIT", "COOLING_OFF", "COLLATERAL_DEFICIT"],
  shortlimit: ["SHORT_LIMIT", "COOLING_OFF", "COLLATERAL_DEFICIT"],
  bigbuy: ["OK", "INSUFFICIENT_CASH", "LONG_LIMIT", "COOLING_OFF", "COLLATERAL_DEFICIT"],
  cooling: ["COOLING_OFF"],
  edit: ["OK", "NOT_EDITABLE", "INSUFFICIENT_CASH", "LONG_LIMIT", "SHORT_LIMIT", "SHORT_EXPOSURE", "NOT_ENOUGH_SHARES", "NOT_ENOUGH_SHORT", "COLLATERAL_DEFICIT"],
  cancel: ["OK", "NOT_EDITABLE"],
  replay: ["OK"],
  late: ["OK", "TRADING_HALTED", "INSUFFICIENT_CASH", "LONG_LIMIT", "SHORT_LIMIT", "SHORT_EXPOSURE", "NOT_ENOUGH_SHARES", "NOT_ENOUGH_SHORT", "COLLATERAL_DEFICIT", "COOLING_OFF"],
};

function checkOutcomes(outs: Outcome[]) {
  // RATE_LIMITED (20 order actions per team per 10 s, both sessions together) is a rule-book verdict for any call.
  const bad = outs.filter((o) => o.code !== "RATE_LIMITED" && !(ALLOWED[o.kind] ?? []).includes(o.code));
  expect(bad.slice(0, 10), "every call answers with a rule-book verdict (no database error reaches a team)").toEqual([]);
}

type Book = Awaited<ReturnType<Night["fundBooks"]>>;

/** One fund's session: a mix of orders, edge cases and edits/cancels on its own orders. */
async function session(f: Fund, s: number, round: number, ctx: { books: Book; prices: Record<string, number>; companies: string[]; cooling: string[] }) {
  const g = rng((round * 1000 + Number(f.code.replace(/\D/g, "")) * 7 + s) * 2654435761);
  const outs: Outcome[] = [];
  const mine: any[] = [];
  const book = ctx.books[f.id]!;
  const held = Object.entries(book.positions).filter(([, p]) => p.exchangeQty > 0).map(([c]) => c);
  const shorted = Object.entries(book.positions).filter(([, p]) => p.shortQty > 0).map(([c]) => c);
  const others = ctx.companies.filter((c) => c !== f.own);
  const edges: (() => Promise<Outcome>)[] = [];
  if (s === 0) {
    edges.push(() => call(f, "place_order", "insider", f.own, g.pick(["BUY", "SHORT"]), 100));
    if (held.length) {
      const c = g.pick(held);
      edges.push(() => call(f, "place_order", "oversell", c, "SELL", book.positions[c]!.exchangeQty + 1_000));
    }
    edges.push(() => call(f, "place_order", "longlimit", g.pick(others), "BUY", 4_001));
    if (ctx.cooling.length) edges.push(() => call(f, "place_order", "cooling", g.pick(ctx.cooling.filter((c) => c !== f.own).concat(ctx.cooling)), g.pick(["BUY", "SELL", "SHORT", "COVER"]), 10));
  } else {
    edges.push(() => call(f, "place_order", "shortlimit", g.pick(others), "SHORT", 2_001));
    if (shorted.length) {
      const c = g.pick(shorted);
      edges.push(() => call(f, "place_order", "overcover", c, "COVER", book.positions[c]!.shortQty + 500));
    }
    edges.push(() => call(f, "place_order", "bigbuy", g.pick(others), "BUY", 3_999)); // near the long limit: LONG_LIMIT if the fund holds any
  }
  const steps: (() => Promise<Outcome>)[] = [];
  for (let k = 0; k < PER_SESSION; k++) {
    steps.push(async () => {
      const r = g.next();
      let c: string, type: string, qty: number;
      if (r < 0.4) [c, type, qty] = [g.pick(others), "BUY", g.pick([g.int(10, 300), g.int(100, 1_500)])];
      else if (r < 0.62 && held.length) [c, type, qty] = [g.pick(held), "SELL", g.int(10, 1_200)];
      else if (r < 0.85) [c, type, qty] = [g.pick(others), "SHORT", g.int(10, 800)];
      else if (shorted.length) [c, type, qty] = [g.pick(shorted), "COVER", g.int(10, 1_000)];
      else [c, type, qty] = [g.pick(others), "BUY", g.int(10, 200)];
      const ref = `r${round}-${f.code}-${s}-${k}`;
      const o = await call(f, "place_order", "random", c, type, qty, ref);
      if (o.code === "OK") {
        mine.push(o.order);
        if (s === 0 && g.next() < 0.15) {
          // A double-click: the same client_ref again returns the same order, not a second one.
          const d = await call(f, "place_order", "replay", c, type, qty, ref);
          if (d.code !== "RATE_LIMITED") expect(d.order?.id).toBe(o.order.id);
        }
      }
      return o;
    });
  }
  // Interleave edge cases among the orders.
  const plan = [...steps];
  for (const e of edges) plan.splice(g.int(0, plan.length), 0, e);
  for (const step of plan) outs.push(await step());
  if (s === 0 && mine.length) outs.push(await call(f, "edit_order", "edit", g.pick(mine).id, g.int(10, 600)));
  if (s === 1 && mine.length) outs.push(await call(f, "cancel_order", "cancel", g.pick(mine).id));
  return outs;
}

/** The pending book obeys every entry rule (two sessions of a fund raced each other placing it). */
async function checkPendingBook(n: Night, roundId: string, funds: Fund[], cooling: string[]) {
  const bad = await n.q(
    `with p as (
       select o.team_id, o.company_id,
              sum(o.qty) filter (where o.type = 'BUY') as buy, sum(o.qty) filter (where o.type = 'SELL') as sell,
              sum(o.qty) filter (where o.type = 'SHORT') as short, sum(o.qty) filter (where o.type = 'COVER') as cover
         from orders o where o.round_id = $1 and o.status = 'PENDING' group by o.team_id, o.company_id),
     h as (
       select team_id, company_id, coalesce(sum(qty) filter (where lot = 'EXCHANGE'), 0) as ex,
              coalesce(sum(qty) filter (where lot = 'SHORT'), 0) as sh
         from holdings group by team_id, company_id)
     select p.*, coalesce(h.ex, 0) as ex, coalesce(h.sh, 0) as sh from p left join h using (team_id, company_id)
      where coalesce(h.ex, 0) + coalesce(p.buy, 0) > 4000 or coalesce(p.sell, 0) > coalesce(h.ex, 0)
         or coalesce(h.sh, 0) + coalesce(p.short, 0) > 2000 or coalesce(p.cover, 0) > coalesce(h.sh, 0)`,
    [roundId],
  );
  expect(bad, "limits and holdings hold over the pending book").toEqual([]);
  const cash = await n.q(
    `select t.code, t.cash_cents, t.collateral_cents, sum(o.reserve_cents) as reserved
       from teams t join orders o on o.team_id = t.id and o.round_id = $1 and o.status = 'PENDING'
      group by t.id having sum(o.reserve_cents) > greatest(t.cash_cents - t.collateral_cents, 0)`,
    [roundId],
  );
  expect(cash, "reserves never exceed available cash").toEqual([]);
  const own = new Map(funds.map((f) => [f.id, f.own]));
  const pend = await n.q("select team_id, company_id from orders where round_id = $1 and status = 'PENDING'", [roundId]);
  expect(pend.filter((o) => own.get(o.team_id) === o.company_id), "no order in the fund's own company").toEqual([]);
  expect(pend.filter((o) => cooling.includes(o.company_id)), "no order in a cooling-off company").toEqual([]);
  return pend.length;
}

async function coolingNow(n: Night): Promise<string[]> {
  return (await n.q("select c.id from companies c where c.event_id = $1 and app.cooling_off(c.id)", [n.eventId])).map((r) => r.id);
}

async function afterClearing(n: Night, roundNumber: number, cooling: string[]) {
  const rows = await n.q(
    "select rp.company_id, rp.market_before, rp.market_after, rp.net_qty, rp.capped_net from round_prices rp join rounds r on r.id = rp.round_id where r.event_id = $1 and r.number = $2 and rp.kind = 'CLEARING'",
    [n.eventId, roundNumber],
  );
  for (const r of rows) {
    expect(r.market_after, "price = the engine's formula (±10% cap, half-up)").toBe(clearingPrice(r.market_before, Number(r.net_qty)));
    expect(Math.abs(r.market_after - r.market_before)).toBeLessThanOrEqual(Math.ceil(r.market_before / 10) + 1);
    if (cooling.includes(r.company_id)) expect(Number(r.net_qty), "a cooling-off company has no trades").toBe(0);
  }
  const neg = await n.q("select code, cash_cents from teams where event_id = $1 and track = 'FINANCE' and cash_cents < 0", [n.eventId]);
  expect(neg, "no fund below zero cash").toEqual([]);
  await n.checkInvariants();
  return rows;
}

describe(`${FUNDS} funds trading at once`, () => {
  test("concurrent books, round after round, a score release, a crisis drop and a contested round boundary", async () => {
    const t0 = performance.now();
    const { n, squads: s } = await toPressure(db.pool, FUNDS, "trading-stress", {
      pitch: (i) => [35, 45, 55, 65, 85][i % 5]!,
      // IPO: every fund bids on 6 companies; the first two companies are oversubscribed (pro rata).
      bids: (i) => Object.fromEntries([1, 2, 5, 11, 23, 37].map((d) => [(i + d) % FUNDS, 400 + ((i * 37 + d * 11) % 3_000)]).concat(i > 1 ? [[0, 2_000], [1, 3_000]] : [])),
    });
    await noWaits(n);
    const setupMs = performance.now() - t0;
    const funds: Fund[] = s.map((q) => ({ code: q.f_code, id: n.teamId(q.f_code), caller: n.team(q.f_code), own: q.company_id }));
    const companies = s.map((q) => q.company_id as string);

    // IPO: allocations never above 35,000 a company, pro rata on the oversubscribed ones; money balances.
    const ipo = await n.q(
      "select company_id, sum(share_delta)::int as q from ledger_entries where event_id = $1 and kind = 'IPO_ALLOCATION' and team_id is not null group by company_id",
      [n.eventId],
    );
    expect(ipo.length).toBe(FUNDS);
    for (const r of ipo) expect(r.q).toBeLessThanOrEqual(35_000);
    expect(ipo.find((r) => r.company_id === companies[1])!.q).toBeGreaterThan(34_000);
    await n.checkInvariants();

    const report: string[] = [];
    let totalOrders = 0;
    let totalActions = 0;

    const stressRound = async (round: number, before?: () => Promise<void>) => {
      await n.openRound(round);
      await resetRateLimits(db.pool);
      if (before) await before();
      const cooling = await coolingNow(n);
      const ctx = { books: await n.fundBooks(), prices: await n.prices(), companies, cooling };
      const roundId = (await n.one("select id from rounds where event_id = $1 and number = $2", [n.eventId, round])).id;
      const t = performance.now();
      const outs = (await Promise.all(funds.flatMap((f) => [session(f, 0, round, ctx), session(f, 1, round, ctx)]))).flat();
      const wall = performance.now() - t;
      checkOutcomes(outs);
      const pending = await checkPendingBook(n, roundId, funds, cooling);
      const exp = await n.clearRound(round); // through tick(), equal to the engine
      const ms = n.clearings.at(-1)!.ms;
      await afterClearing(n, round, cooling);
      totalOrders += pending;
      totalActions += outs.length;
      report.push(`round ${round}: ${outs.length} calls in ${Math.round(wall)} ms, ${pending} orders filled, ${cooling.length} cooling-off, clearing tick ${Math.round(ms)} ms`);
      return exp;
    };

    // Round 1: the book, plus two companies driven to the full +10% / −10% (cooling-off in round 2).
    const [up, down] = [companies[2]!, companies[3]!];
    const r1 = await stressRound(1, async () => {
      const buyers = funds.filter((f) => f.own !== up).slice(0, 5).map((f) => f.code);
      await n.orderNet(up, 12_000, buyers);
    });
    expect(r1.companies[up]!.cappedNet).toBe(10_000);
    // Round 2: up is cooling off (everyone who tries it is refused); down is driven by the random book only.
    const cool2 = await coolingNow(n);
    expect(cool2).toContain(up);
    await stressRound(2);

    // A score release between rounds: ten companies move by a tier (+25% … −20%), collateral recalculated.
    for (const [k, c] of companies.slice(10, 20).entries()) {
      const p = (await n.one("select market_price from companies where id = $1", [c])).market_price;
      await movePrice(db.pool, n.eventId, c, Math.round((p * [125, 120, 110, 105, 100, 90, 80, 125, 80, 110][k]!) / 100));
    }
    await n.checkInvariants();
    await stressRound(3);

    // A crisis reveal: every price −5% (market and AI), collateral recalculated.
    const pre = await n.prices();
    await n.deadlinePassed("REVEAL_2");
    await n.ok(n.lead, "tick", n.eventId);
    const post = await n.prices();
    for (const c of companies) expect(post[c]).toBeLessThan(pre[c]! + 1);
    expect(Object.keys(post).filter((c) => post[c]! < pre[c]!).length).toBeGreaterThan(FUNDS / 2);
    await n.checkInvariants();
    await stressRound(4);

    // Round 5: the boundary. Orders arrive from every fund while the round closes; three ticks race to clear it.
    await n.openRound(5);
    await resetRateLimits(db.pool);
    const round5 = (await n.one("select id from rounds where event_id = $1 and number = 5", [n.eventId])).id;
    const ctx5 = { books: await n.fundBooks(), prices: await n.prices(), companies, cooling: await coolingNow(n) };
    await n.q("update rounds set closes_at = now() + interval '1500 milliseconds' where id = $1", [round5]);
    const lateOuts: Outcome[] = [];
    const firing = Promise.all(
      funds.map(async (f, i) => {
        const g = rng(5_000 + i);
        for (let k = 0; k < 8; k++) {
          await new Promise((r) => setTimeout(r, g.int(0, 400)));
          const c = g.pick(companies.filter((x) => x !== f.own));
          lateOuts.push(await call(f, "place_order", "late", c, g.pick(["BUY", "SHORT"]), g.int(10, 200)));
        }
      }),
    );
    await new Promise((r) => setTimeout(r, 1_600));
    const ticks = await Promise.all([1, 2, 3].map(() => as(load, n.lead, async (c) => (await c.query("select public.tick($1) as r", [n.eventId])).rows[0].r, { commit: true }).catch((e) => ({ err: String(e) }))));
    await firing;
    expect(ticks.filter((t: any) => t.err), "no tick raises").toEqual([]);
    for (let k = 0; k < 20 && (await n.one("select status from rounds where id = $1", [round5])).status !== "CLEARED"; k++) {
      await n.ok(n.lead, "tick", n.eventId);
    }
    checkOutcomes(lateOuts);
    expect((await n.one("select status from rounds where id = $1", [round5])).status).toBe("CLEARED");
    expect((await n.one("select count(*)::int as c from round_prices where round_id = $1", [round5])).c, "cleared exactly once").toBe(companies.length);
    const accepted = lateOuts.filter((o) => o.code === "OK").map((o) => o.order.id);
    const filled = await n.q("select o.id, o.status, o.fill_price, rp.market_after from orders o join round_prices rp on rp.round_id = o.round_id and rp.company_id = o.company_id where o.id = any($1)", [accepted]);
    expect(filled.length).toBe(accepted.length);
    expect(filled.filter((o) => o.status !== "FILLED" || o.fill_price !== o.market_after), "every accepted order filled at its company's clearing price").toEqual([]);
    expect(lateOuts.filter((o) => o.code === "TRADING_HALTED").length, "orders after the close are refused").toBeGreaterThan(0);
    expect(accepted.length, "orders before the close are taken").toBeGreaterThan(0);
    const again = (await n.one("select app.clear_round($1) as r", [round5])).r;
    expect(again).toMatchObject({ ok: true, already: true });
    expect((await n.one("select count(*)::int as c from round_prices where round_id = $1", [round5])).c).toBe(companies.length);
    await afterClearing(n, 5, ctx5.cooling);
    report.push(`round 5 (boundary): ${lateOuts.length} calls, ${accepted.length} accepted and filled, ${lateOuts.filter((o) => o.code === "TRADING_HALTED").length} refused after the close; 3 racing ticks, one clearing`);

    // Round 6: one more full round on the post-boundary state.
    await stressRound(6);

    const p50 = pct(latencies, 50), p95 = pct(latencies, 95), mx = pct(latencies, 100);
    console.log(
      [
        `trading stress: ${FUNDS} funds × 2 sessions, ${companies.length} companies; setup ${Math.round(setupMs / 1000)} s`,
        ...report,
        `${totalActions} calls in the stress rounds, ${totalOrders} orders filled; place_order ${latencies.length} calls: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${mx.toFixed(1)} ms; peak ${peak} calls in flight`,
        `verdicts: ${[...codes.entries()].sort().map(([k, v]) => `${k} ${v}`).join(", ")}`,
      ].join("\n"),
    );
    expect(errors, "no database error (deadlock, serialization failure) reached a team").toEqual([]);
    for (const k of ["insider INSIDER", "oversell NOT_ENOUGH_SHARES", "longlimit LONG_LIMIT", "shortlimit SHORT_LIMIT", "cooling COOLING_OFF", "random OK", "edit OK", "cancel OK", "replay OK"]) {
      expect(codes.get(k) ?? 0, `edge case reached: ${k}`).toBeGreaterThan(0);
    }
    expect(p95, "place_order p95 under 80-fund load").toBeLessThan(2_000);
  }, 900_000);
});

describe("a resent order under the throttle (migration 091)", () => {
  test("a retry with the same client_ref returns the order placed, even when the fund has used up its 20 actions", async () => {
    const { n, squads: s } = await toPressure(db.pool, 4, "trading-stress-retry");
    await n.openRound(1);
    await resetRateLimits(db.pool);
    const fund = n.team(s[0]!.f_code);
    const ref = `${"0".repeat(32)}|${s[1]!.company_id}|BUY|100`;
    const first = await n.ok(fund, "place_order", s[1]!.company_id, "BUY", 100, ref);
    // The fund's other laptop uses up the throttle (19 more actions in the window).
    for (let k = 0; k < 19; k++) await n.call(fund, "place_order", s[2]!.company_id, "BUY", 1);
    expect(await n.call(fund, "place_order", s[2]!.company_id, "BUY", 1)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    // The lost answer is retried: the order already placed, not "too many order actions" (before 091: RATE_LIMITED).
    const again = await n.call(fund, "place_order", s[1]!.company_id, "BUY", 100, ref);
    expect(again).toMatchObject({ ok: true, duplicate: true, order: { id: first.order.id, status: "PENDING", qty: 100 } });
    // Another team's reference is its own order; a new reference is still throttled.
    expect(await n.call(n.team(s[1]!.f_code), "place_order", s[2]!.company_id, "BUY", 100, ref)).toMatchObject({ ok: true });
    expect(await n.call(fund, "place_order", s[1]!.company_id, "BUY", 100, `${"1".repeat(32)}|${s[1]!.company_id}|BUY|100`)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect((await n.one("select count(*)::int as c from orders where team_id = $1 and client_ref = $2", [n.teamId(s[0]!.f_code), ref])).c).toBe(1);
    await n.clearRound(1);
    await n.checkInvariants();
  }, 240_000);
});
