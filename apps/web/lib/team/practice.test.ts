import { describe, expect, test } from "vitest";
import {
  maxBuy,
  practiceState,
  practiceTotals,
  stockLines,
  type PracticeEvent,
  type PracticeStock,
} from "./practice";

const ev = (over: Partial<PracticeEvent> = {}): PracticeEvent => ({
  format: "PRIMUS",
  practice_enabled: true,
  practice_step: 3,
  practice_settled_at: null,
  ...over,
});
const stock = (
  id: string,
  symbol: string,
  open: number,
  price: number,
): PracticeStock => ({
  id,
  symbol,
  name: symbol,
  sector: "S",
  blurb: "",
  open_cents: open,
  price_cents: price,
});

describe("practice market", () => {
  test("its state follows the format, the switch, the phase and the settlement", () => {
    expect(practiceState(ev({ format: "CLASSIC" }), "BUILD")).toBe("OFF");
    expect(practiceState(ev({ practice_enabled: false }), "BUILD")).toBe("OFF");
    expect(practiceState(ev({ practice_step: -1 }), "SQUAD_DRAW")).toBe(
      "NOT_YET",
    );
    expect(practiceState(ev(), "BUILD")).toBe("OPEN");
    expect(practiceState(ev(), "READING")).toBe("OPEN");
    expect(practiceState(ev(), "IPO")).toBe("CLOSED");
    expect(
      practiceState(
        ev({ practice_settled_at: "2026-11-20T17:15:00Z" }),
        "PRESSURE",
      ),
    ).toBe("SETTLED");
  });

  test("stock lines carry the change since the open, the last move, the history and what the fund holds", () => {
    const [line] = stockLines(
      [stock("a", "AAA", 1000, 1100)],
      [
        { stock_id: "a", step: 1, price_cents: 1050 },
        { stock_id: "a", step: 0, price_cents: 1000 },
        { stock_id: "a", step: 2, price_cents: 1100 },
      ],
      [{ stock_id: "a", qty: 7, cost_cents: 7000 }],
    );
    expect(line).toMatchObject({
      changeBp: 1000,
      lastMove: 50,
      history: [1000, 1050, 1100],
      held: 7,
    });
  });

  test("the portfolio is cash plus shares at the current prices, measured against $60,000", () => {
    const t = practiceTotals(
      5_000_000,
      [stock("a", "AAA", 1000, 1200), stock("b", "BBB", 500, 400)],
      [
        { stock_id: "a", qty: 500, cost_cents: 500_000 },
        { stock_id: "b", qty: 1000, cost_cents: 500_000 },
        { stock_id: "c", qty: 0, cost_cents: 0 },
      ],
    );
    expect(t.holdingsValue).toBe(600_000 + 400_000);
    expect(t.value).toBe(6_000_000);
    expect(t.gain).toBe(0);
    expect(t.positions.map((p) => [p.symbol, p.avgCost, p.pnl])).toEqual([
      ["AAA", 1000, 100_000],
      ["BBB", 500, -100_000],
    ]);
    expect(practiceTotals(6_600_000, [], []).returnBp).toBe(1000);
  });

  test("the most shares the cash buys", () => {
    expect(maxBuy(6_000_000, 4200)).toBe(1428);
    expect(maxBuy(100, 0)).toBe(0);
  });
});
