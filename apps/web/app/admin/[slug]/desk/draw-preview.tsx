// Before the squad draw (migration 076, switch draw_checked_in): how many squads the checked-in teams make and who would
// be left out, so the desk can move or turn away surplus teams first.

import { supabaseServer } from "@/lib/supabase/server";
import { Notice, Panel } from "@/components/ui/ui";

interface Preview {
  message?: string;
  ready?: boolean;
  squads?: number;
  left_out?: number;
}

export async function DrawPreview({ eventId }: { eventId: string }) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("draw_preview", { p_event: eventId });
  if (error || !data) return null; // not an organiser, or a database older than 076
  const p = data as Preview;
  if (!p.message) return null;
  return (
    <Panel title="The squad draw">
      <Notice tone={p.left_out && p.left_out > 0 ? "amber" : "green"}>{p.message}</Notice>
    </Panel>
  );
}
