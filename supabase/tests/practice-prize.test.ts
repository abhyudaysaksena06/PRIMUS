// The Round 1 practice market under load and at the close: 80 funds trading at once (no double spend, every fund's
// cash and positions equal to its own trades at the server's prices, p95 latency), a fund's own racing orders, and
// the close (ties, a fund that never traded, a second close, a market where nobody traded), with the prize paid
// once into real cash through a balanced ledger.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { candleTicks, practiceCandles, sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { service } from "./helpers";
import { createTestDb } from "./pg";
import { settle } from "./race";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

async function openMarket(squads: number) {
  const n = await Night.create(db.pool, squads, "PRIMUS");
  const seed = sha256Hex(`practice-${squads}`);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, "5");
  await n.advanceTo("BUILD");
  const products = await n.q("select id, code from teams where event_id = $1 and track = 'PRODUCT' order by code", [n.eventId]);
  const rows = products.map((p) => ({ ticker: p.id, prices: practiceCandles(`${n.eventId}:${p.code}`, 40).flatMap((k) => candleTicks(k)) }));
  expect((await n.call(service, "practice_prepare", n.eventId, new Date(Date.now() - 300_000).toISOString(), 5, JSON.stringify(rows))).ok).toBe(true);
  const squadList = [];
  for (let i = 1; i <= squads; i++) squadList.push(await n.squad(i));
  return { n, products: products as { id: string; code: string }[], squads: squadList };
}

const signed = (type: string, qty: number) => (type === "BUY" || type === "COVER" ? qty : -qty);

describe("practice market under load", () => {
  test("80 funds trade at once: no double spend, cash and positions match the trades, p95 latency", async () => {
    const { n, products, squads } = await openMarket(80);
    const plan = ["BUY", "BUY", "SELL", "SHORT", "COVER"] as const;
    const ms: number[] = [];
    const results = await Promise.all(
      squads.map(async (s, i) => {
        const long = products[i % products.length]!.id;
        const short = products[(i + 7) % products.length]!.id;
        const out = [];
        for (const t of plan) {
          const r = await settle(n.call(n.team(s.f_code), "practice_trade", t === "SHORT" || t === "COVER" ? short : long, t, 100));
          ms.push(r.ms);
          out.push(r);
        }
        return out;
      }),
    );
    const errors = results.flat().filter((r) => r.err !== undefined || r.ok?.ok !== true);
    expect(errors.map((e) => e.err ?? e.ok?.code)).toEqual([]);
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.floor(ms.length * 0.95)]!;
    console.log(`practice_trade x ${ms.length} (80 funds at once): p50 ${Math.round(ms[Math.floor(ms.length / 2)]!)} ms, p95 ${Math.round(p95)} ms, max ${Math.round(ms.at(-1)!)} ms`);
    expect(p95).toBeLessThan(2000);

    // Every fund: cash = $100,000 − Σ signed qty × fill price; each position = Σ its signed trades; trades counted.
    const bad = await n.q(
      `select a.team_id from practice_accounts a
        where a.event_id = $1 and (
          a.cash_cents <> 10000000 - coalesce((select sum(case when t.type in ('BUY','COVER') then 1 else -1 end * t.qty::bigint * t.price_cents)
                                                  from practice_trades t where t.team_id = a.team_id), 0)
          or a.trades <> (select count(*) from practice_trades t where t.team_id = a.team_id)
          or exists (select 1 from practice_positions p where p.team_id = a.team_id and p.qty <> coalesce((
                       select sum(case when t.type in ('BUY','COVER') then t.qty else -t.qty end) from practice_trades t
                        where t.team_id = a.team_id and t.ticker_team_id = p.ticker_team_id), 0)))`,
      [n.eventId],
    );
    expect(bad).toEqual([]);
    expect((await n.one("select count(*)::int as c from practice_accounts where event_id = $1", [n.eventId])).c).toBe(80);
    // A fill is always a stored tick of that company at or before the trade (the server's price, never the client's).
    expect(
      (await n.one(
        `select count(*)::int as c from practice_trades t where t.event_id = $1 and not exists (
           select 1 from practice_ticks k where k.ticker_team_id = t.ticker_team_id and k.price_cents = t.price_cents and k.at <= t.created_at)`,
        [n.eventId],
      )).c,
    ).toBe(0);
    expect(signed("SELL", 3)).toBe(-3);

    // One fund fires 12 buys at once, each for ~60% of its cash: never below zero, at most one more fills.
    const f = n.team(squads[0]!.f_code);
    const fid = n.teamId(squads[0]!.f_code);
    const target = products[20]!.id;
    const price = (await n.one("select app.practice_price($1) as p", [target])).p as number;
    const cash = Number((await n.one("select cash_cents from practice_accounts where team_id = $1", [fid])).cash_cents);
    const qty = Math.min(4000, Math.floor((cash * 0.6) / price));
    const race = await Promise.all(Array.from({ length: 12 }, () => settle(n.call(f, "practice_trade", target, "BUY", qty))));
    const filled = race.filter((r) => r.ok?.ok === true).length;
    expect(filled).toBe(Math.min(Math.floor(cash / (qty * price)), Math.floor(4000 / qty), 12));
    expect(Number((await n.one("select cash_cents from practice_accounts where team_id = $1", [fid])).cash_cents)).toBeGreaterThanOrEqual(0);
    expect(race.filter((r) => r.err !== undefined)).toEqual([]);

    // A client cannot name its price: the function takes none (an extra argument is no such function).
    await expect(n.call(f, "practice_trade", target, "BUY", 1, 1)).rejects.toThrow();
    // A fund cannot trade a ticker of another event or a Finance team.
    expect((await n.call(f, "practice_trade", fid, "BUY", 1)).code).toBe("NO_PRICE");

    // The close: one settlement even when run twice at once; the prize goes to exactly 3 funds, through the ledger.
    const realBefore = Number((await n.one("select sum(cash_cents) as s from teams where event_id = $1", [n.eventId])).s);
    const exBefore = Number((await n.one("select exchange_cash_cents as s from events where id = $1", [n.eventId])).s);
    const twice = await Promise.all([settle(n.q("select app.settle_practice($1)", [n.eventId])), settle(n.q("select app.settle_practice($1)", [n.eventId]))]);
    expect(twice.filter((r) => r.err !== undefined)).toEqual([]);
    const winners = await n.q("select team_id, rank, equity_cents, edge_cents from practice_accounts where event_id = $1 and rank is not null order by rank", [n.eventId]);
    expect(winners.map((w) => w.rank)).toEqual([1, 2, 3]);
    const top = await n.q(
      `select a.team_id from practice_accounts a join teams t on t.id = a.team_id where a.event_id = $1 and a.trades > 0
        order by a.equity_cents desc, t.code collate "C" limit 3`,
      [n.eventId],
    );
    expect(winners.map((w) => w.team_id)).toEqual(top.map((t) => t.team_id));
    expect((await n.one("select count(*)::int as c from ledger_entries where event_id = $1 and kind = 'PRACTICE_EDGE'", [n.eventId])).c).toBe(4);
    expect(Number((await n.one("select sum(cash_delta_cents) as s from ledger_entries where event_id = $1 and kind = 'PRACTICE_EDGE'", [n.eventId])).s)).toBe(0);
    expect(Number((await n.one("select sum(cash_cents) as s from teams where event_id = $1", [n.eventId])).s) - realBefore).toBe(15_000_000);
    expect(exBefore - Number((await n.one("select exchange_cash_cents as s from events where id = $1", [n.eventId])).s)).toBe(15_000_000);
    expect((await n.call(f, "practice_trade", target, "BUY", 1)).code).toBe("PRACTICE_CLOSED");
    await n.checkInvariants();
  }, 600_000);
});

