// "Prepare the practice market" (migration 076, switch practice_verified): the Round 1 practice market has one
// simulated company per checked-in Finance team, prepared once by an organiser when Round 1 starts (a Finance page
// never stores it). The panel shows how far it is and the button prepares it; pressing it again is safe.

import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Panel } from "@/app/admin/guide-ui";
import { ActionButton } from "@/components/ui/action";
import { preparePracticeMarketAction } from "./practice-actions";

interface Status {
  ok: boolean;
  prepared: boolean;
  simulated?: boolean;
  companies: number;
  loaded: number;
  ready: boolean;
  settled?: boolean;
  switch: boolean;
  phase: string;
  funds: number;
}

export async function PracticeMarketPanel({ eventId, organiser }: { eventId: string; organiser: boolean }) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("practice_market_status", { p_event: eventId });
  if (error || !data) return null; // a database older than migration 076
  const s = data as Status;
  if (!s.ok || !s.switch) return null; // switch off: the first Finance page opens the market, as before

  const inRound1 = s.phase === "BUILD";
  const state = s.settled
    ? { tone: "slate" as const, text: "Closed" }
    : s.ready
      ? { tone: "green" as const, text: "Ready" }
      : s.prepared
        ? { tone: "amber" as const, text: `${s.loaded} of ${s.companies} loaded` }
        : { tone: "slate" as const, text: "Not prepared" };
  const line = s.prepared
    ? s.ready
      ? `${s.companies} companies, one per Finance team. Finance teams are trading.`
      : `${s.loaded} of ${s.companies} companies loaded. Press the button to finish.`
    : inRound1
      ? `Round 1 has started: prepare it now. ${s.funds} Finance teams are checked in, so ${s.funds} companies. Until then Finance teams see "opens in a moment".`
      : `It can be prepared once Round 1 starts. ${s.funds} Finance teams are checked in now.`;

  return (
    <Panel title="Practice market" actions={<Badge tone={state.tone}>{state.text}</Badge>}>
      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="practice-market-panel">
        <p className="max-w-3xl text-sm text-muted">{line}</p>
        {organiser && !s.settled && !s.ready ? (
          <ActionButton action={preparePracticeMarketAction.bind(null, eventId)} variant="primary" disabled={!inRound1 && !s.prepared}>
            Prepare the practice market
          </ActionButton>
        ) : null}
      </div>
    </Panel>
  );
}
