"use server";

// Running the event by hand: each button is one game function, run as the signed-in organiser.

import type { PhaseCode } from "@msim/engine";
import { revalidatePath } from "next/cache";
import { rpc, type ActionResult } from "@/lib/rpc";
import { phaseName } from "@/lib/admin/run-sheet";

/** End the current phase and start the next one now (its plan is pulled in, so its steps run on time from now). */
export async function startNextPhase(eventId: string, from: PhaseCode, nextName: string): Promise<ActionResult> {
  const r = await rpc("start_next_phase_now", { p_event: eventId, p_from: from });
  if (r.code === "STALE") return { ...r, message: `The event has already left ${phaseName(from)}; nothing changed.` };
  return r.ok ? { ...r, message: `${nextName} has started.` } : r;
}

/** Do the step planned at `at` now; every later step moves earlier by the same amount. */
export async function startStepNow(eventId: string, at: string, label: string): Promise<ActionResult> {
  const r = await rpc("start_step_now", { p_event: eventId, p_at: at, p_label: label });
  return r.ok ? { ...r, message: `${label}: done now. Every later step moved ${String(r.data?.moved_minutes ?? 0)} min earlier.` } : r;
}

/** Add time before the step planned at `at` (and everything after it). */
export async function delayStep(eventId: string, at: string, minutes: number, label: string): Promise<ActionResult> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return { ok: false, code: "BAD_MINUTES", message: "Add 1 to 120 minutes." };
  const r = await rpc("delay_step", { p_event: eventId, p_at: at, p_minutes: minutes, p_label: label });
  return r.ok ? { ...r, message: `${label}: ${minutes} min later. Everything after it moved too.` } : r;
}

export async function setManual(eventId: string, on: boolean): Promise<ActionResult> {
  const r = await rpc("set_manual_starts", { p_event: eventId, p_on: on });
  return r.ok
    ? { ...r, message: on ? "Manual mode on: nothing starts until you press its button." : "Manual mode off: the clock runs the plan by itself." }
    : r;
}

/** Every step inside a round waits for the organiser (manual mode only). */
export async function setHoldSteps(eventId: string, on: boolean): Promise<ActionResult> {
  const r = await rpc("set_hold_steps", { p_event: eventId, p_on: on });
  return r.ok
    ? { ...r, message: on ? "Every step now waits for you: press Do it now when you are ready." : "Steps inside a round run on their timers again." }
    : r;
}

/** Open the next trading window now, for its planned length. */
export async function openRoundNow(eventId: string, n: number): Promise<ActionResult> {
  const r = await rpc("open_round_now", { p_event: eventId, p_number: n });
  return r.ok ? { ...r, message: `Trading window ${n} is open.` } : r;
}

/** Put a rehearsal back to a fresh Setup (same teams, logins and cards). Never the live event. */
export async function resetRehearsal(eventId: string, slug: string): Promise<ActionResult> {
  const r = await rpc("reset_rehearsal", { p_event: eventId });
  if (r.ok) revalidatePath(`/admin/${slug}`, "layout");
  return r.ok ? { ...r, message: "The demo is back at Setup. Teams sign in with the same codes and passwords." } : r;
}

/**
 * Reset to new (migration 085): wipe everything played on this event and build it again from its creation, keeping the
 * registration desk's work (names, members, check-ins, team list) and the switches. The slug must be typed to confirm.
 */
export async function resetEvent(eventId: string, slug: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await rpc("reset_event", { p_event: eventId, p_confirm: String(form.get("confirm") ?? "").trim() });
  if (r.ok) revalidatePath("/admin", "layout");
  return r.ok
    ? { ...r, message: "Reset to new: the event is back at Setup. Registered teams stay checked in and sign in with the same cards." }
    : r;
}

/** Turn one of tonight's switches on or off (migration 070). */
export async function setFeature(eventId: string, key: string, on: boolean): Promise<ActionResult> {
  const r = await rpc("set_feature", { p_event: eventId, p_key: key, p_on: on });
  if (r.ok) revalidatePath("/admin", "layout");
  return r.ok ? { ...r, message: on ? "Switched on." : "Switched off." } : r;
}
