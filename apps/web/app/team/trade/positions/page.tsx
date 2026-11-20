import type { Metadata } from "next";
import Link from "next/link";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { fundContext, loadTradeData } from "@/lib/team/trade-data";
import { companyPosition, fundSummary } from "@/lib/team/trade";
import { FUND_LOT_HINTS, FUND_LOT_LABELS, collateralView, meterPct, portfolioTotals, positionLines } from "@/lib/team/portfolio";
import { bp, clock, count, money, signedMoney } from "@/lib/format";
import { Notice } from "@/components/ui/ui";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { DeskKpi, DeskRow, DeskStatus, DeskTable, DeskTd, Sparkline, deskPill, deskTr } from "../desk-ui";
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
  const spark = series.map((p) => p.value);

  return (
    <div className="space-y-4">
      <DeskStatus live={!closed}>
        {closed ? "Market closed" : "Portfolio live"} <span aria-hidden>·</span> {lines.length} {lines.length === 1 ? "position" : "positions"}{" "}
        <span aria-hidden>·</span> valued at {priceWord} prices <span aria-hidden>·</span> start {money(totals.start)}
      </DeskStatus>

      {closed ? (
        <Notice>
          The market closed at {clock(data.marketClosedAt)}: every short was covered at the closing price, and positions are valued at closing prices.
        </Notice>
      ) : null}

      <section aria-labelledby="portfolio-title" className="space-y-4">
        <h2 id="portfolio-title" className="sr-only">
          Portfolio
        </h2>
        {/* The demo overview's key (what each figure means), then its 4-column KPI strip. */}
        <dl className="grid gap-2 rounded border border-white/10 bg-[#11110d] p-3 text-xs leading-relaxed text-[#BACBB9] sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-[#F2F5F3]">Portfolio value</dt>
            <dd>What the fund is worth at {priceWord} prices: cash + long − short.</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#F2F5F3]">Available cash</dt>
            <dd>Cash left for new orders after collateral and open orders.</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#F2F5F3]">Short exposure</dt>
            <dd>What your shorts are worth, against the {money(RULES.SHORT_EXPOSURE_LIMIT)} cap.</dd>
          </div>
        </dl>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <DeskKpi
            label="Portfolio value"
            tag={closed ? "CLOSED" : <span className="text-[#00D68F]">LIVE</span>}
            value={<span data-testid="portfolio-value">{money(totals.value)}</span>}
            foot={
              <span className={`flex items-center gap-1 ${totals.gain >= 0 ? "text-[#00D68F]" : "text-[#FF5364]"}`}>
                {totals.gain >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" /> : <ArrowDownRight className="w-3.5 h-3.5" aria-hidden="true" />}
                <span data-testid="portfolio-return">{bp(totals.returnBp)}</span>
              </span>
            }
            aside={<Sparkline values={spark} positive={totals.gain >= 0} />}
          />
          <DeskKpi
            label="Net P&amp;L"
            tag={`VS ${money(totals.start)}`}
            tone={totals.gain > 0 ? "up" : totals.gain < 0 ? "down" : "plain"}
            value={<span data-testid="portfolio-gain">{signedMoney(totals.gain)}</span>}
            foot={
              <>
                {closed ? "At closing prices" : "Unrealised"} <span data-testid="portfolio-pnl">{signedMoney(totals.unrealised)}</span>
              </>
            }
            aside={<Sparkline values={spark.map((v) => v - totals.start)} positive={totals.gain >= 0} />}
          />
          <DeskKpi
            label="Gross exposure"
            tag={`${lines.length} ${lines.length === 1 ? "POSITION" : "POSITIONS"}`}
            value={money(totals.longValue + Math.abs(totals.shortValue))}
            foot={<span className="text-[#BACBB9]">Short {meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT)}% of cap</span>}
            aside={
              <div className="w-24 h-1.5 bg-[#070909] rounded-sm overflow-hidden">
                <div className="h-full bg-[var(--desk-accent)] transition-all" style={{ width: `${meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT)}%` }} />
              </div>
            }
          />
          <DeskKpi
            label="Available cash"
            tag={<span className="text-[#00D68F]">CASH {money(totals.cash)}</span>}
            value={money(summary.available)}
            foot={<>Reserved {money(summary.reserved)}</>}
            aside={
              <Link href="/team/trade" className="font-mono text-[11px] text-[color:var(--desk-accent)] hover:underline whitespace-nowrap">
                Order Book
              </Link>
            }
          />
        </div>
        {totals.unpriced > 0 ? (
          <p className="text-xs text-[#87948D]">
            {count(totals.unpriced)} {totals.unpriced === 1 ? "line has" : "lines have"} no price until the IPO prices are released and {totals.unpriced === 1 ? "is" : "are"} not counted.
          </p>
        ) : null}
      </section>

      {/* The demo's main stage: the equity chart (8 columns) beside the risk panel (4 columns). */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <div className={`min-w-0 flex flex-col ${series.length >= 2 ? "xl:col-span-8" : "xl:col-span-12"}`}>
          {series.length >= 2 ? (
            <section className="min-w-0 grow bg-[#171610] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold tracking-tight text-[#F2F5F3]">Your fund&apos;s value after each step</h2>
                    <span className="font-mono text-[11px] text-[#87948D] tabular-nums">{series.length} steps</span>
                  </div>
                  <div className="flex items-baseline gap-3 mt-1">
                    <span className="font-mono text-lg font-semibold text-[#F2F5F3] tabular-nums">{money(totals.value)}</span>
                    <span className={`font-mono text-xs tabular-nums ${totals.gain > 0 ? "text-[#00D68F]" : totals.gain < 0 ? "text-[#FF5364]" : "text-[#87948D]"}`}>
                      Return {bp(totals.returnBp)} vs start ({money(totals.start)})
                    </span>
                  </div>
                </div>
                <div className="flex items-center bg-[#11110d] border border-[#2d2a1d] rounded p-0.5">
                  <span className="px-2.5 py-1.5 text-[11px] font-mono font-medium rounded-sm whitespace-nowrap bg-[#201e14] text-[color:var(--desk-accent)] border border-[color:var(--desk-accent-line)]">NAV Curve</span>
                </div>
              </div>
              <div className="relative w-full">
                <LineChart points={series} label="Your fund's value by step" mainName="Portfolio value (cash + long − short)" testId="portfolio-chart" />
              </div>
            </section>
          ) : (
            positionsPanel()
          )}
        </div>
        {series.length >= 2 ? (
          <div className="min-w-0 xl:col-span-4 flex flex-col">
            {riskPanel()}
          </div>
        ) : null}
      </div>

      {series.length >= 2 ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="min-w-0 xl:col-span-8 flex flex-col">{positionsPanel()}</div>
          <div className="min-w-0 xl:col-span-4 flex flex-col">{limitsPanel()}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="min-w-0 xl:col-span-8 flex flex-col">{riskPanel()}</div>
          <div className="min-w-0 xl:col-span-4 flex flex-col">{limitsPanel()}</div>
        </div>
      )}
    </div>
  );

  function positionsPanel() {
    return (
      <section className="min-w-0 bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden flex flex-col grow">
        <div className="px-4 py-3 border-b border-[#2d2a1d] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-[#11110d] border border-[#2d2a1d] p-0.5 rounded">
            <h2 className={deskPill(true)}>Positions ({lines.length})</h2>
            <Link href="/team/trade/history" className={deskPill(false)}>
              Order history
            </Link>
          </div>
          <span className="font-mono text-[11px] text-[#87948D]">Valued at {priceWord} prices</span>
        </div>
        {lines.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-mono text-xs text-[#87948D]">No shares yet.</p>
          </div>
        ) : (
          <DeskTable head={["Company", "Shares", "Value", "Profit and loss", `Price (${priceWord})`, "Avg cost"]} label="Positions" right={[1, 2, 3, 4, 5]}>
            {lines.map((l) => (
              <tr key={l.key} className={deskTr} data-testid={`position-${l.ticker}-${l.lot}`}>
                <DeskTd edge className="font-semibold">
                  <Link href={`/team/market/${l.ticker}`} className="underline-offset-2 hover:underline">
                    {l.ticker}
                  </Link>
                  <span className={`ml-2 text-[10px] font-normal ${l.lot === "SHORT" ? "text-[#FF5364]" : "text-[#87948D]"}`} title={FUND_LOT_HINTS[l.lot]}>
                    {FUND_LOT_LABELS[l.lot]}
                  </span>
                </DeskTd>
                <DeskTd right>{count(l.qty)}</DeskTd>
                <DeskTd right className={l.value !== null && l.value < 0 ? "text-[#FF5364]" : ""}>
                  {l.value === null ? "—" : money(l.value)}
                </DeskTd>
                <DeskTd right className={l.pnl === null ? "" : l.pnl < 0 ? "text-[#FF5364]" : l.pnl > 0 ? "text-[#00D68F]" : ""}>
                  {l.pnl === null ? "—" : signedMoney(l.pnl)}
                </DeskTd>
                <DeskTd right>{money(l.price)}</DeskTd>
                <DeskTd edge right className="text-[#BACBB9]">
                  {money(l.avgCost)}
                </DeskTd>
              </tr>
            ))}
          </DeskTable>
        )}
        <dl className="px-4 py-3 border-t border-[#2d2a1d] space-y-1 text-xs text-[#87948D]">
          {(["EXCHANGE", "SQUAD", "SHORT"] as const).map((lot) => (
            <div key={lot}>
              <dt className="inline font-semibold text-[#F2F5F3]">{FUND_LOT_LABELS[lot]}:</dt> <dd className="inline">{FUND_LOT_HINTS[lot]}</dd>
            </div>
          ))}
          <div>
            <dt className="inline font-semibold text-[#F2F5F3]">Profit and loss:</dt>{" "}
            <dd className="inline">long lots: value − what they cost; shorts: what the sale brought in − what covering costs now.</dd>
          </div>
        </dl>
      </section>
    );
  }

  function riskPanel() {
    const pct = meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT);
    return (
      <section className="min-w-0 bg-[#171610] border border-white/[0.07] rounded-lg p-4 flex flex-col gap-4 grow text-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#2d2a1d]">
          <div>
            <h2 className="text-sm font-semibold text-[#F2F5F3]">Collateral and limits</h2>
            <span className="font-mono text-[11px] text-[#87948D]">Margin, short exposure and per-company limits</span>
          </div>
          <span className={`font-mono text-xs tabular-nums ${coll.blocked ? "text-[#FF5364]" : "text-[#00D68F]"}`}>{closed ? "CLOSED" : coll.blocked ? "BLOCKED" : "OK"}</span>
        </div>
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
        <dl className="space-y-1 font-mono text-xs tabular-nums">
          <DeskRow label="Collateral locked" value={money(coll.locked)} testId="collateral-locked" />
          <DeskRow label="Required at current prices" value={money(coll.required)} testId="collateral-required" />
          <DeskRow label="Reserved by open orders" value={money(summary.reserved)} />
          <DeskRow label="Available cash" value={money(summary.available)} tone="accent" />
        </dl>
        <p className="text-xs text-[#87948D]">
          Collateral is 150% of each short&apos;s value (shares short × current price), locked out of your cash and recalculated at every price change.
        </p>
        <div>
          <div className="flex flex-wrap justify-between gap-x-3 text-sm">
            <span className="font-medium text-[#F2F5F3]">Short exposure</span>
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
            aria-valuenow={pct}
          >
            <div className="h-full bg-[var(--desk-accent)]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-[#87948D]">
            Open shorts {money(summary.shortExposure)}
            {summary.shortExposureWithPending > summary.shortExposure ? ` + pending shorts ${money(summary.shortExposureWithPending - summary.shortExposure)}` : ""}, at
            current prices.
          </p>
        </div>
      </section>
    );
  }

  // The demo overview's L2 depth column: each held company's long and short room as depth rows.
  function limitsPanel() {
    return (
      <section className="min-w-0 grow bg-[#171610] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-[#2d2a1d]">
            <div>
              <h2 className="text-sm font-semibold text-[#F2F5F3]">Limits per company</h2>
              <span className="font-mono text-[11px] text-[#87948D]">With pending orders</span>
            </div>
            <span className="font-mono text-sm font-semibold text-[color:var(--desk-accent)] tabular-nums">{count(limitCompanies.length)}</span>
          </div>
          {limitCompanies.length === 0 ? (
            <p className="p-6 text-center font-mono text-xs text-[#87948D]">No holdings or pending orders yet.</p>
          ) : (
            <div role="region" aria-label="Limits per company" className="mt-3 space-y-1 font-mono text-xs tabular-nums">
              <div className="grid grid-cols-3 text-[10px] uppercase tracking-[0.08em] text-[#87948D] pb-1">
                <span>Company</span>
                <span className="text-right">Long</span>
                <span className="text-right">Short</span>
              </div>
              {limitCompanies.map((c) => {
                const p = companyPosition(fctx, c.id);
                const long = p.exchangeQty + p.pending.BUY;
                const short = p.shortQty + p.pending.SHORT;
                return (
                  <div key={c.id} className="relative grid grid-cols-3 py-1 px-1.5 rounded-sm overflow-hidden">
                    <div className="absolute inset-y-0 right-0 bg-[#00D68F]/12 pointer-events-none" style={{ width: `${meterPct(long, RULES.LONG_LIMIT)}%` }} />
                    <span className="relative font-semibold text-[#F2F5F3]">{c.ticker}</span>
                    <span className="relative text-right text-[#00D68F]">
                      {count(long)} of {count(RULES.LONG_LIMIT)}
                    </span>
                    <span className="relative text-right text-[#FF5364]">
                      {count(short)} of {count(RULES.SHORT_LIMIT)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-[#2d2a1d] flex items-center justify-between text-xs font-mono">
          <span className="text-[#87948D]">Long limit {count(RULES.LONG_LIMIT)} · short {count(RULES.SHORT_LIMIT)}</span>
          <Link href="/team/trade" className="text-[color:var(--desk-accent)] hover:underline whitespace-nowrap">
            Orders →
          </Link>
        </div>
      </section>
    );
  }
}
