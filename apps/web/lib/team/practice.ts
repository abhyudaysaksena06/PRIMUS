// The Round 1 practice market (PRIMUS, Finance funds): where it stands, each stock's line, and the fund's practice
// portfolio. Pure: the page passes what it read. Money in integer cents.

import { RULES, type PhaseCode } from "@msim/engine";

export type PracticeState = "OFF" | "NOT_YET" | "OPEN" | "CLOSED" | "SETTLED";

export interface PracticeEvent {
  format: "CLASSIC" | "PRIMUS";
  practice_enabled: boolean;
  practice_step: number;
  practice_settled_at: string | null;
}

/** Off (classic night or turned off), not yet (before BUILD), open (BUILD and READING), closed (IPO), settled (Round 2 on). */
export function practiceState(
  ev: PracticeEvent,
  phase: PhaseCode,
): PracticeState {
  if (ev.format !== "PRIMUS" || !ev.practice_enabled) return "OFF";
  if (ev.practice_settled_at) return "SETTLED";
  if (ev.practice_step < 0) return "NOT_YET";
  return phase === "BUILD" || phase === "READING" ? "OPEN" : "CLOSED";
}

export interface PracticeStock {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  blurb: string;
  open_cents: number;
  price_cents: number;
}

export interface PracticeHolding {
  stock_id: string;
  qty: number;
  cost_cents: number;
}

export interface StockLine extends PracticeStock {
  /** Change since the market opened, basis points. */
  changeBp: number;
  /** Change over the last step, cents. */
  lastMove: number;
  /** The recent prices, oldest first. */
  history: number[];
  held: number;
}

export function stockLines(
  stocks: readonly PracticeStock[],
  prices: readonly { stock_id: string; step: number; price_cents: number }[],
  holdings: readonly PracticeHolding[],
): StockLine[] {
  return stocks.map((s) => {
    const history = prices
      .filter((p) => p.stock_id === s.id)
      .sort((a, b) => a.step - b.step)
      .map((p) => p.price_cents);
    const prev =
      history.length >= 2 ? history[history.length - 2]! : s.price_cents;
    return {
      ...s,
      changeBp: Math.round(
        ((s.price_cents - s.open_cents) * 10_000) / s.open_cents,
      ),
      lastMove: s.price_cents - prev,
      history,
      held: holdings.find((h) => h.stock_id === s.id)?.qty ?? 0,
    };
  });
}

export interface PositionRow {
  symbol: string;
  name: string;
  qty: number;
  avgCost: number;
  price: number;
  value: number;
  pnl: number;
}

export interface PracticeTotals {
  cash: number;
  holdingsValue: number;
  value: number;
  start: number;
  gain: number;
  /** Return on the start, basis points. */
  returnBp: number;
  positions: PositionRow[];
}

export function practiceTotals(
  cash: number,
  stocks: readonly PracticeStock[],
  holdings: readonly PracticeHolding[],
  start: number = RULES.PRACTICE_CASH,
): PracticeTotals {
  const positions: PositionRow[] = holdings
    .filter((h) => h.qty > 0)
    .flatMap((h) => {
      const s = stocks.find((x) => x.id === h.stock_id);
      if (!s) return [];
      const value = h.qty * s.price_cents;
      return [
        {
          symbol: s.symbol,
          name: s.name,
          qty: h.qty,
          avgCost: Math.round(h.cost_cents / h.qty),
          price: s.price_cents,
          value,
          pnl: value - h.cost_cents,
        },
      ];
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const holdingsValue = positions.reduce((t, p) => t + p.value, 0);
  const value = cash + holdingsValue;
  return {
    cash,
    holdingsValue,
    value,
    start,
    gain: value - start,
    returnBp: start > 0 ? Math.round(((value - start) * 10_000) / start) : 0,
    positions,
  };
}

/** The most shares of a stock the fund can buy with its cash. */
export const maxBuy = (cash: number, price: number): number =>
  price > 0 ? Math.floor(cash / price) : 0;
