"use server";

// Phase control: each action is one game function, run as the signed-in organiser.

import { PHASE_LABELS, type PhaseCode } from "@msim/engine";
import { rpc, type ActionResult } from "@/lib/rpc";

export async function advancePhase(eventId: string, from: PhaseCode): Promise<ActionResult> {
  const r = await rpc("advance_phase", { p_event: eventId, p_from: from });
  // Another organiser (or auto-advance) moved the event first: nothing changed, and the page refreshes.
  if (r.code === "STALE") return { ...r, message: `The event has already left ${PHASE_LABELS[from]}; nothing changed. Check the page and try again.` };
  return r;
}

export async function pauseEvent(eventId: string): Promise<ActionResult> {
  return rpc("pause_event", { p_event: eventId });
}

export async function resumeEvent(eventId: string): Promise<ActionResult> {
  return rpc("resume_event", { p_event: eventId });
}

export async function extendEvent(eventId: string, minutes: number): Promise<ActionResult> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return { ok: false, code: "BAD_MINUTES", message: "Extend by 1 to 120 minutes." };
  return rpc("extend_event", { p_event: eventId, p_minutes: minutes });
}

export async function extendEventForm(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  return extendEvent(eventId, Number(form.get("minutes")));
}

/** The phase on now ends at this exact time instead, earlier or later, and everything after it moves with it. */
export async function setPhaseEnd(eventId: string, endsAt: Date): Promise<ActionResult> {
  if (Number.isNaN(endsAt.getTime())) return { ok: false, code: "BAD_TIME", message: "That is not a time." };
  return rpc("set_phase_end", { p_event: eventId, p_ends_at: endsAt.toISOString() });
}

/**
 * The form sends a local date and time ("2026-11-20T23:30"), which the organiser read off their own clock, so it is
 * taken in the server's zone rather than UTC.
 */
export async function setPhaseEndForm(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const raw = String(form.get("endsAt") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return { ok: false, code: "BAD_TIME", message: "Pick a date and a time." };
  return setPhaseEnd(eventId, new Date(raw));
}

/** `advanceNow` is the confirmed second click when the planned end has passed; without it the database refuses. */
export async function setAutoAdvance(eventId: string, on: boolean, advanceNow = false): Promise<ActionResult> {
  const r = await rpc("set_auto_advance", { p_event: eventId, p_on: on, p_advance_now: advanceNow });
  if (r.code === "OVERDUE") return { ...r, message: "The planned end has passed: with auto-advance on, the event advances at once. Click the button twice to confirm." };
  return r;
}

