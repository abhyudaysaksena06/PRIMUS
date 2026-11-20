"use client";

// Download a backup as one JSON file. The browser reads it straight from the database, one table at a time
// (public.snapshot_data), so a large backup never passes through the web server, then saves the file.

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { buttonClass } from "@/components/ui/ui";
import { backupFileName } from "./backups";

interface Manifest {
  ok: boolean;
  message?: string;
  backup: Record<string, unknown>;
  tables: { table: string; rows: number; restored: boolean }[];
}

export function DownloadBackup({ id, slug }: { id: number; slug: string }) {
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    setState("Reading…");
    try {
      const sb = supabaseBrowser();
      const head = await sb.rpc("snapshot_data", { p_snapshot: id, p_table: null });
      if (head.error) throw new Error(head.error.message);
      const manifest = head.data as Manifest;
      if (!manifest.ok) throw new Error(manifest.message ?? "This backup could not be read.");
      const tables: Record<string, { columns: string[]; rows: unknown[] }> = {};
      for (const [i, t] of manifest.tables.entries()) {
        setState(`Reading ${t.table} (${i + 1} of ${manifest.tables.length})…`);
        const part = await sb.rpc("snapshot_data", { p_snapshot: id, p_table: t.table });
        if (part.error) throw new Error(part.error.message);
        const d = part.data as { ok: boolean; message?: string; columns: string[]; rows: unknown[] };
        if (!d.ok) throw new Error(d.message ?? `Table ${t.table} could not be read.`);
        tables[t.table] = { columns: d.columns, rows: d.rows };
      }
      const blob = new Blob([JSON.stringify({ backup: manifest.backup, tables })], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFileName(slug, id);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState(null);
    } catch (e) {
      setState(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={buttonClass.secondary} onClick={download} disabled={busy}>
        {busy ? "Downloading…" : "Download JSON"}
      </button>
      {state ? <span className="text-xs text-muted">{state}</span> : null}
    </span>
  );
}
