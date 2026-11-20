// Round 1 at the real size: the desk caps every track at 70 teams tonight (90 in migrations 095/096). Times every
// Round 1 step on the local database and checks the reads every Finance browser makes each tick stay bounded
// (the timings are printed: "[round1-90 timings]").

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { candleTicks, PRACTICE, practiceCandles, sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { rowsAs } from "./helpers";
import { createTestDb } from "./pg";
import { settle } from "./race";

let db: Awaited<ReturnType<typeof createTestDb>>;
const report: Record<number, { timings: Record<string, number>; broadcasts: Record<string, string> }> = {};
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  for (const [size, r] of Object.entries(report)) {
    console.log(`[round1-${size} timings] ${JSON.stringify(r.timings)}`);
    console.log(`[round1-${size} broadcasts] ${JSON.stringify(r.broadcasts)}`);
  }
  await db?.drop();
});

const ms = (t0: number) => Math.round(performance.now() - t0);
const p95 = (xs: number[]) => Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!);

// 70 per track is tonight's desk cap (the organisers, 20 Nov); 90 was the cap of migrations 095/096.
describe.each([70, 90])("Round 1 with %i squads", (SQUADS) => {
  test("draw, practice market, autosave, deadline, close and the IPO stay fast and bounded", { timeout: 600_000 }, async () => {
    const timings: Record<string, number> = {};
    const broadcasts: Record<string, string> = {};
    report[SQUADS] = { timings, broadcasts };
    let t0 = performance.now();
    const n = await Night.create(db.pool, SQUADS, "PRIMUS");
    timings.seed_teams_ms = ms(t0);
    const E = n.eventId;
    const seed = sha256Hex("round1-90");
    await n.org("set_seed_commitment", E, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    t0 = performance.now();
    expect((await n.org("run_lottery", E, seed, "4")).squads).toBe(SQUADS);
    timings.run_lottery_ms = ms(t0);
    const squads = await Promise.all(Array.from({ length: SQUADS }, (_, i) => n.squad(i + 1)));
    await n.advanceTo("BUILD");

    // "Prepare the practice market": fix the companies, then store the paths 20 companies per call (lib/team/practice.ts).
    const steps = PRACTICE.candles * PRACTICE.candleTicks;
    t0 = performance.now();
    let r = await n.org("prepare_practice_market", E, PRACTICE.tickSeconds, steps, "[]");
    expect(r).toMatchObject({ prepared: true, companies: SQUADS, ready: false });
    const tickerOf = new Map((r.list as { id: string; ticker: string }[]).map((c) => [c.id, c.ticker]));
    let gen = 0;
    let maxPayload = 0;
    let calls = 0;
    while ((r.missing?.length ?? 0) > 0) {
      const g0 = performance.now();
      const rows = (r.missing as string[]).slice(0, 20).map((id) => ({
        ticker: id,
        prices: practiceCandles(`${E}:practice:${tickerOf.get(id)}`).flatMap((k) => candleTicks(k)),
      }));
      gen += performance.now() - g0;
      const body = JSON.stringify(rows);
      maxPayload = Math.max(maxPayload, body.length);
      r = await n.org("prepare_practice_market", E, PRACTICE.tickSeconds, steps, body);
      calls++;
    }
    timings.prepare_total_ms = ms(t0);
    timings.prepare_generation_ms = Math.round(gen);
    timings.prepare_calls = calls;
    timings.prepare_max_payload_kb = Math.round(maxPayload / 1024);
    expect(r).toMatchObject({ ready: true, loaded: SQUADS });
    expect((await n.one("select count(*)::int as c from practice_ticks where event_id = $1", [E])).c).toBe(SQUADS * steps);
    // Well inside one Vercel function (a 4.5 MB body limit and the action's own 20 s budget).
    expect(maxPayload).toBeLessThan(1_000_000);
    await n.q("analyze practice_ticks");

    // The market opened ten minutes ago (as half-way through BUILD).
    await n.q("update practice_markets set starts_at = starts_at - interval '10 minutes' where event_id = $1", [E]);
    await n.q("update practice_ticks set at = at - interval '10 minutes' where event_id = $1", [E]);
    const k = (await n.one("select max(step)::int as k from practice_ticks where event_id = $1 and at <= now()", [E])).k as number;

    // One Finance browser's heartbeat (terminal.tsx): the newest two steps of every ticker, and the selected ticker's new ticks.
    const fund = n.team(squads[0]!.f_code);
    const ids = [...tickerOf.keys()];
    const beats: number[] = [];
    let rows = 0;
    for (let i = 0; i < 20; i++) {
      const b0 = performance.now();
      const a = await rowsAs(db.pool, fund, "select ticker_team_id, step, price_cents from practice_ticks where event_id = $1 and step >= $2 and step <= $3", [E, k - 1, k]);
      const b = await rowsAs(db.pool, fund, "select step, price_cents from practice_ticks where ticker_team_id = $1 and step >= $2 order by step limit 1000", [ids[i]!, k - 5]);
      beats.push(performance.now() - b0);
      rows = Math.max(rows, a.length + b.length);
    }
    timings.practice_heartbeat_rows = rows;
    timings.practice_heartbeat_p95_ms = p95(beats);
    expect(rows).toBeLessThanOrEqual(2 * SQUADS + 6);
    // No future tick is ever readable.
    expect((await rowsAs(db.pool, fund, "select count(*)::int as c from practice_ticks where event_id = $1 and step > $2", [E, k + 1]))[0]!.c).toBe(0);
    // First load of the chart (the last half hour) and the opening prices: bounded too.
    t0 = performance.now();
    const first = await rowsAs(db.pool, fund, "select step, price_cents from practice_ticks where ticker_team_id = $1 and step >= 0 order by step limit 1000", [ids[0]!]);
    const opening = await rowsAs(db.pool, fund, "select ticker_team_id, price_cents from practice_ticks where event_id = $1 and step = 0", [E]);
    timings.practice_first_load_ms = ms(t0);
    expect(first.length).toBeLessThanOrEqual(k + 1);
    expect(opening).toHaveLength(SQUADS);

    // Realtime: what each stage sends (the event channel fans out to every screen).
    const sentSince = async (label: string) => {
      const rows = await n.q("select split_part(topic, ':', 1) as kind, event, count(*)::int as c from realtime.messages group by 1, 2 order by 1, 2");
      broadcasts[label] = rows.map((x) => `${x.kind}/${x.event}x${x.c}`).join(" ") || "none";
      await n.q("delete from realtime.messages");
    };
    await n.q("delete from realtime.messages");

    // 90 funds trading at once, 4 trades each.
    const lat: number[] = [];
    const res = await Promise.all(
      squads.map(async (s, i) => {
        const out = [];
        for (const t of ["BUY", "BUY", "SELL", "SHORT"] as const) {
          const x = await settle(n.call(n.team(s.f_code), "practice_trade", ids[(i + (t === "SHORT" ? 11 : 0)) % ids.length]!, t, 50));
          lat.push(x.ms);
          out.push(x);
        }
        return out;
      }),
    );
    expect(res.flat().filter((x) => x.err !== undefined || x.ok?.ok !== true).map((x) => x.err ?? x.ok?.code)).toEqual([]);
    timings.practice_trade_p95_ms = p95(lat);
    timings.practice_trade_max_ms = Math.round(Math.max(...lat));
    await sentSince("practice_trades");
    // The heartbeat during BUILD with nothing due (pg_cron every few seconds).
    for (let i = 0; i < 12; i++) await n.ok(n.lead, "tick", E);
    await sentSince("ticks_x12_build");

    // Autosave: 90 PRDs (7 sections, ~800 words) and 90 memos (~500 words) saved at once, then again.
    const words = (w: number) => Array.from({ length: w }, (_, i) => `word${i % 97}`).join(" ");
    const prd = (i: number) => ({
      company_name: `Round Co ${i}`,
      ticker: `R${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
      problem: words(110), solution: words(110), mvp: words(110), metrics: words(110), business_model: words(110), advantage: words(110), risks: words(110),
    });
    const memo = { diagnosis: words(120), options: words(120), recommendation: words(120), risks: words(100) };
    timings.prd_payload_kb = Math.round(JSON.stringify(prd(0)).length / 1024);
    for (const round of [0, 1]) {
      const save: number[] = [];
      const out = await Promise.all(
        squads.flatMap((s, i) => [
          settle(n.call(n.team(s.p_code), "save_draft", "PITCH", prd(i), round)).then((x) => (save.push(x.ms), x)),
          settle(n.call(n.team(s.c_code), "save_draft", "MEMO", memo, round)).then((x) => (save.push(x.ms), x)),
        ]),
      );
      expect(out.filter((x) => x.err !== undefined || x.ok?.ok !== true).map((x) => x.err ?? x.ok?.code ?? x.ok?.message)).toEqual([]);
      timings[`save_draft_all_p95_ms_${round}`] = p95(save);
    }
    await sentSince("save_drafts");
    // Half submit by hand; the rest are auto-submitted at the deadline.
    for (const s of squads.slice(0, 45)) await n.ok(n.team(s.p_code), "submit_submission", "PITCH");

    // The deadline: the tick auto-submits the 135 others and judge_auto queues the runs.
    await n.org("set_feature", E, "judge_auto", true).catch(() => undefined);
    await n.deadlinePassed("PITCH");
    await n.deadlinePassed("MEMO").catch(() => undefined);
    t0 = performance.now();
    const tick = await n.ok(n.lead, "tick", E);
    timings.deadline_tick_ms = ms(t0);
    timings.submissions = (await n.one("select count(*)::int as c from submissions where event_id = $1 and superseded_at is null", [E])).c;
    timings.judge_runs_queued = (await n.one("select count(*)::int as c from judge_runs where event_id = $1 and status = 'QUEUED'", [E])).c;
    expect(timings.submissions).toBeGreaterThanOrEqual(SQUADS * 2 - 0);
    expect(tick.actions.join(" ")).toMatch(/auto-submitted/);
    t0 = performance.now();
    await n.ok(n.lead, "tick", E);
    timings.next_tick_ms = ms(t0);
    await sentSince("submits_and_deadline_tick");

    // Practice close + prize.
    t0 = performance.now();
    await n.q("select app.settle_practice($1)", [E]);
    timings.settle_practice_ms = ms(t0);
    expect((await n.one("select count(*)::int as c from practice_accounts where event_id = $1 and rank is not null", [E])).c).toBe(3);

    // READING → IPO: seal scores, release, 90 funds × 5 bids, clearing.
    await n.advanceTo("READING");
    for (const s of squads) {
      await n.judge(s.company_id, "PITCH", [60, 60, 60]);
      await n.judge(s.company_id, "MEMO", [60, 60, 60]).catch(() => undefined);
    }
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", E, "PITCH");
    await n.advanceTo("IPO");
    const companies = squads.map((s) => s.company_id);
    const bids: number[] = [];
    const placed = await Promise.all(
      squads.map(async (s, i) => {
        const out = [];
        for (let j = 1; j <= 5; j++) {
          const x = await settle(n.call(n.team(s.f_code), "place_ipo_bid", companies[(i + j * 7) % SQUADS], 50 * j));
          bids.push(x.ms);
          out.push(x);
        }
        return out;
      }),
    );
    expect(placed.flat().filter((x) => x.err !== undefined).map((x) => x.err)).toEqual([]);
    timings.ipo_bids_ok = placed.flat().filter((x) => x.ok?.ok === true).length;
    timings.place_ipo_bid_p95_ms = p95(bids);
    t0 = performance.now();
    await n.advanceTo("PRESSURE");
    timings.ipo_clearing_ms = ms(t0);
    expect((await n.one("select count(*)::int as c from ipo_bids where event_id = $1 and qty_allocated > 0", [E])).c).toBeGreaterThan(0);
    await n.checkInvariants();
  });
});
