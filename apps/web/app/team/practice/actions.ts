"use server";

// A fund's practice market order: one game function run as the signed-in team. The database checks the caller, that
// the practice market is open, the cash or the shares held, and the rate limit; here only the shape of the input.

import { rpc, type ActionResult } from "@/lib/rpc";
import { parseShares } from "@/lib/team/trade";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function practiceTrade(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const stock = String(form.get("stock") ?? "");
  const side = String(form.get("side") ?? "");
  if (!UUID.test(stock))
    return { ok: false, code: "NO_STOCK", message: "Choose a stock." };
  if (side !== "BUY" && side !== "SELL")
    return { ok: false, code: "NO_SIDE", message: "Choose BUY or SELL." };
  const qty = parseShares(String(form.get("qty") ?? ""));
  if (qty === null || qty < 1 || qty > 100_000)
    return {
      ok: false,
      code: "BAD_QUANTITY",
      message: "Enter 1 to 100,000 shares.",
    };
  const r = await rpc("practice_trade", {
    p_stock: stock,
    p_side: side,
    p_qty: qty,
  });
  if (!r.ok) return r;
  const d = r.data ?? {};
  const price =
    typeof d.price_cents === "number"
      ? `$${(d.price_cents / 100).toFixed(2)}`
      : "the market price";
  return {
    ...r,
    message: `${side === "BUY" ? "Bought" : "Sold"} ${qty.toLocaleString("en-US")} ${String(d.symbol ?? "")} at ${price}.`,
  };
}
