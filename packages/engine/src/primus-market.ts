// The PRIMUS-only market rules, mirrored from the database so they can be tested and fuzzed against it
// (docs/system/TRADING-ALGORITHM.md): the crisis shock, the Round 3 leveller, the close, the cooling-off, equity raises,
// the practice market's trades and its prize ranking.
//
// Every function here has a SQL twin; supabase/tests/trading-fuzz.test.ts runs both on the same inputs.

import { avgHalfUp, floorDiv, mul } from "./money";
import { PRACTICE } from "./candles";
import { applyTier } from "./prices";
import { RULES } from "./rules";
import type { OrderType } from "./types";

// ───────────────────────────── Prices ─────────────────────────────

/** A PRIMUS crisis reveal moves every market and AI price by −5% (app.reveal_subround). */
export const SUB_SHOCK_BP = -500;

/** price × 0.95, rounded half-up. Never below 1 cent: 1 × 0.95 = 0.95 rounds to 1. */
export function subShock(price: number): number {
  return applyTier(price, SUB_SHOCK_BP);
}

/**
 * The Round 3 leveller (migration 064, app.release_tier_bp): a positive SOLUTION tier is scaled from ×1.25 at place 1
 * (the weakest score so far) to ×0.25 at place n, evenly spaced, in whole basis points (truncated, as SQL integer
 * division). Negative tiers, other types, a company without a draft pick (place null) or a draft of one apply in full.
 */
export function levelledTierBp(bp: number, place: number | null, n: number | null, type: "SOLUTION" | "OTHER" = "SOLUTION"): number {
  if (type !== "SOLUTION" || bp <= 0) return bp;
  if (place === null || n === null || n <= 1) return bp;
  if (!Number.isInteger(place) || place < 1 || place > n) throw new Error(`place ${place} is not between 1 and ${n}`);
  return floorDiv(bp * (125 * (n - 1) - 100 * (place - 1)), 100 * (n - 1));
}

/**
 * Places by a key, lowest first, with SQL rank() semantics: ties share the lower place and the next place skips
 * (1, 2, 2, 4). The leveller ranks companies by their score so far; app.score_so_far is the average of five scores
 * (PRD and the four crisis plans, missing = 0) rounded to 2 decimals, which is exact for an average of five whole
 * numbers, so ranking by the sum of the five scores gives the same places.
 */
export function ranksAscending(keys: readonly number[]): number[] {
  return keys.map((k) => 1 + keys.filter((other) => other < k).length);
}

/** The five scores the draft and the leveller rank by (PITCH, CRISIS_1–4), missing ones counted as 0. */
export function scoreSoFarSum(scores: readonly (number | null | undefined)[]): number {
  if (scores.length !== 5) throw new Error("score so far needs the PRD and the four crisis plan scores");
  return scores.reduce<number>((s, x) => s + (x ?? 0), 0);
}

/**
 * The closing market price (migration 068): the average of the last round's opening price (its market_before) and its
 * clearing price, rounded half-up; a company that never cleared keeps its market price.
 */
export function closingMarketPrice(lastRound: { open: number; clear: number } | null, marketPrice: number): number {
  return lastRound ? avgHalfUp(lastRound.open, lastRound.clear) : marketPrice;
}

/** The closing price: (closing market price + AI price) ÷ 2, rounded half-up. */
export function primusClosingPrice(closingMarket: number, ai: number): number {
  return avgHalfUp(closingMarket, ai);
}

// ───────────────────────────── Cooling-off (migration 069) ─────────────────────────────

/**
 * A company whose last cleared round moved the full ±10% (net demand at the 10,000-share cap) takes no new orders in
 * the next round. Only on a PRIMUS night; no cleared round yet means no cooling-off.
 */
export function coolingOff(lastCappedNet: number | null): boolean {
  return lastCappedNet !== null && Math.abs(lastCappedNet) >= RULES.NET_CAP;
}

// ───────────────────────────── Equity raises (migrations 067, 069) ─────────────────────────────

export const RAISES = {
  /** 1% to 10% of the company: 1,000 to 10,000 of its 100,000 shares, in steps of 10 (0.01%). */
  MIN_SHARES: 1_000,
  MAX_SHARES: 10_000,
  STEP: 10,
  /** A fund holds at most 10,000 shares (10%) of a company through raises (its SQUAD lot). */
  FUND_CAP: 10_000,
} as const;

export type RaiseTermsRejection = "BAD_TERMS";

/** The terms a company may post: 1,000–10,000 shares in steps of 10, keeping 40,000 shares after promised fees. */
export function checkRaiseTerms(shares: number, retained: number, promisedFeeShares: number): RaiseTermsRejection | null {
  if (!Number.isInteger(shares) || shares < RAISES.MIN_SHARES || shares > RAISES.MAX_SHARES || shares % RAISES.STEP !== 0) return "BAD_TERMS";
  if (retained - promisedFeeShares - shares < RULES.MIN_RETAINED_SHARES) return "BAD_TERMS";
  return null;
}

export type FundRaiseRejection = "OWN_SQUAD" | "ONE_RAISE" | "RAISE_CAP" | "FUND_CASH" | "BAD_TERMS";

