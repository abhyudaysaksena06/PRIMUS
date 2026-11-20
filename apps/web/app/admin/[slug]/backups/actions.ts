"use server";

// Backups (migration 075): each button is one game function, run as the signed-in organiser or fairness officer.

import { rpc, type ActionResult } from "@/lib/rpc";

/** Back up now: queued; the database takes it within about 10 seconds. */
export async function backUpNow(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const label = String(form.get("label") ?? "").trim();
  const r = await rpc("request_snapshot", { p_event: eventId, p_label: label || null });
  return r.ok ? { ...r, message: `Backup "${String(r.data?.label ?? label)}" queued. It appears here within about 10 seconds.` } : r;
}

/** Ask for a restore (the event must be paused); a second person approves it. */
export async function askRestore(backupId: number, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const reason = String(form.get("reason") ?? "").trim();
  const r = await rpc("request_restore", { p_snapshot: backupId, p_reason: reason });
  return r.ok ? { ...r, message: "Asked. A second organiser or the fairness officer must approve it below." } : r;
}

/** Approve (runs within 10 seconds), reject, or (for whoever asked) cancel a restore. */
export async function decideRestore(requestId: number, approve: boolean): Promise<ActionResult> {
  const r = await rpc("approve_restore", { p_restore: requestId, p_approve: approve, p_note: null });
  if (!r.ok) return r;
  if (!approve) return { ...r, message: r.data?.status === "CANCELLED" ? "Restore cancelled." : "Restore rejected." };
  return { ...r, message: "Approved. The restore runs within 10 seconds; the event stays paused. Check the result below, then resume." };
}
