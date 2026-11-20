"use client";

// The practice trading terminal (laptop layout): the 50 tickers with their live price and move since the open, the
// selected ticker's 30-second candles (live, with the crosshair and pattern markers), and the order panel with the
// fund's practice cash, positions and profit. The practice money stays here; the top funds win a real-cash prize.
// Prices tick every 5
// seconds; every 5 seconds (± 1.5 s at random, so the funds' terminals do not all ask at once) the page reads only the
// ticks newer than it holds: the newest for every ticker, and the selected ticker's new ticks.
// Trades go straight to the database function (practice_trade), which checks everything and fills at the latest
// price.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { candlesFromTicks, PRACTICE, type OrderType } from "@msim/engine";
import type { Candle } from "@/lib/chart";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { bp, count, money } from "@/lib/format";
import { Search } from "lucide-react";
import { TradingChart } from "@/components/ui/trading-chart";
import type { PracticeTicker } from "@/lib/team/practice";
import { DeskFact, DeskKpi, DeskRow, DeskStatus } from "../desk-ui";
import { BANDS, bandFor } from "../desk";

const WINDOW_CANDLES = 60;

interface Position {
  ticker_team_id: string;
  qty: number;
}
interface Trade {
  id: number;
  ticker_team_id: string;
  type: OrderType;
  qty: number;
  price_cents: number;
  created_at: string;
}

