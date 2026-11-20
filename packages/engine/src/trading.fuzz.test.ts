// Property-based fuzzing of the trading algorithm (docs/system/TRADING-ALGORITHM.md, "Invariants").
//
// Every property runs on scenarios drawn from a seeded generator (mulberry32), so a failure names its seed and is
// replayed exactly. TRADING_FUZZ_SCALE multiplies every count (default 1: ~0.5 million scenarios, a few seconds per
// block). The oracles below are written from the rules, independently of the engine's own arithmetic (BigInt, no
// shared helpers), so the engine is checked against the spec, not against itself.

import { describe, expect, test } from "vitest";
import {
  PRACTICE,
  RULES,
  allocateIpo,
  applyTier,
  availableCash,
  buyReserve,
  cappedNet,
  checkFundRaise,
  checkRaiseTerms,
  clearRound,
  clearingPrice,
  closingMarketPrice,
  collateralFor,
  coolingOff,
  crisisShock,
  levelledTierBp,
  maxQuantity,
  practiceEquity,
  practiceTrade,
  practiceWinners,
  primusClosingPrice,
  ranksAscending,
  shortCollateral,
  shortReserve,
  subShock,
  tierBp,
  validateOrder,
  type ClearingOrder,
  type FundBook,
  type FundPosition,
  type OrderContext,
  type OrderType,
  type PendingOrder,
} from "./index";

const SCALE = Number(process.env.TRADING_FUZZ_SCALE ?? 1);
const n = (base: number) => Math.max(1, Math.round(base * SCALE));

/** Seeds used by each block (recorded in docs/system/TRADING-ALGORITHM.md). */
export const SEEDS = {
  clearingPrice: 0x5eed0001,
  rounds: 0x5eed0002,
  nights: 0x5eed0003,
  ipo: 0x5eed0004,
  floor: 0x5eed0005,
  raises: 0x5eed0006,
  leveller: 0x5eed0007,
  practice: 0x5eed0008,
  maxQty: 0x5eed0009,
} as const;

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

// ── Oracles, from the rules (BigInt; no engine arithmetic) ──
/** round(num ÷ den) half-up, for num ≥ 0, den > 0. */
const halfUp = (num: bigint, den: bigint) => (2n * num + den) / (2n * den);
/** new = old × (100,000 + clamp(net, ±10,000)) ÷ 100,000, half-up. */
const oraclePrice = (old: number, net: number) =>
  Number(halfUp(BigInt(old) * BigInt(100_000 + Math.max(-10_000, Math.min(10_000, net))), 100_000n));
const oracleTier = (price: number, bp: number) => Number(halfUp(BigInt(price) * BigInt(10_000 + bp), 10_000n));

const TYPES: OrderType[] = ["BUY", "SELL", "SHORT", "COVER"];
const emptyPos = (): FundPosition => ({ exchangeQty: 0, exchangeCost: 0, shortQty: 0, shortProceeds: 0 });

// ───────────────────────────── 1 · The clearing price ─────────────────────────────

describe("clearing price", () => {
  test(`${n(200_000)} (price, net) pairs: exact formula, ±10% cap, never below 1¢, monotone in net`, () => {
    const g = gen(SEEDS.clearingPrice);
    for (let i = 0; i < n(200_000); i++) {
      const old = g.pick([g.int(1, 20), g.int(1, 2_000), g.int(1, 200_000), g.int(1, 2_000_000_000)]);
      const net = g.pick([g.int(-50, 50), g.int(-15_000, 15_000), g.int(-2_000_000, 2_000_000), 10_000, -10_000, 9_999, -9_999]);
      const p = clearingPrice(old, net);
      const ctx = `old=${old} net=${net}`;
      // Impact = the formula, rounded half-up once.
      if (p !== oraclePrice(old, net)) expect.fail(`formula ${ctx}: ${p}`);
      // |move| ≤ 10% of the old price + half a cent (the rounding), and the cap is reached at |net| ≥ 10,000.
      if (10 * Math.abs(p - old) > old + 5) expect.fail(`cap ${ctx}: ${p}`);
      if (p < 1) expect.fail(`floor ${ctx}: ${p}`);
      // Direction: never against the net demand; monotone (more net demand never gives a lower price).
      if ((net > 0 && p < old) || (net < 0 && p > old) || (net === 0 && p !== old)) expect.fail(`direction ${ctx}: ${p}`);
      if (clearingPrice(old, net + g.int(1, 5_000)) < p) expect.fail(`monotone ${ctx}`);
      if (cappedNet(net) !== Math.max(-10_000, Math.min(10_000, net))) expect.fail(`capped ${ctx}`);
    }
  });

  test("worked examples from the document", () => {
    expect(clearingPrice(1_000, 2_500)).toBe(1_025); // $10.00, net +2,500 → +2.5% → $10.25
    expect(clearingPrice(1_000, 25_000)).toBe(1_100); // capped at +10%
    expect(clearingPrice(1_234, -3_333)).toBe(1_193); // 1,234 × 0.96667 = 1,192.87 → 1,193
    expect(clearingPrice(5, 10_000)).toBe(6); // 5.5 rounds half-up: at a few cents rounding is up to half a cent
    expect(clearingPrice(1, -10_000)).toBe(1); // 0.9 rounds to 1: a price never reaches 0
  });
});

