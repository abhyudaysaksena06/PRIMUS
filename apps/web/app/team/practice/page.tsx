import type { Metadata } from "next";
import Link from "next/link";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { supabaseServer } from "@/lib/supabase/server";
import { loadPractice } from "@/lib/team/practice-data";
import { practiceState, practiceTotals, stockLines } from "@/lib/team/practice";
import { bp, clock, count, money, signedMoney } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";
import { Sparkline } from "@/components/ui/line-chart";
import { PracticeTicket } from "./ticket";

export const metadata: Metadata = { title: "Practice market" };

const tone = (n: number) => (n > 0 ? "text-phosphor" : n < 0 ? "text-danger-soft" : "");

// The Round 1 practice market (PRIMUS): each fund trades $60,000 on six made-up companies while the PRDs are written
// and read. Prices move every few seconds and with the news; orders fill at once. It closes when the IPO opens, and the
// result is added to the fund's cash when Round 2 starts. The page re-reads itself every few seconds while it is open.
export default async function PracticePage() {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/practice")) {
    return (
      <Notice tone="blue">
        The practice market is for the Finance teams.{" "}
        <Link href="/team" className="font-semibold underline">
          Back to Home
        </Link>
      </Notice>
    );
  }
  const sb = await supabaseServer();
  const data = await loadPractice(sb, ctx);
  const state = practiceState(data.event, ctx.status.phase);
  const start = data.account?.grant ?? RULES.PRACTICE_CASH;

  if (state === "OFF") return <Notice>There is no practice market tonight.</Notice>;
  if (state === "NOT_YET" || data.stocks.length === 0) {
    return (
      <Notice tone="blue">
        The practice market opens when Round 1 starts. Your fund gets {money(RULES.PRACTICE_CASH)} to trade six made-up companies until the IPO opens. Whatever
        it is worth at the end is added to your fund cash when Round 2 starts.
      </Notice>
    );
  }

  const lines = stockLines(data.stocks, data.prices, data.holdings);
  const cash = data.account?.cash ?? RULES.PRACTICE_CASH;
  const totals = practiceTotals(cash, data.stocks, data.holdings, start);
  const symbolOf = (id: string | null) => data.stocks.find((s) => s.id === id)?.symbol ?? "";
  const open = state === "OPEN";
  const finalValue = data.account?.finalValue ?? null;

  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={ctx.event.clock_speed > 1 ? 4_000 : 10_000} active={open} />

      {state === "OPEN" ? (
        <Notice tone="green">
          Practice market is <b>open</b>: buy and sell at the current price; orders fill at once. Prices move every few seconds and with the news. It closes
          when the IPO opens, and your result is added to your fund cash when Round 2 starts.
        </Notice>
      ) : state === "CLOSED" ? (
        <Notice tone="amber">
          The practice market is closed. Your holdings are valued at the last prices, and the total ({money(totals.value)}) is added to your fund cash when
          Round 2 starts.
        </Notice>
      ) : (
        <Notice tone="green">
          <span data-testid="practice-settled">
            Settled
            {data.account?.settledAt ? ` at ${clock(data.account.settledAt)}` : ""}: {money(finalValue ?? 0)} from the practice market was added to your fund
            cash ({signedMoney((finalValue ?? 0) - start)} on the {money(start)} you were given). It counts in your final return.
          </span>
        </Notice>
      )}

      <Panel title="Your practice fund">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Value"
            value={<span data-testid="practice-value">{money(state === "SETTLED" && finalValue !== null ? finalValue : totals.value)}</span>}
            hint="Cash + shares at current prices"
          />
          <Stat
            label={`Return on ${money(start)}`}
            value={<span className={tone(totals.gain)}>{bp(totals.returnBp)}</span>}
            hint={<span className={tone(totals.gain)}>{signedMoney(totals.gain)}</span>}
          />
          <Stat label="Cash" value={<span data-testid="practice-cash">{money(totals.cash)}</span>} />
          <Stat label="Shares" value={money(totals.holdingsValue)} />
        </div>
      </Panel>

      {open ? (
        <Panel title="Place an order">
          <PracticeTicket
            stocks={lines.map((l) => ({
              id: l.id,
              symbol: l.symbol,
              name: l.name,
              price: l.price_cents,
              held: l.held,
            }))}
            cash={totals.cash}
          />
        </Panel>
      ) : null}

      <Panel title="Market">
        <Table head={["Stock", "Sector", "Price", "Since open", "Last move", "Trend", "You hold"]} label="Practice stocks">
          {lines.map((l) => (
            <tr key={l.id} data-testid={`practice-row-${l.symbol}`}>
              <Td>
                <span className="font-mono font-semibold text-phosphor">{l.symbol}</span> <span className="text-paper">{l.name}</span>
                <div className="hidden max-w-xs whitespace-normal text-xs text-muted sm:block">{l.blurb}</div>
              </Td>
              <Td>{l.sector}</Td>
              <Td mono className="text-right">
                {money(l.price_cents)}
              </Td>
              <Td mono className={`text-right ${tone(l.changeBp)}`}>
                {bp(l.changeBp)}
              </Td>
              <Td mono className={`text-right ${tone(l.lastMove)}`}>
                {signedMoney(l.lastMove)}
              </Td>
              <Td>
                <Sparkline values={l.history} label={`${l.symbol} over the last ${l.history.length} steps`} />
              </Td>
              <Td mono className="text-right">
                {count(l.held)}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="News">
          {data.news.length === 0 ? (
            <p className="text-sm text-muted">No news yet. Headlines move prices, and often keep moving them for a while.</p>
          ) : (
            <ul className="divide-y divide-line text-sm" aria-label="Practice market news">
              {data.news.map((n) => (
                <li key={n.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span>
                    <span className="mr-2 font-mono text-xs text-muted">{clock(n.at, true)}</span>
                    {n.headline}
                  </span>
                  <Badge tone={n.move_bp >= 0 ? "green" : "red"}>{n.stock_id ? symbolOf(n.stock_id) : "Market"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Your positions">
          <Table head={["Stock", "Shares", "Avg cost", "Price", "Value", "Profit"]} label="Practice positions" empty="No shares yet.">
            {totals.positions.map((p) => (
              <tr key={p.symbol}>
                <Td mono>{p.symbol}</Td>
                <Td mono className="text-right">
                  {count(p.qty)}
                </Td>
                <Td mono className="text-right">
                  {money(p.avgCost)}
                </Td>
                <Td mono className="text-right">
                  {money(p.price)}
                </Td>
                <Td mono className="text-right">
                  {money(p.value)}
                </Td>
                <Td mono className={`text-right ${tone(p.pnl)}`}>
                  {signedMoney(p.pnl)}
                </Td>
              </tr>
            ))}
          </Table>
          {data.trades.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Your last {data.trades.length} trades</summary>
              <ul className="mt-2 space-y-1">
                {data.trades.map((t) => (
                  <li key={t.id} className="font-mono text-xs">
                    {clock(t.at, true)} {t.side} {count(t.qty)} {symbolOf(t.stock_id)} @ {money(t.price_cents)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