export function PracticeTerminal({
  eventId,
  teamId,
  tickers,
  startsAt,
  tickSeconds,
  steps,
  serverNow,
  initialStep,
  paused,
}: {
  eventId: string;
  teamId: string;
  tickers: PracticeTicker[];
  startsAt: string;
  tickSeconds: number;
  steps: number;
  serverNow: string;
  /** The tick the server was at when it rendered the page. */
  initialStep: number;
  paused: boolean;
}) {
  const sb = supabaseBrowser();
  // The server's clock minus this laptop's, measured once on mount (ticks are timed by the server).
  const offset = useRef(0);
  const start = new Date(startsAt).getTime();
  const tickMs = tickSeconds * 1000;
  const per = PRACTICE.candleTicks;
  const stepNow = useCallback(() => Math.max(0, Math.min(steps - 1, Math.floor((Date.now() + offset.current - start) / tickMs))), [start, tickMs, steps]);

  const [selected, setSelected] = useState(tickers[0]?.id ?? "");
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [opening, setOpening] = useState<Record<string, number>>({});
  const [series, setSeries] = useState<Record<string, { steps: number[]; prices: number[] }>>({});
  const [cash, setCash] = useState<number>(PRACTICE.startCents);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [qty, setQty] = useState("100");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [step, setStep] = useState(initialStep);
  const known = useRef<Record<string, number>>({});
  /** The newest step read for every ticker (ticks of all tickers share the steps). */
  const held = useRef(-1);

  const byId = useMemo(() => new Map(tickers.map((t) => [t.id, t])), [tickers]);

  // Every ticker's newest price (and, once, its opening price).
  const readPrices = useCallback(async () => {
    const k = stepNow();
    // Only the steps not read yet, at most the last two (one tick of every ticker each: well under 1,000 rows).
    const from = Math.max(held.current + 1, k - 1, 0);
    if (from > k) return;
    const { data } = await sb
      .from("practice_ticks")
      .select("ticker_team_id, step, price_cents")
      .eq("event_id", eventId)
      .gte("step", from)
      .lte("step", k);
    if (!data) return;
    for (const r of data as { step: number }[]) held.current = Math.max(held.current, r.step);
    const next: Record<string, { step: number; price: number }> = {};
    for (const r of data as { ticker_team_id: string; step: number; price_cents: number }[]) {
      if (!next[r.ticker_team_id] || next[r.ticker_team_id]!.step < r.step) next[r.ticker_team_id] = { step: r.step, price: r.price_cents };
    }
    setLatest((old) => ({ ...old, ...Object.fromEntries(Object.entries(next).map(([id, v]) => [id, v.price])) }));
  }, [sb, eventId, stepNow]);

  // The selected ticker's ticks: the last half hour once, then only the new ones.
  const readSeries = useCallback(
    async (id: string) => {
      const last = known.current[id];
      const from = last !== undefined ? last + 1 : Math.max(0, Math.floor(stepNow() / per) * per - WINDOW_CANDLES * per);
      const { data } = await sb
        .from("practice_ticks")
        .select("step, price_cents")
        .eq("ticker_team_id", id)
        .gte("step", from)
        .order("step")
        .limit(1000);
      if (!data || data.length === 0) return;
      const rows = data as { step: number; price_cents: number }[];
      known.current[id] = rows.at(-1)!.step;
      setSeries((old) => {
        const cur = old[id] ?? { steps: [], prices: [] };
        const s = [...cur.steps];
        const p = [...cur.prices];
        for (const r of rows) {
          if (s.length && r.step <= s.at(-1)!) continue;
          s.push(r.step);
          p.push(r.price_cents);
        }
        return { ...old, [id]: { steps: s.slice(-WINDOW_CANDLES * per - per), prices: p.slice(-WINDOW_CANDLES * per - per) } };
      });
    },
    [sb, stepNow, per],
  );

  const readAccount = useCallback(async () => {
    const [a, p, t] = await Promise.all([
      sb.from("practice_accounts").select("cash_cents").eq("team_id", teamId).maybeSingle(),
      sb.from("practice_positions").select("ticker_team_id, qty").eq("team_id", teamId),
      sb.from("practice_trades").select("id, ticker_team_id, type, qty, price_cents, created_at").eq("team_id", teamId).order("id", { ascending: false }).limit(12),
    ]);
    if (a.data) setCash(Number((a.data as { cash_cents: number | string }).cash_cents));
    if (p.data) setPositions(p.data as Position[]);
    if (t.data) setTrades(t.data as Trade[]);
  }, [sb, teamId]);

  const readOpening = useCallback(async () => {
    const { data } = await sb.from("practice_ticks").select("ticker_team_id, price_cents").eq("event_id", eventId).eq("step", 0);
    if (data) setOpening(Object.fromEntries((data as { ticker_team_id: string; price_cents: number }[]).map((r) => [r.ticker_team_id, r.price_cents])));
  }, [sb, eventId]);

  // The heartbeat: every tick (5 s) ± 1.5 s at random (the first beat also reads the opening prices and the account).
  useEffect(() => {
    offset.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const beat = async () => {
      await Promise.all([readPrices(), readSeries(selected), ...(first ? [readOpening(), readAccount()] : [])]);
      first = false;
      setStep(stepNow());
      timer = setTimeout(beat, Math.max(1000, tickMs + (Math.random() * 2 - 1) * 1500));
    };
    timer = setTimeout(beat, 0);
    return () => clearTimeout(timer);
  }, [readPrices, readSeries, readOpening, readAccount, stepNow, selected, tickMs]);

  const sel = byId.get(selected);
  const s = series[selected];
  const candles: Candle[] = useMemo(() => {
    if (!s || s.steps.length === 0) return [];
    // Align to candle boundaries (a candle is `per` ticks from a multiple of `per`).
    const firstFull = s.steps.findIndex((st) => st % per === 0);
    if (firstFull < 0) return [];
    const st = s.steps.slice(firstFull);
    const pr = s.prices.slice(firstFull);
    return candlesFromTicks(pr, per).map((c, i) => ({
      label: new Date(start + st[i * per]! * tickMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  }, [s, per, start, tickMs]);

  const posOf = (id: string) => positions.find((p) => p.ticker_team_id === id)?.qty ?? 0;
  const equity = cash + positions.reduce((sum, p) => sum + p.qty * (latest[p.ticker_team_id] ?? 0), 0);
  const shortValue = positions.reduce((sum, p) => sum + (p.qty < 0 ? -p.qty * (latest[p.ticker_team_id] ?? 0) : 0), 0);
  const free = cash - Math.ceil(shortValue * PRACTICE.shortCollateral);
  const price = latest[selected] ?? null;
  const pos = posOf(selected);
  const n = Number.parseInt(qty.replace(/[ ,]/g, ""), 10);
  const maxFor = (type: OrderType) => {
    if (!price) return 0;
    if (type === "BUY") return Math.max(0, Math.min(PRACTICE.maxLong - Math.max(pos, 0), Math.floor(free / price)));
    if (type === "SELL") return Math.max(0, pos);
    if (type === "SHORT") return Math.max(0, Math.min(PRACTICE.maxShort + Math.min(pos, 0), Math.floor(free / (price * (PRACTICE.shortCollateral - 1)))));
    return Math.max(0, -pos);
  };

  async function trade(type: OrderType) {
    if (!sel || !Number.isFinite(n) || n < 1) {
      setMessage({ ok: false, text: "Enter a number of shares." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data, error } = await sb.rpc("practice_trade", { p_ticker: selected, p_type: type, p_qty: n });
    setBusy(false);
    const r = data as { ok?: boolean; message?: string; price?: number } | null;
    if (error || !r?.ok) {
      setMessage({ ok: false, text: r?.message ?? error?.message ?? "Refused." });
    } else {
      setMessage({ ok: true, text: `${type} ${count(n)} ${sel.code} at ${money(r.price ?? 0)}.` });
      await readAccount();
    }
  }

  const left = Math.max(0, steps - 1 - step);
  const shown = tickers.filter((t) => !filter || `${t.code} ${t.name}`.toLowerCase().includes(filter.toLowerCase()));
  const profit = equity - PRACTICE.startCents;

  const selMove = price && opening[selected] ? Math.round(((price - opening[selected]!) / opening[selected]!) * 10000) : null;

  return (
    // The demo's Markets & Execution screen: the KPI strip, the market screener (one heatmap tile per company), the
    // picked company's analysis over its candles, then the execution row (ticket · account · trades blotter).
    <div className="min-w-0 space-y-4" data-testid="practice-terminal">
      <DeskStatus live={!paused && left > 0}>
        Practice trading <span aria-hidden>·</span> {left > 0 ? `${count(left)} prices left` : "closed"} <span aria-hidden>·</span> {tickers.length} companies{" "}
        <span aria-hidden>·</span> practice money only
      </DeskStatus>
      {/* The demo's KPI strip. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <DeskKpi label="Practice fund value" tag={<span className="text-[#00D68F]">LIVE</span>} value={money(equity)} foot={`Started at ${money(PRACTICE.startCents)}`} />
        <DeskKpi label="Profit" tag="NET" tone={profit > 0 ? "up" : profit < 0 ? "down" : "plain"} value={`${profit >= 0 ? "+" : "−"}${money(Math.abs(profit))}`} foot={`${trades.length} trades`} />
        <DeskKpi label="Cash" value={money(cash)} foot="Practice money" />
        <DeskKpi label="Prize" tag={`TOP ${PRACTICE.winners}`} tone="accent" value={money(PRACTICE.prizeCents)} foot="Real cash before the IPO" />
      </div>
      {paused ? <p className="rounded-md border border-[color:var(--desk-accent-line)] bg-[var(--desk-accent-soft)] px-3 py-2 text-sm text-[color:var(--desk-accent)]">The event is paused: trading is stopped.</p> : null}

      {/* Market screener */}
      <section className="bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2d2a1d] px-4 py-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[#F2F5F3]">Practice market · Round 1</h2>
              <p className="mt-1 text-xs text-[#BACBB9]" role="status">
                {shown.length} of {tickers.length} companies
              </p>
            </div>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#87948D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a company..."
              aria-label="Find a company"
              className="h-9 w-full rounded border border-[#423c28] bg-[#11110d] pr-3 pl-9 font-mono text-xs text-[#F2F5F3] placeholder:text-[#87948D]"
            />
          </div>
        </div>
        <div className="p-3 market-type @container space-y-3">
          <ul aria-label="Price change legend" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[#F2F5F3]">
            {BANDS.map(({ label, tone }) => (
              <li key={label} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-2.5 rounded-sm border ${tone}`} />
                {label}
              </li>
            ))}
          </ul>
          <ul className="grid grid-cols-2 gap-1.5 @min-[650px]:grid-cols-5 @min-[1080px]:grid-cols-10" data-testid="practice-tickers">
            {shown.map((t) => {
              const p = latest[t.id];
              const o = opening[t.id];
              const moveBp = p && o ? Math.round(((p - o) / o) * 10000) : null;
              const held = posOf(t.id);
              const on = t.id === selected;
              return (
                <li key={t.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelected(t.id)}
                    data-testid={`ticker-${t.code}`}
                    className={`flex h-full min-h-22 w-full min-w-0 cursor-pointer flex-col rounded-md border-t px-2.5 py-2 text-left text-white hover:brightness-110 focus-visible:outline-offset-2 ${bandFor(moveBp).tone} ${on ? "ring-2 ring-inset ring-[color:var(--heatmap-selection,white)]" : ""}`}
                  >
                    <span className="flex flex-wrap justify-between gap-x-2">
                      <span className="text-sm font-semibold">{t.code}</span>
                      {held ? <span className="text-xs text-white/90">{held > 0 ? `+${count(held)}` : `−${count(-held)}`}</span> : null}
                    </span>
                    <span className="w-full truncate text-xs text-white/90" title={t.name}>
                      {t.name}
                    </span>
                    <span className="mt-auto flex flex-wrap justify-between gap-x-2 pt-2 text-xs font-semibold tabular-nums">
                      <span>{p ? money(p) : "—"}</span>
                      <span>{bp(moveBp)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Instrument analysis */}
      <section aria-label="Instrument analysis" className="scroll-mt-24 rounded-lg border border-white/10 bg-[#171610] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#F2F5F3]">{sel?.code}</h2>
            <p className="text-xs text-[#BACBB9]">{sel?.name}</p>
          </div>
          <a href="#practice-ticket" className="rounded border border-[color:var(--desk-accent-line)] px-3 py-2 text-sm font-semibold text-[color:var(--desk-accent)]">
            Buy or sell {sel?.code} ↓
          </a>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <DeskFact label="Price now" value={<span data-testid="practice-price">{price ? money(price) : "—"}</span>} tone="accent" />
          <DeskFact
            label="Move since the open"
            value={selMove === null ? "—" : bp(selMove)}
            tone={selMove === null || selMove === 0 ? "muted" : selMove > 0 ? "up" : "down"}
          />
          <DeskFact label="You hold" value={pos > 0 ? `${count(pos)} long` : pos < 0 ? `${count(-pos)} short` : "None"} />
          <DeskFact label="Can buy" value={count(maxFor("BUY"))} />
          <DeskFact label="Can short" value={count(maxFor("SHORT"))} />
          <DeskFact label="Status" value={paused ? "Paused" : left > 0 ? "Live" : "Closed"} tone={!paused && left > 0 ? "up" : "muted"} />
        </dl>
        <div className="finance-candles mt-3 rounded border border-white/10 bg-[#0a141a] p-2 sm:p-3">
          <TradingChart candles={candles} label={`${sel?.code ?? ""} practice price`} testId="practice-chart" live average={5} note="30-second candles" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[#BACBB9]">
          A candle every {tickSeconds * per} s, a price every {tickSeconds} s. The practice money stays here, but the {PRACTICE.winners} funds worth the most
          when Round 1 ends each win {money(PRACTICE.prizeCents)} in real cash. Trade at least once to be ranked.
        </p>
      </section>

      {/* Execution workspace: the ticket · the account · the trades blotter */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section id="practice-ticket" className="min-w-0 scroll-mt-4 xl:col-span-4 bg-[#171610] border border-white/[0.07] rounded-lg p-5 flex flex-col gap-3 xl:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#F2F5F3]">Order ticket · {sel?.code}</h2>
            <span className="font-mono text-[11px] text-[#87948D] tabular-nums">
              Mark {price ? money(price) : "—"} · BP {money(Math.max(0, free))}
            </span>
          </div>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]" htmlFor="practice-qty">
                Shares
              </label>
              <div className="flex flex-wrap items-center gap-1">
                {[100, 500, 1000, 2000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setQty(String(v))}
                    className="px-1.5 py-0.5 font-mono text-[10px] bg-[#11110d] border border-[#2d2a1d] hover:border-[color:var(--desk-accent-line)] text-[#87948D] hover:text-[#F2F5F3] rounded-sm"
                  >
                    {count(v)}
                  </button>
                ))}
              </div>
            </div>
            <input
              id="practice-qty"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              className="w-full h-9 px-3 bg-[#11110d] border border-[#2d2a1d] focus:border-[color:var(--desk-accent)] focus:ring-1 focus:ring-[color:var(--desk-accent)] focus:outline-none rounded font-mono text-[13px] text-[#F2F5F3] tabular-nums"
            />
          </div>
          <div className="bg-[#11110d] border border-[#2d2a1d] rounded px-3 py-2 flex items-center justify-between text-xs font-mono">
            <span className="text-[#87948D]">Est. Notional</span>
            <span className="text-[#F2F5F3] font-medium tabular-nums">{price && Number.isFinite(n) && n > 0 ? money(n * price) : "—"}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 bg-[#11110d] p-1 rounded border border-[#2d2a1d]">
            {(["BUY", "SELL", "SHORT", "COVER"] as const).map((type) => (
              <button
                key={type}
                type="button"
                disabled={busy || paused || left === 0}
                onClick={() => trade(type)}
                data-testid={`practice-${type}`}
                className={`rounded-sm px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40 ${
                  type === "BUY" || type === "COVER"
                    ? "bg-[var(--desk-accent)] text-[#070909] enabled:hover:bg-[var(--desk-accent-hover)]"
                    : "bg-[#FF5364] text-[#070909] enabled:hover:bg-[#e14353]"
                }`}
              >
                {type}
                <span className="block text-[10px] font-normal normal-case tracking-normal text-[#070909]/70">max {count(maxFor(type))}</span>
              </button>
            ))}
          </div>
          {message ? (
            <p
              className={`px-3 py-2 rounded border font-mono text-[11px] ${
                message.ok
                  ? "bg-[var(--desk-accent-soft)] border-[color:var(--desk-accent-line)] text-[color:var(--desk-accent)]"
                  : "bg-[#FF5364]/10 border-[#FF5364]/40 text-[#FF5364]"
              }`}
              role="status"
              data-testid="practice-message"
            >
              {message.text}
            </p>
          ) : null}
          <p className="text-xs text-[#87948D]">
            Practice closes when Round 1 ends. Up to {count(PRACTICE.maxLong)} shares long or {count(PRACTICE.maxShort)} short per company; shorts need 150% cover.
          </p>
        </section>

        {/* The account, drawn as the demo's order book column. */}
        <section className="min-w-0 xl:col-span-4 bg-[#171610] border border-white/[0.07] rounded-lg p-4" data-testid="practice-account">
          <div className="flex items-center justify-between pb-3 border-b border-[#2d2a1d]">
            <div>
              <h2 className="text-sm font-semibold text-[#F2F5F3]">Practice account</h2>
              <span className="font-mono text-[11px] text-[#87948D]">Cash, value and positions</span>
            </div>
            <span className="font-mono text-xs text-[color:var(--desk-accent)] tabular-nums">{money(equity)}</span>
          </div>
          <dl className="mt-3 space-y-1 font-mono text-xs tabular-nums">
            <DeskRow label="Cash" value={money(cash)} />
            <DeskRow label="Fund value" value={money(equity)} />
            <DeskRow
              label="Profit"
              value={
                <span data-testid="practice-profit">
                  {profit >= 0 ? "+" : "−"}
                  {money(Math.abs(profit))}
                </span>
              }
              tone={profit >= 0 ? "up" : "down"}
            />
            <DeskRow label={`Prize if top ${PRACTICE.winners}`} value={<span data-testid="practice-prize">{money(PRACTICE.prizeCents)}</span>} tone="up" />
          </dl>
          {positions.some((p) => p.qty !== 0) ? (
            <div className="mt-3 space-y-1 font-mono text-xs tabular-nums">
              <div className="grid grid-cols-3 text-[10px] uppercase tracking-[0.08em] text-[#87948D] pb-1 border-t border-[#2d2a1d] pt-2">
                <span>Company</span>
                <span className="text-right">Position</span>
                <span className="text-right">Value</span>
              </div>
              {positions
                .filter((p) => p.qty !== 0)
                .map((p) => (
                  <div key={p.ticker_team_id} className="relative grid grid-cols-3 py-1 px-1.5 rounded-sm overflow-hidden">
                    <button type="button" className="relative text-left font-semibold text-[#F2F5F3] hover:text-[color:var(--desk-accent)]" onClick={() => setSelected(p.ticker_team_id)}>
                      {byId.get(p.ticker_team_id)?.code}
                    </button>
                    <span className={`relative text-right ${p.qty > 0 ? "text-[#00D68F]" : "text-[#FF5364]"}`}>{p.qty > 0 ? `${count(p.qty)} long` : `${count(-p.qty)} short`}</span>
                    <span className="relative text-right text-[#87948D]">{money(Math.abs(p.qty) * (latest[p.ticker_team_id] ?? 0))}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-3 pt-3 border-t border-[#2d2a1d] font-mono text-xs text-[#87948D]">No practice positions yet.</p>
          )}
        </section>

        {/* The demo's order blotter, holding the fund's practice trades. */}
        <section className="min-w-0 xl:col-span-4 bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#2d2a1d] flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#F2F5F3]">Order Blotter</h2>
            <span className="px-2.5 py-1 rounded-sm font-mono text-[11px] whitespace-nowrap bg-[#201e14] text-[color:var(--desk-accent)] border border-[color:var(--desk-accent-line)]">
              All ({trades.length})
            </span>
          </div>
          {trades.length === 0 ? (
            <div className="p-6 text-center font-mono text-xs text-[#87948D]">No practice trades yet.</div>
          ) : (
            <ul className="divide-y divide-[#1B2420] overflow-y-auto max-h-[380px]" data-testid="practice-trades">
              {trades.map((t) => (
                <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#201e14]/60">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className={`font-semibold ${t.type === "BUY" || t.type === "COVER" ? "text-[#00D68F]" : "text-[#FF5364]"}`}>
                        {t.type} {count(t.qty)}
                      </span>
                      <span className="font-semibold text-[#F2F5F3]">{byId.get(t.ticker_team_id)?.code}</span>
                    </div>
                    <div className="font-mono text-[11px] text-[#87948D] mt-0.5 tabular-nums">
                      @ {money(t.price_cents)} · {new Date(t.created_at).toLocaleTimeString("en-GB")}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-sm border bg-[#00D68F]/10 border-[color:var(--desk-accent-line)] text-[#00D68F]">
                    Filled
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
