// Which full-screen takeover the big screen shows, worked out from moments the database stores (the draw, the crisis,
// each score release, the flash bulletin, the closing bell, the awards) and the server clock. Nothing is kept in the
// browser: a projector that is reloaded, or reconnects, in the middle of a takeover shows the rest of it, and one
// that comes back after it ended shows the ticker board. Pure, so the timing is unit-tested.

export type TakeoverKind = "DRAW" | "CRISIS" | "REVEAL" | "VERDICTS" | "FLASH" | "CLOSING_BELL" | "AWARDS";

/**
 * The score releases that take the screen: those that set or move prices. PRIMUS plans (CRISIS_1–4) and solutions
 * (SOLUTION) move prices through SUB_TIER rows; Round 1 memos (MEMO) and advice (ADVICE_k) move no price, so their
 * release does not take the screen.
 */
export const VERDICT_TYPES = ["PITCH", "PLAN", "FLASH", "CRISIS_1", "CRISIS_2", "CRISIS_3", "CRISIS_4", "SOLUTION"] as const;
export type VerdictType = (typeof VERDICT_TYPES)[number];

export function isVerdictType(type: string): type is VerdictType {
  return (VERDICT_TYPES as readonly string[]).includes(type);
}

/** The PRIMUS sub-round a release belongs to (CRISIS_k → k, SOLUTION → 5); null for the classic types and PITCH. */
export function verdictSubround(type: VerdictType): number | null {
  if (type === "SOLUTION") return 5;
  const m = /^CRISIS_([1-4])$/.exec(type);
  return m ? Number(m[1]) : null;
}

export interface TakeoverMoments {
  /** events.drawn_at: the 21:00 squad draw. */
  drawnAt: string | null;
  /** events.crisis_applied_at: the 00:30 crisis draw (and the seed reveal). */
  crisisAt: string | null;
  /** PRIMUS: subrounds.revealed_at of each crisis sub-round (k 1–4): every price −5%, trading halted 5 minutes. */
  reveals?: { k: number; at: string }[];
  /** When each kind of score was released (the earliest released_at of that type: the release itself). */
  verdicts: { type: VerdictType; at: string }[];
  /** published_at of the FLASH bulletin (04:00). */
  flashAt: string | null;
  /** events.market_closed_at: the 05:00 close. */
  closedAt: string | null;
  /** When AWARDS began; set only while the event is in AWARDS (the last phase). */
  awardsAt: string | null;
}

/**
 * How long each takeover stays up, in seconds at the night's real speed. A rehearsal's faster clock shortens them in
 * proportion (never below TAKEOVER_MIN_SECONDS), so they do not hide the board for most of its short rounds. AWARDS
 * stays up.
 */
export const TAKEOVER_SECONDS: Record<Exclude<TakeoverKind, "AWARDS">, number> = {
  DRAW: 180,
  CRISIS: 120,
  REVEAL: 60,
  VERDICTS: 120,
  FLASH: 90,
  CLOSING_BELL: 90,
};
export const TAKEOVER_MIN_SECONDS = 30;

/** How long a takeover stays up at the event's clock speed, in ms (null: it stays up). */
export function takeoverMs(kind: TakeoverKind, clockSpeed = 1): number | null {
  if (kind === "AWARDS") return null;
  const speed = Number.isFinite(clockSpeed) && clockSpeed > 1 ? clockSpeed : 1;
  return Math.max(TAKEOVER_MIN_SECONDS, TAKEOVER_SECONDS[kind] / speed) * 1000;
}

export interface ActiveTakeover {
  kind: TakeoverKind;
  /** When it began (the stored moment). */
  at: string;
  /** When it ends (null: it stays up, as AWARDS does). */
  until: string | null;
  /** For VERDICTS: which scores were released. */
  type?: VerdictType;
  /** For REVEAL: which crisis (1–4). */
  k?: number;
}

function candidates(m: TakeoverMoments): Omit<ActiveTakeover, "until">[] {
  const out: Omit<ActiveTakeover, "until">[] = [];
  if (m.drawnAt) out.push({ kind: "DRAW", at: m.drawnAt });
  if (m.crisisAt) out.push({ kind: "CRISIS", at: m.crisisAt });
  for (const r of m.reveals ?? []) out.push({ kind: "REVEAL", at: r.at, k: r.k });
  for (const v of m.verdicts) out.push({ kind: "VERDICTS", at: v.at, type: v.type });
  if (m.flashAt) out.push({ kind: "FLASH", at: m.flashAt });
  if (m.closedAt) out.push({ kind: "CLOSING_BELL", at: m.closedAt });
  if (m.awardsAt) out.push({ kind: "AWARDS", at: m.awardsAt });
  return out;
}

/**
 * The takeover on screen at `nowMs` (server time): the latest moment that has happened, while its takeover lasts.
 * A newer takeover replaces an older one at once, and once the newest has run out the board comes back: an older
 * takeover that would still have time left never returns. Null: show the ticker board.
 */
export function activeTakeover(m: TakeoverMoments, nowMs: number, clockSpeed = 1): ActiveTakeover | null {
  let latest: Omit<ActiveTakeover, "until"> | null = null;
  let latestAt = -Infinity;
  for (const c of candidates(m)) {
    const at = Date.parse(c.at);
    if (Number.isNaN(at) || at > nowMs) continue;
    // Equal times: the later stage of the night wins (candidates are listed in night order).
    if (at >= latestAt) {
      latest = c;
      latestAt = at;
    }
  }
  if (!latest) return null;
  const ms = takeoverMs(latest.kind, clockSpeed);
  if (ms !== null && nowMs >= latestAt + ms) return null;
  return { ...latest, until: ms === null ? null : new Date(latestAt + ms).toISOString() };
}

/** Display names of the takeovers (the strip at the top of each). */
export const TAKEOVER_TITLES: Record<TakeoverKind, string> = {
  DRAW: "Squad draw",
  CRISIS: "Crisis",
  REVEAL: "Crisis",
  VERDICTS: "Verdicts",
  FLASH: "Flash news",
  CLOSING_BELL: "Closing bell",
  AWARDS: "Awards",
};

export const VERDICT_TITLES: Record<VerdictType, string> = {
  PITCH: "Pitch scores: IPO prices are set",
  PLAN: "Rescue plan verdicts",
  FLASH: "Flash verdicts",
  CRISIS_1: "Crisis 1 verdicts: plans move prices",
  CRISIS_2: "Crisis 2 verdicts: plans move prices",
  CRISIS_3: "Crisis 3 verdicts: plans move prices",
  CRISIS_4: "Crisis 4 verdicts: plans move prices",
  SOLUTION: "Final verdicts: solutions move prices",
};
