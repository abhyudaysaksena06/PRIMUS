"use client";

// Reset to new (migration 085): the organisers test the live event, then wipe what was played and run the night on it.
// Typing the event's name is the confirmation.

import { useActionState } from "react";
import type { ActionResult } from "@/lib/rpc";

export function ResetEventForm({
  slug,
  action,
}: {
  slug: string;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const [state, submit, pending] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <form action={submit} className="space-y-3" data-testid="reset-event">
      <p className="text-sm text-paper">
        Wipes everything played on this event: the phases go back to Setup, and every draw, company, submission, score, order, trade,
        chat, hire and backup is removed. Kept: the logins and printed cards, the registered teams (names, members, check-ins), the team
        list, the decks and every switch. The live event keeps its planned times.
      </p>
      <label className="block">
        <span className="guide-label">TYPE THE EVENT NAME TO CONFIRM: {slug}</span>
        <input name="confirm" autoComplete="off" spellCheck={false} placeholder={slug} className="guide-input font-mono" required />
      </label>
      <button type="submit" disabled={pending} className="guide-btn danger">
        {pending ? "Resetting…" : "Reset to new"}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "text-sm text-[#7ef0c4]" : "text-sm text-[#ffb3bb]"}>
          {state.message ?? (state.ok ? "Done." : "The reset was refused.")}
        </p>
      ) : null}
    </form>
  );
}
