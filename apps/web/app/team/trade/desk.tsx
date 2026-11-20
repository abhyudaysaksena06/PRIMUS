"use client";

// The order screen's chart, beside the ticket: pick a company (the ticket follows the pick), read its candles (each
// trading round's real high and low, crisis and score moves marked as their own candles), the candlestick patterns,
// and, while a round is open, its live indicative candle, read every 5 seconds. Drawn as the desk's screener (one
// tinted tile per company), the instrument panel over its candles and the ticket beside it.

import { useEffect, useMemo, useState } from "react";
import type { OrderContext } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import type { Candle } from "@/lib/chart";
import { liveCandle, type RangeRow } from "@/lib/team/trade-candles";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { money } from "@/lib/format";
import { TradingChart } from "@/components/ui/trading-chart";
import { Countdown } from "@/components/ui/countdown";
import { OrderTicket } from "./ticket";
import "./finance-desk.css";

/** How often an open round's price ranges are re-read (each desk adds ±1 s of its own). */
const RANGE_POLL_MS = 5000;

export interface DeskCompany {
  id: string;
  ticker: string;
  name: string | null;
  price: number;
}

export function TradeDesk({
  companies,
  candles,
  openRound,
  initialRanges,
  ticket,
  embedded = false,
}: {
  companies: DeskCompany[];
  candles: Record<string, Candle[]>;
  openRound: { id: string; number: number } | null;
  initialRanges: RangeRow[];
  embedded?: boolean;
  /** The order ticket while a round accepts orders (it trades the company picked on the chart). */
  ticket: {
    ctx: OrderContext;
    round: { number: number; closesAt: string };
    action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
    ownTicker: string | null;
  } | null;
}) {
  const [picked, setPicked] = useState(companies[0]?.id ?? "");
  const [snapshot, setSnapshot] = useState<{ roundId: string; ranges: RangeRow[] }>();
  const roundId = openRound?.id ?? null;
  const ranges = roundId && snapshot?.roundId === roundId
    ? snapshot.ranges
    : roundId ? initialRanges.filter((range) => range.round_id === roundId) : [];

  useEffect(() => {
    if (!roundId) return;
    const sb = supabaseBrowser();
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        // A hidden tab does not read; it catches up on its next beat once it is visible again.
        if (document.visibilityState === "visible") {
          const { data } = await sb.from("round_ranges").select("round_id, company_id, open_cents, high_cents, low_cents, last_cents").eq("round_id", roundId);
          if (!stop && data) setSnapshot({ roundId, ranges: data as RangeRow[] });
        }
      } finally {
        // Every desk reads on its own beat (4–6 s), so a room of screens never reads in the same second, and a failed
        // read does not stop the polling.
        if (!stop) t = setTimeout(read, RANGE_POLL_MS - 1000 + Math.random() * 2000);
      }
    };
    // The first read waits up to 1.5 s: every desk mounts at once when a round opens (the page already has the ranges).
    t = setTimeout(read, Math.random() * 1500);
    return () => {
      stop = true;
      if (t) clearTimeout(t);
    };
  }, [roundId]);

  const company = companies.find((c) => c.id === picked) ?? companies[0] ?? null;
  const live = openRound && company ? liveCandle(openRound.number, company.price, ranges.find((r) => r.company_id === company.id) ?? null) : null;
  const shown = useMemo(() => {
    const past = company ? (candles[company.id] ?? []) : [];
    return live ? [...past, live] : past;
  }, [company, candles, live]);
  const indicative = (id: string) => {
    const r = ranges.find((x) => x.company_id === id);
    return r ? Number(r.last_cents) : null;
  };

  if (!company) return null;
  const now = live ? live.close : company.price;
  const move = now - company.price;
  const movePct = (Math.abs(move) / company.price) * 100;

  const chart = (
    <div className="fin-candles rounded border border-white/10 bg-[#0a141a] p-2 sm:p-3">
      <TradingChart candles={shown} label={`${company.ticker} price`} testId="trade-chart" live={!!live} average={3} note="One candle per price step: each trading round, the IPO, crises and score moves" />
    </div>
  );

  if (embedded) {
    return (
      <section className="min-w-0" data-testid="trade-chart-panel">
        <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-paper">
          Company chart
          <select value={company.id} onChange={(event) => setPicked(event.target.value)}
            className="max-w-full rounded border border-line px-2 py-1 font-mono text-sm">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.ticker} · {c.name}</option>)}
          </select>
        </label>
        <Quote company={company} live={live} now={now} move={move} movePct={movePct} roundNumber={openRound?.number ?? null} />
        {chart}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* The screener: one tile per company, tinted by its move this round; picking one moves the chart and the ticket. */}
      <section className="min-w-0 overflow-hidden rounded-lg border border-white/[0.07] bg-[#171610]" data-testid="trade-chart-panel">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[#2d2a1d] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-[#F2F5F3]">Market screener</h2>
            <p className="mt-0.5 text-xs text-[#BACBB9]">
              {companies.length} {companies.length === 1 ? "company" : "companies"}
              {openRound ? ` · live prices for round ${openRound.number}` : " · last cleared prices"}
            </p>
          </div>
          {openRound ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#00D68F]">
              <span className="fin-live-dot inline-block size-1.5 rounded-full bg-[#00D68F]" aria-hidden />
              Live
            </span>
          ) : null}
        </header>
        <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" role="tablist" aria-label="Company chart">
          {companies.map((c) => {
            const ind = indicative(c.id);
            const d = ind !== null ? ind - c.price : 0;
            const on = c.id === company.id;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPicked(c.id)}
                data-testid={`chart-pick-${c.ticker}`}
                className={`min-w-0 rounded border px-2.5 py-2 text-left font-mono text-xs transition-colors ${tileTone(d, c.price)} ${
                  on ? "outline-2 outline-offset-1 outline-[color:var(--desk-accent)] outline" : "hover:brightness-125"
                }`}
              >
                <span className="block truncate text-[13px] font-semibold text-[#F2F5F3]">{c.ticker}</span>
                <span className="block tabular-nums text-[#F2F5F3]">
                  {money(ind ?? c.price)}
                  {d !== 0 ? <span className={d > 0 ? "text-[#7ef0c4]" : "text-[#ffb3bb]"}> {d > 0 ? "▲" : "▼"}</span> : null}
                </span>
                {c.name ? <span className="block truncate font-sans text-[11px] text-[#BACBB9]">{c.name}</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <div className={ticket ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" : ""}>
        <section className="min-w-0 rounded-lg border border-white/10 bg-[#171610] p-4" aria-label="Instrument analysis">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-mono text-base font-semibold text-[#F2F5F3]">{company.ticker}</h2>
              {company.name ? <p className="text-xs text-[#BACBB9]">{company.name}</p> : null}
            </div>
            {ticket ? (
              <a href="#order-ticket" className="rounded border border-[color:var(--desk-accent-line)] px-3 py-2 text-sm font-semibold text-[color:var(--desk-accent)] xl:hidden">
                Trade {company.ticker} ↓
              </a>
            ) : null}
          </div>
          <Quote company={company} live={live} now={now} move={move} movePct={movePct} roundNumber={openRound?.number ?? null} />
          {chart}
        </section>
        {ticket ? (
          <section id="order-ticket" className="min-w-0 scroll-mt-4 overflow-hidden rounded-lg border border-white/[0.07] bg-[#171610] xl:self-start">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2d2a1d] px-4 py-3">
              <h2 className="text-sm font-semibold text-[#F2F5F3]">Order ticket · round {ticket.round.number}</h2>
              <span className="font-mono text-[11px] text-[#87948D] tabular-nums">
                closes in <Countdown to={ticket.round.closesAt} passed="now" className="font-semibold text-[color:var(--desk-accent)]" />
              </span>
            </header>
            <div className="p-4">
              <OrderTicket ctx={ticket.ctx} companies={companies} round={ticket.round} action={ticket.action} picked={company.id} onPick={setPicked} />
              {ticket.ownTicker ? (
                <p className="mt-3 text-xs text-[#87948D]">
                  Your squad&apos;s company, {ticket.ownTicker}, is not listed: a fund never trades its own squad&apos;s company.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** A tile's tint: green when the round would lift it, red when it would sink it, graphite when flat. */
function tileTone(d: number, price: number): string {
  const pct = price > 0 ? (d / price) * 100 : 0;
  if (pct > 5) return "border-[#53d6b4] bg-[#08604c]";
  if (pct >= 2) return "border-[#49ae91] bg-[#145340]";
  if (pct > 0) return "border-[#378073] bg-[#153f36]";
  if (pct === 0) return "border-[#423c28] bg-[#11110d]";
  if (pct > -2) return "border-[#b66b73] bg-[#543039]";
  return pct >= -5 ? "border-[#d47183] bg-[#682b38]" : "border-[#f08799] bg-[#7f2538]";
}

/** The picked company's figures over the chart: the price, and while a round is open what it would clear at. */
function Quote({
  company,
  live,
  now,
  move,
  movePct,
  roundNumber,
}: {
  company: DeskCompany;
  live: Candle | null;
  now: number;
  move: number;
  movePct: number;
  roundNumber: number | null;
}) {
  const tone = move > 0 ? "text-[#00D68F]" : move < 0 ? "text-[#FF5364]" : "text-[#87948D]";
  return (
    <div className="my-3 space-y-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuoteFact label="Market price" value={money(company.price)} />
        <QuoteFact label={live ? `Round ${roundNumber} indicative` : "Last price"} value={money(now)} />
        <QuoteFact label="Move" value={`${move >= 0 ? "+" : "−"}${movePct.toFixed(1)}%`} tone={tone} />
        <QuoteFact label="Status" value={live ? "Round open" : "Closed"} tone={live ? "text-[#00D68F]" : "text-[#87948D]"} />
      </dl>
      {live ? (
        <p className="text-sm" data-testid="indicative-price">
          <span className="text-[#BACBB9]">Round {roundNumber} would clear at </span>
          <b className="font-mono text-[color:var(--desk-accent)]">{money(now)}</b>
          <span className={tone}>
            {" "}
            ({move >= 0 ? "+" : "−"}
            {movePct.toFixed(1)}%)
          </span>
          <span className="text-[#BACBB9]"> if no other order came</span>
        </p>
      ) : null}
    </div>
  );
}

function QuoteFact({ label, value, tone = "text-[#F2F5F3]" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-[#11110d] p-2">
      <dt className="text-xs text-[#BACBB9]">{label}</dt>
      <dd className={`mt-1 break-words font-mono text-xs font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