// ───────────────────────────── 2 · One round: order entry + clearing ─────────────────────────────

interface Market {
  prices: Record<string, number>;
  funds: Record<string, FundBook>;
  squad: Record<string, string | null>;
}

function randomMarket(g: Gen): Market {
  const companies = Array.from({ length: g.int(1, 8) }, (_, i) => `C${i}`);
  const prices: Record<string, number> = {};
  for (const c of companies) prices[c] = g.pick([g.int(1, 30), g.int(500, 1_500), g.int(1_000, 6_000), g.int(1, 50_000), 1_005, 999]);
  const funds: Record<string, FundBook> = {};
  const squad: Record<string, string | null> = {};
  for (let f = 0; f < g.int(1, 10); f++) {
    const positions: Record<string, FundPosition> = {};
    for (const c of companies) {
      if (g.next() < 0.5) {
        const exchangeQty = g.pick([0, g.int(0, 4_000), 4_000]);
        const shortQty = g.pick([0, 0, g.int(0, 2_000), 2_000]);
        positions[c] = {
          exchangeQty,
          exchangeCost: exchangeQty * g.int(1, 3_000),
          shortQty,
          shortProceeds: shortQty * g.int(1, 3_000),
        };
      }
    }
    funds[`F${f}`] = { cash: g.pick([g.int(0, 60_000_000), 50_000_000, g.int(0, 3_000_000), 0]), positions };
    squad[`F${f}`] = g.next() < 0.7 ? g.pick(companies) : null;
  }
  return { prices, funds, squad };
}

/** The fund's order view in the open round (as app.order_context builds it). */
function view(m: Market, fund: string, pending: PendingOrder[]): OrderContext["fund"] {
  const book = m.funds[fund]!;
  const positions: Record<string, { exchangeQty: number; shortQty: number }> = {};
  for (const [c, p] of Object.entries(book.positions)) positions[c] = { exchangeQty: p.exchangeQty, shortQty: p.shortQty };
  return {
    track: "FINANCE",
    cash: book.cash,
    collateral: collateralFor(book.positions, m.prices),
    squadCompanyId: m.squad[fund] ?? null,
    positions,
    pending: pending.filter((o) => (o as PendingOrder & { teamId?: string }).teamId === fund),
  };
}

type Placed = PendingOrder & { teamId: string };

/** Random order flow: every attempt goes through validateOrder; edits and cancels replace or drop pending orders. */
type Style = "bull" | "bear" | "random";

function orderFlow(
  g: Gen,
  m: Market,
  attempts: number,
  blocked: ReadonlySet<string> = new Set(),
  hot?: string,
  styles: Readonly<Record<string, Style>> = {},
): Placed[] {
  const pending: Placed[] = [];
  const fundIds = Object.keys(m.funds);
  const companies = Object.keys(m.prices);
  for (let i = 0; i < attempts; i++) {
    const teamId = g.pick(fundIds);
    const r = g.next();
    if (r < 0.08 && pending.some((o) => o.teamId === teamId)) {
      // Cancel.
      const mine = pending.filter((o) => o.teamId === teamId);
      const o = g.pick(mine);
      pending.splice(pending.indexOf(o), 1);
      continue;
    }
    if (r < 0.16 && pending.some((o) => o.teamId === teamId)) {
      // Edit: the same check, with the edited order left out of the pending totals.
      const o = g.pick(pending.filter((x) => x.teamId === teamId));
      const qty = g.pick([g.int(1, 500), g.int(1, 4_000), o.qty * 2]);
      const ctx: OrderContext = { trading: "OPEN", prices: m.prices, fund: view(m, teamId, pending), replacingOrderId: o.id };
      const check = validateOrder(ctx, { companyId: o.companyId, type: o.type, qty });
      if (check.ok) {
        o.qty = qty;
        o.reserve = check.reserve;
      }
      continue;
    }
    // A "hot" company draws half the flow: mostly buys (it rises the full 10%), some shorts against it, so
    // collateral deficits, cooling-off and covers at a loss all happen.
    // Bears short the hot company and put the rest of their cash into longs, so its rise puts them in a collateral
    // deficit; bulls chase it.
    const style = styles[teamId] ?? "random";
    let companyId: string;
    let type: OrderType;
    if (hot !== undefined && style === "bear") {
      const short = g.next() < 0.4;
      companyId = short ? hot : g.pick(companies);
      type = short ? "SHORT" : g.next() < 0.8 ? "BUY" : g.pick(TYPES);
    } else if (hot !== undefined && style === "bull" && g.next() < 0.6) {
      companyId = hot;
      type = g.next() < 0.85 ? "BUY" : g.pick(TYPES);
    } else {
      companyId = hot !== undefined && g.next() < 0.3 ? hot : g.pick(companies);
      type = g.pick(TYPES);
    }
    if (blocked.has(companyId)) continue; // cooling off: place_order refuses before the check
    const ctx: OrderContext = { trading: "OPEN", prices: m.prices, fund: view(m, teamId, pending) };
    const k = style !== "random" && g.next() < 0.6 ? 4 : g.int(0, 4);
    const qty = k === 0 ? g.int(1, 200) : k === 1 ? g.int(1, 2_500) : k === 2 ? g.int(1, 5_000) : k === 3 ? g.int(1, 50) : maxQuantity(ctx, companyId, type) || 1;
    const check = validateOrder(ctx, { companyId, type, qty });
    if (check.ok) pending.push({ id: `o${i}`, teamId, companyId, type, qty, reserve: check.reserve });
  }
  return pending;
}

