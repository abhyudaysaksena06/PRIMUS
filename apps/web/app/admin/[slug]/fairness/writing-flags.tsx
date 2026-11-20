// Drafts that grew too fast to have been typed (migration 072, switch paste_flag): over 120 words in under 10 seconds.
// A flag never blocks a save; the fairness officer decides what it means.

import { supabaseServer } from "@/lib/supabase/server";
import { Panel, Table, Td } from "@/components/ui/ui";
import { clock } from "@/lib/format";

interface Row {
  type: string;
  words_before: number;
  words_after: number;
  seconds: number;
  created_at: string;
  team: { code: string } | null;
  company: { ticker: string | null } | null;
}

export async function WritingFlags({ eventId }: { eventId: string }) {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("writing_flags")
    .select("type, words_before, words_after, seconds, created_at, team:teams(code), company:companies(ticker)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return null; // not the fairness officer, or a database older than 072
  const rows = (data ?? []) as unknown as Row[];
  return (
    <Panel title="Writing that grew too fast">
      <p className="mb-3 text-sm text-paper">
        Saves that added more than 120 words in under 10 seconds (pasting is blocked on screen; this catches extensions and other tricks). A flag
        never blocks the save.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">None so far.</p>
      ) : (
        <Table label="Writing flags" head={["Time", "Team", "Company", "Text", "Words", "Seconds"]}>
          {rows.map((r, i) => (
            <tr key={i}>
              <Td>{clock(r.created_at)}</Td>
              <Td>{r.team?.code ?? "?"}</Td>
              <Td>{r.company?.ticker ?? "?"}</Td>
              <Td>{r.type}</Td>
              <Td>
                {r.words_before} → {r.words_after}
              </Td>
              <Td>{Number(r.seconds).toFixed(1)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}
