import type { Metadata } from "next";
import Link from "next/link";
import { RULES, phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { fundContext, loadTradeData } from "@/lib/team/trade-data";
import { fundSummary, openOrders, openOrdersState, tradingNotice, type TradingNotice } from "@/lib/team/trade";
import { clock, money } from "@/lib/format";
import { meterPct } from "@/lib/team/portfolio";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice } from "@/components/ui/ui";
import { DeskPanel, DeskRow, DeskStatus, deskPill } from "./desk-ui";
import { supabaseServer } from "@/lib/supabase/server";
import { Countdown } from "@/components/ui/countdown";
import { tradeGate } from "./gate";
import { type TicketCompany } from "./ticket";
import { TradeDesk } from "./desk";
import { loadTradeCandles } from "@/lib/team/trade-candles-data";
import { OpenOrders } from "./open-orders";
import { cancelOrder, editOrder, placeOrder } from "./actions";
import { loadWire } from "@/lib/team/wire-data";
import { WireFeed } from "../wire-feed";

export const metadata: Metadata = { title: "Trade" };

// Orders: the fund's cash and limits, the order ticket while a round is open (or why trading is closed and when the
// next round opens), and the open round's orders with their countdown. Clearings, phase changes and pauses broadcast,
// so the page re-reads itself then, and after each of its own actions. The page also re-reads itself when the round's
// closing time or the next round's opening time passes, and every 10 s while a round accepts orders: an order placed
// on the fund's other device, or a rescue deal a partner signs last, sends no broadcast, and a stale view could
// otherwise refuse an order the exchange would accept.
export default async function TradePage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const { status, company: own } = ctx;
  const data = await loadTradeData(ctx, { orders: "pending" });
  const at = (code: "READING" | "IPO" | "ROUNDS_1_4") => {
    // A PRIMUS event's first trading round is in Round 2 (PRESSURE).
    const t = data.phaseStarts[code] ?? (code === "ROUNDS_1_4" ? data.phaseStarts.PRESSURE : undefined);
    return t ? clock(t) : null;
  };

  if (!phaseReached(status.phase, "READING")) {
    return (
      <DeskPanel title="Trading">
        <p className="text-sm text-paper" data-testid="trading-notice">
          Trading starts with round 1{at("ROUNDS_1_4") ? ` at ${at("ROUNDS_1_4")}` : ""}. The companies are listed at Reading
          {at("READING") ? ` (${at("READING")})` : ""}, and IPO bids open with the IPO{at("IPO") ? ` at ${at("IPO")}` : ""}.
        </p>
        {status.phase === "BUILD" ? (
          <p className="mt-2 text-sm text-paper">
            Until then, trade the{" "}
            <Link href="/team/trade/practice" className="font-semibold text-[color:var(--desk-accent)] underline">
              practice market
            </Link>
            : practice only, to learn the desk before the IPO; nothing from it carries into the real game.
          </p>
        ) : null}
      </DeskPanel>
    );
  }

  const fctx = fundContext(ctx, data);
  const nowMs = new Date(status.server_time).getTime();
  const notice = tradingNotice(
    { phase: status.phase, trading: status.trading, paused: status.paused, marketClosed: data.marketClosedAt !== null, nowMs },
    data.rounds,
  );
  const summary = fundSummary(fctx);
  const open = openOrders(data.orders, data.rounds, data.companies);
  const accepting = status.trading === "OPEN" && status.open_round !== null && !status.paused;
  const ordersRound = open.length > 0 ? (data.rounds.find((r) => r.number === open[0]!.roundNumber) ?? null) : null;
  const shownRound = status.open_round ?? (ordersRound ? { number: ordersRound.number, closes_at: ordersRound.closes_at } : null);
  const ordersState = shownRound ? openOrdersState({ accepting, paused: status.paused, closesAt: shownRound.closes_at, nowMs }) : null;
  const tradable: TicketCompany[] = data.companies
    .filter((c) => c.market_price !== null && c.id !== own?.id)
    .map((c) => ({ id: c.id, ticker: c.ticker!, name: c.name, price: c.market_price! }));
  const ownTicker = own?.ticker ?? null;
  // What just became public (released scores, the plans, bulletins): the funds trade on it.
  const wire = await loadWire(ctx.event.id);
  // Companies cooling off this round (migration 069): each moved the full 10% last round and takes no orders now.
  const coolingIds = accepting
    ? (((await (await supabaseServer()).rpc("cooling_off_companies", { p_event: ctx.event.id })).data ?? []) as string[])
    : [];
  const cooling = tradable.filter((c) => coolingIds.includes(c.id));
  const chart = await loadTradeCandles(ctx.event.id);
  const openRoundId = status.open_round ? (data.rounds.find((r) => r.number === status.open_round!.number)?.id ?? null) : null;

  // The execution row's first column, where the demo has its order book: the fund's cash and limits as depth rows.
  const fundBook = (
    <section aria-labelledby="cash-and-limits" className="bg-[#171610] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between grow">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-[#2d2a1d]">
          <div>
            <h2 id="cash-and-limits" className="text-sm font-semibold text-[#F2F5F3]">
              Cash and limits · {ctx.team.code}
            </h2>
            <span className="font-mono text-[11px] text-[#87948D]">Cash − collateral − reserves</span>
          </div>
          <span className="font-mono text-xs text-[color:var(--desk-accent)] tabular-nums">{money(summary.available)}</span>
        </div>
        <dl className="mt-3 space-y-1 font-mono text-xs tabular-nums">
          <div className="grid grid-cols-2 text-[10px] uppercase tracking-[0.08em] text-[#87948D] pb-1">
            <span>Figure</span>
            <span className="text-right">Amount</span>
          </div>
          <DeskRow label="Available to spend" value={money(summary.available)} testId="available" tone="accent" />
          <DeskRow label="Cash" value={money(summary.cash)} />
          <DeskRow label="Reserved by open orders" value={money(summary.reserved)} testId="reserved" bar={meterPct(summary.reserved, summary.cash)} barTone="accent" />
          <DeskRow label="Collateral locked" value={money(summary.collateral)} bar={meterPct(summary.collateral, summary.cash)} barTone="down" />
          <div className="my-2 py-1.5 border-y border-[#2d2a1d] flex items-center justify-between text-xs">
            <span className="text-[#87948D]">Collateral</span>
            <span className="text-[#F2F5F3]">150% of your shorts&apos; value</span>
          </div>
          <DeskRow
            label="Short exposure"
            value={money(summary.shortExposureWithPending)}
            testId="exposure"
            bar={meterPct(summary.shortExposureWithPending, RULES.SHORT_EXPOSURE_LIMIT)}
            barTone="down"
          />
          <DeskRow label="Short exposure limit" value={money(RULES.SHORT_EXPOSURE_LIMIT)} />
        </dl>
        <p className="mt-2 text-[11px] text-[#87948D]">Short exposure counts pending shorts.</p>
      </div>
      <div className="mt-3 pt-3 border-t border-[#2d2a1d] flex items-center justify-between gap-3 text-xs font-mono">
        <span className="text-[#87948D]">Holdings, P&amp;L, limits per company</span>
        <Link href="/team/trade/positions" className="text-[color:var(--desk-accent)] hover:underline whitespace-nowrap">
          Positions →
        </Link>
      </div>
    </section>
  );

  // The execution row's last column: the demo's order blotter, holding the open round's orders.
  const blotter =
    shownRound && (accepting || open.length > 0) ? (
      <section className="bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden flex flex-col grow">
        <div className="px-4 py-3 border-b border-[#2d2a1d] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#F2F5F3]">Order blotter · round {shownRound.number}</h2>
          <div className="flex items-center bg-[#11110d] border border-[#2d2a1d] p-0.5 rounded">
            <span className={deskPill(true)}>Open ({open.length})</span>
            <Link href="/team/trade/history" className={deskPill(false)}>
              History
            </Link>
          </div>
        </div>
        <div className="px-4 py-2 border-b border-[#2d2a1d] font-mono text-[11px] text-[#87948D]">
          {ordersState === "EDITABLE" ? (
            <span className="text-[#BACBB9]">
              editable for <Countdown to={shownRound.closes_at} passed="—" className="font-semibold text-[color:var(--desk-accent)]" />
            </span>
          ) : ordersState === "PAUSED" ? (
            <span className="text-warn" data-testid="open-orders-state">
              paused: no changes until the event resumes
            </span>
          ) : (
            <span className="text-warn" data-testid="open-orders-state">
              closed at {clock(shownRound.closes_at, true)}: clearing
            </span>
          )}
        </div>
        <div className="px-4 overflow-y-auto max-h-[520px]">
          {open.length === 0 ? (
            <p className="p-6 text-center font-mono text-xs text-[#87948D]">No open orders in round {shownRound.number}.</p>
          ) : (
            <OpenOrders
              ctx={fctx}
              closesAt={shownRound.closes_at}
              accepting={accepting}
              items={open.map((line) => ({ line, edit: editOrder.bind(null, line.id), cancel: cancelOrder.bind(null, line.id) }))}
            />
          )}
        </div>
        <p className="mt-auto px-4 py-3 border-t border-[#2d2a1d] text-xs text-[#87948D]">
          Every valid order fills at its company&apos;s new price when the round clears. Past rounds and their fill prices are under{" "}
          <Link href="/team/trade/history" className="underline">
            History
          </Link>
          .
        </p>
      </section>
    ) : null;

  return (
    <div className="space-y-4">
      <RefreshAt at={accepting ? status.open_round!.closes_at : (notice?.next?.opensAt ?? null)} />
      <AutoRefresh everyMs={10_000} active={accepting} />

      <DeskStatus live={accepting}>
        {accepting ? <>Live trading · round {status.open_round!.number} · closes in <Countdown to={status.open_round!.closes_at} passed="now" className="text-[color:var(--desk-accent)]" /></> : "Trading closed"}
        <span aria-hidden>·</span> {open.length} open {open.length === 1 ? "order" : "orders"} <span aria-hidden>·</span> {tradable.length} listed
      </DeskStatus>

      {notice ? <ClosedNotice notice={notice} nowMs={nowMs} ipo={status.phase === "IPO"} /> : null}

      {cooling.length > 0 ? (
        <Notice tone="amber">
          <span data-testid="cooling-off">
            Cooling off this round: <strong className="font-mono">{cooling.map((c) => c.ticker).join(", ")}</strong>. Each moved the full 10% last round, so
            it takes no orders until the next round opens.
          </span>
        </Notice>
      ) : null}

      {summary.blocked ? (
        <Notice tone="red">
          <span data-testid="collateral-blocked">
            Your cash ({money(summary.cash)}) is below your locked collateral ({money(summary.collateral)}), short by {money(summary.deficit)}: new buys and shorts are
            blocked until cash covers it. Sells and covers are always allowed, and nothing is sold for you before the close.
          </span>
        </Notice>
      ) : null}

      {tradable.length > 0 ? (
        <TradeDesk
          companies={tradable}
          candles={chart.candles}
          openRound={accepting && openRoundId ? { id: openRoundId, number: status.open_round!.number } : null}
          initialRanges={chart.ranges}
          ticket={
            accepting
              ? { ctx: fctx, round: { number: status.open_round!.number, closesAt: status.open_round!.closes_at }, action: placeOrder, ownTicker }
              : null
          }
          side={fundBook}
          blotter={blotter}
        />
      ) : (
        <>
          {accepting ? <Notice tone="slate">No company is trading.</Notice> : null}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className="min-w-0 xl:col-span-4 flex flex-col">{fundBook}</div>
            {blotter ? <div className="min-w-0 xl:col-span-8 flex flex-col">{blotter}</div> : null}
          </div>
        </>
      )}

      <WireFeed items={wire} />
    </div>
  );
}

function ClosedNotice({ notice, nowMs, ipo }: { notice: TradingNotice; nowMs: number; ipo: boolean }) {
  const upcoming = notice.next && new Date(notice.next.opensAt).getTime() > nowMs ? notice.next : null;
  return (
    <Notice tone={notice.tone}>
      <span data-testid="trading-notice">
        {notice.text}
        {upcoming ? (
          <>
            {" "}
            Round {upcoming.number} opens at {clock(upcoming.opensAt)} (in <Countdown to={upcoming.opensAt} passed="a moment" />
            ).
          </>
        ) : null}
      </span>
      {ipo ? (
        <>
          {" "}
          <Link href="/team/trade/ipo" className="font-semibold underline">
            IPO bids
          </Link>
        </>
      ) : null}
    </Notice>
  );
}