interface RoundStats {
  orders: number;
  rejectedCash: number;
}

/** Clears one round and checks every per-round invariant. Returns the market after the round. */
function clearAndCheck(m: Market, pending: Placed[], ctx: string): { market: Market; companies: ReturnType<typeof clearRound>["companies"] } {
  const orders: ClearingOrder[] = pending.map((o) => ({ id: o.id, teamId: o.teamId, companyId: o.companyId, type: o.type, qty: o.qty }));
  const r = clearRound(m.prices, orders, m.funds);
  const fail = (what: string) => expect.fail(`${what} (${ctx})`);

  // One price per company, = the formula on the round's net demand.
  const net: Record<string, number> = {};
  for (const o of orders) net[o.companyId] = (net[o.companyId] ?? 0) + (o.type === "BUY" || o.type === "COVER" ? o.qty : -o.qty);
  for (const [c, old] of Object.entries(m.prices)) {
    const cc = r.companies[c]!;
    if (cc.newPrice !== oraclePrice(old, net[c] ?? 0)) fail(`price of ${c}`);
    if (cc.newPrice < 1) fail(`price of ${c} below 1¢`);
  }
  for (const f of r.fills) {
    const o = orders.find((x) => x.id === f.orderId)!;
    if (f.price !== r.companies[o.companyId]!.newPrice) fail(`fill ${f.orderId} not at the company's one price`);
  }
  if (r.fills.length !== orders.length) fail("every order fills");

  // Conservation: cash and shares.
  let cashDelta = r.exchangeCashDelta;
  for (const [id, before] of Object.entries(m.funds)) cashDelta += r.funds[id]!.cash - before.cash;
  if (cashDelta !== 0) fail(`cash not conserved: ${cashDelta}`);
  for (const c of Object.keys(m.prices)) {
    let shares = r.exchangeShareDelta[c]!;
    for (const [id, before] of Object.entries(m.funds)) {
      const a = r.funds[id]!.positions[c] ?? emptyPos();
      const b = before.positions[c] ?? emptyPos();
      shares += a.exchangeQty - b.exchangeQty - (a.shortQty - b.shortQty);
    }
    if (shares !== 0) fail(`shares of ${c} not conserved: ${shares}`);
  }

  for (const [id, before] of Object.entries(m.funds)) {
    const after = r.funds[id]!;
    const mine = pending.filter((o) => o.teamId === id);
    // Limits never exceeded, never negative.
    for (const [c, p] of Object.entries(after.positions)) {
      const b = before.positions[c] ?? emptyPos();
      const grew = (q: number, was: number) => q > was;
      if (p.exchangeQty < 0 || p.shortQty < 0) fail(`${id}/${c} negative position`);
      if (grew(p.exchangeQty, b.exchangeQty) && p.exchangeQty > RULES.LONG_LIMIT) fail(`${id}/${c} over the long limit`);
      if (grew(p.shortQty, b.shortQty) && p.shortQty > RULES.SHORT_LIMIT) fail(`${id}/${c} over the short limit`);
      if (p.exchangeQty === 0 && p.exchangeCost !== 0) fail(`${id}/${c} cost left on an empty lot`);
      if (p.shortQty === 0 && p.shortProceeds !== 0) fail(`${id}/${c} proceeds left on an empty short lot`);
    }
    // Collateral = 150% of every open short at the new prices, exactly.
    let coll = 0n;
    for (const [c, p] of Object.entries(after.positions)) {
      if (p.shortQty > 0) coll += halfUp(BigInt(p.shortQty) * BigInt(r.companies[c]!.newPrice) * 150n, 100n);
    }
    if (BigInt(after.collateral) !== coll) fail(`${id} collateral`);
    // Reserves: no buy costs more than it reserved (the fills are at most +10% above the entry price).
    let buyCost = 0;
    let buyReserved = 0;
    for (const o of mine) {
      if (o.type !== "BUY") continue;
      buyCost += o.qty * r.companies[o.companyId]!.newPrice;
      buyReserved += o.reserve;
    }
    if (buyCost > buyReserved) fail(`${id} buys cost ${buyCost} > reserved ${buyReserved}`);
    // A short's reserve covers the collateral it adds less the proceeds it brings.
    for (const o of mine) {
      if (o.type !== "SHORT") continue;
      const p = r.companies[o.companyId]!.newPrice;
      if (shortCollateral(o.qty, p) - o.qty * p > o.reserve) fail(`${id} short ${o.id} needs more than its reserve`);
    }
    // No cash below what the rules allow: a fund that could afford its orders (available cash ≥ 0, no collateral
    // deficit) never ends a round with negative cash. Only a fund already in a deficit that covers can go below zero.
    const collBefore = collateralFor(before.positions, m.prices);
    const reserved = mine.reduce((s, o) => s + o.reserve, 0);
    if (before.cash >= collBefore && before.cash - collBefore - reserved >= 0 && after.cash < 0) fail(`${id} cash below zero: ${after.cash}`);
  }
  return { market: { prices: Object.fromEntries(Object.entries(r.companies).map(([c, x]) => [c, x.newPrice])), funds: r.funds, squad: m.squad }, companies: r.companies };
}

