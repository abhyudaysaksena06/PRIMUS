// SQL fuzz-parity of the trading algorithm (docs/system/TRADING-ALGORITHM.md, "SQL parity"): random order books run
// through the real database functions and the TypeScript engine, compared exactly.
//
//  A. Order entry through public.place_order / edit_order / cancel_order as the teams themselves: every verdict
//     (accepted with its reserve, or the refusal code) equals the engine's validateOrder (+ the cooling-off), then the
//     round clears through the tick and Night.clearRound compares prices, cash, collateral and every position with
//     clearRound. Crisis reveals (−5%) between sub-rounds are compared with subShock.
//  B. Bulk books: thousands of rounds of engine-validated orders written straight into the open round and cleared by
//     app.clear_round, with the engine carrying its own state from round to round (cumulative parity: any drift in
//     rounding, cost basis or collateral would show and stay).
//
// Counts are environment knobs (defaults keep the file near a minute on 4 shared cores):
//   TRADING_FUZZ_EVENTS (A: events, 24 rounds each, default 2), TRADING_FUZZ_ATTEMPTS (A: order actions per round,
//   default 30), TRADING_FUZZ_BULK_ROUNDS (B: default 3,000), TRADING_FUZZ_SEED (default 20261120).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  clearRound,
  collateralFor,
  coolingOff,
  maxQuantity,
  subShock,
  validateOrder,
  type ClearingOrder,
  type FundBook,
  type OrderContext,
  type OrderType,
  type PendingOrder,
} from "@msim/engine";
import { createTestDb } from "./pg";
import { noWaits, resetRateLimits, toPressure } from "./trading-setup";
import type { Night } from "./night";

const EVENTS = Number(process.env.TRADING_FUZZ_EVENTS ?? 2);
const ATTEMPTS = Number(process.env.TRADING_FUZZ_ATTEMPTS ?? 30);
const BULK = Number(process.env.TRADING_FUZZ_BULK_ROUNDS ?? 3_000);
const SEED = Number(process.env.TRADING_FUZZ_SEED ?? 20261120);

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

function gen(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
  return { next, int, pick };
}
type Gen = ReturnType<typeof gen>;
const TYPES: OrderType[] = ["BUY", "SELL", "SHORT", "COVER"];

async function lastCapped(n: Night): Promise<Record<string, number>> {
  const rows = await n.q(
    `select rp.company_id, rp.capped_net from round_prices rp
      where rp.kind = 'CLEARING' and rp.round_id = (select id from rounds where event_id = $1 and status = 'CLEARED' order by number desc limit 1)`,
    [n.eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.company_id, r.capped_net]));
}

function fundView(book: FundBook & { collateral: number }, squadCompanyId: string | null, pending: PendingOrder[]): OrderContext["fund"] {
  const positions: Record<string, { exchangeQty: number; shortQty: number }> = {};
  for (const [c, p] of Object.entries(book.positions)) positions[c] = { exchangeQty: p.exchangeQty, shortQty: p.shortQty };
  return { track: "FINANCE", cash: book.cash, collateral: book.collateral, squadCompanyId, positions, pending };
}

