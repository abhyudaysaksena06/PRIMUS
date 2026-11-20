import type { Metadata } from "next";
import { phaseReached, PRACTICE } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { ensurePracticeMarket, loadPracticeMarket, practiceResults, practiceTickers } from "@/lib/team/practice";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, money } from "@/lib/format";
import { featureOn } from "@/lib/event-status";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice } from "@/components/ui/ui";
import { DeskKpi, DeskPanel, DeskStatus, DeskTable, DeskTd, deskTr } from "../desk-ui";
import { tradeGate } from "../gate";
import { PracticeTerminal } from "./terminal";

export const metadata: Metadata = { title: "Practice market" };

// Round 1 for the Finance teams: a practice market named after the Product teams, trading on candlestick charts while
// the PRDs are written. Before Round 1 it says when it opens; during Round 1 it is the trading terminal; after it,
// each fund's result and which funds won a prize.
export default async function PracticePage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const { status, event } = ctx;
  const start = money(PRACTICE.startCents);
  // Switch practice_verified (migration 076): one simulated company per checked-in Finance team, prepared by the
  // organisers; a page load never stores the market. Off: named after the Product teams, opened by the first page.
  const simulated = featureOn(status, "practice_verified", false);

  if (!phaseReached(status.phase, "BUILD")) {
    const sb = await supabaseServer();
    const { data } = await sb.from("phases").select("starts_at").eq("event_id", event.id).eq("code", "BUILD").maybeSingle<{ starts_at: string }>();
    return (
      <DeskPanel title="Practice market">
        <p className="text-sm text-paper" data-testid="practice-notice">
          The practice market opens with Round 1{data ? ` at ${clock(data.starts_at)}` : ""}. You get {start} of practice money to trade
          candlestick charts {simulated ? "of simulated companies, one per Finance team" : "named after the Product teams"}. It is practice only, to learn the desk:
          nothing from it carries into the real game. Trade at least once to be ranked.
        </p>
      </DeskPanel>
    );
  }

  const market =
    status.phase === "BUILD" && !simulated ? await ensurePracticeMarket(event.id, await practiceTickers(event.id)) : await loadPracticeMarket(event.id);
  const tickers = market?.companies ?? (market ? await practiceTickers(event.id) : []);

  if (status.phase !== "BUILD" || market?.settledAt) {
    const results = await practiceResults(event.id);
    const mine = results.find((r) => r.code === ctx.team.code);
    return (
      <div className="space-y-4">
        <DeskStatus>
          Practice market closed <span aria-hidden>·</span> {results.length} {results.length === 1 ? "fund" : "funds"} ranked <span aria-hidden>·</span> practice only
        </DeskStatus>
        {mine ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <DeskKpi label="Practice fund" tag="CLOSED" value={money(mine.equity)} foot={`${mine.trades} trades · started at ${start}`} />
            <DeskKpi
              label="Rank"
              tag={mine.rank !== null ? <span className="text-[#00D68F]">TOP {PRACTICE.winners}</span> : "UNRANKED"}
              tone={mine.rank !== null ? "accent" : "plain"}
              value={mine.rank !== null ? `#${mine.rank}` : "—"}
              foot="Practice ranking"
            />
            <DeskKpi label="Real-game effect" tag="PRACTICE" tone="plain" value="None" foot="The practice money stays here" />
          </div>
        ) : null}
        <DeskPanel title="Practice market: closed" sub="Final standings" bodyClassName="p-0">
          {mine ? (
            <p className="px-4 py-3 text-sm text-[#BACBB9]" data-testid="practice-result">
              Your practice fund finished at <b className="font-mono text-[#F2F5F3]">{money(mine.equity)}</b> ({mine.trades} trades).{" "}
              {mine.rank !== null ? (
                <>
                  You placed <b className="text-[color:var(--desk-accent)]">#{mine.rank}</b> in the practice ranking.
                </>
              ) : (
                <>Trade at least once to be ranked; the practice money stays in the practice market.</>
              )}
            </p>
          ) : (
            <p className="px-4 py-3 text-sm text-[#BACBB9]" data-testid="practice-result">
              {market ? "Your fund did not trade in the practice market." : "There was no practice market in this event."}
            </p>
          )}
          {results.length > 0 ? (
            <div className="border-t border-[#2d2a1d]" data-testid="practice-leaderboard">
              <DeskTable head={["#", "Fund", "Practice result", "Prize"]} label="Practice leaderboard" right={[2, 3]}>
                {results.slice(0, 15).map((r, i) => (
                  <tr key={r.code} className={r.code === ctx.team.code ? "border-b border-[#2d2a1d]/70 bg-[#201e14]" : deskTr}>
                    <DeskTd edge className={r.code === ctx.team.code ? "text-[color:var(--desk-accent)]" : "text-[#87948D]"}>
                      {i + 1}
                    </DeskTd>
                    <DeskTd className={r.code === ctx.team.code ? "font-semibold text-[color:var(--desk-accent)]" : "font-semibold"}>
                      {r.code} <span className="font-sans text-xs font-normal text-[#87948D]">{r.name}</span>
                    </DeskTd>
                    <DeskTd right>{money(r.equity)}</DeskTd>
                    <DeskTd edge right className={r.edge > 0 ? "text-[#00D68F]" : "text-[#87948D]"}>
                      {r.edge > 0 ? `+${money(r.edge)}` : "—"}
                    </DeskTd>
                  </tr>
                ))}
              </DeskTable>
            </div>
          ) : null}
        </DeskPanel>
      </div>
    );
  }

  if (!market && simulated) {
    // Read again every 15 to 25 seconds (spread out, so the funds do not all reload at once) until it is prepared.
    return (
      <DeskPanel title="Practice market">
        <p className="text-sm text-paper" data-testid="practice-notice">
          The practice market opens in a moment: the organisers are preparing it. This page opens it by itself.
        </p>
        <RefreshAt at={new Date(new Date(status.server_time).getTime() + 15_000).toISOString()} afterMs={0} spreadMs={10_000} />
      </DeskPanel>
    );
  }
  if (!market) {
    return <Notice tone="amber">The practice market could not open. Ask the organisers.</Notice>;
  }

  return (
    <PracticeTerminal
      eventId={event.id}
      teamId={ctx.team.id}
      tickers={tickers}
      startsAt={market.startsAt}
      tickSeconds={market.tickSeconds}
      steps={market.steps}
      serverNow={status.server_time}
      initialStep={Math.max(0, Math.floor((new Date(status.server_time).getTime() - new Date(market.startsAt).getTime()) / (market.tickSeconds * 1000)))}
      paused={status.paused}
    />
  );
}
