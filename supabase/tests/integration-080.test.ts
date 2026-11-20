// Migration 080: the fixes found while merging tonight's changes.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const landed = async (n: Night, needle: string) =>
  (await n.one(
    `select coalesce(string_agg(s.nspname || '.' || p.proname, ',' order by p.proname), '') as f
       from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('app', 'public') and strpos(p.prosrc, $1) > 0`,
    [needle],
  )).f;

describe("integration fixes (080)", () => {
  test("each patch landed in exactly its function", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    expect(await landed(n, "and (select e.format from public.events e where e.id = p_event) <> 'PRIMUS'")).toBe("app.pay_consultant_bonuses");
    expect(await landed(n, "d.sector is not distinct from v_mine.sector")).toBe("app.team_primus_facts");
    expect(await landed(n, "unnest(enum_range(null::public.submission_type)) t where app.scoring_closed(p_event, t)")).toBe("app.auto_submit_due_drafts");
    expect((await n.one("select app.snapshot_keep() as k")).k).toBe(60);
  });

  test("the seed is published when a PRIMUS night reaches settlement, not before", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("integration-080");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const stored = (await n.one("select seed from event_secrets where event_id = $1", [n.eventId])).seed;
    expect(stored).toBe(seed);
    await n.q("update events set current_phase = 'CLOSE' where id = $1", [n.eventId]);
    expect((await n.one("select seed_revealed from events where id = $1", [n.eventId])).seed_revealed).toBeNull();
    await n.q("update events set current_phase = 'SETTLEMENT' where id = $1", [n.eventId]);
    expect((await n.one("select seed_revealed from events where id = $1", [n.eventId])).seed_revealed).toBe(seed);
  });
});
