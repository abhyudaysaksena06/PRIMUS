"use client";

// The terms of a consulting fee (or a raise) in equity: the team types an equity % and sees, as it types, how many
// shares that is and what it is worth at the company's current price. The form posts `shares` (and `cash` when
// cash is allowed); the exchange checks the terms again and works out the value itself.

import { useState } from "react";
import { money } from "@/lib/format";
import { equityText, parsePct, pctOf, stakeValue } from "@/lib/team/equity";

export function EquityFields({
  shares = 0,
  cash,
  priceCents,
  hint,
  label = "Equity (% of the company)",
  testId = "equity-fields",
}: {
  shares?: number;
  /** Cash in cents, or undefined to offer no cash field (a raise is equity only). */
  cash?: number;
  priceCents: number | null;
  hint?: string;
  label?: string;
  testId?: string;
}) {
  const [pct, setPct] = useState(shares ? String(pctOf(shares)) : "");
  const parsed = parsePct(pct);
  const value = parsed === null ? null : stakeValue(parsed, priceCents);
  return (
    <div className="grid gap-2" data-testid={testId}>
      <label className="block text-sm">
        <span className="guide-label uppercase">{label}</span>
        <input
          inputMode="decimal"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          placeholder="e.g. 5"
          className={`guide-input mt-1 font-mono`}
          aria-describedby={`${testId}-value`}
        />
      </label>
      {/* What the server reads. An unreadable percentage posts as text, so the server refuses it with a reason. */}
      <input type="hidden" name="shares" value={parsed === null ? pct : String(parsed)} />
      <p id={`${testId}-value`} className="font-mono text-xs text-[var(--term-cyan)]" data-testid={`${testId}-value`}>
        {parsed === null
          ? "Write a percentage with at most two decimals, e.g. 5 or 2.5."
          : parsed === 0
            ? "No equity."
            : `${equityText(parsed)}${value !== null ? ` · worth ${money(value)} at ${money(priceCents)} a share now` : ""}`}
      </p>
      {cash !== undefined ? (
        <details open={cash > 0}>
          <summary className="cursor-pointer text-xs font-semibold text-muted">Add cash as well (optional)</summary>
          <label className="mt-1 block text-sm">
            <span className="guide-label uppercase">Cash ($)</span>
            <input name="cash" inputMode="decimal" defaultValue={(cash / 100).toFixed(2)} className={`guide-input mt-1 font-mono`} />
          </label>
        </details>
      ) : null}
      {hint ? <p className="guide-muted">{hint}</p> : null}
    </div>
  );
}
