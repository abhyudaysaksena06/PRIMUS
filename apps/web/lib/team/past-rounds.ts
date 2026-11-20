// Past rounds on Home (PRIMUS): every round or crisis whose writing has closed, with the team's own submitted text
// (the PRD or crisis memo, a crisis plan or advice memo, the Round 3 solution), its score once released and the price
// move it gave. Pure: lib/team/past-rounds-data.ts reads the rows through RLS (released scores only).

import type { SubmissionType, Track } from "@msim/engine";

export interface PastSubmission {
  company_id: string;
  type: SubmissionType;
  content: Record<string, unknown>;
  submitted_at: string;
  word_count: number;
  auto_submitted: boolean;
}

export interface PastEntry {
  key: string;
  type: SubmissionType;
  /** What it is: "Your PRD", "Your plan", "Your advice memo for ABC". */
  label: string;
  submission: PastSubmission | null;
  /** Released score (0–100), or null before the release. */
  score: number | null;
  /** The price move it gave (basis points), or null (none yet, or the type moves no price). */
  moveBp: number | null;
  /** Whose price moved: "your price" or the client's ticker. */
  moveOf: string | null;
}

export interface PastRound {
  key: string;
  title: string;
  entries: PastEntry[];
}

export interface PastInput {
  track: Track;
  companyId: string | null;
  /** Has this deadline passed (PITCH, DUE_1 … DUE_5)? */
  closed: (code: string) => boolean;
  submissions: readonly PastSubmission[];
  scores: readonly { company_id: string; type: SubmissionType; final_score: number | null }[];
  /** SUB_TIER price moves per company and sub-round. */
  moves: readonly { company_id: string; subround: number; tier_bp: number | null }[];
  /** Consulting: its clients per sub-round. */
  clients: readonly { k: number; company_id: string; ticker: string | null }[];
}

const roundTitle = (k: number) => (k === 5 ? "Round 3: the final problem" : `Crisis ${k} of 4`);

/** The finished rounds, newest first. A Finance team writes nothing, so it has none. */
export function pastRounds(i: PastInput): PastRound[] {
  if (i.track === "FINANCE") return [];
  const sub = (company: string | null, type: SubmissionType) => i.submissions.find((s) => s.company_id === company && s.type === type) ?? null;
  const score = (company: string | null, type: SubmissionType) => {
    const s = i.scores.find((x) => x.company_id === company && x.type === type);
    return s && s.final_score !== null ? Number(s.final_score) : null;
  };
  const move = (company: string | null, k: number) => {
    const m = i.moves.find((x) => x.company_id === company && x.subround === k);
    return m && m.tier_bp !== null ? Number(m.tier_bp) : null;
  };
  const out: PastRound[] = [];
  if (i.closed("PITCH")) {
    const type: SubmissionType = i.track === "PRODUCT" ? "PITCH" : "MEMO";
    out.push({
      key: "R1",
      title: "Round 1",
      entries: [
        {
          key: `R1-${type}`,
          type,
          label: i.track === "PRODUCT" ? "Your PRD" : "Your crisis memo",
          submission: sub(i.companyId, type),
          score: score(i.companyId, type),
          moveBp: null,
          moveOf: null,
        },
      ],
    });
  }
  for (const k of [1, 2, 3, 4, 5]) {
    if (!i.closed(`DUE_${k}`)) continue;
    const entries: PastEntry[] = [];
    if (i.track === "PRODUCT") {
      const type = (k === 5 ? "SOLUTION" : `CRISIS_${k}`) as SubmissionType;
      entries.push({
        key: `${k}-${type}`,
        type,
        label: k === 5 ? "Your solution" : "Your response plan",
        submission: sub(i.companyId, type),
        score: score(i.companyId, type),
        moveBp: move(i.companyId, k),
        moveOf: "your price",
      });
    } else {
      const type = `ADVICE_${k}` as SubmissionType;
      for (const c of i.clients.filter((x) => x.k === k)) {
        const who = c.ticker ?? "your client";
        entries.push({
          key: `${k}-${type}-${c.company_id}`,
          type,
          label: `Your advice memo for ${who}`,
          submission: sub(c.company_id, type),
          score: score(c.company_id, type),
          moveBp: move(c.company_id, k),
          moveOf: who,
        });
      }
    }
    out.push({ key: `K${k}`, title: roundTitle(k), entries });
  }
  return out.reverse();
}
