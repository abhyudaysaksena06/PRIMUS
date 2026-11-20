import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { featureOn } from "@/lib/event-status";
import { supabaseServer } from "@/lib/supabase/server";
import { LEADERBOARD_CLOSED, leaderboardOpen, loadLeaderboard, moveText } from "@/lib/team/leaderboard";
import { count } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { Notice, Table, Td } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Leaderboard" };

// The live leaderboard (switch `leaderboard`): every company's PRIMUS Rating (from 1,000; each released score moves
// it), its rank and its move at the last release. The page re-reads every 30 seconds and on every broadcast.
export default async function LeaderboardPage() {
  const ctx = await loadTeamContext();
  const on = featureOn(ctx.status, "leaderboard");
  const rows = on ? await loadLeaderboard(await supabaseServer(), ctx.event.id) : null;
  const mine = ctx.company?.id ?? null;
  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={30_000} active={on} />
      <h1 className="text-2xl font-extrabold text-phosphor">Leaderboard</h1>
      <p className="text-sm text-paper">
        Every company starts at a Rating of 1,000. Each released score moves it: a score above its sector&apos;s average for that round raises it, one
        below lowers it.
      </p>
      {!on ? (
        <Notice>The leaderboard is turned off tonight.</Notice>
      ) : !rows || !leaderboardOpen(rows) ? (
        <Notice tone="blue">
          <span data-testid="leaderboard-closed">{LEADERBOARD_CLOSED}</span>
        </Notice>
      ) : (
        <div data-testid="leaderboard">
          <Table head={["#", "Company", "Sector", "Rating", "Move", "Scores"]} label="Leaderboard">
            {rows.map((r) => (
              <tr key={r.company_id} className={r.company_id === mine ? "bg-phosphor/10 font-semibold" : ""} data-mine={r.company_id === mine ? "true" : undefined}>
                <Td mono>{count(r.rank)}</Td>
                <Td>
                  <span className="font-mono">{r.ticker ?? "—"}</span> <span className="text-paper">{r.name ?? ""}</span>
                  {r.company_id === mine ? <span className="ml-1 text-xs text-phosphor">{ctx.team.track === "PRODUCT" ? "(you)" : "(your squad)"}</span> : null}
                </Td>
                <Td>{r.sector ?? "—"}</Td>
                <Td mono className="text-right">
                  {count(Math.round(r.rating))}
                </Td>
                <Td mono className={r.change && r.change < 0 ? "text-danger-soft" : "text-phosphor"}>
                  {moveText(r.change) || "—"}
                </Td>
                <Td mono className="text-right">
                  {count(r.rounds)}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