describe("the close", () => {
  test("ties go to the lower code, a fund that never traded is never ranked, a second close pays nothing", async () => {
    const { n, products, squads } = await openMarket(5);
    const codes = squads.map((s) => s.f_code);
    // Four funds trade (in and out: flat), the fifth never does. Equities set by hand: two tie for first.
    for (const c of codes.slice(0, 4)) {
      await n.ok(n.team(c), "practice_trade", products[0]!.id, "BUY", 10);
      await n.ok(n.team(c), "practice_trade", products[0]!.id, "SELL", 10);
    }
    const set = (c: string, cents: number) => n.q("update practice_accounts set cash_cents = $2 where team_id = $1", [n.teamId(c), cents]);
    const sorted = [...codes.slice(0, 4)].sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : 1));
    await set(sorted[3]!, 12_000_000);
    await set(sorted[1]!, 12_000_000);
    await set(sorted[0]!, 9_000_000);
    await set(sorted[2]!, 11_000_000);
    const before = Object.fromEntries((await n.q("select code, cash_cents from teams where event_id = $1", [n.eventId])).map((r) => [r.code, Number(r.cash_cents)]));
    await n.q("select app.settle_practice($1)", [n.eventId]);
    await n.q("select app.settle_practice($1)", [n.eventId]);
    const ranks = Object.fromEntries((await n.q("select t.code, a.rank from practice_accounts a join teams t on t.id = a.team_id where a.event_id = $1", [n.eventId])).map((r) => [r.code, r.rank]));
    expect([ranks[sorted[1]!], ranks[sorted[3]!], ranks[sorted[2]!], ranks[sorted[0]!]]).toEqual([1, 2, 3, null]);
    expect(ranks[codes[4]!]).toBe(undefined);
    const after = Object.fromEntries((await n.q("select code, cash_cents from teams where event_id = $1", [n.eventId])).map((r) => [r.code, Number(r.cash_cents)]));
    for (const c of Object.keys(before)) expect(after[c]! - before[c]!, c).toBe([sorted[1], sorted[3], sorted[2]].includes(c) ? 5_000_000 : 0);
    expect((await n.one("select count(*)::int as c from ledger_entries where event_id = $1 and kind = 'PRACTICE_EDGE' and team_id is not null", [n.eventId])).c).toBe(3);
    // The practice money itself never reaches real cash: only the three prizes moved.
    expect(Object.keys(before).reduce((s, c) => s + after[c]! - before[c]!, 0)).toBe(15_000_000);
    await n.checkInvariants();
  }, 300_000);

  test("nobody traded: no prize, no ledger row, the bulletin says so", async () => {
    const { n } = await openMarket(3);
    const before = Number((await n.one("select sum(cash_cents) as s from teams where event_id = $1", [n.eventId])).s);
    await n.q("select app.settle_practice($1)", [n.eventId]);
    expect((await n.one("select count(*)::int as c from ledger_entries where event_id = $1 and kind = 'PRACTICE_EDGE'", [n.eventId])).c).toBe(0);
    expect(Number((await n.one("select sum(cash_cents) as s from teams where event_id = $1", [n.eventId])).s)).toBe(before);
    expect((await n.one("select body from bulletins where event_id = $1 and title = 'The practice market has closed'", [n.eventId])).body).toContain("No fund traded");
    expect((await n.one("select settled_at is not null as s from practice_markets where event_id = $1", [n.eventId])).s).toBe(true);
    await n.checkInvariants();
  }, 300_000);
});
