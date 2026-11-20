// The Backups page's data (public.snapshots_list, migration 075) and the pure helpers that show it.

export interface Fingerprint {
  rows?: Record<string, number>;
  phase?: string;
  cash_cents?: number;
  collateral_cents?: number;
  exchange_cash_cents?: number;
  holdings?: Record<string, number>;
  exchange_inventory?: number;
  market_price?: number;
  ledger_cash?: number;
}

export interface Backup {
  id: number;
  label: string;
  kind: "BASE" | "PHASE" | "ROUND" | "RELEASE" | "MANUAL" | "SAFETY";
  taken_at: string;
  game_time: string | null;
  phase: string | null;
  tables: number;
  rows: number;
  size_bytes: number;
  ms: number | null;
  fingerprint: Fingerprint;
  by: string | null;
}

export interface QueuedBackup {
  id: number;
  label: string;
  kind: string;
  requested_at: string;
  attempts: number;
  note: string | null;
}

export interface RestoreRequest {
  id: number;
  snapshot_id: number | null;
  label: string;
  taken_at: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "RUNNING" | "DONE" | "FAILED" | "REJECTED" | "CANCELLED";
  requested_by_name: string | null;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  note: string | null;
  finished_at: string | null;
  error: string | null;
  before_backup: number | null;
  mine: boolean;
}

export interface BackupsData {
  backups_on: boolean;
  paused: boolean;
  phase: string;
  keep: number;
  now: Fingerprint | null;
  snapshots: Backup[];
  queue: QueuedBackup[];
  restores: RestoreRequest[];
}

/** "812 KB", "23.9 MB". */
export function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Stable text of a fingerprint (keys sorted at every level), so two fingerprints compare as strings. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

/** A short code for a fingerprint (6 hex digits), to compare a backup with the event at a glance. */
export function fingerprintCode(fp: Fingerprint | null | undefined): string {
  if (!fp) return "—";
  // FNV-1a over the canonical text: not for security, only to tell fingerprints apart on screen.
  let h = 0x811c9dc5;
  for (const ch of canonical(fp)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/** Same event state (the fingerprints match exactly)? */
export function sameFingerprint(a: Fingerprint | null | undefined, b: Fingerprint | null | undefined): boolean {
  return !!a && !!b && canonical(a) === canonical(b);
}

/** Rows in all the tables a restore writes back. */
export function totalRows(fp: Fingerprint): number {
  return Object.values(fp.rows ?? {}).reduce((s, n) => s + Number(n), 0);
}

/** Shares held, all lots together. */
export function sharesHeld(fp: Fingerprint): number {
  return Object.values(fp.holdings ?? {}).reduce((s, n) => s + Number(n), 0);
}

/** What the restore button says: Base is a reset to the start. */
export function restoreVerb(b: Pick<Backup, "kind">): string {
  return b.kind === "BASE" ? "Reset to base" : "Restore";
}

export const KIND_LABEL: Record<Backup["kind"], string> = {
  BASE: "Base",
  PHASE: "Phase",
  ROUND: "Round",
  RELEASE: "Scores",
  MANUAL: "By hand",
  SAFETY: "Before a restore",
};

export const STATUS_LABEL: Record<RestoreRequest["status"], string> = {
  PENDING: "Waiting for a second person",
  APPROVED: "Approved: runs within 10 s",
  RUNNING: "Running",
  DONE: "Restored",
  FAILED: "Failed: nothing changed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** The download's file name: primus-2026-backup-12.json. */
export function backupFileName(slug: string, id: number): string {
  return `${slug}-backup-${id}.json`;
}
