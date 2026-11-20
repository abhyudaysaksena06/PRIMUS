// The Round 3 draft on the big screen, while it runs: whose pick it is (with its 20 seconds), every statement with the
// companies on it, and the picks still to come. Public data only (tickers, never team names). It replaces the board,
// and any results screen still showing, until every company has its statement. Picks go to the staff channel only,
// so the board re-reads itself every 3 s; with one queue per sector (draft_clock) it shows a column per sector.
// Migration 088: in each sector only the 10 lowest-scoring companies pick, each statement once; the others are given a
// statement at random, spread evenly, when their sector's pickers are done.

import { Countdown } from "@/components/ui/countdown";
import { DRAFT_POLL_MS, parseDraftHeads, sameSector, type DraftHead } from "@/lib/display/draft";
import { DRAFT_RULE } from "@/lib/team/crisis";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { supabaseServer } from "@/lib/supabase/server";
import { TakeoverFrame } from "./takeovers/frame";

interface Pick {
  company_id: string;
  pick_no: number;
  opens_at: string;
  closes_at: string;
  statement_id: string | null;
  by_default: boolean;
}

export interface DraftBoardData {
  /** With one queue per sector: the company on the clock in each sector (empty: a single queue). */
  heads: DraftHead[];
  picks: Pick[];
  statements: { id: string; number: number; title: string; cap: number; sector: string | null }[];
  tickers: Map<string, string>;
  /** Each company's sector (an event split across sectors), by company id. */
  sectors: Map<string, string>;
}

/** The draft, when one is under way in this event (some company still to pick); null otherwise. */
export async function loadLiveDraft(eventId: string): Promise<DraftBoardData | null> {
  const sb = await supabaseServer();
  const { data: picks } = await sb
    .from("draft_picks")
    .select("company_id, pick_no, opens_at, closes_at, statement_id, by_default")
    .eq("event_id", eventId)
    .order("pick_no");
  const rows = (picks ?? []) as Pick[];
  if (rows.length === 0 || rows.every((p) => p.statement_id !== null)) return null;
  const [st, co, sec, clock] = await Promise.all([
    sb.from("problem_statements").select("id, number, title, cap, sector").eq("event_id", eventId).order("number"),
    sb.from("companies").select("id, ticker").eq("event_id", eventId),
    // The display account may not read the squads' problem cards: the draft's sectors come from draft_sectors.
    sb.rpc("draft_sectors", { p_event: eventId }),
    // One queue per sector (migration 077): who is on the clock in each. Missing or failing: the single queue.
    sb.rpc("draft_clock", { p_event: eventId }),
  ]);
  const companies = (co.data ?? []) as { id: string; ticker: string | null }[];
  return {
    heads: clock.error ? [] : parseDraftHeads(clock.data),
    picks: rows,
    statements: (st.data ?? []) as DraftBoardData["statements"],
    tickers: new Map(companies.map((c) => [c.id, c.ticker ?? "—"])),
    sectors: new Map(((sec.data ?? []) as { company_id: string; sector: string }[]).map((r) => [r.company_id, r.sector])),
  };
}

export function DraftBoard({ data }: { data: DraftBoardData }) {
  // Picks reach only the staff channel: the projector re-reads the draft every 3 s while it runs.
  const poll = <AutoRefresh everyMs={DRAFT_POLL_MS} />;
  return data.heads.length > 1 ? (
    <>
      {poll}
      <SectorDraftBoard data={data} />
    </>
  ) : (
    <>
      {poll}
      <QueueDraftBoard data={data} />
    </>
  );
}

