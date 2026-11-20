// The one summary table of a load run (docs/LOAD-TEST.md). The bot night (pnpm rehearse), the app load test
// (pnpm app-load-test) and the realtime test (pnpm load-test) each end by printing it and writing it, with its
// details, to out/load-<timestamp>.md. Pure apart from writeSummary.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The bot test's pass bar (the plan's W17): pages, errors, the clearing and realtime delivery. */
export const TARGETS = {
  /** 95% of pages are served in under 2 s. */
  pageMs: 2000,
  pageShare: 0.95,
  /** Under 1% errors (pages, game calls, orders). */
  errorRate: 0.01,
  /** A trading round is cleared within 5 s of its close. */
  clearingMs: 5000,
  /** At least 99% of event broadcasts reach the screens that were connected. */
  deliveryPct: 99,
  /** Supabase Pro: 500 realtime connections and 500 messages a second. */
  proConnections: 500,
  proMessagesPerSecond: 500,
} as const;

/** The p-th percentile (nearest rank) of xs, rounded to whole ms; null when there is nothing to measure. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!);
}

export interface Spread {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export const spread = (xs: readonly number[]): Spread => ({ n: xs.length, p50: percentile(xs, 50), p95: percentile(xs, 95), max: percentile(xs, 100) });

/** The share of xs strictly under a limit (1 when there is nothing to measure is wrong: that is 0). */
export function shareUnder(xs: readonly number[], limit: number): number {
  if (!xs.length) return 0;
  return xs.filter((x) => x < limit).length / xs.length;
}

export interface Check {
  name: string;
  value: string;
  target: string;
  ok: boolean;
}

export interface SummaryRow {
  /** Which tool: rehearse, app-load-test or load-test. */
  run: string;
  slug: string;
  /** Bots playing, or virtual screens loading pages, or teams signed in for the realtime test. */
  screens: number | null;
  /** Realtime connections joined of those asked for. */
  connections: { joined: number; requested: number } | null;
  /** What p50/p95 measure, e.g. "page", "game call", "delivery". */
  latencyOf: string;
  p50Ms: number | null;
  p95Ms: number | null;
  errors: { failed: number; total: number } | null;
  /** The slowest clearing measured (ms after the round's close), or null. */
  clearingMs: number | null;
  deliveryPct: number | null;
  checks: Check[];
}

/** A row passes when every check passes (a row with no checks has measured nothing: it fails). */
export const passed = (row: SummaryRow): boolean => row.checks.length > 0 && row.checks.every((c) => c.ok);

export const pct = (x: number, digits = 2): string => `${(x * 100).toFixed(digits)}%`;
const ms = (x: number | null): string => (x === null ? "—" : `${Math.round(x)}`);

// ───────────────────────────── The checks ─────────────────────────────

/** 95% of pages under 2 s (failed pages are counted as errors, not here). */
export function pageCheck(latencies: readonly number[], what = "pages"): Check {
  const share = shareUnder(latencies, TARGETS.pageMs);
  return {
    name: `${what} under ${TARGETS.pageMs / 1000} s`,
    value: latencies.length ? `${pct(share, 1)} (p95 ${percentile(latencies, 95)} ms, ${latencies.length} measured)` : "none measured",
    target: `≥ ${pct(TARGETS.pageShare, 0)}`,
    ok: latencies.length > 0 && share >= TARGETS.pageShare,
  };
}

export function errorCheck(failed: number, total: number, what = "errors"): Check {
  const rate = total ? failed / total : 0;
  return {
    name: what,
    value: total ? `${pct(rate)} (${failed} of ${total})` : "nothing attempted",
    target: `< ${pct(TARGETS.errorRate, 0)}`,
    ok: total > 0 && rate < TARGETS.errorRate,
  };
}

export function clearingCheck(clearings: readonly number[]): Check {
  const worst = clearings.length ? Math.max(...clearings) : null;
  return {
    name: "clearing after the close",
    value: worst === null ? "no round measured" : `${clearings.length} round${clearings.length === 1 ? "" : "s"}, slowest ${Math.round(worst)} ms`,
    target: `< ${TARGETS.clearingMs} ms`,
    ok: worst !== null && worst < TARGETS.clearingMs,
  };
}

export function deliveryCheck(delivered: number, expected: number): Check {
  const p = expected ? (delivered / expected) * 100 : null;
  return {
    name: "realtime delivery",
    value: p === null ? "no broadcast measured" : `${p.toFixed(2)}% (${delivered} of ${expected})`,
    target: `≥ ${TARGETS.deliveryPct}%`,
    ok: p !== null && p >= TARGETS.deliveryPct,
  };
}

