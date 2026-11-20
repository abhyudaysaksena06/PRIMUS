"use client";

// The order screen's chart, beside the ticket: pick a company (the ticket follows the pick), read its candles (each
// trading round's real high and low, crisis and score moves marked as their own candles), the candlestick patterns,
// and, while a round is open, its live indicative candle, read every 5 seconds. Drawn as the desk's screener (one
// tinted tile per company), the instrument panel over its candles and the ticket beside it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { OrderContext } from "@msim/engine";
import type { ActionResult } from "@/lib/rpc";
import type { Candle } from "@/lib/chart";
import { liveCandle, type RangeRow } from "@/lib/team/trade-candles";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { bp, money } from "@/lib/format";
import { TradingChart } from "@/components/ui/trading-chart";
import { Countdown } from "@/components/ui/countdown";
import { LayoutGrid, List, Search } from "lucide-react";
import { fundSummary } from "@/lib/team/trade";
import { OrderTicket } from "./ticket";
import { DeskFact, Sparkline } from "./desk-ui";
import "@/components/ui/market-board.css";
import "@/styles/primus/finance.css";

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
  side,
  blotter,
  embedded = false,
}: {
  /** The execution row's first column (the fund's cash and limits) and its last (the open round's orders). */
  side?: ReactNode;
  blotter?: ReactNode;
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
  const [view, setView] = useState<"heatmap" | "table">("heatmap");
  const [query, setQuery] = useState("");
  const [moveFilter, setMoveFilter] = useState<(typeof MOVES)[number]>("ALL");
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

  const moveBp = (c: DeskCompany) => {
    const ind = indicative(c.id);
    if (openRound) return ind === null ? 0 : Math.round(((ind - c.price) / c.price) * 10000);
    const past = candles[c.id] ?? [];
    const prev = past.length >= 2 ? past[past.length - 2]!.close : null;
    return prev ? Math.round(((c.price - prev) / prev) * 10000) : null;
  };
  const needle = query.trim().toLowerCase();
  const moveOk = (c: DeskCompany) => {
    if (moveFilter === "ALL") return true;
    const m = moveBp(c) ?? 0;
    return moveFilter === "Rising" ? m > 0 : moveFilter === "Falling" ? m < 0 : m === 0;
  };
  const listed = companies.filter((c) => moveOk(c) && (!needle || `${c.ticker} ${c.name ?? ""}`.toLowerCase().includes(needle)));
  const last = shown.at(-1) ?? null;
  const high = last ? (last.high ?? Math.max(last.open, last.close)) : now;
  const low = last ? (last.low ?? Math.min(last.open, last.close)) : now;
  const stepWord = live && openRound ? `Round ${openRound.number}` : "Last step";
  const blotterOnly = !ticket && blotter;

  return (
    <div className="space-y-4">
      {/* Market screener (the demo's MarketsScreen): one heatmap tile per company, tinted by its move; picking one moves
          the chart and the ticket. */}
      <section className="bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden" data-testid="trade-chart-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2d2a1d] px-4 py-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[#F2F5F3]">Market screener</h2>
              <p className="mt-1 text-xs text-[#BACBB9]" role="status">
                {listed.length} of {companies.length} {companies.length === 1 ? "company" : "companies"}
                {openRound ? ` · live prices for round ${openRound.number}` : " · last cleared prices"}
              </p>
            </div>
            <div aria-label="Screener view" role="group" className="flex gap-1">
              {(["heatmap", "table"] as const).map((mode) => {
                const Icon = mode === "heatmap" ? LayoutGrid : List;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view === mode}
                    onClick={() => setView(mode)}
                    className="inline-flex items-center gap-1.5 rounded border border-[#423c28] px-2 py-1.5 text-xs capitalize text-[#F2F5F3] aria-pressed:border-[color:var(--desk-accent)] aria-pressed:bg-[var(--desk-accent-soft)]"
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {mode}
                  </button>
                );
              })}
            </div>
          </div>
          {/* The demo's sector filter, here by the move: all, rising, flat or falling. */}
          <div className="flex flex-wrap items-center gap-1 bg-[#11110d] border border-[#2d2a1d] p-0.5 rounded" role="group" aria-label="Filter by move">
            {MOVES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={moveFilter === m}
                onClick={() => setMoveFilter(m)}
                className={`px-3 py-1.5 rounded-sm font-mono text-xs transition-colors whitespace-nowrap shrink-0 ${
                  moveFilter === m
                    ? "bg-[#201e14] text-[color:var(--desk-accent)] border border-[color:var(--desk-accent-line)]"
                    : "text-[#87948D] hover:text-[#F2F5F3]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#87948D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticker or company..."
              aria-label="Search companies"
              className="h-9 w-full rounded border border-[#423c28] bg-[#11110d] pr-3 pl-9 font-mono text-xs text-[#F2F5F3] placeholder:text-[#87948D]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {listed.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="font-mono text-xs text-[#87948D]">
                No company matches &ldquo;{query}&rdquo; in {moveFilter}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setMoveFilter("ALL");
                }}
                className="px-3 py-1.5 bg-[#11110d] border border-[#2d2a1d] hover:border-[color:var(--desk-accent-line)] rounded font-mono text-xs text-[color:var(--desk-accent)]"
              >
                Reset Market Filters
              </button>
            </div>
          ) : view === "heatmap" ? (
            <div className="p-3 market-type @container space-y-3">
              <ul aria-label="Price change legend" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[#F2F5F3]">
                {BANDS.map(({ label, tone }) => (
                  <li key={label} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`size-2.5 rounded-sm border ${tone}`} />
                    {label}
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-1.5 @min-[650px]:grid-cols-5 @min-[1080px]:grid-cols-10" role="tablist" aria-label="Company chart">
                {listed.map((c) => {
                  const ind = indicative(c.id);
                  const on = c.id === company.id;
                  const m = moveBp(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setPicked(c.id)}
                      data-testid={`chart-pick-${c.ticker}`}
                      className={`flex h-full min-h-22 w-full min-w-0 cursor-pointer flex-col rounded-md border-t px-2.5 py-2 text-left text-white hover:brightness-110 focus-visible:outline-offset-2 ${bandFor(m).tone} ${on ? "ring-2 ring-inset ring-[color:var(--heatmap-selection,white)]" : ""}`}
                    >
                      <span className="flex flex-wrap justify-between gap-x-2">
                        <span className="text-sm font-semibold">{c.ticker}</span>
                        {openRound ? <span className="text-xs text-white/90">R{openRound.number}</span> : null}
                      </span>
                      <span className="w-full truncate text-xs text-white/90" title={c.name ?? undefined}>
                        {c.name ?? " "}
                      </span>
                      <span className="mt-auto flex flex-wrap justify-between gap-x-2 pt-2 text-xs font-semibold tabular-nums">
                        <span>{money(ind ?? c.price)}</span>
                        <span>{bp(m)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <table className="w-full text-left border-collapse" aria-label="Company chart">
              <thead>
                <tr className="border-b border-[#2d2a1d] bg-[#11110d]">
                  {["Company", "Market price", openRound ? "Indicative" : "Last price", "Move", "High / Low", "Trend"].map((h, i) => (
                    <th
                      key={h}
                      className={`py-2.5 ${i === 0 || i === 5 ? "px-4" : "px-3"} font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] whitespace-nowrap ${i > 0 ? "text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listed.map((c, idx) => {
                  const ind = indicative(c.id);
                  const m = moveBp(c);
                  const past = candles[c.id] ?? [];
                  const r = ranges.find((x) => x.company_id === c.id);
                  const hi = r ? Math.max(Number(r.high_cents), Number(r.open_cents)) : (past.at(-1)?.high ?? null);
                  const lo = r ? Math.min(Number(r.low_cents), Number(r.open_cents)) : (past.at(-1)?.low ?? null);
                  const spark = [...past.slice(-11).map((k) => k.close), ind ?? c.price];
                  const selected = c.id === company.id;
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-[#2d2a1d]/70 transition-colors ${selected ? "bg-[#201e14]" : idx % 2 === 0 ? "bg-[#11110d] hover:bg-[#201e14]/70" : "bg-[#171610] hover:bg-[#201e14]/70"}`}
                    >
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setPicked(c.id)}
                          data-testid={`chart-pick-${c.ticker}`}
                          className="font-mono text-[13px] font-semibold text-[#F2F5F3] underline underline-offset-4"
                        >
                          {c.ticker}
                        </button>
                        {c.name ? <div className="text-[11px] text-[#87948D]">{c.name}</div> : null}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums">{money(c.price)}</td>
                      <td className="py-2.5 px-3 font-mono text-[13px] text-[#F2F5F3] text-right tabular-nums">{money(ind ?? c.price)}</td>
                      <td
                        className={`py-2.5 px-3 font-mono text-[13px] text-right tabular-nums ${(m ?? 0) > 0 ? "text-[#00D68F]" : (m ?? 0) < 0 ? "text-[#FF5364]" : "text-[#87948D]"}`}
                      >
                        {bp(m)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[#BACBB9] text-right tabular-nums whitespace-nowrap">
                        {hi !== null && lo !== null ? `${money(hi)} / ${money(lo)}` : "—"}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="flex justify-end">
                          <Sparkline values={spark} positive={(m ?? 0) >= 0} width={76} height={22} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Instrument analysis: the picked company's figures over its candles. */}
      <section aria-label="Instrument analysis" className="scroll-mt-24 rounded-lg border border-white/10 bg-[#171610] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#F2F5F3]">{company.ticker}</h2>
            {company.name ? <p className="text-xs text-[#BACBB9]">{company.name}</p> : null}
          </div>
          {ticket ? (
            <a href="#order-ticket" className="rounded border border-[color:var(--desk-accent-line)] px-3 py-2 text-sm font-semibold text-[color:var(--desk-accent)]">
              Buy or sell {company.ticker} ↓
            </a>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <DeskFact label="Market price" value={money(company.price)} />
          <DeskFact label={live && openRound ? `Round ${openRound.number} indicative` : "Last price"} value={money(now)} tone={live ? "accent" : "plain"} />
          <DeskFact label="Move" value={`${move >= 0 ? "+" : "−"}${movePct.toFixed(1)}%`} tone={move > 0 ? "up" : move < 0 ? "down" : "muted"} />
          <DeskFact label={`${stepWord} high`} value={money(high)} />
          <DeskFact label={`${stepWord} low`} value={money(low)} />
          <DeskFact label="Status" value={live ? "Round open" : "Closed"} tone={live ? "up" : "muted"} />
        </dl>
        {live && openRound ? <Indicative now={now} move={move} movePct={movePct} roundNumber={openRound.number} /> : null}
        <div className="mt-3">{chart}</div>
        <p className="mt-3 text-xs leading-relaxed text-[#BACBB9]">
          The market price values your positions. While a round is open, the indicative price is where it would clear if no other order came: every valid
          order fills at its company&apos;s clearing price when the round closes, which moves 1% for every 1,000 shares of net demand (at most 10%).
        </p>
      </section>

      {/* Execution workspace (the demo's book · ticket · blotter row): the fund's cash and limits, the ticket, the open
          round's orders. */}
      {side || ticket || blotter ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {side ? <div className="min-w-0 xl:col-span-4 flex flex-col">{side}</div> : null}
          {ticket ? (
            <section
              id="order-ticket"
              className="min-w-0 scroll-mt-4 xl:col-span-4 bg-[#171610] border border-white/[0.07] rounded-lg p-5 flex flex-col gap-3 xl:self-start"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#F2F5F3]">Order ticket · round {ticket.round.number}</h2>
                <span className="font-mono text-[11px] text-[#87948D] tabular-nums">
                  Mark {money(company.price)} · BP {money(fundSummary(ticket.ctx).available)} ·{" "}
                  <span>
                    closes in <Countdown to={ticket.round.closesAt} passed="now" className="font-semibold text-[color:var(--desk-accent)]" />
                  </span>
                </span>
              </div>
              <OrderTicket ctx={ticket.ctx} companies={companies} round={ticket.round} action={ticket.action} picked={company.id} onPick={setPicked} />
              {ticket.ownTicker ? (
                <p className="text-xs text-[#87948D]">Your squad&apos;s company, {ticket.ownTicker}, is not listed: a fund never trades its own squad&apos;s company.</p>
              ) : null}
            </section>
          ) : null}
          {blotter ? (
            <div className={`min-w-0 flex flex-col ${blotterOnly && side ? "xl:col-span-8" : blotterOnly ? "xl:col-span-12" : "xl:col-span-4"}`}>{blotter}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const MOVES = ["ALL", "Rising", "Flat", "Falling"] as const;

export const BANDS = [
  { label: "Above +5%", tone: "bg-[#08604c] border-[#53d6b4]" },
  { label: "+2% to +5%", tone: "bg-[#145340] border-[#49ae91]" },
  { label: "0% to +2%", tone: "bg-[#153f36] border-[#378073]" },
  { label: "0%", tone: "bg-[#303844] border-[#697382]" },
  { label: "0% to −2%", tone: "bg-[#543039] border-[#b66b73]" },
  { label: "−2% to −5%", tone: "bg-[#682b38] border-[#d47183]" },
  { label: "Below −5%", tone: "bg-[#7f2538] border-[#f08799]" },
  { label: "No data", tone: "bg-[#22272d] border-[#4d5663]" },
] as const;

/** The heatmap's band for a move in basis points (the demo's market-heatmap bands). */
export function bandFor(move: number | null) {
  if (move === null) return BANDS[7];
  if (move > 500) return BANDS[0];
  if (move >= 200) return BANDS[1];
  if (move > 0) return BANDS[2];
  if (move === 0) return BANDS[3];
  if (move > -200) return BANDS[4];
  return move >= -500 ? BANDS[5] : BANDS[6];
}

/** While a round is open: where the picked company would clear if no other order came. */
function Indicative({ now, move, movePct, roundNumber }: { now: number; move: number; movePct: number; roundNumber: number }) {
  const tone = move > 0 ? "text-[#00D68F]" : move < 0 ? "text-[#FF5364]" : "text-[#87948D]";
  return (
    <p className="mt-3 text-sm text-[#BACBB9]" data-testid="indicative-price">
      Round {roundNumber} would clear at <b className="font-mono text-[color:var(--desk-accent,var(--market-accent))]">{money(now)}</b>
      <span className={tone}>
        {" "}
        ({move >= 0 ? "+" : "−"}
        {movePct.toFixed(1)}%)
      </span>{" "}
      if no other order came
    </p>
  );
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
          <span className="text-muted">Round {roundNumber} would clear at </span>
          <b className="font-mono text-[color:var(--desk-accent,var(--market-accent))]">{money(now)}</b>
          <span className={tone}>
            {" "}
            ({move >= 0 ? "+" : "−"}
            {movePct.toFixed(1)}%)
          </span>
          <span className="text-muted"> if no other order came</span>
        </p>
      ) : null}
    </div>
  );
}

function QuoteFact({ label, value, tone = "text-paper" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-black/25 p-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 break-words font-mono text-xs font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