describe("one round", () => {
  test(`${n(40_000)} random books through validateOrder and clearRound: every per-round invariant`, () => {
    const g = gen(SEEDS.rounds);
    let orders = 0;
    for (let i = 0; i < n(40_000); i++) {
      const m = randomMarket(g);
      const pending = orderFlow(g, m, g.int(0, 40));
      orders += pending.length;
      // Entry-time rules the clearing relies on.
      for (const o of pending) {
        if (o.companyId === m.squad[o.teamId]) expect.fail(`insider order (seed ${SEEDS.rounds}, scenario ${i})`);
      }
      for (const fund of Object.keys(m.funds)) {
        const mine = pending.filter((o) => o.teamId === fund);
        const book = m.funds[fund]!;
        for (const c of Object.keys(m.prices)) {
          const pos = book.positions[c] ?? emptyPos();
          const q = (t: OrderType) => mine.filter((o) => o.companyId === c && o.type === t).reduce((s, o) => s + o.qty, 0);
          if (q("BUY") > 0 && pos.exchangeQty + q("BUY") > RULES.LONG_LIMIT) expect.fail(`long limit at entry, scenario ${i}`);
          if (q("SHORT") > 0 && pos.shortQty + q("SHORT") > RULES.SHORT_LIMIT) expect.fail(`short limit at entry, scenario ${i}`);
          if (q("SELL") > pos.exchangeQty) expect.fail(`oversell at entry, scenario ${i}`);
          if (q("COVER") > pos.shortQty) expect.fail(`overcover at entry, scenario ${i}`);
        }
        // Short exposure at entry prices ≤ $250,000 whenever the fund placed a short in this round.
        if (mine.some((o) => o.type === "SHORT")) {
          let exposure = 0;
          for (const c of Object.keys(m.prices)) {
            const q = (book.positions[c]?.shortQty ?? 0) + mine.filter((o) => o.companyId === c && o.type === "SHORT").reduce((s, o) => s + o.qty, 0);
            exposure += q * m.prices[c]!;
          }
          if (exposure > RULES.SHORT_EXPOSURE_LIMIT) expect.fail(`short exposure at entry, scenario ${i}`);
        }
        // Reserves never exceed what was available when the orders were placed (no over-commitment).
        const v = view(m, fund, pending);
        if (mine.some((o) => o.reserve > 0) && availableCash(v) < 0) expect.fail(`reserves over cash, scenario ${i}`);
      }
      clearAndCheck(m, pending, `seed ${SEEDS.rounds}, scenario ${i}`);
    }
    expect(orders).toBeGreaterThan(n(40_000) * 3);
  });

  test("the old reserve (qty × price × 1.10, rounded once) could be less than the most a buy costs", () => {
    // Before migration 079: at $10.05 a full +10% round fills at round(1,105.5) = $11.06 a share.
    const old = (qty: number, price: number) => Number(halfUp(BigInt(qty) * BigInt(price) * 110n, 100n));
    expect(old(4_000, 1_005)).toBe(4_422_000);
    expect(4_000 * clearingPrice(1_005, 10_000)).toBe(4_424_000); // $20 more than reserved
    expect(buyReserve(4_000, 1_005)).toBe(4_424_000);
    // Where rounding goes down the 110% rule still sets the reserve.
    expect(buyReserve(100, 1_050)).toBe(115_500);
    expect(buyReserve(4_000, 1_001)).toBe(old(4_000, 1_001));
    // The reserve is the larger of the two, and never less than the worst fill.
    const g = gen(SEEDS.rounds + 1);
    for (let i = 0; i < n(100_000); i++) {
      const qty = g.int(1, 100_000);
      const price = g.pick([g.int(1, 100), g.int(1, 10_000_000)]);
      const r = buyReserve(qty, price);
      if (r !== Math.max(old(qty, price), qty * oraclePrice(price, 10_000))) expect.fail(`reserve ${qty} @ ${price}`);
      if (r - old(qty, price) > Math.ceil(qty / 2)) expect.fail(`reserve above 110% by more than ½¢ a share: ${qty} @ ${price}`);
    }
  });
});

// ───────────────────────────── 3 · Whole nights ─────────────────────────────

