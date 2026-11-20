// Migration 075: backups after every phase, trading round and score release, and resets (two people, paused event).
// A PRIMUS night is played through the real game functions; backups are taken at several points (the job's function
// is called directly: pg_cron does not run here); every backup is restored, the event's fingerprint equals the
// backup's, the ledger invariants hold, and the game goes on (a later round opens and clears, the draw runs again).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { as, user } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

/**
 * What the pg_cron job does every 10 seconds (no minimum gap, so a test can take backups back to back). `taken` counts
 * this event's new backups (the job also serves the other tests' events); restores are counted for the whole run.
 */
async function runJob(n: Night, gap = "0 seconds") {
  const before = (await n.one("select coalesce(max(id), 0)::int as m from app.snapshots where event_id = $1", [n.eventId])).m;
  const r = (await n.one("select app.process_snapshot_requests($1::interval) as r", [gap])).r as { restored: number; failed: number };
  const taken = (await n.one("select count(*)::int as c from app.snapshots where event_id = $1 and id > $2 and kind <> 'SAFETY'", [n.eventId, before])).c;
  return { ...r, taken: taken as number };
}

async function live(n: Night) {
  return (await n.one("select app.live_fingerprint($1) as f", [n.eventId])).f;
}

interface Snap {
  id: number;
  label: string;
  kind: string;
  phase: string;
  fingerprint: Record<string, unknown>;
}

/** Runs the job, which must take exactly one backup; it equals the event as it is (nothing moved since). */
async function backup(n: Night, invariants = true): Promise<Snap> {
  const r = await runJob(n);
  expect(r).toMatchObject({ taken: 1, failed: 0 });
  const s = await n.one<Snap>(
    "select id::int, label, kind, phase::text, fingerprint from app.snapshots where event_id = $1 and kind <> 'SAFETY' order by id desc limit 1",
    [n.eventId],
  );
  expect(await live(n)).toEqual(s.fingerprint);
  if (invariants) await n.checkInvariants();
  return s;
}

/** Two people restore a backup: the lead asks, `approver` approves, the job runs it. The event must be paused. */
async function restore(n: Night, snap: Snap, approver = n.second, invariants = true) {
  const asked = await n.ok(n.lead, "request_restore", snap.id, `Replay from ${snap.label}`);
  await n.ok(approver, "approve_restore", asked.restore_id, true, null);
  const before = await live(n);
  const r = await runJob(n);
  const req = await n.one("select status, error, safety_snapshot_id::int as safety from app.snapshot_restores where id = $1", [asked.restore_id]);
  expect(req.error).toBeNull();
  expect(r).toMatchObject({ restored: 1, failed: 0 });
  expect(req.status).toBe("DONE");
  // The event is exactly the backup again, still paused, and its ledger adds up.
  expect(await live(n)).toEqual(snap.fingerprint);
  expect((await n.one("select current_phase::text as p, paused from events where id = $1", [n.eventId]))).toEqual({ p: snap.phase, paused: true });
  if (invariants) await n.checkInvariants();
  // What it was just before is a backup of its own.
  const safety = await n.one("select kind, label, fingerprint from app.snapshots where id = $1", [req.safety]);
  expect(safety.kind).toBe("SAFETY");
  expect(safety.label).toContain(`Before restoring #${snap.id}`);
  expect(safety.fingerprint).toEqual(before);
}

