import type { Metadata } from "next";
import Link from "next/link";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { fundContext, loadTradeData } from "@/lib/team/trade-data";
import { companyPosition, fundSummary } from "@/lib/team/trade";
import { FUND_LOT_HINTS, FUND_LOT_LABELS, collateralView, meterPct, portfolioTotals, positionLines } from "@/lib/team/portfolio";
import { bp, clock, count, money, signedMoney } from "@/lib/format";
import { Notice, Table, Td } from "@/components/ui/ui";
import { DeskFact, DeskKpi, DeskPanel } from "../desk-ui";
import { LineChart } from "@/components/ui/line-chart";
import { loadPortfolioSeries } from "@/lib/team/portfolio-history-data";
import { tradeGate } from "../gate";

export const metadata: Metadata = { title: "Positions" };

// Positions: every company and lot the fund holds (exchange, squad lot, short) with its average cost, the current
// price, the market value and the unrealised profit and loss; the portfolio's value and its return on the $500,000
// start; and the collateral and limits (locked vs required, short exposure vs the $250,000 cap, whether new buys and
// shorts are blocked). Every price change broadcasts, so the page re-reads itself after each clearing and tier.
export default async function PositionsPage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const [data, series] = await Promise.all([loadTradeData(ctx, { orders: "pending" }), loadPortfolioSeries(ctx.event.id, ctx.team.id)]);
  const closed = data.marketClosedAt !== null;
  const lines = positionLines(data.holdings, data.companies, closed);
  const totals = portfolioTotals(ctx.team.cash, lines);
  const fctx = fundContext(ctx, data);
  const summary = fundSummary(fctx);
  const coll = collateralView(fctx);
  const limitCompanies = data.companies.filter((c) => {
    const p = companyPosition(fctx, c.id);
    return p.exchangeQty + p.shortQty + p.pending.BUY + p.pending.SHORT > 0;
  });
  const priceWord = closed ? "closing" : "market";

  return (
    <div className="space-y-4">
      {closed ? (
        <Notice>
          The market closed at {clock(data.marketClosedAt)}: every short was covered at the closing price, and positions are valued at closing prices.
        </Notice>
      ) : null}

      <section aria-labelledby="portfolio-title" className="space-y-4">
        <h2 id="portfolio-title" className="sr-only">
          Portfolio
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DeskKpi
            label="Portfolio value"
            tag={closed ? "CLOSED" : <span className="text-[#00D68F]">LIVE</span>}
            value={<span data-testid="portfolio-value">{money(totals.value)}</span>}
            foot={`Cash + long − short, at ${priceWord} prices`}
          />
          <DeskKpi
            label={`Return on ${money(totals.start)}`}
            tag="NET"
            tone={totals.gain > 0 ? "up" : totals.gain < 0 ? "down" : "plain"}
            value={<span data-testid="portfolio-return">{bp(totals.returnBp)}</span>}
            foot={<span data-testid="portfolio-gain">{signedMoney(totals.gain)}</span>}
          />
          <DeskKpi
            label={closed ? "Profit and loss at closing prices" : "Unrealised profit and loss"}
            tone={totals.unrealised > 0 ? "up" : totals.unrealised < 0 ? "down" : "plain"}
            value={<span data-testid="portfolio-pnl">{signedMoney(totals.unrealised)}</span>}
          />
          <DeskKpi label="Cash" value={money(totals.cash)} />
          <DeskKpi label="Long shares" value={money(totals.longValue)} foot="Exchange and squad lots" />
          <DeskKpi label="Short shares" value={money(totals.shortValue)} foot={closed ? "Covered at the close" : "What covering would cost"} />
        </div>
        {totals.unpriced > 0 ? (
          <p className="text-xs text-[#87948D]">
            {count(totals.unpriced)} {totals.unpriced === 1 ? "line has" : "lines have"} no price until the IPO prices are released and {totals.unpriced === 1 ? "is" : "are"} not counted.
          </p>
        ) : null}
        {series.length >= 2 ? (
          <DeskPanel title="Your fund's value after each step" sub="Equity curve · cash + long − short">
            <div className="rounded border border-white/10 bg-[#0a141a] p-2 sm:p-3">
              <LineChart points={series} label="Your fund's value by step" mainName="Portfolio value (cash + long − short)" testId="portfolio-chart" />
            </div>
          </DeskPanel>
        ) : null}
      </section>

      <DeskPanel title="Positions" sub={`${lines.length} ${lines.length === 1 ? "line" : "lines"} · valued at ${priceWord} prices`}>
        {lines.length === 0 ? (
          <p className="py-6 text-center font-mono text-xs text-[#87948D]">No shares yet.</p>
        ) : (
          <Table head={["Company", "Shares", "Value", "Profit and loss", `Price (${priceWord})`, "Avg cost"]} label="Positions">
            {lines.map((l) => (
              <tr key={l.key} data-testid={`position-${l.ticker}-${l.lot}`}>
                <Td>
                  <Link href={`/team/market/${l.ticker}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                    {l.ticker}
                  </Link>{" "}
                  <span className="text-xs text-muted" title={FUND_LOT_HINTS[l.lot]}>
                    {FUND_LOT_LABELS[l.lot]}
                  </span>
                </Td>
                <Td mono className="text-right">
                  {count(l.qty)}
                </Td>
                <Td mono className={`text-right ${l.value !== null && l.value < 0 ? "text-danger-soft" : ""}`}>
                  {l.value === null ? "—" : money(l.value)}
                </Td>
                <Td mono className={`text-right ${l.pnl === null ? "" : l.pnl < 0 ? "text-danger-soft" : l.pnl > 0 ? "text-phosphor" : ""}`}>
                  {l.pnl === null ? "—" : signedMoney(l.pnl)}
                </Td>
                <Td mono className="text-right">
                  {money(l.price)}
                </Td>
                <Td mono className="text-right">
                  {money(l.avgCost)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <dl className="mt-3 space-y-1 text-xs text-muted">
          {(["EXCHANGE", "SQUAD", "SHORT"] as const).map((lot) => (
            <div key={lot}>
              <dt className="inline font-semibold text-paper">{FUND_LOT_LABELS[lot]}:</dt> <dd className="inline">{FUND_LOT_HINTS[lot]}</dd>
            </div>
          ))}
          <div>
            <dt className="inline font-semibold text-paper">Profit and loss:</dt>{" "}
            <dd className="inline">long lots: value − what they cost; shorts: what the sale brought in − what covering costs now.</dd>
          </div>
        </dl>
      </DeskPanel>

      <DeskPanel title="Collateral and limits" sub="Margin, short exposure and per-company limits">
        <div className="space-y-4 text-sm">
          {closed ? (
            <Notice>
              <span data-testid="collateral-status">The market has closed: every short was covered at the closing price and no more orders are taken.</span>
            </Notice>
          ) : coll.blocked ? (
            <Notice tone="red">
              <span data-testid="collateral-status">
                Blocked: your cash ({money(coll.cash)}) is below your locked collateral ({money(coll.locked)}), short by {money(coll.deficit)}. New buys and shorts are
                refused until cash covers it; sells and covers are always allowed. Nothing is sold for you before the close.
              </span>
            </Notice>
          ) : (
            <Notice tone="green">
              <span data-testid="collateral-status">Your cash covers your collateral: new buys and shorts are allowed.</span>
            </Notice>
          )}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Collateral locked" value={money(coll.locked)} testId="collateral-locked" />
            <Fact label="Required at current prices" value={money(coll.required)} testId="collateral-required" />
            <Fact label="Reserved by open orders" value={money(summary.reserved)} />
            <Fact label="Available cash" value={money(summary.available)} />
          </dl>
          <p className="text-xs text-muted">
            Collateral is 150% of each short&apos;s value (shares short × current price), locked out of your cash and recalculated at every price change.
          </p>
          <div>
            <div className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span className="font-medium text-paper">Short exposure</span>
              <span className="font-mono tabular-nums" data-testid="exposure-of-cap">
                {money(summary.shortExposureWithPending)} of {money(RULES.SHORT_EXPOSURE_LIMIT)}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-sm bg-[#070909]"
              role="meter"
              aria-label="Short exposure of the $250,000 limit"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT)}
            >
              <div className="h-full bg-[var(--desk-accent)]" style={{ width: `${meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">
              Open shorts {money(summary.shortExposure)}
              {summary.shortExposureWithPending > summary.shortExposure ? ` + pending shorts ${money(summary.shortExposureWithPending - summary.shortExposure)}` : ""}, at
              current prices.
            </p>
          </div>
          {limitCompanies.length > 0 ? (
            <Table head={["Company", "Long, with pending buys", "Short, with pending shorts"]} label="Limits per company">
              {limitCompanies.map((c) => {
                const p = companyPosition(fctx, c.id);
                return (
                  <tr key={c.id}>
                    <Td mono className="font-semibold">
                      {c.ticker}
                    </Td>
                    <Td mono className="text-right">
                      {count(p.exchangeQty + p.pending.BUY)} of {count(RULES.LONG_LIMIT)}
                    </Td>
                    <Td mono className="text-right">
                      {count(p.shortQty + p.pending.SHORT)} of {count(RULES.SHORT_LIMIT)}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ) : null}
        </div>
      </DeskPanel>
    </div>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return <DeskFact label={label} value={value} testId={testId} />;
}