describe("whole PRIMUS nights", () => {
  test(`${n(1_000)} nights of 31 rounds with the IPO, −5% shocks, tiers, the leveller, the injection and the close`, () => {
    const g = gen(SEEDS.nights);
    let rounds = 0;
    let deficits = 0;
    let negativeCash = 0;
    let cooled = 0;
    let minPrice = Infinity;
    let maxPrice = 0;
    for (let night = 0; night < n(1_000); night++) {
      const ctx = (r: number) => `seed ${SEEDS.nights}, night ${night}, round ${r}`;
      // Enough companies that a fund can spend all its cash under the 4,000-share caps (the night has up to 200).
      const companies = Array.from({ length: g.int(3, 16) }, (_, i) => `C${i}`);
      const fundIds = Array.from({ length: g.int(2, 8) }, (_, i) => `F${i}`);
      // Start: $500,000 each; IPO price = $10 × (1 + PRD tier); the exchange holds the IPO's 35,000 shares.
      const ipo: Record<string, number> = {};
      for (const c of companies) ipo[c] = applyTier(RULES.BASE_PRICE, tierBp("PITCH", g.int(0, 100)));
      let m: Market = { prices: { ...ipo }, funds: {}, squad: {} };
      for (const f of fundIds) {
        m.funds[f] = { cash: RULES.START_CASH_FINANCE, positions: {} };
        m.squad[f] = g.next() < 0.8 ? g.pick(companies) : null;
      }
      let ai: Record<string, number> = { ...ipo };
      const startMoney = fundIds.length * RULES.START_CASH_FINANCE;
      let exchangeCash = -startMoney;
      const inventory: Record<string, number> = Object.fromEntries(companies.map((c) => [c, RULES.IPO_SHARES]));

      // IPO: random books, allocated pro rata; funds pay the IPO price.
      for (const c of companies) {
        const bids = fundIds.filter((f) => m.squad[f] !== c && g.next() < 0.7).map((f) => ({ f, qty: g.int(0, 4_000) }));
        const affordable = bids.filter((b) => m.funds[b.f]!.cash >= b.qty * ipo[c]!);
        for (const a of allocateIpo(affordable.map((b) => ({ ...b, qty: b.qty })))) {
          if (a.allocated === 0) continue;
          const book = m.funds[a.f]!;
          const pos = (book.positions[c] ??= emptyPos());
          pos.exchangeQty += a.allocated;
          pos.exchangeCost += a.allocated * ipo[c]!;
          book.cash -= a.allocated * ipo[c]!;
          exchangeCash += a.allocated * ipo[c]!;
          inventory[c]! -= a.allocated;
        }
      }

      const hot = g.next() < 0.8 ? g.pick(companies) : undefined;
      const styles: Record<string, Style> = Object.fromEntries(fundIds.map((f) => [f, g.pick(["bull", "bear", "random"] as const)]));
      let lastCapped: Record<string, number> | null = null;
      let lastRound: Record<string, { open: number; clear: number }> = {};
      for (let round = 1; round <= 31; round++) {
        // Between rounds: a crisis reveal (−5%) before each sub-round's first round; the plan tier after its 5th
        // round (before its waiting 6th); Round 3's injection and the levelled solution tier before round 31.
        const sub = round <= 24 ? Math.ceil(round / 6) : 5;
        if (round <= 24 && round % 6 === 1) {
          for (const c of companies) {
            m.prices[c] = subShock(m.prices[c]!);
            ai[c] = subShock(ai[c]!);
          }
        }
        if ((round <= 24 && round % 6 === 0) || round === 31) {
          const scores = companies.map((c) => (c === hot ? g.int(80, 100) : g.pick([g.int(0, 100), g.int(0, 39), g.int(85, 100)])));
          const keys = companies.map(() => g.int(0, 500));
          const places = ranksAscending(keys);
          companies.forEach((c, i) => {
            let bp = tierBp(sub <= 4 ? "CRISIS_1" : "SOLUTION", scores[i]!);
            if (round === 31) bp = levelledTierBp(bp, places[i]!, companies.length);
            m.prices[c] = applyTier(m.prices[c]!, bp);
            ai[c] = applyTier(ai[c]!, bp);
          });
        }
        if (round === 25) {
          for (const f of fundIds) {
            m.funds[f]!.cash += RULES.START_CASH_FINANCE / 2;
            exchangeCash -= RULES.START_CASH_FINANCE / 2;
          }
        }
        // Funds in a collateral deficit at the start of the round.
        for (const f of fundIds) if (m.funds[f]!.cash < collateralFor(m.funds[f]!.positions, m.prices)) deficits++;

        const blocked = new Set(companies.filter((c) => coolingOff(lastCapped?.[c] ?? null)));
        const pending = orderFlow(g, m, g.int(0, 40), blocked, hot, styles);
        for (const o of pending) if (blocked.has(o.companyId)) expect.fail(`order in a cooling-off company (${ctx(round)})`);
        cooled += blocked.size;
        const out = clearAndCheck(m, pending, ctx(round));
        for (const c of companies) {
          exchangeCash += out.companies[c]!.net * out.companies[c]!.newPrice;
          inventory[c]! -= out.companies[c]!.net;
        }
        lastRound = Object.fromEntries(companies.map((c) => [c, { open: m.prices[c]!, clear: out.companies[c]!.newPrice }]));
        lastCapped = Object.fromEntries(companies.map((c) => [c, out.companies[c]!.cappedNet]));
        m = out.market;
        rounds++;
        for (const c of companies) {
          minPrice = Math.min(minPrice, m.prices[c]!);
          maxPrice = Math.max(maxPrice, m.prices[c]!);
        }
        for (const f of fundIds) if (m.funds[f]!.cash < 0) negativeCash++;
        // Money is conserved at every step: funds + exchange = 0.
        const total = fundIds.reduce((s, f) => s + m.funds[f]!.cash, 0) + exchangeCash;
        if (total !== 0) expect.fail(`money not conserved: ${total} (${ctx(round)})`);
        // 35,000 IPO shares: exchange inventory + Σ longs − Σ shorts.
        for (const c of companies) {
          const held = fundIds.reduce((s, f) => s + (m.funds[f]!.positions[c]?.exchangeQty ?? 0) - (m.funds[f]!.positions[c]?.shortQty ?? 0), 0);
          if (held + inventory[c]! !== RULES.IPO_SHARES) expect.fail(`shares of ${c}: ${held + inventory[c]!} (${ctx(round)})`);
        }
      }

      // The close: market = avg(last round's open, its clearing price); closing = avg(market, AI); shorts covered.
      for (const c of companies) {
        const market = closingMarketPrice(lastRound[c] ?? null, m.prices[c]!);
        const closing = primusClosingPrice(market, ai[c]!);
        if (closing < 1 || market < 1) expect.fail(`closing price below 1¢ (night ${night})`);
        for (const f of fundIds) {
          const p = m.funds[f]!.positions[c];
          if (p && p.shortQty > 0) {
            m.funds[f]!.cash -= p.shortQty * closing;
            exchangeCash += p.shortQty * closing;
            p.shortQty = 0;
            p.shortProceeds = 0;
          }
        }
      }
      const total = fundIds.reduce((s, f) => s + m.funds[f]!.cash, 0) + exchangeCash;
      if (total !== 0) expect.fail(`money not conserved after the close (night ${night})`);
    }
    expect(rounds).toBe(n(1_000) * 31);
    // The generator must reach the interesting states, or the night proves little.
    expect(deficits).toBeGreaterThan(0);
    expect(cooled).toBeGreaterThan(0);
    expect(minPrice).toBeGreaterThanOrEqual(1);
    expect(maxPrice).toBeLessThan(2 ** 31);
    // Report what the nights reached (visible with --reporter=verbose).
    console.info(`nights: ${rounds} rounds; deficits ${deficits}; negative cash (deficit covers) ${negativeCash}; cooling-off ${cooled}; prices ${minPrice}–${maxPrice}`);
  });
});

