// Reads the Round 1 practice market as the signed-in fund, through RLS: the event's switch and step, the six stocks
// and their recent prices, the latest news, and the fund's own account, holdings and trades.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamContext } from "@/lib/team/context";
import { cents } from "@/lib/format";
import type { PracticeEvent, PracticeHolding, PracticeStock } from "./practice";

/** How many recent steps the page draws for each stock. */
export const HISTORY_STEPS = 60;

export interface PracticeData {
  event: PracticeEvent;
  stocks: PracticeStock[];
  prices: { stock_id: string; step: number; price_cents: number }[];
  news: {
    id: number;
    step: number;
    stock_id: string | null;
    headline: string;
    move_bp: number;
    at: string;
  }[];
  account: {
    cash: number;
    grant: number;
    finalValue: number | null;
    settledAt: string | null;
  } | null;
  holdings: PracticeHolding[];
  trades: {
    id: number;
    stock_id: string;
    side: "BUY" | "SELL";
    qty: number;
    price_cents: number;
    at: string;
  }[];
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`);
  return r.data as T;
}

export async function loadPractice(sb: SupabaseClient, ctx: TeamContext): Promise<PracticeData> {
  const eventId = ctx.event.id;
  const ev = must(
    await sb.from("events").select("format, practice_enabled, practice_step, practice_settled_at").eq("id", eventId).single<PracticeEvent>(),
    "the practice market",
  );
  const fromStep = Math.max(0, ev.practice_step - HISTORY_STEPS);
  const [stocks, prices, news, account, holdings, trades] = await Promise.all([
    sb.from("practice_stocks").select("id, symbol, name, sector, blurb, open_cents, price_cents").eq("event_id", eventId).order("symbol"),
    sb.from("practice_prices").select("stock_id, step, price_cents").eq("event_id", eventId).gte("step", fromStep).order("step"),
    sb.from("practice_news").select("id, step, stock_id, headline, move_bp, at").eq("event_id", eventId).order("id", { ascending: false }).limit(12),
    sb.from("practice_accounts").select("cash_cents, grant_cents, final_value_cents, settled_at").eq("team_id", ctx.team.id).maybeSingle(),
    sb.from("practice_holdings").select("stock_id, qty, cost_cents").eq("team_id", ctx.team.id),
    sb.from("practice_trades").select("id, stock_id, side, qty, price_cents, at").eq("team_id", ctx.team.id).order("id", { ascending: false }).limit(15),
  ]);
  const acct = must(account, "your practice account") as {
    cash_cents: string | number;
    grant_cents: string | number;
    final_value_cents: string | number | null;
    settled_at: string | null;
  } | null;
  return {
    event: ev,
    stocks: must(stocks, "the practice stocks") as PracticeStock[],
    prices: must(prices, "the practice prices") as PracticeData["prices"],
    news: must(news, "the practice news") as PracticeData["news"],
    account: acct
      ? {
          cash: cents(acct.cash_cents),
          grant: cents(acct.grant_cents),
          finalValue: acct.final_value_cents === null ? null : cents(acct.final_value_cents),
          settledAt: acct.settled_at,
        }
      : null,
    holdings: (
      must(holdings, "your practice holdings") as {
        stock_id: string;
        qty: number;
        cost_cents: string | number;
      }[]
    ).map((h) => ({ ...h, cost_cents: cents(h.cost_cents) })),
    trades: must(trades, "your practice trades") as PracticeData["trades"],
  };
}
