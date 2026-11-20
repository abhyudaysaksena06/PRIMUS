// "Judge automatically" (switch judge_auto, migration 073): whether the clock starts the judging of each type when its
// writing deadline passes, and what it has done per type, next to the runs and scores of that type. The release stays
// an organiser's click. Shown on a PRIMUS night only (the clock judges PRIMUS types).

import Link from "next/link";
import type { SubmissionType } from "@msim/engine";
import { supabaseServer } from "@/lib/supabase/server";
import { featureOn, type EventStatus } from "@/lib/event-status";
import { TYPE_TITLES, type TypeSummary } from "@/lib/admin/judge";
import { clock } from "@/lib/format";
import { Badge, Panel, Table, Td } from "@/components/ui/ui";

/** The types the clock judges, in the order of the night. */
export const AUTO_JUDGE_TYPES: readonly SubmissionType[] = [
  "PITCH", "MEMO", "CRISIS_1", "ADVICE_1", "CRISIS_2", "ADVICE_2", "CRISIS_3", "ADVICE_3", "CRISIS_4", "ADVICE_4", "SOLUTION", "ADVICE_5",
];

export interface AutoJudgeRow {
  type: SubmissionType;
  queued_at: string;
  submissions: number;
  runs: number;
  sealed_at: string | null;
  sealed_missing: number | null;
}

/** What the clock did for a type, in one short line. */
export function autoText(row: AutoJudgeRow | undefined, released: boolean): string {
  if (!row) return released ? "Released by hand" : "Waits for the deadline";
  const started = row.submissions === 0 ? `Nothing to judge (${clock(row.queued_at, true)})` : `Started ${clock(row.queued_at, true)}: ${row.submissions} submission${row.submissions === 1 ? "" : "s"}, ${row.runs} runs`;
  if (!row.sealed_at) return `${started} · seals missing when the runs finish`;
  const missing = row.sealed_missing ?? 0;
  return `${started} · ${missing === 0 ? "none missing" : `${missing} missing sealed as 0`} (${clock(row.sealed_at, true)})`;
}

async function loadAutoJudge(eventId: string): Promise<AutoJudgeRow[]> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("judge_auto")
    .select("type, queued_at, submissions, runs, sealed_at, sealed_missing")
    .eq("event_id", eventId);
  if (error) return []; // a database older than migration 073
  return (data ?? []) as AutoJudgeRow[];
}

export async function AutoJudgePanel({
  eventId,
  slug,
  status,
  summaries,
}: {
  eventId: string;
  slug: string;
  status: EventStatus;
  summaries: Partial<Record<SubmissionType, TypeSummary>>;
}) {
  const on = featureOn(status, "judge_auto", false);
  const rows = await loadAutoJudge(eventId);
  const byType = new Map(rows.map((r) => [r.type, r]));
  const types = AUTO_JUDGE_TYPES.filter((t) => summaries[t]);
  return (
    <Panel
      title="Judge automatically"
      actions={
        <span data-testid="judge-auto-state">
          <Badge tone={on ? "green" : "slate"}>{on ? "On" : "Off"}</Badge>
        </span>
      }
    >
      <p className="text-sm text-paper">
        {on
          ? "When a writing deadline passes, judging starts by itself (after the drafts are auto-submitted). When every run of that type has finished, missing scores are sealed as 0. Releasing scores stays your click: it moves prices."
          : "Off: start judging, seal missing scores and release by hand, with the buttons below."}{" "}
        <Link href={`/admin/${slug}/run`} className="font-semibold underline hover:text-phosphor">
          Turn it {on ? "off" : "on"} on the Run page
        </Link>
        .
      </p>
      <Table
        head={["Type", "Queued", "Running", "Done", "Failed", "Sealed", "Released", "By itself"]}
        label="Judging by type"
        className="mt-3"
      >
        {types.map((t) => {
          const s = summaries[t]!;
          return (
            <tr key={t} data-testid={`judge-auto-${t.toLowerCase()}`}>
              <Td>{TYPE_TITLES[t]}</Td>
              <Td mono>{s.runs.QUEUED}</Td>
              <Td mono>{s.runs.RUNNING}</Td>
              <Td mono>{s.runs.DONE}</Td>
              <Td mono className={s.runs.FAILED > 0 ? "font-semibold text-danger-soft" : ""}>
                {s.runs.FAILED}
              </Td>
              <Td mono>
                {s.sealed} of {s.companies}
              </Td>
              <Td mono>{s.released}</Td>
              <Td className="text-muted">{autoText(byType.get(t), s.released > 0)}</Td>
            </tr>
          );
        })}
      </Table>
    </Panel>
  );
}
