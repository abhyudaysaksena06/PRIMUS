// The projector's news ticker: a scrolling strip of public news under the price board. Only what every screen may
// show: companies by ticker (never a team), the last round's biggest movers (as the verdicts screen shows top
// movers), the latest bulletins, how many rescue deals are signed, and the next deadline. No ranking of teams. On a
// PRIMUS night: the crisis step and its time, how many companies have hired while hiring is open, and the top 3
// companies by Rating (companies, not teams; only while the "leaderboard" switch is on) instead of the rescue deals.

import { DEADLINE_LABELS, phaseReached, type DeadlineCode, type PhaseCode } from "@msim/engine";

export interface TickerMove {
  ticker: string;
  before: number;
  after: number;
}

export interface TickerInput {
  phase: PhaseCode;
  nowMs: number;
  lastRound: { number: number; moves: TickerMove[] } | null;
  bulletins: { kind: string; title: string }[];
  dealsSigned: number;
  squads: number;
  deadlines: { code: DeadlineCode; at: string }[];
  /** Formats an ISO time as the hall's clock (HH:MM, IST). */
  clock: (iso: string) => string;
  /** PRIMUS: no rescue deals; the crisis step, hiring and the Rating leaders instead. */
  format?: "CLASSIC" | "PRIMUS";
  /** PRIMUS, while a sub-round's hiring is open: companies hired so far of all companies. */
  hiring?: { hired: number; companies: number } | null;
  /** PRIMUS: the top of the Rating leaderboard (only when its switch is on and it could be read). */
  leaders?: { ticker: string; rating: number }[] | null;
}

/** The PRIMUS steps in night order: Round 2's four crises, then Round 3 (sub-round 5). */
const PRIMUS_STEPS: readonly { code: DeadlineCode; k: number }[] = [
  ...[1, 2, 3, 4].flatMap((k) => (["REVEAL", "HIRE", "DUE", "RATE"] as const).map((s) => ({ code: `${s}_${k}` as DeadlineCode, k }))),
  { code: "DRAFT" as DeadlineCode, k: 5 },
  ...(["HIRE", "DUE", "RATE"] as const).map((s) => ({ code: `${s}_5` as DeadlineCode, k: 5 })),
];

export interface PrimusStep {
  /** The sub-round: 1–4 the crises, 5 Round 3. */
  k: number;
  code: DeadlineCode;
  at: string;
  tag: string;
  text: string;
}

/** A PRIMUS night's next crisis step (hiring closes, plans due, rating closes, the next reveal), from the schedule. */
export function primusStep(deadlines: readonly { code: DeadlineCode; at: string }[], nowMs: number, clock: (iso: string) => string): PrimusStep | null {
  const at = new Map(deadlines.map((d) => [d.code, d.at]));
  for (const s of PRIMUS_STEPS) {
    const t = at.get(s.code);
    if (!t || Date.parse(t) <= nowMs) continue;
    const when = clock(t);
    const step = s.code.replace(/_\d$/, "");
    const tag = s.k === 5 ? "Round 3" : `Crisis ${s.k}`;
    const text =
      step === "REVEAL" ? `Starts at ${when}: every price −5%, trading halted 5 min`
      : step === "HIRE" ? `Hiring closes at ${when}`
      : step === "DUE" ? `${s.k === 5 ? "Solutions" : "Plans"} due at ${when}`
      : step === "RATE" ? `Rating closes at ${when}`
      : `Draft ends at ${when}`;
    return { k: s.k, code: s.code, at: t, tag, text };
  }
  return null;
}

const PRIMUS_STEP_PHASES: ReadonlySet<PhaseCode> = new Set(["IPO", "PRESSURE", "SATURATION"]);

export interface TickerItem {
  key: string;
  tag: string;
  text: string;
  tone: "up" | "down" | "news" | "info";
}

/** Not shown: the flash tier is an internal step, not something the hall acts on. */
const HIDDEN: ReadonlySet<DeadlineCode> = new Set(["FLASH_TIER"]);

const pct = (before: number, after: number) => {
  const bp = Math.round(((after - before) * 10_000) / before);
  const s = (Math.abs(bp) / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${bp > 0 ? "+" : bp < 0 ? "−" : ""}${s}%`;
};

export function tickerItems(i: TickerInput, movers = 3): TickerItem[] {
  const out: TickerItem[] = [];
  if (i.lastRound && i.lastRound.moves.length) {
    const moved = i.lastRound.moves.filter((m) => m.before > 0 && m.after !== m.before);
    const up = moved.filter((m) => m.after > m.before).sort((a, b) => (b.after - b.before) / b.before - (a.after - a.before) / a.before || a.ticker.localeCompare(b.ticker));
    const down = moved.filter((m) => m.after < m.before).sort((a, b) => (a.after - a.before) / a.before - (b.after - b.before) / b.before || a.ticker.localeCompare(b.ticker));
    const r = `Round ${i.lastRound.number}`;
    if (up.length) out.push({ key: "up", tag: `${r} ▲`, text: up.slice(0, movers).map((m) => `${m.ticker} ${pct(m.before, m.after)}`).join("  ·  "), tone: "up" });
    if (down.length) out.push({ key: "down", tag: `${r} ▼`, text: down.slice(0, movers).map((m) => `${m.ticker} ${pct(m.before, m.after)}`).join("  ·  "), tone: "down" });
    if (!up.length && !down.length) out.push({ key: "flat", tag: r, text: "No price moved this round.", tone: "info" });
  }
  const primus = i.format === "PRIMUS";
  const step = primus && PRIMUS_STEP_PHASES.has(i.phase) ? primusStep(i.deadlines, i.nowMs, i.clock) : null;
  if (step) out.push({ key: "step", tag: step.tag, text: step.text, tone: "info" });
  if (step?.code.startsWith("HIRE_") && i.hiring && i.hiring.companies > 0) {
    out.push({ key: "hired", tag: "Hiring", text: `${i.hiring.hired} of ${i.hiring.companies} companies hired`, tone: "info" });
  }
  if (primus && i.leaders?.length) {
    const top = i.leaders.slice(0, 3).map((l, n) => `${n + 1}. ${l.ticker} ${Math.round(l.rating).toLocaleString("en-US")}`);
    out.push({ key: "rating", tag: "Rating", text: top.join("  ·  "), tone: "info" });
  }
  for (const [n, b] of i.bulletins.entries()) out.push({ key: `b${n}`, tag: b.kind, text: b.title, tone: "news" });
  if (!primus && phaseReached(i.phase, "CRISIS") && !phaseReached(i.phase, "CLOSE") && i.squads > 0) {
    out.push({ key: "deals", tag: "Rescue", text: `${i.dealsSigned} of ${i.squads} rescue deals signed`, tone: "info" });
  }
  const next = i.deadlines
    .filter((d) => !HIDDEN.has(d.code) && Date.parse(d.at) > i.nowMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  // On PRIMUS the next deadline is usually the crisis step already shown.
  if (next && next.code !== step?.code) {
    out.push({ key: "next", tag: "Next", text: `${DEADLINE_LABELS[next.code]} at ${i.clock(next.at)}`, tone: "info" });
  }
  return out;
}
