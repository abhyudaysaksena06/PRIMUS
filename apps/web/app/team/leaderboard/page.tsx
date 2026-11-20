import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { featureOn } from "@/lib/event-status";
import { supabaseServer } from "@/lib/supabase/server";
import { LEADERBOARD_CLOSED, leaderboardOpen, loadLeaderboard, moveText } from "@/lib/team/leaderboard";
import { count } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { GuideMetric, GuidePageTitle, GuidePanel } from "@/components/guide/guide";

export const metadata: Metadata = { title: "Leaderboard" };

// The live leaderboard (switch `leaderboard`): every company's PRIMUS Rating (from 1,000; each released score moves
// it), its rank and its move at the last release. The page re-reads every 30 seconds and on every broadcast.
export default async function LeaderboardPage() {
  const ctx = await loadTeamContext();
  const on = featureOn(ctx.status, "leaderboard");
  const rows = on ? await loadLeaderboard(await supabaseServer(), ctx.event.id) : null;
  const mine = ctx.company?.id ?? null;
  const open = on && rows && leaderboardOpen(rows) ? rows : null;
  const myRow = open && mine ? (open.find((r) => r.company_id === mine) ?? null) : null;
  // The demo's leaderboard (app/demo/leaderboard): the page head, three metric cards and the standings panel.
  return (
    <div>
      <AutoRefresh everyMs={30_000} active={on} />
      <GuidePageTitle
        eyebrow="PRIMUS RATING / LIVE"
        title="Leaderboard"
        sub="Every company starts at a Rating of 1,000. Each released score moves it: a score above its sector's average for that round raises it, one below lowers it."
      />
      {!on ? (
        <p className="guide-alert">The leaderboard is turned off tonight.</p>
      ) : !open ? (
        <p className="guide-alert">
          <span data-testid="leaderboard-closed">{LEADERBOARD_CLOSED}</span>
        </p>
      ) : (
        <>
          <div className="guide-grid three">
            <GuideMetric label="COMPANIES" value={count(open.length)} delta="RANKED BY RATING" />
            <GuideMetric
              label={ctx.team.track === "PRODUCT" ? "YOUR POSITION" : "YOUR SQUAD'S COMPANY"}
              value={myRow ? `#${String(myRow.rank).padStart(2, "0")}` : "—"}
              delta={myRow ? `${myRow.ticker ?? ""} · RATING ${count(Math.round(myRow.rating))}` : "NOT RANKED"}
            />
            <GuideMetric label="TOP RATING" value={count(Math.round(open[0]!.rating))} delta={`${open[0]!.ticker ?? ""} · ${open[0]!.sector ?? ""}`} />
          </div>
          <div className="mt-4" data-testid="leaderboard">
            <GuidePanel title="Overall standings" tag="LIVE · RE-READ EVERY 30 S">
              <div className="guide-scroll-box table-8 overflow-x-auto">
                <table className="guide-table" aria-label="Leaderboard">
                  <thead>
                    <tr>
                      {["#", "Company", "Sector", "Rating", "Move", "Scores"].map((h) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((r) => (
                      <tr key={r.company_id} className={r.company_id === mine ? "guide-row-mine" : ""} data-mine={r.company_id === mine ? "true" : undefined}>
                        <td className="font-mono">
                          <strong className={r.rank <= 3 ? "guide-status" : ""}>{String(r.rank).padStart(2, "0")}</strong>
                        </td>
                        <td>
                          <strong className="font-mono">{r.ticker ?? "—"}</strong> {r.name ?? ""}
                          {r.company_id === mine ? <span className="guide-chip ml-2">{ctx.team.track === "PRODUCT" ? "(you)" : "(your squad)"}</span> : null}
                        </td>
                        <td>{r.sector ?? "—"}</td>
                        <td className="text-right font-mono">{count(Math.round(r.rating))}</td>
                        <td className={`font-mono ${r.change && r.change < 0 ? "text-[#ff8a95]" : "guide-status"}`}>{moveText(r.change) || "—"}</td>
                        <td className="text-right font-mono">{count(r.rounds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GuidePanel>
          </div>
        </>
      )}
    </div>
  );
}