describe("A · order entry and clearing through the real functions", () => {
  test(`${EVENTS} PRIMUS events × 24 rounds × ${ATTEMPTS} order actions: every verdict and every clearing equals the engine`, async () => {
    const g = gen(SEED);
    const codes = new Map<string, number>();
    let actions = 0;
    let rounds = 0;
    for (let e = 0; e < EVENTS; e++) {
      const squads = 8;
      const { n, squads: s } = await toPressure(db.pool, squads, `fuzz-a-${SEED}-${e}`, {
        pitch: () => g.int(30, 95),
        bids: (i) => Object.fromEntries([1, 3, 5].map((d) => [(i + d) % squads, g.int(0, 3_000)])),
      });
      await noWaits(n);
      const funds = s.map((q) => ({ code: q.f_code as string, id: n.teamId(q.f_code), squadCompany: q.company_id as string }));
      const hot = s[g.int(0, squads - 1)]!.company_id as string;
      for (let round = 1; round <= 24; round++) {
        if (round > 1 && round % 6 === 1) {
          // A crisis reveal between rounds: every market and AI price −5%, collateral recalculated.
          const before = await n.q("select id, market_price, ai_price from companies where event_id = $1 and market_price is not null", [n.eventId]);
          await n.deadlinePassed(`REVEAL_${(round + 5) / 6}`);
          await n.ok(n.lead, "tick", n.eventId);
          const after = new Map((await n.q("select id, market_price, ai_price from companies where event_id = $1", [n.eventId])).map((r) => [r.id, r]));
          for (const b of before) {
            expect([after.get(b.id).market_price, after.get(b.id).ai_price]).toEqual([subShock(b.market_price), subShock(b.ai_price)]);
          }
          const books = await n.fundBooks();
          const prices = await n.prices();
          for (const f of funds) expect(books[f.id]!.collateral).toBe(collateralFor(books[f.id]!.positions, prices));
        }
        await n.openRound(round);
        await resetRateLimits(db.pool);
        const prices = await n.prices();
        const books = await n.fundBooks();
        const capped = await lastCapped(n);
        const pending = new Map<string, (PendingOrder & { teamId: string })[]>(funds.map((f) => [f.id, []]));
        let sinceReset = 0;
        for (let k = 0; k < ATTEMPTS; k++) {
          if (++sinceReset >= 15) {
            await resetRateLimits(db.pool);
            sinceReset = 0;
          }
          const f = g.pick(funds);
          const mine = pending.get(f.id)!;
          const ctx = (replacing?: string): OrderContext => ({
            trading: "OPEN",
            prices,
            fund: fundView(books[f.id]!, f.squadCompany, mine),
            ...(replacing ? { replacingOrderId: replacing } : {}),
          });
          const r = g.next();
          if (r < 0.07 && mine.length) {
            const o = g.pick(mine);
            expect(await n.call(n.team(f.code), "cancel_order", o.id)).toMatchObject({ ok: true });
            mine.splice(mine.indexOf(o), 1);
            actions++;
            continue;
          }
          if (r < 0.15 && mine.length) {
            const o = g.pick(mine);
            const qty = g.pick([g.int(1, 400), g.int(1, 4_000), o.qty + g.int(1, 2_000)]);
            const exp = validateOrder(ctx(o.id), { companyId: o.companyId, type: o.type, qty });
            const got = await n.call(n.team(f.code), "edit_order", o.id, qty);
            const key = `edit ${exp.ok ? "OK" : exp.code}`;
            codes.set(key, (codes.get(key) ?? 0) + 1);
            if (exp.ok) {
              expect(got, `edit ${JSON.stringify({ o, qty })}`).toMatchObject({ ok: true });
              expect(Number(got.order.reserve_cents)).toBe(exp.reserve);
              o.qty = qty;
              o.reserve = exp.reserve;
            } else {
              expect(got, `edit ${JSON.stringify({ o, qty })}`).toMatchObject({ ok: false, code: exp.code });
            }
            actions++;
            continue;
          }
          // A hot company draws a third of the flow (mostly buys at the maximum), so it hits the cap and cools off.
          const hotNow = hot !== f.squadCompany && g.next() < 0.33;
          const companyId = hotNow ? hot : g.next() < 0.06 ? f.squadCompany : g.pick(Object.keys(prices).sort());
          const type = hotNow && g.next() < 0.8 ? "BUY" : g.pick(TYPES);
          const q = hotNow ? 9 : g.int(0, 9);
          const qty = q === 0 ? g.pick([0, 100_001, 4_001, 2_001]) : q < 4 ? g.int(1, 300) : q < 7 ? g.int(1, 4_000) : maxQuantity(ctx(), companyId, type) || g.int(1, 50);
          const cooling = coolingOff(capped[companyId] ?? null);
          const exp = cooling ? ({ ok: false, code: "COOLING_OFF" } as const) : validateOrder(ctx(), { companyId, type, qty });
          const got = await n.call(n.team(f.code), "place_order", companyId, type, qty);
          const key = exp.ok ? "OK" : exp.code;
          codes.set(key, (codes.get(key) ?? 0) + 1);
          if (exp.ok) {
            expect(got, `place ${JSON.stringify({ f: f.code, companyId, type, qty })}`).toMatchObject({ ok: true });
            expect([Number(got.order.reserve_cents), got.order.entry_price]).toEqual([exp.reserve, exp.entryPrice]);
            mine.push({ id: got.order.id, teamId: f.id, companyId, type, qty, reserve: exp.reserve });
          } else {
            expect(got, `place ${JSON.stringify({ f: f.code, companyId, type, qty })}`).toMatchObject({ ok: false, code: exp.code });
          }
          actions++;
        }
        await n.clearRound(round); // compares the clearing with the engine
        rounds++;
        if (round % 8 === 0) await n.checkInvariants();
      }
      await n.checkInvariants();
    // Team codes and logins are unique across events and the test seeds cycle through 20 prefixes: retire this event's.
    await n.q("delete from accounts where team_id in (select id from teams where event_id = $1)", [n.eventId]);
    await n.q(
      `update teams t set code = 'W' || chr(65 + ($2::int / 26) % 26) || chr(65 + $2::int % 26) || lpad(x.k::text, 3, '0')
         from (select id, row_number() over (order by code) as k from teams where event_id = $1) x where x.id = t.id`,
      [n.eventId, e],
    );
    }
    console.info(`A: ${actions} order actions over ${rounds} rounds; verdicts ${JSON.stringify(Object.fromEntries([...codes].sort()))}`);
    for (const c of ["OK", "COOLING_OFF", "INSIDER", "BAD_QUANTITY", "LONG_LIMIT", "NOT_ENOUGH_SHARES", "NOT_ENOUGH_SHORT", "SHORT_LIMIT"]) {
      expect(codes.has(c), `the generator reached ${c}`).toBe(true);
    }
  }, 900_000);
});

