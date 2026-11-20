// Shared set-up for the trading tests (trading-edges, trading-fuzz): a PRIMUS night played through the real game
// functions up to Round 2 with crisis 1 revealed, IPO bids allocated, plus superuser helpers that move a price the
// way a score release does (for adversarial cases that would otherwise need hours of rounds).

import type pg from "pg";
import { sha256Hex } from "@msim/engine";
import { Night } from "./night";

export const ticker = (i: number) => `T${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(i / 26) % 26]}${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i % 26]}`;

export interface Primus {
  n: Night;
  squads: any[];
}

/**
 * A PRIMUS event with `squads` squads in PRESSURE, crisis 1 revealed (prices −5%), no round open yet.
 * `pitch(i)` is squad i's PRD score (its IPO price); `bids(i)` the IPO bids of squad i's fund (company index → qty).
 */
export async function toPressure(
  pool: pg.Pool,
  squads: number,
  tag: string,
  opts: { pitch?: (i: number) => number; bids?: (i: number) => Record<number, number> } = {},
): Promise<Primus> {
  const n = await Night.create(pool, squads, "PRIMUS");
  const seed = sha256Hex(tag);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, String(squads));
  const s: any[] = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Trade Co ${i}`, ticker: ticker(i), problem: "A real problem." }, 0);
    await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const [i, q] of s.entries()) {
    const score = opts.pitch?.(i) ?? 60;
    await n.judge(q.company_id, "PITCH", [score, score, score]);
  }
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  if (opts.bids) {
    for (const [i, q] of s.entries()) {
      for (const [c, qty] of Object.entries(opts.bids(i))) {
        await n.ok(n.team(q.f_code), "place_ipo_bid", s[Number(c)]!.company_id, qty);
      }
    }
  }
  await n.advanceTo("PRESSURE");
  await n.deadlinePassed("REVEAL_1");
  await n.ok(n.lead, "tick", n.eventId);
  return { n, squads: s };
}

/** Moves a company's market price as a score release would (a SUB_TIER price row, then collateral recalculated). */
export async function movePrice(pool: pg.Pool, eventId: string, companyId: string, price: number, ai?: number) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.price_writer', 'TIER', true)");
    await c.query(
      `insert into round_prices (event_id, company_id, kind, subround, market_before, market_after, ai_before, ai_after, tier_bp)
       select event_id, id, 'SUB_TIER',
              (select coalesce(max(subround), 0) + 1 from round_prices where company_id = $1 and kind = 'SUB_TIER'),
              market_price, $2::int, ai_price, coalesce($3::int, ai_price), 0 from companies where id = $1`,
      [companyId, price, ai ?? null],
    );
    await c.query("update companies set market_price = $2, ai_price = coalesce($3::int, ai_price) where id = $1", [companyId, price, ai ?? null]);
    await c.query("select app.recalculate_collateral($1)", [eventId]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** Clears the rate limiter (fuzz loops place more than 20 order actions per team per 10 seconds). */
export async function resetRateLimits(pool: pg.Pool) {
  await pool.query("delete from rate_limits");
}

/** Rounds open in sequence without waiting for score releases (the fuzz plays long runs of rounds). */
export async function noWaits(n: Night) {
  await n.q("update rounds set waits_for = null where event_id = $1", [n.eventId]);
}
