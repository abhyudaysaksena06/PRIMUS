"use client";

// The draw's dice roll: typed from real dice in the hall, or "Roll dice" fills it with three random dice (1–6 each,
// e.g. "426") from the browser's cryptographic random generator. Either way the value is shown before the draw and
// stored in the lottery record, so the draw can be replayed.

import { useState } from "react";

export function rollDice(count = 3, random: (n: number) => number = cryptoInt): string {
  return Array.from({ length: count }, () => String(1 + random(6))).join("");
}

function cryptoInt(n: number): number {
  const a = new Uint32Array(1);
  // Rejection sampling: no bias towards low faces.
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(a);
  while (a[0]! >= limit);
  return a[0]! % n;
}

export function DiceInput({ className }: { className: string }) {
  const [value, setValue] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        name="dice"
        required
        inputMode="numeric"
        pattern="[0-9]{1,6}"
        maxLength={6}
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        className={className}
        data-testid="dice-input"
      />
      <button
        type="button"
        onClick={() => setValue(rollDice())}
        className="rounded border border-line px-3 py-2 font-mono text-xs uppercase tracking-wider text-phosphor hover:bg-raised"
        data-testid="dice-roll"
      >
        🎲 Roll dice
      </button>
    </span>
  );
}
