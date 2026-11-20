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
import { count, money } from "@/lib/format";
import { TradingChart } from "@/components/ui/trading-chart";
import type { PracticeTicker } from "@/lib/team/practice";

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

  return (
    // Laptop screens: the desk frame (the trading layout) already uses the window's width. A phone stacks the panels.
    <div className="min-w-0 space-y-3" data-testid="practice-terminal">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-base font-semibold text-[#F2F5F3]">Practice market · Round 1</h1>
        <p className="text-xs text-[#BACBB9]">
          A candle every {tickSeconds * per} s, a price every {tickSeconds} s. The practice money stays here, but the {PRACTICE.winners} funds worth the most
          when Round 1 ends each win {money(PRACTICE.prizeCents)} in real cash. Trade at least once to be ranked.
        </p>
      </div>
      {paused ? <p className="rounded-md border border-[color:var(--desk-accent-line)] bg-[var(--desk-accent-soft)] px-3 py-2 text-sm text-[color:var(--desk-accent)]">The event is paused: trading is stopped.</p> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* Tickers */}
        <section className="flex max-h-[320px] min-w-0 flex-col overflow-hidden rounded-lg border border-white/[0.07] bg-[#171610] md:max-h-[720px]">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a company"
            aria-label="Find a company"
            className="m-2 h-9 rounded border px-2.5 font-mono text-xs"
          />
          <ul className="flex-1 overflow-y-auto text-sm" data-testid="practice-tickers">
            {shown.map((t) => {
              const p = latest[t.id];
              const o = opening[t.id];
              const ch = p && o ? ((p - o) / o) * 100 : 0;
              const held = posOf(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    data-testid={`ticker-${t.code}`}
                    className={`flex w-full items-center justify-between gap-2 border-l-2 px-3 py-1.5 text-left hover:bg-[#201e14]/70 ${t.id === selected ? "border-[color:var(--desk-accent)] bg-[#201e14] text-[color:var(--desk-accent)]" : "border-transparent text-[#F2F5F3]"}`}
                  >
                    <span className="min-w-0">
                      <span className="font-mono font-semibold">{t.code}</span>
                      {held ? <span className={`ml-1 text-xs ${held > 0 ? "text-phosphor" : "text-warn"}`}>{held > 0 ? `+${held}` : held}</span> : null}
                      <span className="block truncate text-xs text-muted">{t.name}</span>
                    </span>
                    <span className="text-right font-mono text-xs">
                      {p ? money(p) : "—"}
                      <span className={`block ${ch > 0 ? "text-phosphor" : ch < 0 ? "text-danger-soft" : "text-muted"}`}>
                        {ch >= 0 ? "+" : ""}
                        {ch.toFixed(1)}%
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Chart */}
        <section className="min-w-0 rounded-lg border border-white/10 bg-[#171610] p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-mono text-base font-semibold text-paper">
              {sel?.code} <span className="text-sm font-normal text-muted">{sel?.name}</span>
            </h2>
            <span className="font-mono text-lg font-semibold text-[color:var(--desk-accent)]" data-testid="practice-price">
              {price ? money(price) : "—"}
            </span>
          </div>
          <div className="fin-candles rounded border border-white/10 bg-[#0a141a] p-2 sm:p-3">
            <TradingChart candles={candles} label={`${sel?.code ?? ""} practice price`} testId="practice-chart" live average={5} note="30-second candles" />
          </div>
        </section>

        {/* Order panel and account */}
        <section className="min-w-0 space-y-3 md:col-span-2 xl:col-span-1">
          <div className="rounded-lg border border-white/[0.07] bg-[#171610] p-4">
            <h2 className="mb-2 text-sm font-semibold text-paper">
              Trade {sel?.code} <span className="font-normal text-muted">· you hold {pos > 0 ? `${count(pos)} long` : pos < 0 ? `${count(-pos)} short` : "none"}</span>
            </h2>
            <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]" htmlFor="practice-qty">
              Shares
            </label>
            <input
              id="practice-qty"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              className="mt-1 h-9 w-full rounded border px-3 font-mono text-[13px]"
            />
            <div className="mt-2 flex gap-1 text-xs">
              {[100, 500, 1000, 2000].map((v) => (
                <button key={v} type="button" onClick={() => setQty(String(v))} className="rounded-sm border border-[#2d2a1d] bg-[#11110d] px-2 py-1 font-mono text-[#BACBB9] hover:border-[color:var(--desk-accent-line)] hover:text-[#F2F5F3]">
                  {count(v)}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["BUY", "SELL", "SHORT", "COVER"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={busy || paused || left === 0}
                  onClick={() => trade(type)}
                  data-testid={`practice-${type}`}
                  className={`rounded px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider ring-1 ring-inset transition-colors disabled:opacity-40 ${
                    type === "BUY" || type === "COVER"
                      ? "bg-[#00D68F]/10 text-[#00D68F] ring-[#00D68F]/50 hover:bg-[#00D68F]/20"
                      : "bg-[#FF5364]/10 text-[#FF5364] ring-[#FF5364]/50 hover:bg-[#FF5364]/20"
                  }`}
                >
                  {type}
                  <span className="block text-[10px] font-normal normal-case tracking-normal text-[#87948D]">max {count(maxFor(type))}</span>
                </button>
              ))}
            </div>
            {message ? (
              <p className={`mt-2 text-xs ${message.ok ? "text-phosphor" : "text-danger-soft"}`} role="status" data-testid="practice-message">
                {message.text}
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-white/[0.07] bg-[#171610] p-4 text-sm" data-testid="practice-account">
            <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
              <dt className="text-muted">Cash</dt>
              <dd className="text-right">{money(cash)}</dd>
              <dt className="text-muted">Fund value</dt>
              <dd className="text-right text-paper">{money(equity)}</dd>
              <dt className="text-muted">Profit</dt>
              <dd className={`text-right ${profit >= 0 ? "text-phosphor" : "text-danger-soft"}`} data-testid="practice-profit">
                {profit >= 0 ? "+" : "−"}
                {money(Math.abs(profit))}
              </dd>
              <dt className="text-muted">Prize if top {PRACTICE.winners}</dt>
              <dd className="text-right text-phosphor" data-testid="practice-prize">
                {money(PRACTICE.prizeCents)}
              </dd>
            </dl>
            {positions.some((p) => p.qty !== 0) ? (
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {positions
                    .filter((p) => p.qty !== 0)
                    .map((p) => (
                      <tr key={p.ticker_team_id}>
                        <td>
                          <button type="button" className="font-mono hover:text-phosphor" onClick={() => setSelected(p.ticker_team_id)}>
                            {byId.get(p.ticker_team_id)?.code}
                          </button>
                        </td>
                        <td className={`text-right font-mono ${p.qty > 0 ? "text-phosphor" : "text-warn"}`}>{p.qty > 0 ? `${count(p.qty)} long` : `${count(-p.qty)} short`}</td>
                        <td className="text-right font-mono">{money(Math.abs(p.qty) * (latest[p.ticker_team_id] ?? 0))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : null}
          </div>

          {trades.length > 0 ? (
            <div className="rounded-lg border border-white/[0.07] bg-[#171610] p-4">
              <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">Your trades</h3>
              <ul className="space-y-0.5 font-mono text-xs" data-testid="practice-trades">
                {trades.map((t) => (
                  <li key={t.id}>
                    {new Date(t.created_at).toLocaleTimeString("en-GB")} {t.type} {count(t.qty)} {byId.get(t.ticker_team_id)?.code} @ {money(t.price_cents)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted">
            Practice closes when Round 1 ends. Up to {count(PRACTICE.maxLong)} shares long or{" "}
            {count(PRACTICE.maxShort)} short per company; shorts need 150% cover.
          </p>
        </section>
      </div>
    </div>
  );
}
