"use client";

// The practice order ticket: a stock, BUY or SELL and a whole number of shares. The order fills at once at the current
// price; the database checks the cash or the shares held, and its refusal is shown as it comes. The Max button fills in
// the most the fund's cash buys, or every share it holds.

import { useState } from "react";
import { ActionForm } from "@/components/ui/action";
import { buttonClass, inputClass } from "@/components/ui/ui";
import { money } from "@/lib/format";
import { maxBuy } from "@/lib/team/practice";
import { practiceTrade } from "./actions";

export interface TicketStock {
  id: string;
  symbol: string;
  name: string;
  price: number;
  held: number;
}

export function PracticeTicket({ stocks, cash }: { stocks: TicketStock[]; cash: number }) {
  const [stockId, setStockId] = useState(stocks[0]?.id ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState("");
  const stock = stocks.find((s) => s.id === stockId);
  const max = stock ? (side === "BUY" ? maxBuy(cash, stock.price) : stock.held) : 0;
  const n = Number(qty.replace(/[,\s]/g, ""));
  const cost = stock && Number.isInteger(n) && n > 0 ? n * stock.price : null;
  return (
    <ActionForm action={practiceTrade} submit={side === "BUY" ? "Buy now" : "Sell now"} resetOnSuccess>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-muted">Stock</span>
          <select name="stock" value={stockId} onChange={(e) => setStockId(e.target.value)} className={inputClass} data-testid="practice-stock">
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.symbol} · {s.name} · {money(s.price)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend className="text-muted">Order</legend>
          <div className="mt-1 flex gap-2">
            {(["BUY", "SELL"] as const).map((x) => (
              <label key={x} className={`${side === x ? buttonClass.primary : buttonClass.secondary} cursor-pointer`}>
                <input type="radio" name="side" value={x} checked={side === x} onChange={() => setSide(x)} className="sr-only" />
                {x}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm">
          <span className="text-muted">Shares</span>
          <div className="flex gap-2">
            <input
              name="qty"
              inputMode="numeric"
              required
              pattern="[0-9,\s]+"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={inputClass}
              data-testid="practice-qty"
            />
            <button type="button" className={`${buttonClass.secondary} whitespace-nowrap`} onClick={() => setQty(String(max))} disabled={max < 1}>
              Max
            </button>
          </div>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">
        {stock
          ? side === "BUY"
            ? `Your cash buys up to ${max.toLocaleString("en-US")} ${stock.symbol}.`
            : `You hold ${stock.held.toLocaleString("en-US")} ${stock.symbol}.`
          : null}{" "}
        {cost !== null ? `About ${money(cost)} at the current price; it fills at the price when you press.` : null}
      </p>
    </ActionForm>
  );
}