/** One queue per sector, all at once: a column per sector with its company on the clock and its statements. */
function SectorDraftBoard({ data }: { data: DraftBoardData }) {
  const left = data.picks.filter((p) => p.statement_id === null).length;
  return (
    <TakeoverFrame title="Round 3 · the draft" at={data.picks[0]!.opens_at} until={null} tone="bg-[var(--term-amber,#ffa028)] text-ink">
      <div className="flex h-full flex-col gap-5" data-testid="display-draft">
        <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: `repeat(${data.heads.length}, minmax(0, 1fr))` }}>
          {data.heads.map((h) => {
            const statements = data.statements.filter((s) => sameSector(s.sector, h.sector));
            return (
              <section key={h.sector} className="guide-panel flex min-h-0 flex-col gap-3 p-4" data-testid={`display-draft-sector-${h.sector}`}>
                <p className="truncate text-[30px] font-bold uppercase tracking-widest text-warn">{h.sector}</p>
                {h.place && h.queue ? (
                  <p className="truncate text-[22px] text-muted">
                    Pick {h.place} of {h.queue}
                    {h.others ? ` · then ${h.others} given a statement at random` : ""}
                  </p>
                ) : null}
                <div className="flex items-end justify-between gap-4 border-b-4 border-phosphor-dim pb-2">
                  <p className="text-[72px] font-black leading-none text-phosphor">{h.ticker}</p>
                  <p className="font-mono text-[64px] font-black leading-none tabular-nums text-warn">
                    <Countdown to={h.closes_at} passed="0:00" />
                  </p>
                </div>
                <ul className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
                  {statements.map((s) => {
                    const on = data.picks.filter((p) => p.statement_id === s.id);
                    // Each statement once among the pickers: a picked statement is taken while the sector still picks.
                    const taken = on.length >= 1;
                    return (
                      <li key={s.id} className="flex items-baseline gap-3 text-[24px] leading-tight" data-testid={`display-statement-${s.number}`}>
                        <span className="font-mono font-bold text-warn">#{s.number}</span>
                        <span className="min-w-0 flex-1 truncate text-paper">{s.title}</span>
                        <span className={`font-mono font-bold ${taken ? "text-danger" : "text-muted"}`}>
                          {taken ? `TAKEN · ${data.tickers.get(on[0]!.company_id) ?? ""}` : "open"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="shrink-0 text-[26px] text-paper" data-testid="display-draft-rule">
          {DRAFT_RULE}
        </p>
        <p className="shrink-0 text-[30px] text-muted">
          {data.picks.length - left} of {data.picks.length} have a statement · {left} still to come
        </p>
      </div>
    </TakeoverFrame>
  );
}

/** A single queue: whose pick it is, the statements of its sector with the companies on them, the picks to come. */
function QueueDraftBoard({ data }: { data: DraftBoardData }) {
  const current = data.picks.find((p) => p.statement_id === null)!;
  const left = data.picks.filter((p) => p.statement_id === null);
  const done = data.picks.length - left.length;
  // Split across sectors: the room sees the statements of the sector whose company is on the clock.
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const sector = data.statements.some((s) => s.sector) ? (data.sectors.get(current.company_id) ?? "") : "";
  const shown = sector ? data.statements.filter((s) => norm(s.sector) === norm(sector)) : data.statements;
  return (
    <TakeoverFrame title="Round 3 · the draft" at={data.picks[0]!.opens_at} until={null} tone="bg-[var(--term-amber,#ffa028)] text-ink">
      <div className="flex h-full flex-col gap-6" data-testid="display-draft">
        <div className="flex shrink-0 items-end justify-between gap-10">
          <div>
            <p className="text-[32px] font-bold uppercase tracking-widest text-muted">
              On the clock · pick {current.pick_no} of {data.picks.length}
              {sector ? <span className="text-warn"> · {sector}</span> : null}
            </p>
            <p className="text-[110px] font-black leading-none text-phosphor" data-testid="display-draft-current">
              {data.tickers.get(current.company_id)}
            </p>
          </div>
          <p className="text-right font-mono text-[120px] font-black leading-none tabular-nums text-warn">
            <Countdown to={current.closes_at} passed="0:00" />
          </p>
        </div>
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-5 overflow-hidden">
          {shown.map((s) => {
            const on = data.picks.filter((p) => p.statement_id === s.id);
            const full = on.length >= s.cap;
            return (
              <li key={s.id} className={`guide-panel px-4 py-2.5 ${full ? "!border-danger" : ""}`} data-testid={`display-statement-${s.number}`}>
                <p className="flex items-baseline gap-4 text-[30px] font-bold leading-tight">
                  <span className="font-mono text-warn">#{s.number}</span>
                  <span className="min-w-0 flex-1 truncate text-paper">{s.title}</span>

                  <span className={`font-mono text-[28px] ${full ? "text-danger" : "text-muted"}`}>
                    {on.length}/{s.cap}
                  </span>
                </p>
                <p className="mt-1.5 flex min-h-[40px] flex-wrap gap-3">
                  {on.map((p) => (
                    <span key={p.company_id} className={`px-3 py-1 font-mono text-[28px] font-bold ${p.by_default ? "bg-raised text-muted" : "bg-phosphor text-ink"}`}>
                      {data.tickers.get(p.company_id)}
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="shrink-0 truncate text-[30px] text-muted">
          {done} picked · still to pick: <span className="font-mono text-paper">{left.map((p) => data.tickers.get(p.company_id)).join("  ")}</span>
        </p>
      </div>
    </TakeoverFrame>
  );
}