export function joinCheck(joined: number, requested: number): Check {
  const share = requested ? joined / requested : 0;
  return {
    name: "realtime connections joined",
    value: `${joined} of ${requested}`,
    target: `≥ 99%${requested > TARGETS.proConnections ? ` (asked for more than the Pro ${TARGETS.proConnections})` : ""}`,
    ok: requested > 0 && share >= 0.99,
  };
}

/** Every team or console that should be signed in is. */
export function signInCheck(signedIn: number, wanted: number, what = "sign-ins"): Check {
  return { name: what, value: `${signedIn} of ${wanted}`, target: "≥ 99%", ok: wanted > 0 && signedIn / wanted >= 0.99 };
}

// ───────────────────────────── The table ─────────────────────────────

const HEAD = ["Run", "Event", "Screens", "Connections", "p50 ms", "p95 ms", "Errors", "Clearing ms", "Realtime delivery", "Result"];

function cells(r: SummaryRow): string[] {
  return [
    r.run,
    r.slug,
    r.screens === null ? "—" : String(r.screens),
    r.connections ? `${r.connections.joined} of ${r.connections.requested}` : "—",
    r.p50Ms === null ? "—" : `${ms(r.p50Ms)} (${r.latencyOf})`,
    r.p95Ms === null ? "—" : `${ms(r.p95Ms)} (${r.latencyOf})`,
    r.errors ? (r.errors.total ? `${pct(r.errors.failed / r.errors.total)} (${r.errors.failed}/${r.errors.total})` : "0 attempted") : "—",
    ms(r.clearingMs),
    r.deliveryPct === null ? "—" : `${r.deliveryPct.toFixed(2)}%`,
    passed(r) ? "PASS" : "FAIL",
  ];
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The summary as a Markdown table, one line per run. */
export function summaryTable(rows: readonly SummaryRow[]): string {
  const line = (xs: string[]) => `| ${xs.map(esc).join(" | ")} |`;
  return [line(HEAD), line(HEAD.map(() => "---")), ...rows.map((r) => line(cells(r)))].join("\n");
}

/** Every check of every row, as a Markdown table (what was measured against which target). */
export function checksTable(rows: readonly SummaryRow[]): string {
  const line = (xs: string[]) => `| ${xs.map(esc).join(" | ")} |`;
  const out = [line(["Run", "Check", "Measured", "Target", "Result"]), line(["---", "---", "---", "---", "---"])];
  for (const r of rows) for (const c of r.checks) out.push(line([r.run, c.name, c.value, c.target, c.ok ? "pass" : "FAIL"]));
  return out.join("\n");
}

/** The whole file: title, the summary table, the checks and any details (Markdown) the run adds. */
export function summaryMarkdown(rows: readonly SummaryRow[], { title, at, details = "" }: { title: string; at: Date; details?: string }): string {
  return [
    `# ${title}`,
    "",
    `${at.toISOString()} · ${rows.every(passed) ? "PASS" : "FAIL"} · targets: 95% of pages under 2 s, under 1% errors, clearing under 5 s, realtime delivery at least 99% (docs/LOAD-TEST.md)`,
    "",
    summaryTable(rows),
    "",
    "## Checks",
    "",
    checksTable(rows),
    ...(details.trim() ? ["", "## Details", "", details.trim()] : []),
    "",
  ].join("\n");
}

/** out/load-<timestamp>.md, the timestamp to the millisecond (file-name safe). */
export function summaryFileName(at: Date): string {
  return `load-${at.toISOString().replace(/[:.]/g, "-")}.md`;
}

/** Writes the summary file (never over another run's: a clash gets a suffix) and returns its path. */
export function writeSummary(rows: readonly SummaryRow[], opts: { title: string; at?: Date; details?: string; dir?: string }): string {
  const at = opts.at ?? new Date();
  const dir = opts.dir ?? "out";
  mkdirSync(dir, { recursive: true });
  let file = join(dir, summaryFileName(at));
  for (let i = 2; existsSync(file); i++) file = join(dir, summaryFileName(at).replace(/\.md$/, `-${i}.md`));
  writeFileSync(file, summaryMarkdown(rows, { title: opts.title, at, details: opts.details }));
  return file;
}

/** Prints the table and the checks, writes the file, and says PASS or FAIL. Returns the process exit code. */
export function report(rows: readonly SummaryRow[], opts: { title: string; details?: string; dir?: string; log?: (s: string) => void }): number {
  const log = opts.log ?? console.log;
  const file = writeSummary(rows, opts);
  log("");
  log(summaryTable(rows));
  log("");
  log(checksTable(rows));
  log("");
  const ok = rows.every(passed);
  log(`${ok ? "PASS" : "FAIL"}: summary written to ${file}`);
  return ok ? 0 : 1;
}
