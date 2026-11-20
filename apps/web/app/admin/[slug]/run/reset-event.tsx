"use client";

// Reset to new (migration 085): the organisers test the live event, then wipe what was played and run the night on it.
// Typing the event's name is the confirmation.

import { useActionState } from "react";
import type { ActionResult } from "@/lib/rpc";

export function ResetEventForm({
  slug,
  final = false,
  action,
}: {
  slug: string;
  /** Final reset: the test teams (TEST- roll numbers) are unregistered too (migration 087). */
  final?: boolean;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const phrase = final ? `FINAL ${slug}` : slug;
  const [state, submit, pending] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <form action={submit} className="space-y-3" data-testid={final ? "reset-event-final" : "reset-event"}>
      <p className="text-sm text-paper">
        {final ? (
          <>
            <b>Use once, just before doors.</b> Wipes everything played (back to Setup: no draw, companies, submissions, scores, orders,
            trades, chats, hires or backups) <b>and unregisters the test teams</b> (P01–P03, C01–C03, F01–F03: every team whose members
            have TEST- roll numbers), so they stay out of the squad draw. Kept: real registrations, the logins and printed cards, the team
            list, the Round 3 statements and every switch.
          </>
        ) : (
          <>
            For testing, as often as you like. Wipes everything played (back to Setup: no draw, companies, submissions, scores, orders,
            trades, chats, hires or backups). Kept: every registered team <b>including the test teams</b>, the logins and cards, the team
            list, the Round 3 statements and every switch.
          </>
        )}
      </p>
      <label className="block">
        <span className="guide-label">TYPE {phrase} TO CONFIRM</span>
        <input name="confirm" autoComplete="off" spellCheck={false} placeholder={phrase} className="guide-input font-mono" required />
      </label>
      <button type="submit" disabled={pending} className="guide-btn danger">
        {pending ? "Resetting…" : final ? "Final reset" : "Test reset"}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "text-sm text-[#7ef0c4]" : "text-sm text-[#ffb3bb]"}>
          {state.message ?? (state.ok ? "Done." : "The reset was refused.")}
        </p>
      ) : null}
    </form>
  );
}