// ───────────────────────────── 4 · IPO allocation ─────────────────────────────

describe("IPO allocation", () => {
  test(`${n(50_000)} books: ≤ 35,000, exact pro rata to 10 shares, never above a request, fair`, () => {
    const g = gen(SEEDS.ipo);
    for (let i = 0; i < n(50_000); i++) {
      const book = Array.from({ length: g.pick([g.int(0, 10), g.int(0, 200)]) }, () => ({ qty: g.pick([0, g.int(0, 4_000), 4_000, g.int(1, 10)]) }));
      const total = book.reduce((s, r) => s + r.qty, 0);
      const out = allocateIpo(book);
      const sum = out.reduce((s, r) => s + r.allocated, 0);
      const ctx = `seed ${SEEDS.ipo}, book ${i}`;
      if (sum > RULES.IPO_SHARES) expect.fail(`over supply ${ctx}`);
      for (const r of out) {
        if (r.allocated > r.qty || r.allocated < 0) expect.fail(`allocation outside 0..request ${ctx}`);
        if (total <= RULES.IPO_SHARES) {
          if (r.allocated !== r.qty) expect.fail(`undersubscribed book not filled ${ctx}`);
        } else {
          const exact = (BigInt(r.qty) * 35_000n) / (BigInt(total) * 10n) * 10n;
          if (BigInt(r.allocated) !== exact) expect.fail(`not pro rata ${ctx}`);
          if (r.allocated % 10 !== 0) expect.fail(`not a multiple of 10 ${ctx}`);
        }
      }
      // Rounding down leaves fewer than 10 shares per bidder with the exchange.
      if (total > RULES.IPO_SHARES && RULES.IPO_SHARES - sum >= 10 * book.filter((r) => r.qty > 0).length) expect.fail(`remainder too large ${ctx}`);
      // Fair: a larger request never gets less.
      const sorted = [...out].sort((a, b) => a.qty - b.qty);
      for (let k = 1; k < sorted.length; k++) if (sorted[k]!.allocated < sorted[k - 1]!.allocated) expect.fail(`unfair ${ctx}`);
    }
  });
});

// ───────────────────────────── 5 · Prices never reach 0, never overflow ─────────────────────────────