export interface FundRaiseView {
  /** The fund is in the company's squad. */
  ownSquad: boolean;
  /** The fund already funded a raise in this crisis. */
  fundedThisCrisis: boolean;
  /** Shares of this company the fund already holds through raises (its SQUAD lot). */
  raiseLotQty: number;
  /** Cash − collateral − reserves of pending orders. */
  availableCash: number;
  /** The company's retained shares and the fee shares it has promised (escrow HELD). */
  retained: number;
  promisedFeeShares: number;
}

/**
 * public.fund_raise's checks after the raise is found open and of this crisis, in its order. The fund pays
 * shares × the market price at that moment.
 */
export function checkFundRaise(v: FundRaiseView, shares: number, marketPrice: number): { ok: true; cash: number } | { ok: false; code: FundRaiseRejection } {
  if (v.ownSquad) return { ok: false, code: "OWN_SQUAD" };
  if (v.fundedThisCrisis) return { ok: false, code: "ONE_RAISE" };
  if (v.raiseLotQty + shares > RAISES.FUND_CAP) return { ok: false, code: "RAISE_CAP" };
  const cash = mul(shares, marketPrice);
  if (v.availableCash < cash) return { ok: false, code: "FUND_CASH" };
  if (v.retained - v.promisedFeeShares - shares < RULES.MIN_RETAINED_SHARES) return { ok: false, code: "BAD_TERMS" };
  return { ok: true, cash };
}

// ───────────────────────────── The practice market (migration 058) ─────────────────────────────

export type PracticeRejection = "BAD_QTY" | "NO_PRICE" | "COVER_FIRST" | "SELL_FIRST" | "LIMIT" | "NOT_HELD" | "NOT_SHORT" | "NO_CASH";

export interface PracticeBook {
  cash: number;
  /** Position per ticker: positive long, negative short. */
  positions: Readonly<Record<string, number>>;
}

/**
 * One practice trade at the latest price (public.practice_trade): 1–4,000 shares; at most 4,000 long or 2,000 short
 * per company; a long is sold before shorting and a short covered before buying. Cash never goes below zero, and a BUY
 * or SHORT must leave cash covering 150% of every short at the current prices (whole cents, rounded down). SELL and
 * COVER only shrink positions, so they are not held to the 150% rule (migration 079).
 */
export function practiceTrade(
  book: PracticeBook,
  prices: Readonly<Record<string, number>>,
  ticker: string,
  type: OrderType,
  qty: number,
): { ok: true; cash: number; position: number } | { ok: false; code: PracticeRejection } {
  if (!Number.isInteger(qty) || qty < 1 || qty > PRACTICE.maxLong) return { ok: false, code: "BAD_QTY" };
  const price = prices[ticker];
  if (price === undefined) return { ok: false, code: "NO_PRICE" };
  const pos = book.positions[ticker] ?? 0;
  let next: number;
  let cash: number;
  switch (type) {
    case "BUY":
      if (pos < 0) return { ok: false, code: "COVER_FIRST" };
      next = pos + qty;
      if (next > PRACTICE.maxLong) return { ok: false, code: "LIMIT" };
      cash = book.cash - mul(qty, price);
      break;
    case "SELL":
      if (qty > pos) return { ok: false, code: "NOT_HELD" };
      next = pos - qty;
      cash = book.cash + mul(qty, price);
      break;
    case "SHORT":
      if (pos > 0) return { ok: false, code: "SELL_FIRST" };
      next = pos - qty;
      if (next < -PRACTICE.maxShort) return { ok: false, code: "LIMIT" };
      cash = book.cash + mul(qty, price);
      break;
    case "COVER":
      if (qty > -pos) return { ok: false, code: "NOT_SHORT" };
      next = pos + qty;
      cash = book.cash - mul(qty, price);
      break;
  }
  let shorts = 0;
  for (const [t, q] of Object.entries(book.positions)) {
    if (t !== ticker && q < 0) shorts += mul(-q, prices[t] ?? 0);
  }
  if (next < 0) shorts += mul(-next, price);
  if (cash < 0 || ((type === "BUY" || type === "SHORT") && cash < floorDiv(shorts * 3, 2))) return { ok: false, code: "NO_CASH" };
  return { ok: true, cash, position: next };
}

/** A fund's practice equity: cash + Σ position × latest price (a short counts negative). */
export function practiceEquity(book: PracticeBook, prices: Readonly<Record<string, number>>): number {
  let v = book.cash;
  for (const [t, q] of Object.entries(book.positions)) if (q !== 0) v += mul(q, prices[t] ?? 0);
  return v;
}

/**
 * The practice prize ranking (app.settle_practice): only funds that traded are ranked, by equity (highest first),
 * ties to the lower team code (byte order); the top PRACTICE.winners each win the prize.
 */
export function practiceWinners(funds: readonly { code: string; equity: number; trades: number }[]): { code: string; rank: number; prize: number }[] {
  const ranked = funds
    .filter((f) => f.trades > 0)
    .sort((a, b) => b.equity - a.equity || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return ranked.slice(0, PRACTICE.winners).map((f, i) => ({ code: f.code, rank: i + 1, prize: PRACTICE.prizeCents }));
}
