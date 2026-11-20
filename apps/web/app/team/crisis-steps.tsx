"use client";

// The steps of the crisis under way as a row of the demo's chips: done (✓), on now (with the time left) and later. The
// step on now follows the server clock on the screen itself, so the row is right without a re-read. On a phone only
// the step on now is spelled out (the others show their tick or number), so the row takes one or two lines.

import { Countdown } from "@/components/ui/countdown";
import { useDeadlineNow } from "@/lib/live/clock";
import { stepStates, type CrisisStep } from "@/lib/team/crisis-steps";

export function CrisisSteps({ steps, label }: { steps: readonly CrisisStep[]; label: string }) {
  const now = useDeadlineNow();
  const states = stepStates(steps, now);
  // The demo's chips: the step on now lit in the track's colour, the done ones ticked, the rest quiet.
  return (
    <ol className="mt-1.5 flex flex-wrap items-center gap-1.5" aria-label={label} data-testid="crisis-steps" suppressHydrationWarning>
      {steps.map((s, i) => {
        const st = states[i]!;
        return (
          <li key={s.key} className="flex items-center gap-1" aria-current={st === "now" ? "step" : undefined} data-step={s.key} data-state={st} suppressHydrationWarning>
            <span className={`guide-chip gap-1.5 ${st === "now" ? "active" : st === "later" ? "opacity-60" : ""}`} suppressHydrationWarning>
              <span aria-hidden suppressHydrationWarning>
                {st === "done" ? "✓" : i + 1}
              </span>
              <span className={st === "now" ? undefined : "sr-only sm:not-sr-only"}>{s.label}</span>
              {st === "now" && s.endsAt ? (
                <span className="whitespace-nowrap font-mono tabular-nums">
                  · <Countdown to={s.endsAt} passed="now" /> left
                </span>
              ) : null}
              <span className="sr-only">{st === "done" ? " (done)" : st === "now" ? " (now)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
