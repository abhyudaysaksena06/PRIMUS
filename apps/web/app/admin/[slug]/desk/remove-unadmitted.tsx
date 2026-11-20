"use client";

// After registration (migration 101): remove every card the desk did not admit, with its login. Typing REMOVE <slug>
// is the confirmation. Shown to organisers only; the database refuses everyone else.

import { useActionState } from "react";
import type { ActionResult } from "@/lib/rpc";

export function RemoveUnadmittedForm({
  slug,
  unadmitted,
  action,
}: {
  slug: string;
  /** Cards of this event nobody has admitted yet. */
  unadmitted: number;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const phrase = `REMOVE ${slug}`;
  const [state, submit, pending] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <form action={submit} className="space-y-3" data-testid="remove-unadmitted">
      <p className="text-sm">
        <b>{unadmitted}</b> {unadmitted === 1 ? "card is" : "cards are"} not admitted. Use once, when registration is over and before the
        squad draw: every team the desk did not admit is <b>deleted with its login</b> (its printed card stops working for good), its
        members and everything else of it. Kept: every admitted team, its login and members, the uploaded team list, staff. Afterwards
        walk-ins can no longer get a card, and a reset to new rebuilds only the cards that remain.
      </p>
      <label className="block">
        <span className="guide-label">TYPE {phrase} TO CONFIRM</span>
        <input name="confirm" autoComplete="off" spellCheck={false} placeholder={phrase} className="guide-input font-mono" required />
      </label>
      <button type="submit" disabled={pending || unadmitted === 0} className="guide-btn danger">
        {pending ? "Removing…" : `Remove ${unadmitted} teams not admitted`}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "text-sm text-[#7ef0c4]" : "text-sm text-[#ffb3bb]"}>
          {state.message ?? (state.ok ? "Done." : "The removal was refused.")}
        </p>
      ) : null}
    </form>
  );
}
