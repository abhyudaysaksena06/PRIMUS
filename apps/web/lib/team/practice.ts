// The Round 1 practice market (migration 58): the tickers, the market's clock, and preparing it.
//
// Switch practice_verified (migration 76, on by default): one simulated company per checked-in Finance team, its name
// and ticker fixed in the database when an organiser prepares the market (the Run page's button), and the price
// paths (packages/engine candles.ts) stored in chunks by that organiser. A page load never stores anything.
// Switch off (as before): the tickers are the event's Product teams, and the first Finance page read in Round 1
// stores the paths with the service role (idempotent and deterministic, so two pages racing store the same thing).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { candleTicks, practiceCandles, PRACTICE } from "@msim/engine";
import { supabaseService } from "@/lib/supabase/service";
import { admittedOnly, deskCheckInOn } from "@/lib/admin/admitted";

export interface PracticeTicker {
  /** The key of the ticker's prices (practice_ticks.ticker_team_id). */
  id: string;
  /** What the screens show: a simulated ticker (or, with the switch off, the Product team's code). */
  code: string;
  name: string;
}

export interface PracticeMarket {
  startsAt: string;
  tickSeconds: number;
  steps: number;
  settledAt: string | null;
  /** The simulated companies, or null for a market prepared the old way (one ticker per Product team). */
  companies: PracticeTicker[] | null;
}

export interface PracticeResult {
  code: string;
  name: string;
  equity: number;
  /** 1..PRACTICE.winners for a prize winner, else null. */
  rank: number | null;
  /** The prize won, in cents (0 for everyone but the winners). */
  edge: number;
  trades: number;
}

interface MarketRow {
  starts_at: string;
  tick_seconds: number;
  steps: number;
  settled_at: string | null;
  companies: { id: string; ticker: string; name: string }[] | null;
}

/** The ticks every ticker gets: PRACTICE.candles candles of PRACTICE.candleTicks ticks. */
export const PRACTICE_STEPS = PRACTICE.candles * PRACTICE.candleTicks;

/** The seed of a simulated company's price path: fixed by the event and the ticker, so a retry stores the same path. */
export const practicePathKey = (eventId: string, ticker: string) => `${eventId}:practice:${ticker}`;

/** One company's price path, in cents, one price per tick. */
export const practicePath = (key: string) => practiceCandles(key).flatMap((c) => candleTicks(c));

const asTickers = (companies: MarketRow["companies"]): PracticeTicker[] | null =>
  Array.isArray(companies) ? companies.map((c) => ({ id: c.id, code: c.ticker, name: c.name })) : null;

export async function loadPracticeMarket(eventId: string): Promise<PracticeMarket | null> {
  const { data, error } = await supabaseService()
    .from("practice_markets")
    .select("starts_at, tick_seconds, steps, settled_at, companies")
    .eq("event_id", eventId)
    .maybeSingle<MarketRow>();
  if (error) throw new Error(`Could not read the practice market: ${error.message}`);
  return data
    ? { startsAt: data.starts_at, tickSeconds: data.tick_seconds, steps: data.steps, settledAt: data.settled_at, companies: asTickers(data.companies) }
    : null;
}

/** The tickers: the market's simulated companies once prepared; otherwise the event's Product teams (the old way). */
export async function practiceTickers(eventId: string): Promise<PracticeTicker[]> {
  const market = await loadPracticeMarket(eventId);
  if (market?.companies) return market.companies;
  const sb = supabaseService();
  const [{ data, error }, deskOn] = await Promise.all([
    sb.from("teams").select("id, code, name, checked_in_at").eq("event_id", eventId).eq("track", "PRODUCT").order("code").range(0, 999),
    deskCheckInOn(sb, eventId),
  ]);
  if (error) throw new Error(`Could not read the practice companies: ${error.message}`);
  // With desk check-in on, only the Product teams the desk has checked in (lib/admin/admitted.ts).
  return admittedOnly((data ?? []) as (PracticeTicker & { checked_in_at: string | null })[], deskOn).map(({ id, code, name }) => ({ id, code, name }));
}

