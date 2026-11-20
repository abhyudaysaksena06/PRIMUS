// The organisers' Activity page (migration 100, public.staff_activity): turns one audit line (who, which table, which
// row, what changed) into words — the action, its kind (for the filter) and the changed fields. Pure, so it is
// unit-tested.

export interface ActivityRow {
  id: number;
  at: string;
  actor_id: string;
  actor_email: string | null;
  actor_name: string | null;
  actor_role: string;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  rows: number;
  changes: Record<string, unknown> | null;
}

export interface StaffAccount {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
}

export const ACTIVITY_KINDS = ["Desk", "Roster", "Phase & clock", "Switches", "Judging", "Scores", "News", "Content", "Money", "Fairness", "Lottery", "Refused", "Other"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const ENTITY_NAMES: Record<string, string> = {
  teams: "team",
  members: "members",
  roster: "roster entry",
  events: "event",
  phases: "phase",
  deadlines: "deadline",
  rounds: "round",
  scores: "score",
  appeals: "appeal",
  corrections: "correction",
  bulletins: "news item",
  problem_cards: "problem card",
  crisis_cards: "crisis card",
  problem_statements: "Round 3 statement",
  judge_runs: "judge runs",
  draw_records: "squad draw",
  flags: "fairness flag",
  companies: "company",
  accounts: "account",
  event_log: "event log",
};

const KIND_BY_ENTITY: Record<string, ActivityKind> = {
  teams: "Desk",
  members: "Desk",
  roster: "Roster",
  phases: "Phase & clock",
  deadlines: "Phase & clock",
  rounds: "Phase & clock",
  event_log: "Phase & clock",
  scores: "Scores",
  judge_runs: "Judging",
  bulletins: "News",
  problem_cards: "Content",
  crisis_cards: "Content",
  problem_statements: "Content",
  corrections: "Money",
  appeals: "Fairness",
  flags: "Fairness",
  draw_records: "Lottery",
  squads: "Lottery",
};

type Change = { from?: unknown; to?: unknown };

function change(row: ActivityRow, key: string): Change | null {
  const c = row.changes?.[key];
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Change) : null;
}

/** A value for the details column: text as is, null as a dash, anything else as short JSON. */
export function showValue(v: unknown, max = 80): string {
  if (v === null || v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The switches that changed between two `features` objects: "judge_auto on". */
export function featureChanges(c: Change | null): string[] {
  if (!c) return [];
  const from = (c.from && typeof c.from === "object" ? c.from : {}) as Record<string, unknown>;
  const to = (c.to && typeof c.to === "object" ? c.to : {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]))
    .sort()
    .map((k) => `${k.replace(/_/g, " ")} ${to[k] === true ? "on" : to[k] === false ? "off" : showValue(to[k], 30)}`);
}

export function activityKind(row: ActivityRow): ActivityKind {
  if (row.action === "rejected") return "Refused";
  if (row.entity === "events") {
    if (change(row, "features") || change(row, "desk_check_in") || change(row, "registration_open") || change(row, "auto_advance")) return "Switches";
    if (change(row, "dice") || change(row, "drawn_at") || change(row, "seed_commitment")) return "Lottery";
    return "Phase & clock";
  }
  if (row.entity === "teams" && !change(row, "checked_in_at") && !change(row, "name")) return "Other";
  return KIND_BY_ENTITY[row.entity] ?? "Other";
}

const VERBS: Record<string, string> = { insert: "Added", update: "Changed", delete: "Removed" };

/** What the staff member did, in words: "Checked in team", "Phase LOBBY → READING", "Switch judge auto on". */
export function activityAction(row: ActivityRow): string {
  const many = row.rows > 1 ? ` (${row.rows} rows)` : "";
  if (row.action === "rejected") return `Refused: ${row.entity.replace(/_/g, " ")}`;
  if (row.entity === "event_log") return showValue(change(row, "what") ?? row.changes?.what, 120);
  if (row.entity === "judge_runs") {
    const runs = change(row, "runs")?.to;
    return `Queued judge runs${typeof runs === "number" ? ` (${runs})` : ""}`;
  }
  if (row.entity === "teams" && row.action === "update") {
    const c = change(row, "checked_in_at");
    if (c) return c.to ? "Checked in team" : "Checked out team";
    return "Edited team";
  }
  if (row.entity === "events" && row.action === "update") {
    const phase = change(row, "current_phase");
    if (phase) return `Phase ${showValue(phase.from)} → ${showValue(phase.to)}`;
    const paused = change(row, "paused");
    if (paused) return paused.to ? "Paused the event" : "Resumed the event";
    const features = featureChanges(change(row, "features"));
    if (features.length > 0) return `Switch ${features.join(", ")}`;
    for (const key of ["desk_check_in", "registration_open", "auto_advance"]) {
      const c = change(row, key);
      if (c) return `${key.replace(/_/g, " ")} ${c.to ? "on" : "off"}`;
    }
    if (change(row, "seed_commitment")) return "Published the seed commitment";
    if (change(row, "dice")) return "Ran the squad draw";
    return "Changed event settings";
  }
  if (row.entity === "scores" && row.action === "update" && change(row, "released_at")) return `Released scores${many}`;
  return `${VERBS[row.action] ?? row.action} ${ENTITY_NAMES[row.entity] ?? row.entity.replace(/_/g, " ")}${many}`;
}

const HIDDEN = new Set(["features", "what", "kind"]);

/** The changed fields, "name: Alpha → Alpha Two", at most `max` of them. */
export function activityDetails(row: ActivityRow, max = 6): string[] {
  if (row.entity === "event_log") return row.changes && typeof row.changes.kind === "string" ? [row.changes.kind] : [];
  const out: string[] = [];
  for (const [key, raw] of Object.entries(row.changes ?? {})) {
    if (HIDDEN.has(key) && row.entity !== "judge_runs") continue;
    const c = (raw && typeof raw === "object" ? raw : {}) as Change;
    const name = key.replace(/_/g, " ");
    if ("from" in c && "to" in c) out.push(`${name}: ${showValue(c.from)} → ${showValue(c.to)}`);
    else if ("to" in c) out.push(`${name}: ${showValue(c.to)}`);
    else if ("from" in c) out.push(`${name} was ${showValue(c.from)}`);
  }
  return out.length > max ? [...out.slice(0, max), `+${out.length - max} more`] : out;
}

/** The page's filters: kind and free text over the staff member, action, target and details. */
export function filterActivity(rows: ActivityRow[], { kind, q }: { kind?: string | null; q?: string | null }): ActivityRow[] {
  const needle = (q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (kind && activityKind(r) !== kind) return false;
    if (!needle) return true;
    const hay = [r.actor_name, r.actor_email, r.actor_role, activityAction(r), r.entity, r.entity_label, ...activityDetails(r, 50)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}
