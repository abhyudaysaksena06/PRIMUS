// The news ticker along the bottom of the price board (public data only; see lib/display/ticker.ts). Its speed is set
// by its length, so every item stays on screen long enough to read from the back of the hall.

import type { DeadlineCode } from "@msim/engine";
import { featureOn, type EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";
import { parseLeaderboard } from "@/lib/display/leaderboard";
import { primusStep, tickerItems, type TickerItem } from "@/lib/display/ticker";
import { clock } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

export async function NewsTicker({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  // The belt runs in every phase (the organisers want it moving on every screen); before there is news it carries the
  // event's own line.
  const sb = await supabaseServer();
  const [round, bulletins, deals, companies, deadlines] = await Promise.all([
    sb
      .from("rounds")
      .select("number, round_prices(market_before, market_after, companies(ticker))")
      .eq("event_id", event.id)
      .eq("status", "CLEARED")
      .eq("round_prices.kind", "CLEARING")
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle<{ number: number; round_prices: { market_before: number | null; market_after: number; companies: { ticker: string | null } | null }[] }>(),
    sb.from("bulletins").select("kind, title").eq("event_id", event.id).not("published_at", "is", null).order("published_at", { ascending: false }).limit(3),
    sb.from("public_ledger").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("kind", "DEAL"),
    sb.from("companies").select("id", { count: "exact", head: true }).eq("event_id", event.id),
    sb.from("deadlines").select("code, at").eq("event_id", event.id),
  ]);
  for (const r of [round, bulletins, deals, companies, deadlines]) if (r.error) throw new Error(`Could not read the ticker: ${r.error.message}`);
  const nowMs = Date.parse(status.server_time);
  const schedule = (deadlines.data ?? []) as { code: DeadlineCode; at: string }[];
  const primus = event.format === "PRIMUS";
  // PRIMUS extras: a failed read leaves its item out, never the ticker.
  const step = primus ? primusStep(schedule, nowMs, (iso) => clock(iso)) : null;
  const [hired, board] = await Promise.all([
    step?.code.startsWith("HIRE_")
      ? sb.from("engagements").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("k", step.k)
      : null,
    primus && featureOn(status, "leaderboard", true) ? sb.rpc("leaderboard", { p_event: event.id }) : null,
  ]);
  const found = tickerItems({
    format: event.format,
    hiring: hired && !hired.error ? { hired: hired.count ?? 0, companies: companies.count ?? 0 } : null,
    leaders: board && !board.error ? parseLeaderboard(board.data).slice(0, 3) : null,
    phase: status.phase,
    nowMs,
    lastRound: round.data
      ? {
          number: round.data.number,
          moves: round.data.round_prices
            .filter((p) => p.companies?.ticker && p.market_before !== null)
            .map((p) => ({ ticker: p.companies!.ticker!, before: Number(p.market_before), after: Number(p.market_after) })),
        }
      : null,
    bulletins: (bulletins.data ?? []) as { kind: string; title: string }[],
    dealsSigned: deals.count ?? 0,
    squads: companies.count ?? 0,
    deadlines: schedule,
    clock: (iso) => clock(iso),
  });
  // Nothing to report yet (before the night starts): the belt still runs, with the event's own line.
  const items: TickerItem[] = found.length
    ? found
    : [{ key: "welcome", tag: "PRIMUS ’26", text: `${event.name} · where every decision connects · news appears here as it is published`, tone: "info" }];
  const seconds = Math.max(30, Math.round(items.reduce((n, it) => n + it.tag.length + it.text.length, 0) / 6));
  // The demo's event-news belt (app/demo/event-news-ticker.tsx): a label, then two copies of the headlines looping.
  return (
    <div className="event-news-ticker shrink-0" role="marquee" aria-label="News ticker" data-testid="news-ticker">
      <span className="event-news-label" aria-hidden>
        Event news
      </span>
      <div className="event-news-window">
        <span className="event-news-belt" style={{ animationDuration: `${seconds}s` }}>
          {[0, 1].map((copy) => (
            <span className="event-news-set" key={copy} aria-hidden={copy === 1 ? true : undefined}>
              {items.map((it) => (
                <span className="event-news-headline" key={it.key} data-tone={it.tone}>
                  <strong>{it.tag}</strong>
                  <span>{it.text}</span>
                </span>
              ))}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
