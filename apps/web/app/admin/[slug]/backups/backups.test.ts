import { describe, expect, test } from "vitest";
import { backupFileName, canonical, fingerprintCode, restoreVerb, sameFingerprint, sharesHeld, size, totalRows } from "./backups";

const fp = {
  rows: { teams: 9, orders: 4 },
  phase: "PRESSURE",
  cash_cents: 1000,
  holdings: { EXCHANGE: 300, SQUAD: 5000 },
};

describe("backups page helpers", () => {
  test("sizes", () => {
    expect(size(0)).toBe("0 KB");
    expect(size(300)).toBe("1 KB");
    expect(size(812 * 1024)).toBe("812 KB");
    expect(size(25_060_000)).toBe("23.9 MB");
  });

  test("fingerprints compare whatever the key order, and a change shows", () => {
    const shuffled = { holdings: { SQUAD: 5000, EXCHANGE: 300 }, cash_cents: 1000, phase: "PRESSURE", rows: { orders: 4, teams: 9 } };
    expect(canonical(shuffled)).toBe(canonical(fp));
    expect(sameFingerprint(fp, shuffled)).toBe(true);
    expect(fingerprintCode(fp)).toBe(fingerprintCode(shuffled));
    expect(fingerprintCode(fp)).toMatch(/^[0-9a-f]{6}$/);
    const moved = { ...fp, cash_cents: 1001 };
    expect(sameFingerprint(fp, moved)).toBe(false);
    expect(fingerprintCode(moved)).not.toBe(fingerprintCode(fp));
    expect(sameFingerprint(fp, null)).toBe(false);
    expect(fingerprintCode(null)).toBe("—");
  });

  test("totals, verbs and file names", () => {
    expect(totalRows(fp)).toBe(13);
    expect(sharesHeld(fp)).toBe(5300);
    expect(restoreVerb({ kind: "BASE" })).toBe("Reset to base");
    expect(restoreVerb({ kind: "ROUND" })).toBe("Restore");
    expect(backupFileName("primus-2026", 12)).toBe("primus-2026-backup-12.json");
  });
});