describe("backups and resets", () => {
  test("a PRIMUS night: backed up at every step; each backup restored by two people; the game goes on", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("snapshots");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));

    // Leaving Setup queues the Base backup (one request per label, so the game's transaction only inserts a row).
    await n.advanceTo("CHECKIN");
    expect((await n.q("select kind, label from app.snapshot_requests where event_id = $1 order by id", [n.eventId]))).toEqual([
      { kind: "BASE", label: "Base" },
      { kind: "PHASE", label: "Start of Check-in" },
    ]);
    expect((await n.one("select count(*)::int as c from app.snapshots where event_id = $1", [n.eventId])).c).toBe(0);
    const base = await backup(n);
    expect(base).toMatchObject({ kind: "BASE", label: "Base · Start of Check-in", phase: "CHECKIN" });

    // The draw.
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    const drawn = await backup(n);
    expect(drawn.label).toBe("Start of Briefing · Start of Squad draw");
    expect(drawn.fingerprint.rows).toMatchObject({ squads: 3, companies: 3 });

    // Round 1: pitches, judged and released.
    const [a, b, c] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    for (const [i, s] of [a, b, c].entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Snap Co ${i}`, ticker: ["SNA", "SNB", "SNC"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const [i, s] of [a, b, c].entries()) await n.judge(s.company_id, "PITCH", [[50, 52, 54], [70, 70, 71], [60, 61, 62]][i]!);
    await n.deadlinePassed("CALL_1");
    // A release updates every score row but queues one backup.
    await n.org("release_scores", n.eventId, "PITCH");
    expect((await n.q("select label from app.snapshot_requests where event_id = $1 and processed_at is null order by id", [n.eventId])).map((r) => r.label)).toEqual([
      "Start of Round 1: Build",
      "Start of Round 1: Judging",
      "Scores released: PITCH",
    ]);
    const released = await backup(n);
    expect(released).toMatchObject({ kind: "RELEASE", phase: "READING" });
    // The judge's full texts stay out of backups.
    await n.q("update judge_runs set request_text = 'the whole prompt', raw_response = 'the whole reply' where event_id = $1", [n.eventId]);

    // Round 2: the crisis, then two trading rounds with orders.
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
    await n.openRound(1);
    await n.orderNet(a.company_id, 3000, [b.f_code, c.f_code]);
    await n.orderNet(b.company_id, 1500, [a.f_code]);
    await n.clearRound(1);
    const round1 = await backup(n);
    expect(round1.label).toContain("Trading round 1 cleared");
    expect(round1).toMatchObject({ kind: "ROUND", phase: "PRESSURE" });
    expect(round1.fingerprint.holdings).toHaveProperty("EXCHANGE");
    await n.openRound(2);
    await n.orderNet(a.company_id, -1000, [b.f_code]);
    await n.orderNet(c.company_id, 2000, [a.f_code, b.f_code]);
    await n.clearRound(2);
    const round2 = await backup(n);
    expect(round2.label).toBe("Trading round 2 cleared");
    // An order waiting in an open round is backed up as it is.
    await n.openRound(3);
    await n.orderNet(c.company_id, 500, [b.f_code]);
    await n.ok(n.lead, "request_snapshot", n.eventId, "Round 3 open");
    const open3 = await backup(n);
    expect(open3).toMatchObject({ kind: "MANUAL", label: "Round 3 open" });
    expect(open3.fingerprint.rows).toMatchObject({ orders: expect.any(Number) });

    // The download: every table, the judge's texts left out.
    const manifest = await as(db.pool, n.lead, async (cl) => (await cl.query("select public.snapshot_data($1) as d", [open3.id])).rows[0].d);
    expect(manifest.ok).toBe(true);
    expect(manifest.backup).toMatchObject({ id: open3.id, phase: "PRESSURE", fingerprint: open3.fingerprint });
    const tables = manifest.tables as { table: string; rows: number; restored: boolean }[];
    expect(tables[0]).toMatchObject({ table: "events", rows: 1 });
    expect(tables.map((t) => t.table)).toEqual(expect.arrayContaining(["teams", "orders", "ledger_entries", "judge_runs", "event_log", "practice_ticks"]));
    expect(tables.find((t) => t.table === "event_log")).toMatchObject({ restored: false });
    const runs = await as(db.pool, n.fairness, async (cl) => (await cl.query("select public.snapshot_data($1, 'judge_runs') as d", [open3.id])).rows[0].d);
    expect(runs.rows).toHaveLength(3);
    expect(runs.columns).not.toContain("request_text");
    expect(runs.rows[0]).not.toHaveProperty("raw_response");
    expect(runs.rows[0]).toHaveProperty("rationale");
    const orders = await as(db.pool, n.lead, async (cl) => (await cl.query("select public.snapshot_data($1, 'orders') as d", [open3.id])).rows[0].d);
    expect(orders.rows).toHaveLength(tables.find((t) => t.table === "orders")!.rows);

    // ── Restores. Never while a round is open (migration 081): round 3 clears first. Pause; then each backup, newest
    // to oldest and back, by two people.
    await n.clearRound(3);
    await n.org("pause_event", n.eventId);
    await restore(n, round1);
    // The judge's texts stored now are kept for the runs written back.
    expect((await n.one("select count(*)::int as c from judge_runs where event_id = $1 and raw_response = 'the whole reply'", [n.eventId])).c).toBe(3);
    // Round 2 is open again for the funds as of the backup: resume, and the game goes on from there.
    expect((await n.one("select status from rounds where event_id = $1 and number = 2", [n.eventId])).status).toBe("SCHEDULED");
    await n.org("resume_event", n.eventId);
    await n.openRound(2);
    await n.orderNet(b.company_id, -500, [a.f_code]);
    await n.clearRound(2); // checks the clearing against the engine
    await n.checkInvariants();
    expect((await n.one("select count(*)::int as c from orders where event_id = $1 and round_id = (select id from rounds where event_id = $1 and number = 2)", [n.eventId])).c).toBeGreaterThan(0);

    await n.org("pause_event", n.eventId);
    await restore(n, open3, n.fairness); // forward again, to a backup taken with a round open; the fairness officer approves
    expect((await n.one("select status from rounds where event_id = $1 and number = 3", [n.eventId])).status).toBe("OPEN");
    // While it is open no restore is approved: it clears first.
    const refused = await n.ok(n.lead, "request_restore", round2.id, "Back to round 2");
    expect(await n.call(n.second, "approve_restore", refused.restore_id, true, null)).toMatchObject({ ok: false, code: "ROUND_OPEN" });
    await n.ok(n.lead, "approve_restore", refused.restore_id, false, null);
    await n.org("resume_event", n.eventId);
    await n.clearRound(3);
    await n.org("pause_event", n.eventId);
    await restore(n, round2);
    await restore(n, released);
    await restore(n, drawn);
    await restore(n, base);
    // Reset to base: no squads, no companies' work, every team's starting cash; the logins are the same.
    expect((await n.one("select count(*)::int as c from squads where event_id = $1", [n.eventId])).c).toBe(0);
    expect((await n.one("select count(*)::int as c from accounts a join teams t on t.id = a.team_id where t.event_id = $1", [n.eventId])).c).toBe(9);
    // The night is played again from there: the draw runs again.
    await n.org("resume_event", n.eventId);
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    expect((await n.one("select count(*)::int as c from squads where event_id = $1", [n.eventId])).c).toBe(3);
    await n.checkInvariants();

    // Logged, and every screen told to re-read.
    const logged = (await n.q("select what from event_log where event_id = $1 and what like 'Restored backup %' order by id", [n.eventId])).map((r) => r.what);
    expect(logged).toHaveLength(6);
    expect(logged[0]).toMatch(/^Restored backup .*Trading round 1 cleared taken at \d\d:\d\d$/);
    expect(
      (await n.one("select count(*)::int as c from realtime.messages where topic = $1 and event = 'phase' and payload ->> 'restored' = 'true'", [`event:${n.eventId}`])).c,
    ).toBe(6);
    expect((await n.one("select count(*)::int as c from audit_log where event_id = $1 and action = 'restore'", [n.eventId])).c).toBe(6);
  }, 240_000);

  test("refused while the event runs, to the person who asked, and to anyone but organisers and the fairness officer", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(sha256Hex("refusals")));
    await n.advanceTo("CHECKIN");
    const snap = await backup(n);
    const team = n.team([...n.ev.teams.keys()][0]!);
    const display = user(n.ev.staff.get("display@example.org")!);

    expect(await n.call(n.lead, "request_restore", snap.id, "Replay the check-in")).toMatchObject({ ok: false, code: "NOT_PAUSED" });
    await n.org("pause_event", n.eventId);
    await expect(n.call(team, "request_restore", snap.id, "Replay the check-in")).rejects.toThrow(/only an organiser/);
    await expect(n.call(n.fairness, "request_restore", snap.id, "Replay the check-in")).rejects.toThrow(/only an organiser/);
    expect(await n.call(n.lead, "request_restore", snap.id, "short")).toMatchObject({ ok: false, code: "NO_REASON" });
    const asked = await n.ok(n.lead, "request_restore", snap.id, "Replay the check-in");
    expect(await n.call(n.second, "request_restore", snap.id, "Replay the check-in again")).toMatchObject({ ok: false, code: "ALREADY_ASKED" });
    expect(await n.call(n.lead, "approve_restore", asked.restore_id, true, null)).toMatchObject({ ok: false, code: "SAME_PERSON" });
    await expect(n.call(team, "approve_restore", asked.restore_id, true, null)).rejects.toThrow(/only an organiser or the fairness officer/);
    await expect(n.call(display, "approve_restore", asked.restore_id, true, null)).rejects.toThrow(/only an organiser or the fairness officer/);
    // Whoever asked may cancel.
    expect(await n.ok(n.lead, "approve_restore", asked.restore_id, false, null)).toMatchObject({ status: "CANCELLED" });
    expect(await n.call(n.second, "approve_restore", asked.restore_id, true, null)).toMatchObject({ ok: false, code: "NOT_WAITING" });

    // Approved, then resumed before the job runs: it fails and nothing changes.
    const again = await n.ok(n.second, "request_restore", snap.id, "Replay the check-in, take two");
    await n.org("resume_event", n.eventId);
    expect(await n.call(n.lead, "approve_restore", again.restore_id, true, null)).toMatchObject({ ok: false, code: "NOT_PAUSED" });
    await n.org("pause_event", n.eventId);
    await n.ok(n.lead, "approve_restore", again.restore_id, true, "ok");
    await n.org("resume_event", n.eventId);
    const before = await live(n);
    expect(await runJob(n)).toMatchObject({ restored: 0, failed: 1 });
    expect(await n.one("select status, error from app.snapshot_restores where id = $1", [again.restore_id])).toMatchObject({
      status: "FAILED",
      error: expect.stringContaining("resumed"),
    });
    expect(await live(n)).toEqual(before);
    expect((await n.one("select count(*)::int as c from app.snapshots where event_id = $1 and kind = 'SAFETY'", [n.eventId])).c).toBe(0);
    expect((await n.one("select count(*)::int as c from event_log where event_id = $1 and what like 'Restore failed%'", [n.eventId])).c).toBe(1);

    // The list and the download are for organisers and the fairness officer only.
    for (const caller of [team, display]) {
      await expect(n.call(caller, "snapshots_list", n.eventId)).rejects.toThrow(/only organisers and the fairness officer/);
      await expect(n.call(caller, "snapshot_data", snap.id, null)).rejects.toThrow(/only organisers and the fairness officer/);
      await expect(n.call(caller, "request_snapshot", n.eventId, null)).rejects.toThrow(/only an organiser/);
    }
    const list = await n.ok(n.fairness, "snapshots_list", n.eventId);
    expect(list.snapshots).toHaveLength(1);
    expect(list.restores.map((r: { status: string }) => r.status)).toEqual(["FAILED", "CANCELLED"]);
    expect(list.now).toBeNull(); // running: no fingerprint of "now"
  }, 120_000);

  test("switched off, nothing is queued; Back up now; merged and spaced requests; the newest are kept", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(sha256Hex("switch")));
    await n.org("set_feature", n.eventId, "snapshots", false);
    await n.advanceTo("SQUAD_DRAW");
    expect((await n.one("select count(*)::int as c from app.snapshot_requests where event_id = $1", [n.eventId])).c).toBe(0);
    expect(await n.call(n.lead, "request_snapshot", n.eventId, null)).toMatchObject({ ok: false, code: "BACKUPS_OFF" });
    expect(await runJob(n)).toMatchObject({ taken: 0 });

    await n.org("set_feature", n.eventId, "snapshots", true);
    expect(await n.ok(n.lead, "request_snapshot", n.eventId, null)).toMatchObject({ queued: true, label: "Backup by Event lead" });
    expect(await n.call(n.lead, "request_snapshot", n.eventId, "x".repeat(81))).toMatchObject({ ok: false, code: "BAD_LABEL" });
    await n.ok(n.second, "request_snapshot", n.eventId, "Before the draw");
    const manual = await backup(n);
    expect(manual).toMatchObject({ kind: "MANUAL", label: "Backup by Event lead · Before the draw" });
    const listed = await n.ok(n.lead, "snapshots_list", n.eventId);
    expect(listed.snapshots[0]).toMatchObject({ id: manual.id, label: manual.label, by: "Event lead", tables: expect.any(Number) });
    expect(listed.snapshots[0].size_bytes).toBeGreaterThan(0);

    // At most one backup every few seconds per event: a request right after waits for the next run.
    await n.ok(n.lead, "request_snapshot", n.eventId, "Too soon");
    expect(await runJob(n, "5 seconds")).toMatchObject({ taken: 0 });
    expect((await n.ok(n.lead, "snapshots_list", n.eventId)).queue).toEqual([expect.objectContaining({ label: "Too soon" })]);
    await backup(n);

    // Requests queued before backups were switched off are dropped, not taken.
    await n.ok(n.lead, "request_snapshot", n.eventId, "Then switched off");
    await n.org("set_feature", n.eventId, "snapshots", false);
    expect(await runJob(n)).toMatchObject({ taken: 0 });
    expect((await n.one("select note from app.snapshot_requests where event_id = $1 and label = 'Then switched off'", [n.eventId])).note).toMatch(/switched off/);
    await n.org("set_feature", n.eventId, "snapshots", true);

    // The newest app.snapshot_keep() are kept, and the Base backup always.
    await n.q("create or replace function app.snapshot_keep() returns int language sql immutable as $$ select 2 $$");
    try {
      for (let i = 0; i < 3; i++) {
        await n.ok(n.lead, "request_snapshot", n.eventId, `Keep ${i}`);
        await backup(n);
      }
      const kept = (await n.q("select kind, label from app.snapshots where event_id = $1 order by id", [n.eventId])).map((r) => r.label);
      expect(kept).toEqual(["Keep 1", "Keep 2"]);
    } finally {
      await n.q("create or replace function app.snapshot_keep() returns int language sql immutable as $$ select 200 $$");
    }
  }, 120_000);

  test("size and speed: a whole night's rows for 50 per track, backed up and restored (estimate for 200 per track: x4)", async () => {
    const n = await Night.create(db.pool, 50, "PRIMUS");
    const seed = sha256Hex("snapshot-size");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "6");
    await n.advanceTo("BUILD");
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    await n.org("seal_missing_scores", n.eventId, "PITCH");
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    const E = n.eventId;
    // A night's worth of rows, written straight in (as the game would have by the end of the night): every trading
    // round cleared with 5 filled orders per fund and their ledger pairs, prices and ranges; 10 written works per
    // company (drafts, submissions, 3 judge runs each, a score); chats; the practice market's ticks and trades; the log.
    const words = `array['market','supplier','growth','customers','cash','risk','plan','price','margin','launch','hire','team','crisis','demand','cost','partner','delay','quality','pilot','city','sales','channel','board','loan','runway','churn','retail','policy','data','trust']`;
    const text = (len: number) => `(select string_agg((${words})[1 + floor(random() * 30)::int], ' ') from generate_series(1, ${len} + (g % 7)))`;
    await n.q("update rounds set status = 'CLEARED', opened_at = now(), closed_at = now(), cleared_at = now() where event_id = $1", [E]);
    await n.q(
      `insert into orders (event_id, round_id, team_id, company_id, type, qty, status, entry_price, fill_price, filled_at, reserve_cents)
       select $1, r.id, f.id, c.id, (array['BUY','SELL','SHORT','COVER'])[1 + (g % 4)]::public.order_type, 100 + g * 7, 'FILLED', 1000 + g, 1000 + g, now(), 0
         from public.rounds r
        cross join (select id, row_number() over (order by id) as rn from public.teams where event_id = $1 and track = 'FINANCE') f
        cross join generate_series(1, 5) g
         join (select id, row_number() over (order by id) as rn from public.companies where event_id = $1) c on c.rn = 1 + ((f.rn * 7 + g * 3 + r.number) % 50)
        where r.event_id = $1`,
      [E],
    );
    await n.q(
      `with o as (select o.*, gen_random_uuid() as txn from public.orders o where o.event_id = $1 and o.status = 'FILLED')
       insert into ledger_entries (event_id, txn_id, kind, team_id, company_id, lot, cash_delta_cents, share_delta, price_cents, round_id, ref_table, ref_id)
       select event_id, txn, 'TRADE'::public.ledger_kind, team_id, company_id, 'EXCHANGE'::public.lot_type, -qty::bigint * fill_price, qty,
              fill_price, round_id, 'orders', id from o
       union all
       select event_id, txn, 'TRADE'::public.ledger_kind, null::uuid, company_id, null::public.lot_type, qty::bigint * fill_price, -qty,
              fill_price, round_id, 'orders', id from o`,
      [E],
    );
    await n.q(
      `insert into round_prices (event_id, company_id, round_id, kind, market_before, market_after, ai_before, ai_after, buy_qty, sell_qty, net_qty, capped_net)
       select $1, c.id, r.id, 'CLEARING', 1000 + r.number, 1001 + r.number, 1000, 1000, 300, 200, 100, 100
         from public.rounds r cross join public.companies c where r.event_id = $1 and c.event_id = $1
       on conflict do nothing`,
      [E],
    );
    await n.q(
      `insert into round_ranges (round_id, company_id, event_id, open_cents, high_cents, low_cents, last_cents)
       select r.id, c.id, $1, 1000, 1010, 990, 1001 from public.rounds r cross join public.companies c where r.event_id = $1 and c.event_id = $1
       on conflict do nothing`,
      [E],
    );
    await n.q(
      `insert into public_ledger (event_id, kind, label, company_id, ticker, cash_cents, shares, price_cents, round_number, details)
       select $1, 'TRADING', 'Round ' || r.number || ' · ' || coalesce(c.ticker, 'XXX'), c.id, c.ticker, 123456, 300, 1001, r.number,
              jsonb_build_object('buy', 300, 'sell', 200, 'net', 100)
         from public.rounds r cross join public.companies c where r.event_id = $1 and c.event_id = $1`,
      [E],
    );
    await n.q(
      `insert into holdings (event_id, team_id, company_id, lot, qty, cost_cents)
       select $1, f.id, c.id, 'EXCHANGE', 500, 500000
         from (select id, row_number() over (order by id) as rn from public.teams where event_id = $1 and track = 'FINANCE') f
         join (select id, row_number() over (order by id) as rn from public.companies where event_id = $1) c on (c.rn + f.rn) % 3 = 0
       on conflict do nothing`,
      [E],
    );
    const types = `array['CRISIS_1','CRISIS_2','CRISIS_3','CRISIS_4','SOLUTION','ADVICE_1','ADVICE_2','ADVICE_3','ADVICE_4','ADVICE_5']`;
    await n.q(
      `insert into submission_drafts (event_id, squad_id, company_id, type, content, version)
       select $1, c.squad_id, c.id, t::public.submission_type,
              jsonb_build_object('impact', ${text(60)}, 'response', ${text(90)}, 'money', ${text(50)}, 'risks', ${text(50)}, 'next_steps', ${text(40)}), 12
         from public.companies c cross join unnest(${types}) t cross join lateral (select (abs(hashtext(c.id::text || t)) % 7) as g) gg
        where c.event_id = $1 on conflict do nothing`,
      [E],
    );
    await n.q(
      `insert into submissions (event_id, squad_id, company_id, type, content, body_text, word_count, submitted_by_team)
       select d.event_id, d.squad_id, d.company_id, d.type, d.content, d.content::text, 330, c.product_team_id
         from public.submission_drafts d join public.companies c on c.id = d.company_id where d.event_id = $1 and d.type <> 'PITCH'`,
      [E],
    );
    await n.q(
      `insert into judge_runs (event_id, submission_id, company_id, type, run_no, model, status, request_text, raw_response, breakdown, total, rationale, finished_at)
       select s.event_id, s.id, s.company_id, s.type, k, 'judge-model', 'DONE', ${text(700)}, ${text(250)},
              jsonb_build_object('impact', 10 + k, 'response', 20, 'money', 15, 'risks', 10, 'fit', 9), 60 + k, ${text(110)}, now()
         from public.submissions s cross join generate_series(1, 3) k cross join lateral (select (abs(hashtext(s.id::text)) % 7) as g) gg
        where s.event_id = $1`,
      [E],
    );
    await n.q(
      `insert into scores (event_id, company_id, type, submission_id, status, run_totals, median, final_score, breakdown, rationale, tier_bp)
       select s.event_id, s.company_id, s.type, s.id, 'RELEASED', '{61,62,63}', 62, 62,
              jsonb_build_object('impact', 12, 'response', 20, 'money', 15, 'risks', 10, 'fit', 9), ${text(110)}, 500
         from public.submissions s cross join lateral (select (abs(hashtext(s.id::text)) % 7) as g) gg
        where s.event_id = $1 on conflict do nothing`,
      [E],
    );
    await n.q(
      `insert into squad_messages (event_id, squad_id, team_id, body)
       select $1, s.id, s.product_team_id, ${text(20)} from public.squads s cross join generate_series(1, 100) g where s.event_id = $1`,
      [E],
    );
    await n.q(
      `insert into hire_messages (event_id, company_id, firm_team_id, team_id, body)
       select $1, c.id, s.consulting_team_id, c.product_team_id, ${text(20)}
         from public.companies c join public.squads s on s.id = c.squad_id cross join generate_series(1, 40) g where c.event_id = $1`,
      [E],
    );
    await n.q(
      `insert into practice_ticks (event_id, ticker_team_id, step, at, price_cents)
       select $1, t.id, k, now() + make_interval(secs => k * 5), 1000 + (k % 50)
         from public.teams t cross join generate_series(0, 479) k where t.event_id = $1 and t.track = 'PRODUCT'`,
      [E],
    );
    await n.q(
      `insert into practice_trades (event_id, team_id, ticker_team_id, type, qty, price_cents)
       select $1, f.id, p.id, 'BUY', 100, 1000
         from public.teams f join public.teams p on p.event_id = f.event_id and p.track = 'PRODUCT'
        where f.event_id = $1 and f.track = 'FINANCE'`,
      [E],
    );
    await n.q(
      `insert into event_log (event_id, kind, what) select $1, 'TRADING', 'Trading round ' || g || ' closed and cleared' from generate_series(1, 500) g`,
      [E],
    );

    await n.ok(n.lead, "request_snapshot", E, "Measured");
    const t0 = performance.now();
    const snap = await backup(n, false); // written straight in, so the ledger does not add up: no invariants here
    const jobMs = performance.now() - t0;
    const stats = await n.one(
      `select s.ms, s.n_rows::int as rows, s.size_bytes::bigint as stored,
              (select sum(octet_length(p.data::text))::bigint from app.snapshot_parts p where p.snapshot_id = s.id) as raw
         from app.snapshots s where s.id = $1`,
      [snap.id],
    );
    const top = await n.q(
      "select tbl, n_rows, bytes::int, octet_length(data::text) as raw from app.snapshot_parts where snapshot_id = $1 order by bytes desc limit 8",
      [snap.id],
    );
    await n.org("pause_event", E);
    const t1 = performance.now();
    await restore(n, snap, n.second, false);
    const restoreMs = performance.now() - t1;
    const run = await n.one(
      "select extract(epoch from finished_at - started_at) * 1000 as ms from app.snapshot_restores where event_id = $1 order by id desc limit 1",
      [E],
    );
    // The judge's full texts are still there after the restore.
    expect((await n.one("select count(*)::int as c from judge_runs where event_id = $1 and raw_response is not null", [E])).c).toBe((await n.one("select count(*)::int as c from judge_runs where event_id = $1", [E])).c);
    const mb = (b: number | string) => `${(Number(b) / 1_048_576).toFixed(1)} MB`;
    console.log(
      [
        `Backup of a synthetic night at 50 per track: ${stats.rows} rows, ${mb(stats.raw)} as JSON, ${mb(stats.stored)} stored (compressed); ` +
          `taken in ${stats.ms} ms (the job's call ${Math.round(jobMs)} ms)`,
        `Restore (with its "before" backup) ran in ${Math.round(Number(run.ms))} ms (the job's call ${Math.round(restoreMs)} ms)`,
        `Largest tables: ${top.map((t) => `${t.tbl} ${t.n_rows} rows ${mb(t.raw)} raw / ${mb(t.bytes)} stored`).join("; ")}`,
        `Estimate at 200 per track (x4): ${mb(Number(stats.raw) * 4)} as JSON, ${mb(Number(stats.stored) * 4)} stored per backup`,
      ].join("\n"),
    );
    expect(Number(stats.stored)).toBeGreaterThan(0);
  }, 240_000);
});
