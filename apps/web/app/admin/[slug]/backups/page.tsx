import type { Metadata } from "next";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent } from "@/lib/admin/event";
import { supabaseServer } from "@/lib/supabase/server";
import { toResult } from "@/lib/rpc";
import { clock, count, money } from "@/lib/format";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Badge, Notice, Panel, Table, Td, inputClass } from "@/components/ui/ui";
import { askRestore, backUpNow, decideRestore } from "./actions";
import {
  KIND_LABEL,
  STATUS_LABEL,
  fingerprintCode,
  restoreVerb,
  sameFingerprint,
  sharesHeld,
  size,
  totalRows,
  type BackupsData,
  type RestoreRequest,
} from "./backups";
import { DownloadBackup } from "./download";

export const metadata: Metadata = { title: "Backups" };

// Backups (migration 075): the event is backed up after every phase, trading round and score release; organisers can
// back up by hand, download any backup, and restore one (two people, paused event).
export default async function BackupsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const organiser = viewer?.role === "ORGANISER";
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("snapshots_list", { p_event: event.id });
  const r = toResult(data, error);
  if (!r.ok) {
    return (
      <Panel title="Backups">
        <Notice tone="red">Backups could not be read: {r.message ?? "the database has no backups yet (migration 075)."}</Notice>
      </Panel>
    );
  }
  const d = r.data as unknown as BackupsData;
  const open = d.restores.filter((x) => x.status === "PENDING" || x.status === "APPROVED" || x.status === "RUNNING");
  const done = d.restores.filter((x) => !open.includes(x));

  return (
    <div className="space-y-6">
      <Panel title="Backups">
        <div className="max-w-3xl space-y-2 text-sm text-paper">
          <p>
            The event is backed up after every phase, every trading round and every score release, and when you press Back up now. The
            newest {d.keep} are kept, and the Base backup (the start of the event) always.
          </p>
          <p className="text-muted">
            Reset to base = restore Base. Reset a round = restore the backup taken just before it (for round 7: &quot;Trading round 6
            cleared&quot;).
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={d.backups_on ? "green" : "amber"}>{d.backups_on ? "Backups on" : "Backups off"}</Badge>
          {d.backups_on ? null : <span className="text-muted">Turn them on under Switches on the Run page.</span>}
          {d.queue.length > 0 ? (
            <span className="text-muted" data-testid="backup-queue">
              Waiting: {d.queue.map((q) => q.label).join(" · ")}
            </span>
          ) : null}
        </div>
        {organiser && d.backups_on ? (
          <ActionForm action={backUpNow.bind(null, event.id)} submit="Back up now" resetOnSuccess className="mt-4 max-w-md">
            <label className="block text-sm text-paper">
              Name (optional)
              <input name="label" maxLength={80} placeholder="e.g. Before the draw" className={`mt-1 ${inputClass}`} />
            </label>
          </ActionForm>
        ) : null}
      </Panel>

      {open.length > 0 ? (
        <Panel title="Restore waiting">
          <ul className="divide-y divide-line">
            {open.map((x) => (
              <RestoreRow key={x.id} x={x} canDecide={organiser || viewer?.role === "FAIRNESS"} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={`All backups (${d.snapshots.length})`}>
        {d.paused ? (
          <Notice tone="amber">
            The event is paused. Restoring a backup brings the whole event back to that moment: everything after it is lost (a backup
            of the event as it is now is taken first). Logins, check-ins and the event log stay. The event stays paused afterwards.
            {d.now ? <> Now: fingerprint {fingerprintCode(d.now)}.</> : null}
          </Notice>
        ) : (
          <Notice>To restore a backup, pause the event first (Run page). Everything after the backup is lost.</Notice>
        )}
        <Table
          className="mt-4"
          label="Backups"
          head={["#", "Backup", "Taken", "Phase", "Rows", "Size", "Fingerprint", ""]}
          empty="No backups yet. The first is taken when the event leaves Setup."
        >
          {d.snapshots.map((b) => (
            <tr key={b.id} data-testid={`backup-${b.id}`}>
              <Td mono>{b.id}</Td>
              <Td className="whitespace-normal">
                <div className="max-w-md text-paper">{b.label}</div>
                <div className="text-xs text-muted">
                  {KIND_LABEL[b.kind]}
                  {b.by ? ` · ${b.by}` : ""}
                </div>
              </Td>
              <Td mono>{clock(b.taken_at, true)}</Td>
              <Td>{b.phase ?? "—"}</Td>
              <Td mono>{count(totalRows(b.fingerprint))}</Td>
              <Td mono>{size(b.size_bytes)}</Td>
              <Td className="whitespace-normal">
                <span className="font-mono">{fingerprintCode(b.fingerprint)}</span>
                {sameFingerprint(b.fingerprint, d.now) ? (
                  <>
                    {" "}
                    <Badge tone="green">= now</Badge>
                  </>
                ) : null}
                <div className="text-xs text-muted">
                  Cash {money(b.fingerprint.cash_cents)} · shares {count(sharesHeld(b.fingerprint))} · exchange{" "}
                  {money(b.fingerprint.exchange_cash_cents)}
                </div>
              </Td>
              <Td className="whitespace-normal">
                <div className="flex flex-col items-start gap-2">
                  <DownloadBackup id={b.id} slug={event.slug} />
                  {organiser && d.paused && open.length === 0 ? (
                    <details>
                      <summary className="cursor-pointer text-sm text-warn">{restoreVerb(b)}…</summary>
                      <ActionForm
                        action={askRestore.bind(null, b.id)}
                        submit={`Ask to ${restoreVerb(b).toLowerCase()}`}
                        confirm="Click again: everything after this backup will be lost"
                        className="mt-2 w-72"
                      >
                        <label className="block text-sm text-paper">
                          Why (a second person reads this)
                          <textarea name="reason" required minLength={10} maxLength={500} rows={2} className={`mt-1 ${inputClass}`} />
                        </label>
                      </ActionForm>
                    </details>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      {done.length > 0 ? (
        <Panel title="Past restores">
          <ul className="divide-y divide-line">
            {done.map((x) => (
              <RestoreRow key={x.id} x={x} canDecide={false} />
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function RestoreRow({ x, canDecide }: { x: RestoreRequest; canDecide: boolean }) {
  const tone = x.status === "DONE" ? "green" : x.status === "FAILED" ? "red" : x.status === "PENDING" || x.status === "APPROVED" ? "amber" : "slate";
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm" data-testid={`restore-${x.id}`}>
      <div className="max-w-3xl space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{STATUS_LABEL[x.status]}</Badge>
          <span className="text-paper">
            Backup #{x.snapshot_id ?? "?"} · {x.label} · taken at {clock(x.taken_at)}
          </span>
        </div>
        <div className="text-muted">
          Asked by {x.requested_by_name ?? "an organiser"} at {clock(x.requested_at)}: &ldquo;{x.reason}&rdquo;
          {x.decided_by_name ? ` · decided by ${x.decided_by_name} at ${clock(x.decided_at)}` : ""}
          {x.finished_at ? ` · finished at ${clock(x.finished_at, true)}` : ""}
          {x.before_backup ? ` · the event before it is backup #${x.before_backup}` : ""}
        </div>
        {x.error ? <div className="text-danger-soft">{x.error}</div> : null}
      </div>
      {canDecide && x.status === "PENDING" ? (
        <div className="flex flex-wrap gap-2">
          {x.mine ? (
            <ActionButton action={decideRestore.bind(null, x.id, false)} confirm="Click again: cancel">
              Cancel
            </ActionButton>
          ) : (
            <>
              <ActionButton action={decideRestore.bind(null, x.id, true)} confirm="Click again: restore, losing everything after it" variant="primary">
                Approve
              </ActionButton>
              <ActionButton action={decideRestore.bind(null, x.id, false)} confirm="Click again: reject">
                Reject
              </ActionButton>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