describe("B · bulk books through app.clear_round, cumulative parity", () => {
  test(`${BULK} rounds: prices, fills, cash, cost bases, collateral, inventory and exchange cash equal the engine round after round`, async () => {
    const g = gen(SEED + 1);
    const squads = 10;
    let orders = 0;
    let done = 0;
    // rounds.number is 1–60, so the rounds run on as many events as they need (60 rounds each, cleared directly).
    for (let e = 0; done < BULK; e++) {
    const { n, squads: s } = await toPressure(db.pool, squads, `fuzz-b-${SEED}-${e}`, {
      pitch: () => g.int(30, 95),
      bids: (i) => Object.fromEntries([1, 2, 4, 7].map((d) => [(i + d) % squads, g.int(500, 4_000)])),
    });
    await n.q(
      `insert into rounds (event_id, number, phase, opens_at, closes_at, status)
       select $1, g, 'PRESSURE', now() - interval '1 hour', now() + interval '1 hour', 'SCHEDULED' from generate_series(32, 60) g`,
      [n.eventId],
    );
    const roundIds = (await n.q("select id, number from rounds where event_id = $1 order by number", [n.eventId])).map((r) => r.id as string);
    const squadOf = new Map(s.map((q) => [n.teamId(q.f_code), q.company_id as string]));
    let prices = await n.prices();
    let books: Record<string, FundBook & { collateral: number }> = await n.fundBooks();
    let capped: Record<string, number> = {};
    const exch0 = await n.one("select exchange_cash_cents from events where id = $1", [n.eventId]);
    let exchangeCash = Number(exch0.exchange_cash_cents);
    const inv0 = await n.q("select id, exchange_inventory from companies where event_id = $1", [n.eventId]);
    const inventory: Record<string, number> = Object.fromEntries(inv0.map((r) => [r.id, r.exchange_inventory]));
    const hot = g.pick(Object.keys(prices).sort());
    for (let b = 0; b < roundIds.length && done < BULK; b++, done++) {
      const roundId = roundIds[b]!;
      const pending = new Map<string, PendingOrder[]>(Object.keys(books).map((id) => [id, []]));
      const all: (ClearingOrder & { reserve: number; entry: number })[] = [];
      const attempts = g.int(5, 60);
      for (let k = 0; k < attempts; k++) {
        const fund = g.pick(Object.keys(books).sort());
        const companyId = g.next() < 0.35 ? hot : g.pick(Object.keys(prices).sort());
        if (coolingOff(capped[companyId] ?? null)) continue;
        const type = companyId === hot && g.next() < 0.5 ? "BUY" : g.pick(TYPES);
        const ctx: OrderContext = { trading: "OPEN", prices, fund: fundView(books[fund]!, squadOf.get(fund) ?? null, pending.get(fund)!) };
        const qty = g.next() < 0.3 ? maxQuantity(ctx, companyId, type) || 1 : g.int(1, 3_000);
        const v = validateOrder(ctx, { companyId, type, qty });
        if (!v.ok) continue;
        const id = `${b}-${k}`;
        pending.get(fund)!.push({ id, companyId, type, qty, reserve: v.reserve });
        all.push({ id, teamId: fund, companyId, type, qty, reserve: v.reserve, entry: v.entryPrice });
      }
      orders += all.length;
      // Write the book (as place_order would have: entry price and reserve from the check), then clear it.
      const ids: string[] = all.length
        ? (
            await n.q(
              `insert into orders (event_id, round_id, team_id, company_id, type, qty, entry_price, reserve_cents)
               select $1, $2, (o ->> 'teamId')::uuid, (o ->> 'companyId')::uuid, (o ->> 'type')::order_type, (o ->> 'qty')::int,
                      (o ->> 'entry')::int, (o ->> 'reserve')::bigint
                 from jsonb_array_elements($3::jsonb) with ordinality x(o, i) order by i returning id`,
              [n.eventId, roundId, JSON.stringify(all)],
            )
          ).map((r) => r.id)
        : [];
      const expected = clearRound(prices, all.map((o, i) => ({ ...o, id: ids[i]! })), books);
      await n.q("select app.clear_round($1, true)", [roundId]);

      // Compare: prices and capped nets, every fill, every fund, exchange cash and inventory.
      const rp = await n.q("select company_id, market_after, capped_net from round_prices where round_id = $1 and kind = 'CLEARING'", [roundId]);
      expect(rp.length).toBe(Object.keys(prices).length);
      for (const r of rp) {
        const c = expected.companies[r.company_id]!;
        if (r.market_after !== c.newPrice || r.capped_net !== c.cappedNet) expect.fail(`round ${b}: ${r.company_id} ${r.market_after}/${r.capped_net} ≠ ${c.newPrice}/${c.cappedNet}`);
      }
      if (ids.length) {
        const fills = await n.q("select id, status, fill_price from orders where round_id = $1", [roundId]);
        const want = new Map(expected.fills.map((f) => [f.orderId, f.price]));
        for (const f of fills) if (f.status !== "FILLED" || f.fill_price !== want.get(f.id)) expect.fail(`round ${b}: fill ${f.id}`);
      }
      const got = await n.fundBooks();
      for (const [id, want] of Object.entries(expected.funds)) {
        const have = got[id]!;
        if (have.cash !== want.cash || have.collateral !== want.collateral) expect.fail(`round ${b}: fund ${id} cash/collateral`);
        for (const [c, p] of Object.entries(want.positions)) {
          const h = have.positions[c] ?? { exchangeQty: 0, exchangeCost: 0, shortQty: 0, shortProceeds: 0 };
          if (h.exchangeQty !== p.exchangeQty || h.exchangeCost !== p.exchangeCost || h.shortQty !== p.shortQty || h.shortProceeds !== p.shortProceeds) {
            expect.fail(`round ${b}: position ${id}/${c} ${JSON.stringify(h)} ≠ ${JSON.stringify(p)}`);
          }
        }
      }
      exchangeCash += expected.exchangeCashDelta;
      for (const [c, d] of Object.entries(expected.exchangeShareDelta)) inventory[c] = inventory[c]! + d;
      if (b % 20 === 19 || done === BULK - 1) {
        expect(Number((await n.one("select exchange_cash_cents from events where id = $1", [n.eventId])).exchange_cash_cents)).toBe(exchangeCash);
        const inv = await n.q("select id, exchange_inventory from companies where event_id = $1", [n.eventId]);
        for (const r of inv) expect(r.exchange_inventory).toBe(inventory[r.id]);
      }
      // The engine carries its own state on (cumulative parity).
      prices = Object.fromEntries(Object.entries(expected.companies).map(([c, x]) => [c, x.newPrice]));
      books = expected.funds;
      capped = Object.fromEntries(Object.entries(expected.companies).map(([c, x]) => [c, x.cappedNet]));
    }
    await n.checkInvariants();
    // Team codes and logins are unique across events and the test seeds cycle through 20 prefixes: retire this event's.
    await n.q("delete from accounts where team_id in (select id from teams where event_id = $1)", [n.eventId]);
    await n.q(
      `update teams t set code = 'X' || chr(65 + ($2::int / 26) % 26) || chr(65 + $2::int % 26) || lpad(x.k::text, 3, '0')
         from (select id, row_number() over (order by code) as k from teams where event_id = $1) x where x.id = t.id`,
      [n.eventId, e],
    );
    }
    console.info(`B: ${BULK} rounds, ${orders} orders, seed ${SEED + 1}: no difference`);
    expect(orders).toBeGreaterThan(BULK * 3);
  }, 900_000);
});