describe("price floor and range", () => {
  test(`${n(20_000)} adversarial paths: 31 rounds of −10%, every −20% tier, every −5% shock, from 1¢ to $20`, () => {
    const g = gen(SEEDS.floor);
    for (let i = 0; i < n(20_000); i++) {
      let p = g.pick([1, 2, 3, 5, 9, 10, 11, g.int(1, 2_000)]);
      for (let k = 0; k < 40; k++) {
        const step = g.int(0, 4);
        p = step === 0 ? subShock(p) : step === 1 ? applyTier(p, g.pick([-2_000, -1_000, -500])) : step === 2 ? crisisShock(p) : clearingPrice(p, g.int(-1_000_000, 0));
        if (p < 1) expect.fail(`price reached ${p} (seed ${SEEDS.floor}, path ${i}, step ${k})`);
      }
    }
    // Every multiplier in the game is at least ×0.8; anything ≥ ×0.5 maps 1¢ to 1¢ (0.5 rounds up).
    for (const bp of [-2_000, -1_000, -500, 0]) expect(applyTier(1, bp)).toBe(1);
    expect(clearingPrice(1, -10_000)).toBe(1);
    expect(crisisShock(1)).toBe(1);
  });

  test("the highest price a night can reach is far inside a 32-bit integer and every value inside 2^53", () => {
    // $10 × PRD +10% × four +25% plans × solution +25% × 1.25 (leveller) × 31 rounds of +10%.
    let p = applyTier(RULES.BASE_PRICE, 1_000);
    for (let k = 0; k < 4; k++) p = applyTier(p, 2_500);
    p = applyTier(p, levelledTierBp(2_500, 1, 200));
    for (let r = 0; r < 31; r++) p = clearingPrice(p, 10_000);
    expect(p).toBeLessThan(100_000); // under $1,000 (cooling-off makes 31 capped rounds in a row impossible anyway)
    // The largest single amount: 100,000 shares × a 32-bit price is still exact in a double and in bigint columns.
    expect(Number.isSafeInteger(100_000 * (2 ** 31 - 1))).toBe(true);
    expect(buyReserve(100_000, 2 ** 31 - 1)).toBe(100_000 * oraclePrice(2 ** 31 - 1, 10_000));
    expect(shortReserve(100_000, 2 ** 31 - 1)).toBeGreaterThan(0);
  });
});

// ───────────────────────────── 6 · Cooling-off, raises, leveller ─────────────────────────────

describe("cooling-off", () => {
  test("exhaustive over net −20,000…20,000: cooling off exactly when the round moved the full ±10%", () => {
    for (let net = -20_000; net <= 20_000; net++) {
      const c = coolingOff(cappedNet(net));
      if (c !== Math.abs(net) >= 10_000) expect.fail(`net ${net}`);
    }
    expect(coolingOff(null)).toBe(false); // the first round: no cleared round yet
    expect(coolingOff(9_999)).toBe(false);
    expect(coolingOff(-10_000)).toBe(true);
  });
});

describe("equity raises", () => {
  test(`${n(50_000)} raises: posted and funded terms always keep the 40% floor with fees in escrow`, () => {
    const g = gen(SEEDS.raises);
    let funded = 0;
    for (let i = 0; i < n(50_000); i++) {
      const retained = g.pick([60_000, g.int(30_000, 60_000), 50_000]);
      const promised = g.pick([0, g.int(0, 4_000), 3_000]);
      const shares = g.pick([g.int(990, 10_010), g.int(100, 1_000) * 10, 1_000, 10_000, 1_005]);
      const posted = checkRaiseTerms(shares, retained, promised);
      const okTerms = shares >= 1_000 && shares <= 10_000 && shares % 10 === 0 && retained - promised - shares >= 40_000;
      if ((posted === null) !== okTerms) expect.fail(`terms ${shares}/${retained}/${promised}`);
      // Between posting and funding the company may promise more fee shares: funding re-checks the floor.
      const promisedLater = promised + g.pick([0, 0, g.int(0, 5_000)]);
      const price = g.int(1, 5_000);
      const lot = g.pick([0, g.int(0, 10_000), 8_000]);
      const avail = g.pick([g.int(-1_000_000, 60_000_000), shares * price, shares * price - 1]);
      const r = checkFundRaise(
        { ownSquad: g.next() < 0.05, fundedThisCrisis: g.next() < 0.1, raiseLotQty: lot, availableCash: avail, retained, promisedFeeShares: promisedLater },
        shares,
        price,
      );
      if (r.ok) {
        funded++;
        if (retained - promisedLater - shares < 40_000) expect.fail(`floor broken (seed ${SEEDS.raises}, case ${i})`);
        if (lot + shares > 10_000) expect.fail(`10% cap broken (case ${i})`);
        if (r.cash !== shares * price || r.cash > avail) expect.fail(`cash (case ${i})`);
      }
    }
    expect(funded).toBeGreaterThan(n(50_000) / 50);
  });
});

describe("Round 3 leveller", () => {
  test(`${n(20_000)} drafts: ×1.25 at the weakest down to ×0.25 at the strongest, ties share, negatives in full`, () => {
    const g = gen(SEEDS.leveller);
    for (let i = 0; i < n(20_000); i++) {
      const size = g.int(1, 200);
      const keys = Array.from({ length: size }, () => g.int(0, 500));
      const places = ranksAscending(keys);
      const bp = g.pick([2_500, 2_000, 1_000, 500, 0, -1_000, -2_000]);
      const out = places.map((p) => levelledTierBp(bp, p, size));
      for (let k = 0; k < size; k++) {
        const v = out[k]!;
        if (bp <= 0 || size <= 1) {
          if (v !== bp) expect.fail(`not in full (case ${i})`);
          continue;
        }
        // Exact: bp × (1.25 − (place − 1)/(n − 1)), truncated to a whole basis point.
        const exact = Math.floor((bp * (125 * (size - 1) - 100 * (places[k]! - 1))) / (100 * (size - 1)));
        if (v !== exact) expect.fail(`formula (case ${i})`);
        if (v > Math.floor((bp * 125) / 100) || v < Math.floor(bp / 4)) expect.fail(`outside ×0.25…×1.25 (case ${i})`);
        // A weaker score so far never gets a smaller multiplier; equal scores get the same.
        for (let j = 0; j < size; j++) {
          if (keys[j]! < keys[k]! && out[j]! < v) expect.fail(`not monotone (case ${i})`);
          if (keys[j] === keys[k] && out[j] !== v) expect.fail(`tie split (case ${i})`);
        }
      }
    }
    expect(levelledTierBp(2_500, 1, 200)).toBe(3_125);
    expect(levelledTierBp(2_500, 200, 200)).toBe(625);
    expect(levelledTierBp(1_000, 2, 3)).toBe(750); // ×0.75 in the middle of three
    expect(ranksAscending([30, 10, 30, 20])).toEqual([3, 1, 3, 2]);
  });
});