/** Switch off only: stores the price paths if Round 1 has started and they are not there yet; returns the market. */
export async function ensurePracticeMarket(eventId: string, tickers: readonly PracticeTicker[]): Promise<PracticeMarket | null> {
  const existing = await loadPracticeMarket(eventId);
  if (existing || tickers.length === 0) return existing;
  const sb = supabaseService();
  const { data: phase } = await sb
    .from("phases")
    .select("started_at, starts_at")
    .eq("event_id", eventId)
    .eq("code", "BUILD")
    .maybeSingle<{ started_at: string | null; starts_at: string }>();
  const start = phase?.started_at ?? new Date().toISOString();
  const rows = tickers.map((t) => ({ ticker: t.id, prices: practicePath(`${eventId}:${t.code}`) }));
  const { data, error } = await sb.rpc("practice_prepare", { p_event: eventId, p_starts_at: start, p_tick_seconds: PRACTICE.tickSeconds, p_rows: rows });
  const r = data as { ok?: boolean; message?: string } | null;
  if (error || !r?.ok) throw new Error(`Could not open the practice market: ${error?.message ?? r?.message ?? "refused"}`);
  // Not read back: the same read in the same render is memoised (it would return the empty answer from above). If
  // another page opened it first ("already"), its start is the same Round 1 start, so this is the same market.
  return { startsAt: start, tickSeconds: PRACTICE.tickSeconds, steps: rows[0]!.prices.length, settledAt: null, companies: null };
}

export interface PrepareOutcome {
  ok: boolean;
  code?: string;
  message: string;
  companies: number;
  loaded: number;
  ready: boolean;
}

interface PrepareState {
  ok?: boolean;
  code?: string;
  message?: string;
  companies?: number;
  loaded?: number;
  ready?: boolean;
  list?: { id: string; ticker: string; name: string }[];
  missing?: string[];
}

/**
 * Switch on: prepares the market as the signed-in organiser (`sb` is their client): fixes the companies, then stores
 * the paths `chunk` companies per call until all are stored or `budgetMs` has passed (calling again finishes it).
 */
export async function preparePracticeMarket(sb: SupabaseClient, eventId: string, { chunk = 20, budgetMs = 20_000 } = {}): Promise<PrepareOutcome> {
  const call = async (rows: { ticker: string; prices: number[] }[]): Promise<PrepareState> => {
    const { data, error } = await sb.rpc("prepare_practice_market", {
      p_event: eventId,
      p_tick_seconds: PRACTICE.tickSeconds,
      p_steps: PRACTICE_STEPS,
      p_rows: rows,
    });
    if (error) return { ok: false, code: "ERROR", message: error.message };
    return (data ?? { ok: false, message: "No answer." }) as PrepareState;
  };
  const started = Date.now();
  let r = await call([]);
  const tickerOf = new Map((r.list ?? []).map((c) => [c.id, c.ticker]));
  while (r.ok && (r.missing?.length ?? 0) > 0 && Date.now() - started < budgetMs) {
    const ids = r.missing!.slice(0, chunk);
    r = await call(ids.map((id) => ({ ticker: id, prices: practicePath(practicePathKey(eventId, tickerOf.get(id) ?? id)) })));
  }
  const companies = r.companies ?? 0;
  const loaded = r.loaded ?? 0;
  if (!r.ok) return { ok: false, code: r.code, message: r.message ?? "Refused.", companies, loaded, ready: false };
  return {
    ok: true,
    companies,
    loaded,
    ready: r.ready === true,
    message: r.ready
      ? `The practice market is ready: ${companies} companies, one per Finance team.`
      : `${loaded} of ${companies} companies loaded. Press again to finish.`,
  };
}

/** Every fund's practice result once the market has closed, best first. */
export async function practiceResults(eventId: string): Promise<PracticeResult[]> {
  const { data } = await supabaseService()
    .from("practice_accounts")
    .select("equity_cents, rank, edge_cents, trades, teams!inner(code, name)")
    .eq("event_id", eventId)
    .not("equity_cents", "is", null)
    .order("equity_cents", { ascending: false })
    .range(0, 999);
  return (
    (data ?? []) as unknown as { equity_cents: number; rank: number | null; edge_cents: number; trades: number; teams: { code: string; name: string } }[]
  ).map((r) => ({
    code: r.teams.code,
    name: r.teams.name,
    equity: Number(r.equity_cents),
    rank: r.rank,
    edge: Number(r.edge_cents ?? 0),
    trades: r.trades,
  }));
}
