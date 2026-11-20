import type { Metadata } from "next";
import { requireSection } from "@/lib/auth/staff";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { featureOn } from "@/lib/event-status";
import { supabaseServer } from "@/lib/supabase/server";
import { changeText, leaderboardMissing, parseLeaderboard, ratingText } from "@/lib/display/leaderboard";
import { Badge, Notice, Panel, Stat, Table, Td } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Leaderboard" };

// Leaderboard: every company's PRIMUS Rating (starts at 1,000; each released score moves it), rank and change, by
// rank. Staff always see it here; the "leaderboard" switch on the Run page decides whether teams and the projector
// do. The page re-reads on every event broadcast (a score release sends one).
export default async function LeaderboardPage({ params }: PageProps<"/admin/[slug]/leaderboard">) {
  const { slug } = await params;
  await requireSection(slug, "/leaderboard");
  const event = await loadAdminEvent(slug);
  const [status, sb] = await Promise.all([loadEventStatus(event.id), supabaseServer()]);
  const { data, error } = await sb.rpc("leaderboard", { p_event: event.id });
  const shown = featureOn(status, "leaderboard", true);
  const rows = error ? [] : parseLeaderboard(data);
  const sectors = new Set(rows.map((r) => r.sector).filter(Boolean)).size;
  const rounds = rows.reduce((m, r) => Math.max(m, r.rounds), 0);

  return (
    <div className="space-y-6">
      <Notice tone={shown ? "green" : "amber"}>
        {shown
          ? "Teams and the projector see the leaderboard (switch “leaderboard” is on, Run page)."
          : "Only staff see the leaderboard: the “leaderboard” switch is off on the Run page."}
      </Notice>
      {error ? (
        leaderboardMissing(error) ? (
          <Notice tone="amber">The leaderboard is not on this database yet (its migration has not been applied).</Notice>
        ) : (
          <Notice tone="red">Could not read the leaderboard: {error.message}</Notice>
        )
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Companies" value={rows.length} />
        <Stat label="Sectors" value={sectors} />
        <Stat label="Rounds counted" value={rounds} hint="released scores" />
        <Stat label="Top rating" value={rows[0] ? ratingText(rows[0].rating) : "—"} hint={rows[0]?.ticker} />
      </div>
      <Panel title="PRIMUS Rating" actions={<Badge tone="slate">starts at 1,000</Badge>}>
        <Table head={["#", "Ticker", "Company", "Sector", "Rating", "Change", "Rounds"]} label="Leaderboard" empty="No ratings yet: they start with the first released score.">
          {rows.map((r) => (
            <tr key={r.company_id} data-testid={`rating-${r.ticker}`}>
              <Td mono>{r.rank}</Td>
              <Td mono className="font-semibold">{r.ticker}</Td>
              <Td>{r.name}</Td>
              <Td>{r.sector ?? "—"}</Td>
              <Td mono>{ratingText(r.rating)}</Td>
              <Td mono className={r.change > 0 ? "text-phosphor" : r.change < 0 ? "text-danger-soft" : "text-muted"}>{changeText(r.change)}</Td>
              <Td mono>{r.rounds}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