// ───────────────────────────── 7 · The practice market ─────────────────────────────

describe("practice market", () => {
  test(`${n(4_000)} sessions of 60 trades: limits, cash ≥ 0, 150% cover on every BUY and SHORT, ties to the lower code`, () => {
    const g = gen(SEEDS.practice);
    let trades = 0;
    let derisked = 0;
    for (let s = 0; s < n(4_000); s++) {
      const tickers = Array.from({ length: g.int(1, 6) }, (_, i) => `T${i}`);
      const prices: Record<string, number> = Object.fromEntries(tickers.map((t) => [t, g.int(200, 4_500)]));
      let book: { cash: number; positions: Record<string, number> } = { cash: PRACTICE.startCents, positions: {} };
      for (let k = 0; k < 60; k++) {
        // The scripted path moves between trades.
        for (const t of tickers) prices[t] = Math.max(150, Math.round(prices[t]! * (1 + (g.next() - 0.5) * 0.06)));
        const t = g.pick(tickers);
        const type = g.pick(TYPES);
        const qty = g.pick([g.int(1, 100), g.int(1, 4_000), g.int(1, 2_000), 4_001, 0]);
        const before = book;
        const r = practiceTrade(book, prices, t, type, qty);
        if (!r.ok) continue;
        trades++;
        book = { cash: r.cash, positions: { ...book.positions, [t]: r.position } };
        if (r.position > PRACTICE.maxLong || r.position < -PRACTICE.maxShort) expect.fail(`limit (seed ${SEEDS.practice}, session ${s})`);
        if (r.cash < 0) expect.fail(`negative practice cash (session ${s})`);
        const shorts = Object.entries(book.positions).reduce((x, [tt, q]) => x + (q < 0 ? -q * prices[tt]! : 0), 0);
        if ((type === "BUY" || type === "SHORT") && r.cash < Math.floor((shorts * 3) / 2)) expect.fail(`150% cover (session ${s})`);
        const prevPos = before.positions[t] ?? 0;
        if ((type === "SELL" || type === "COVER") && Math.abs(r.position) >= Math.abs(prevPos)) expect.fail(`not a risk reduction (session ${s})`);
        if (type === "SELL" || type === "COVER") {
          const prevShorts = Object.entries(before.positions).reduce((x, [tt, q]) => x + (q < 0 ? -q * prices[tt]! : 0), 0);
          if (before.cash < Math.floor((prevShorts * 3) / 2)) derisked++;
        }
        // Equity is cash + positions at the latest price, and a trade at the latest price leaves it unchanged.
        if (practiceEquity(book, prices) !== practiceEquity(before, prices)) expect.fail(`equity jumped on a trade (session ${s})`);
      }
    }
    expect(trades).toBeGreaterThan(n(4_000) * 10);
    console.info(`practice: ${trades} trades; ${derisked} sells or covers by a fund under 150% cover (refused before migration 079)`);

    // The prize: only funds that traded; highest equity first, ties to the lower team code.
    const w = practiceWinners([
      { code: "F10", equity: 12_000_000, trades: 3 },
      { code: "F02", equity: 12_000_000, trades: 1 },
      { code: "F01", equity: 99_000_000, trades: 0 },
      { code: "F07", equity: 11_000_000, trades: 9 },
      { code: "F03", equity: 10_000_000, trades: 2 },
    ]);
    expect(w).toEqual([
      { code: "F02", rank: 1, prize: 5_000_000 },
      { code: "F10", rank: 2, prize: 5_000_000 },
      { code: "F07", rank: 3, prize: 5_000_000 },
    ]);
  });
});

// ───────────────────────────── 8 · The order ticket's maximum ─────────────────────────────

describe("max quantity", () => {
  test(`${n(10_000)} contexts: maxQuantity passes and one more fails`, () => {
    const g = gen(SEEDS.maxQty);
    for (let i = 0; i < n(10_000); i++) {
      const m = randomMarket(g);
      const fund = g.pick(Object.keys(m.funds));
      const pending = orderFlow(g, m, g.int(0, 10));
      const ctx: OrderContext = { trading: "OPEN", prices: m.prices, fund: view(m, fund, pending) };
      const companyId = g.pick(Object.keys(m.prices));
      const type = g.pick(TYPES);
      const max = maxQuantity(ctx, companyId, type);
      if (max > 0 && !validateOrder(ctx, { companyId, type, qty: max }).ok) expect.fail(`max fails (case ${i})`);
      if (max < 100_000 && validateOrder(ctx, { companyId, type, qty: max + 1 }).ok) expect.fail(`max + 1 passes (case ${i})`);
    }
  });
});
