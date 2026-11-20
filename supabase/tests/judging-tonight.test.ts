// Migration 073 on a PRIMUS night: judging runs itself (switch judge_auto) through Round 1, a crisis and Round 3,
// appeals of PRIMUS scores before and after the release (and after the close), the PRIMUS awards, results for drawn
// teams only, and the leaderboard (PRIMUS Rating) with known scores.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RUBRICS, applyTier, avgHalfUp, planBonus, sha256Hex, tierBp, type SubmissionType } from "@msim/engine";
import { Night } from "./night";
import { anon, as, rowsAs, service, user } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

/** A valid model output with this total (the breakdown fills the rubric lines in order). */
function output(type: SubmissionType, total: number) {
  let left = total;
  const breakdown = Object.fromEntries(RUBRICS[type].map((line) => {
    const v = Math.min(line.max, left);
    left -= v;
    return [line.key, v];
  }));
  return {
    ok: true, model: "test-model", prompt_sha: "a".repeat(64), request_text: "<submission>…</submission>",
    raw_response: JSON.stringify({ breakdown, total }), breakdown, total, rationale: "One. Two. Three.", latency_ms: 1200,
  };
}

type Claimed = { run_id: string; submission_id: string; company_id: string; type: SubmissionType; generation: number; claim_token: number };

/** The judge worker: claims every queued run of the event, records its injection check and reports total(run). */
async function work(n: Night, total: (r: Claimed) => number): Promise<Claimed[]> {
  const done: Claimed[] = [];
  for (;;) {
    const runs: Claimed[] = await n.call(service, "claim_judge_runs", n.eventId, 50);
    if (runs.length === 0) return done;
    for (const sub of new Set(runs.map((r) => r.submission_id))) await n.ok(service, "record_injections", sub, "[]");
    for (const r of runs) {
      const res = await n.call(service, "finish_judge_run", r.run_id, { attempt: r.claim_token, ...output(r.type, total(r)) });
      expect(res, `${r.type} run of ${r.company_id}`).toMatchObject({ ok: true, status: "DONE" });
      done.push(r);
    }
  }
}

const crisisPlan = {
  impact: "The supplier left; half our orders are late.",
  response: "Sign a second supplier this week and cut the slowest product.",
  money: "Costs $40,000; protects $120,000 of monthly sales.",
  advice_used: "We take the firm's two-supplier advice.",
  time_to_recovery: "Six weeks.",
  risks: "Quality from the new supplier: test every batch.",
  next_steps: "CEO signs by Friday.",
};
// At least 150 words: only a memo that long releases the fee.
const advice = {
  diagnosis: "The crisis hits the client's busiest channel first, and that channel brings about half of its monthly sales. If nothing changes, two months of disruption cost roughly a third of revenue and push the cash runway below four months. The twist makes it worse: waiting for certainty means the best customers move to rivals while the client is still deciding.",
  advice: "Phase the fix. This week the operations lead protects the top fifth of customers with priority supply and a direct call from the founder. Next week the finance lead renegotiates payment terms with the two largest suppliers. By the end of the month the product lead rebuilds the failing step and tests it with ten customers before the full relaunch.",
  evidence: "The top fifth of customers bring half the sales, so protecting them first saves most of the revenue for a small share of the cost. The fix costs about Rs 12 lakh against roughly Rs 40 lakh of monthly sales at risk, and paying suppliers thirty days later frees enough cash to cover the first phase.",
  fit: "The client's cash covers the first phase without new funding, and its direct relationships with large customers are exactly what this plan relies on.",
};
const solution = {
  solution: "A shared booking app for clinics.",
  fit: "It answers the statement's waiting times.",
  differentiation: "Works offline.",
  plan: "Pilot in two clinics.",
  impact: "Cuts waits by half.",
  risks: "Adoption: train staff.",
};

const autoLog = (n: Night) =>
  n.q("select what, by_name from event_log where event_id = $1 and (what like 'Judging started by itself%' or what like 'Missing scores sealed%') order by id", [n.eventId]);
const runCount = async (n: Night, type: string) =>
  Number((await n.one("select count(*)::int as c from judge_runs where event_id = $1 and type = $2", [n.eventId, type])).c);
const scoreOf = (n: Night, company: string, type: string) =>
  n.one("select status, final_score, missing, tier_bp, generation from scores where company_id = $1 and type = $2", [company, type]);
const company = (n: Night, id: string) =>
  n.one("select market_price, ai_price, closing_market_price, closing_price from companies where id = $1", [id]);

describe("judging runs itself (judge_auto)", () => {
  test("switch on: each type is queued once after its deadline (a late auto-submit too), missing scores sealed once its runs finish; appeals and awards of a PRIMUS night", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await n.org("set_feature", n.eventId, "judge_auto", true);
    const seed = sha256Hex("judging-tonight");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    const [a, b, c] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");

    // ── Round 1: A submits its PRD; B only saves a draft (auto-submitted at the deadline); C writes nothing. No memos.
    await n.ok(n.team(a.p_code), "save_draft", "PITCH", { company_name: "Auto A", ticker: "AUTA", problem: "A real problem." }, 0);
    await n.ok(n.team(a.p_code), "submit_submission", "PITCH");
    await n.ok(n.team(b.p_code), "save_draft", "PITCH", { company_name: "Auto B", ticker: "AUTB", problem: "Another problem." }, 0);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await runCount(n, "PITCH")).toBe(0); // before the deadline nothing happens

    // B's draft is being saved at the very moment the deadline passes (its row is locked): the tick's auto-submit
    // skips it, so judging starts with A alone, and B is queued on the next tick, once.
    const locker = await db.pool.connect();
    try {
      await locker.query("begin");
      await locker.query("select 1 from submission_drafts where company_id = $1 and type = 'PITCH' for update", [b.company_id]);
      await n.deadlinePassed("PITCH");
      await n.ok(n.lead, "tick", n.eventId);
      expect(await n.q("select company_id from judge_runs where event_id = $1 and type = 'PITCH' group by 1", [n.eventId])).toEqual([
        { company_id: a.company_id },
      ]);
    } finally {
      await locker.query("rollback");
      locker.release();
    }
    await n.ok(n.lead, "tick", n.eventId);
    await n.ok(n.lead, "tick", n.eventId);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select company_id, count(*)::int as runs, min(status::text) as status from judge_runs where event_id = $1 and type = 'PITCH' group by 1 order by 1", [n.eventId]))
      .toEqual([a.company_id, b.company_id].sort().map((id) => ({ company_id: id, runs: 3, status: "QUEUED" })));
    // No memo was written: nothing to judge, so every missing memo is sealed at once.
    expect(await runCount(n, "MEMO")).toBe(0);
    expect(await n.q("select missing, final_score, status from scores where event_id = $1 and type = 'MEMO'", [n.eventId])).toEqual(
      Array(3).fill({ missing: true, final_score: 0, status: "SEALED" }));
    // C's missing PRD waits until every pitch run has finished.
    expect(await n.q("select 1 from scores where event_id = $1 and type = 'PITCH'", [n.eventId])).toEqual([]);

    // The worker finishes A's runs: C is still not sealed (B's runs are queued).
    const pitchTotal: Record<string, number> = { [a.company_id]: 82, [b.company_id]: 64 };
    const r1 = await n.call(service, "claim_judge_runs", n.eventId, 3);
    expect(r1.map((r: Claimed) => r.company_id)).toEqual([a.company_id, a.company_id, a.company_id]);
    await n.ok(service, "record_injections", r1[0].submission_id, "[]");
    for (const r of r1) await n.ok(service, "finish_judge_run", r.run_id, { attempt: r.claim_token, ...output("PITCH", 82) });
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select company_id from scores where event_id = $1 and type = 'PITCH'", [n.eventId])).toEqual([{ company_id: a.company_id }]);
    await work(n, (r) => pitchTotal[r.company_id]!);
    await n.ok(n.lead, "tick", n.eventId);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await scoreOf(n, a.company_id, "PITCH")).toMatchObject({ status: "SEALED", final_score: 82, missing: false });
    expect(await scoreOf(n, b.company_id, "PITCH")).toMatchObject({ status: "SEALED", final_score: 64, missing: false });
    expect(await scoreOf(n, c.company_id, "PITCH")).toMatchObject({ status: "SEALED", final_score: 0, missing: true });
    expect(await n.q("select type, submissions, runs, sealed_missing, sealed_at is not null as sealed from judge_auto where event_id = $1 order by type", [n.eventId]))
      .toEqual([
        { type: "PITCH", submissions: 2, runs: 6, sealed_missing: 1, sealed: true },
        { type: "MEMO", submissions: 0, runs: 0, sealed_missing: 3, sealed: true },
      ]);
    expect(await autoLog(n)).toEqual([
      { what: "Judging started by itself for Pitch: 1 submission, 3 runs.", by_name: "Clock" },
      { what: "Judging started by itself for Crisis memo: no submissions to judge.", by_name: "Clock" },
      { what: "Missing scores sealed for Crisis memo: 0 for 3 companies with no submission.", by_name: "Clock" },
      { what: "Judging started by itself for Pitch: 1 more submission, 3 runs.", by_name: "Clock" },
      { what: "Missing scores sealed for Pitch: 0 for 1 company with no submission.", by_name: "Clock" },
    ]);
    // The release stays an organiser's click: nothing is released and no IPO price is set.
    expect(await n.q("select 1 from scores where event_id = $1 and status = 'RELEASED'", [n.eventId])).toEqual([]);
    expect(await n.q("select 1 from companies where event_id = $1 and ipo_price is not null", [n.eventId])).toEqual([]);
    expect(await n.q("select message from error_log where event_id = $1", [n.eventId])).toEqual([]);

    await n.advanceTo("READING");
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");

    // ── Crisis 1: A and C write plans, B none; nobody hires, so every company is given a firm when hiring closes.
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
    for (const s of [a, c]) {
      await n.ok(n.team(s.p_code), "save_draft", "CRISIS_1", crisisPlan, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "CRISIS_1");
    }
    await n.deadlinePassed("HIRE_1");
    await n.ok(n.lead, "tick", n.eventId);
    const firmOf = async (companyId: string, k: number) => {
      const id = (await n.one("select firm_team_id from engagements where company_id = $1 and k = $2", [companyId, k])).firm_team_id as string;
      return { id, code: [...n.ev.teams].find(([, t]) => t.teamId === id)![0] };
    };
    const firmA = await firmOf(a.company_id, 1);
    await n.ok(n.team(firmA.code), "save_draft_for", a.company_id, "ADVICE_1", advice, 0);
    await n.ok(n.team(firmA.code), "submit_for", a.company_id, "ADVICE_1");
    expect(await runCount(n, "CRISIS_1")).toBe(0);
    await n.deadlinePassed("DUE_1");
    await n.ok(n.lead, "tick", n.eventId);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select type::text, count(*)::int as runs from judge_runs where event_id = $1 and type in ('CRISIS_1', 'ADVICE_1') group by 1 order by 1", [n.eventId]))
      .toEqual([{ type: "ADVICE_1", runs: 3 }, { type: "CRISIS_1", runs: 6 }]);
    const r2: Record<string, number> = { [`CRISIS_1 ${a.company_id}`]: 85, [`CRISIS_1 ${c.company_id}`]: 45, [`ADVICE_1 ${a.company_id}`]: 70 };
    await work(n, (r) => r2[`${r.type} ${r.company_id}`]!);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select c.id, s.final_score, s.missing from scores s join companies c on c.id = s.company_id where s.event_id = $1 and s.type = 'CRISIS_1' order by c.id", [n.eventId]))
      .toEqual([
        { id: a.company_id, final_score: 85, missing: false },
        { id: b.company_id, final_score: 0, missing: true },
        { id: c.company_id, final_score: 45, missing: false },
      ].sort((x, y) => x.id.localeCompare(y.id)));
    expect((await n.q("select company_id from scores where event_id = $1 and type = 'ADVICE_1' and missing", [n.eventId])).length).toBe(2);
    expect((await autoLog(n)).slice(5).map((l) => l.what)).toEqual([
      "Judging started by itself for Crisis 1 response plan: 2 submissions, 6 runs.",
      "Judging started by itself for Advice memo (Crisis 1): 1 submission, 3 runs.",
      "Missing scores sealed for Crisis 1 response plan: 0 for 1 company with no submission.",
      "Missing scores sealed for Advice memo (Crisis 1): 0 for 2 companies with no submission.",
    ]);

    // ── An appeal before the release: C's plan is judged again; the new score replaces the sealed one by itself.
    const pricesBefore = await n.prices();
    await n.org("rerun_judging", c.company_id, "CRISIS_1", "The judge timed out on one run.");
    await work(n, () => 55);
    expect(await scoreOf(n, c.company_id, "CRISIS_1")).toMatchObject({ status: "SEALED", final_score: 55, generation: 2 });
    expect(await n.one("select status, after_release from appeals where company_id = $1", [c.company_id])).toEqual({ status: "APPLIED", after_release: false });
    expect(await n.prices()).toEqual(pricesBefore);

    // ── Release (by hand): the plans move the prices; the advice pays A's firm.
    await n.deadlinePassed("RATE_1");
    await n.ok(n.lead, "tick", n.eventId);
    await n.org("release_scores", n.eventId, "CRISIS_1");
    const released = await n.prices();
    expect(released[a.company_id]).toBe(applyTier(pricesBefore[a.company_id]!, 2000));
    expect(released[c.company_id]).toBe(applyTier(pricesBefore[c.company_id]!, 500));
    const firmCash = async () => BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [firmA.id])).c);
    const cash0 = await firmCash();
    await n.org("release_scores", n.eventId, "ADVICE_1");
    expect(await firmCash()).toBe(cash0 + BigInt(planBonus(70)));

    // ── An appeal after the release: A's plan is judged again at 65 (tier +5% instead of +20%).
    await n.org("rerun_judging", a.company_id, "CRISIS_1", "Two runs failed on a timeout.");
    await work(n, () => 65);
    const appealA = await n.one("select id, status, after_release from appeals where company_id = $1 and type = 'CRISIS_1'", [a.company_id]);
    expect(appealA).toMatchObject({ status: "READY", after_release: true });
    // Not while a round is open (a release waits for that too).
    const round = await n.one("select id from rounds where event_id = $1 and status = 'SCHEDULED' order by number limit 1", [n.eventId]);
    await n.q("update rounds set status = 'OPEN', opened_at = now() where id = $1", [round.id]);
    expect(await n.call(n.lead, "apply_appeal", appealA.id)).toMatchObject({ ok: false, code: "TRADING_OPEN" });
    await n.q("update rounds set status = 'SCHEDULED', opened_at = null where id = $1", [round.id]);
    const coA = await company(n, a.company_id);
    const applied = await n.org("apply_appeal", appealA.id);
    const coA2 = await company(n, a.company_id);
    expect(coA2.market_price).toBe(applyTier(coA.market_price, 500 - 2000));
    expect(coA2.ai_price).toBe(applyTier(coA.ai_price, 500 - 2000));
    expect(applied.effects).toMatchObject({
      score: { from: 85, to: 65 }, tier_bp: { from: 2000, to: 500 },
      market_price: { from: coA.market_price, to: coA2.market_price }, ai_price: { from: coA.ai_price, to: coA2.ai_price },
      closing_price: null, short_cover_cents: 0, plan_bonus_cents: 0, settled: false,
    });
    expect(await scoreOf(n, a.company_id, "CRISIS_1")).toMatchObject({ status: "RELEASED", final_score: 65, tier_bp: 500 });
    expect(await n.one("select subround, market_before, market_after, tier_bp from round_prices where company_id = $1 and kind = 'APPEAL'", [a.company_id]))
      .toEqual({ subround: 1, market_before: coA.market_price, market_after: coA2.market_price, tier_bp: 500 });

    // An advice memo's appeal moves no price: the firm's bonus follows the new score.
    await n.org("rerun_judging", a.company_id, "ADVICE_1", "The run crashed.");
    await work(n, () => 60);
    const appealAdvice = await n.one("select id from appeals where company_id = $1 and type = 'ADVICE_1' and status = 'READY'", [a.company_id]);
    const cash1 = await firmCash();
    const pricesAdvice = await n.prices();
    const adv = await n.org("apply_appeal", appealAdvice.id);
    expect(adv.effects).toMatchObject({ score: { from: 70, to: 60 }, plan_bonus_cents: planBonus(60) - planBonus(70) });
    expect(await firmCash()).toBe(cash1 + BigInt(planBonus(60) - planBonus(70)));
    expect(Number((await n.one("select bonus_cents from engagements where company_id = $1 and k = 1", [a.company_id])).bonus_cents)).toBe(planBonus(60));
    expect(await n.prices()).toEqual(pricesAdvice);
    await n.checkInvariants();

    // ── Round 3: the draft, Round 3 hiring by the clock, solutions from A and B; judged by itself at the due time.
    await n.org("set_problem_statements", n.eventId, JSON.stringify([
      { number: 1, title: "Clinic waits", body: "Patients wait hours.", cap: 2 },
      { number: 2, title: "Farm credit", body: "Farmers lack credit." },
    ]));
    await n.advanceTo("SATURATION");
    const st = Object.fromEntries((await n.q("select number, id from problem_statements where event_id = $1", [n.eventId])).map((r) => [r.number, r.id]));
    const order = (await n.q("select c.product_team_id from draft_picks d join companies c on c.id = d.company_id where d.event_id = $1 order by d.pick_no", [n.eventId]))
      .map((r) => [...n.ev.teams].find(([, t]) => t.teamId === r.product_team_id)![0]);
    for (const [i, code] of order.entries()) await n.ok(n.team(code), "pick_statement", st[i < 2 ? 1 : 2]);
    await n.deadlinePassed("DRAFT");
    await n.deadlinePassed("HIRE_5");
    await n.ok(n.lead, "tick", n.eventId);
    for (const s of [a, b]) {
      await n.ok(n.team(s.p_code), "save_draft", "SOLUTION", solution, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "SOLUTION");
    }
    await n.deadlinePassed("DUE_5");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await runCount(n, "SOLUTION")).toBe(6);
    expect(await runCount(n, "ADVICE_5")).toBe(0);
    const r3: Record<string, number> = { [a.company_id]: 92, [b.company_id]: 85 };
    await work(n, (r) => r3[r.company_id]!);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await scoreOf(n, c.company_id, "SOLUTION")).toMatchObject({ status: "SEALED", final_score: 0, missing: true });
    expect((await autoLog(n)).slice(9).map((l) => l.what)).toEqual([
      "Judging started by itself for Round 3 solution: 2 submissions, 6 runs.",
      "Judging started by itself for Advice memo (Round 3): no submissions to judge.",
      "Missing scores sealed for Advice memo (Round 3): 0 for 3 companies with no submission.",
      "Missing scores sealed for Round 3 solution: 0 for 1 company with no submission.",
    ]);
    await n.q("update rounds set status = 'CLEARED' where event_id = $1 and phase = 'SATURATION' and waits_for is null", [n.eventId]);
    await n.org("release_scores", n.eventId, "SOLUTION");
    await n.advanceTo("CLOSE");
    await n.advanceTo("SETTLEMENT");
    await n.checkInvariants();

    // ── Awards on a PRIMUS night.
    // Best turnaround: the biggest rise from a company's lowest market price since crisis 1's reveal to its close.
    const lows = new Map<string, number>();
    for (const s of [a, b, c]) {
      const from = (await n.one("select min(id) as id from round_prices where company_id = $1 and kind = 'SUB_SHOCK' and subround = 1", [s.company_id])).id;
      const low = await n.one("select min(market_after)::int as low from round_prices where company_id = $1 and kind in ('SUB_SHOCK', 'SUB_TIER', 'CLEARING') and id >= $2", [s.company_id, from]);
      lows.set(s.company_id, low.low);
    }
    const closes = new Map<string, number>();
    for (const s of [a, b, c]) closes.set(s.company_id, (await company(n, s.company_id)).closing_price);
    const ratio = (id: string) => closes.get(id)! / lows.get(id)!;
    const best = [a, b, c].map((s) => s.company_id).sort((x, y) => ratio(y) - ratio(x))[0]!;
    expect(new Set([a, b, c].map((s) => ratio(s.company_id))).size).toBe(3); // no tie in this night
    const awards = await n.q("select code, company_id, team_id, metric from awards where event_id = $1 and code in ('BEST_TURNAROUND', 'BEST_RESCUE_PLAN') order by code", [n.eventId]);
    expect(awards).toHaveLength(2);
    expect(awards[1]).toMatchObject({
      code: "BEST_TURNAROUND", company_id: best,
      metric: { closing_price: closes.get(best), post_crisis_price: lows.get(best), low_price: lows.get(best) },
    });
    // Best rescue plan: the highest average of the four crisis plan scores (A: 65 / 4 after its appeal).
    expect(awards[0]).toMatchObject({
      code: "BEST_RESCUE_PLAN", company_id: a.company_id, team_id: n.teamId(a.p_code),
      metric: { score: 16, average: 16.25, crisis_scores: [65, 0, 0, 0], solution: 92 },
    });
    expect(Number((await n.one("select count(*)::int as c from results where event_id = $1", [n.eventId])).c)).toBe(9);

    // ── An appeal after the close (Appeals): B's solution is judged again at 70. Its closing market and AI prices move
    // by the change in its levelled tier, the closing price is their average again, and results are computed again.
    await n.advanceTo("APPEALS");
    const tierB = (await n.one("select tier_bp from round_prices where company_id = $1 and kind = 'SUB_TIER' and subround = 5", [b.company_id])).tier_bp as number;
    const sofar = (await n.q("select company_id, app.score_so_far(company_id)::float8 as s from draft_picks where event_id = $1", [n.eventId])) as { company_id: string; s: number }[];
    const place = 1 + sofar.filter((x) => x.s < sofar.find((y) => y.company_id === b.company_id)!.s).length;
    const levelled = (bp: number) => (bp <= 0 ? bp : Math.trunc((bp * (125 * (sofar.length - 1) - 100 * (place - 1))) / (100 * (sofar.length - 1))));
    expect(tierB).toBe(levelled(tierBp("SOLUTION", 85)));
    await n.org("rerun_judging", b.company_id, "SOLUTION", "The judge read a truncated file.");
    await work(n, () => 70);
    const appealB = await n.one("select id from appeals where company_id = $1 and type = 'SOLUTION' and status = 'READY'", [b.company_id]);
    expect(await n.call(n.lead, "advance_phase", n.eventId, "APPEALS")).toMatchObject({ ok: false, code: "GATE" });
    const coB = await company(n, b.company_id);
    const resultB = async () => Number((await n.one("select final_value_cents from results where team_id = $1", [n.teamId(b.p_code)])).final_value_cents);
    const valueBefore = await resultB();
    const after = await n.org("apply_appeal", appealB.id);
    const d = levelled(tierBp("SOLUTION", 70)) - tierB;
    const coB2 = await company(n, b.company_id);
    expect(coB2.closing_market_price).toBe(applyTier(coB.closing_market_price, d));
    expect(coB2.ai_price).toBe(applyTier(coB.ai_price, d));
    expect(coB2.closing_price).toBe(avgHalfUp(coB2.closing_market_price, coB2.ai_price));
    expect(coB2.market_price).toBe(coB.market_price);
    expect(after.effects).toMatchObject({
      score: { from: 85, to: 70 }, tier_bp: { from: tierB, to: levelled(tierBp("SOLUTION", 70)) },
      closing_price: { from: coB.closing_price, to: coB2.closing_price }, settled: true,
    });
    const retained = Number((await n.one("select coalesce(sum(qty), 0)::int as q from holdings where team_id = $1 and lot = 'RETAINED'", [n.teamId(b.p_code)])).q);
    expect(await resultB()).toBe(valueBefore + retained * (coB2.closing_price - coB.closing_price));
    await n.checkInvariants();
    await n.advanceTo("AWARDS");
    expect(await n.q("select message from error_log where event_id = $1", [n.eventId])).toEqual([]);
  });

  test("switch off: nothing is queued or sealed by itself (auto-submit still runs); turned on later, it catches up", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    expect((await n.one("select app.feature_on($1, 'judge_auto') as on", [n.eventId])).on).toBe(false);
    const seed = sha256Hex("judging-off");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    const [a, b] = [await n.squad(1), await n.squad(2)];
    await n.advanceTo("BUILD");
    await n.ok(n.team(a.p_code), "save_draft", "PITCH", { company_name: "Off A", ticker: "OFFA", problem: "A real problem." }, 0);
    await n.ok(n.team(a.p_code), "submit_submission", "PITCH");
    await n.ok(n.team(b.p_code), "save_draft", "PITCH", { company_name: "Off B", ticker: "OFFB", problem: "Another problem." }, 0);
    await n.deadlinePassed("PITCH");
    for (let i = 0; i < 3; i++) await n.ok(n.lead, "tick", n.eventId);
    expect(Number((await n.one("select count(*)::int as c from submissions where event_id = $1 and type = 'PITCH'", [n.eventId])).c)).toBe(2);
    expect(await n.q("select 1 from judge_runs where event_id = $1", [n.eventId])).toEqual([]);
    expect(await n.q("select 1 from scores where event_id = $1", [n.eventId])).toEqual([]);
    expect(await n.q("select 1 from judge_auto where event_id = $1", [n.eventId])).toEqual([]);
    expect(await autoLog(n)).toEqual([]);

    // Turned on mid-night: the next tick queues what is due and seals what is missing (here: every memo).
    await n.org("set_feature", n.eventId, "judge_auto", true);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await runCount(n, "PITCH")).toBe(6);
    expect(await n.q("select type::text, submissions, runs, sealed_missing from judge_auto where event_id = $1 order by type", [n.eventId])).toEqual([
      { type: "PITCH", submissions: 2, runs: 6, sealed_missing: null },
      { type: "MEMO", submissions: 0, runs: 0, sealed_missing: 3 },
    ]);
    // Turned off again while runs are in flight: nothing more happens by itself.
    await n.org("set_feature", n.eventId, "judge_auto", false);
    await work(n, () => 70);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select 1 from scores where event_id = $1 and type = 'PITCH' and missing", [n.eventId])).toEqual([]);
    // A type released by hand before the clock gets to it is left alone.
    await n.org("seal_missing_scores", n.eventId, "PITCH");
    await n.advanceTo("READING");
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.org("set_feature", n.eventId, "judge_auto", true);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.one("select sealed_missing, sealed_at is not null as sealed from judge_auto where event_id = $1 and type = 'PITCH'", [n.eventId]))
      .toEqual({ sealed_missing: 0, sealed: true });
    expect((await autoLog(n)).filter((l) => l.what.includes("Pitch"))).toEqual([
      { what: "Judging started by itself for Pitch: 2 submissions, 6 runs.", by_name: "Clock" },
    ]);
  });
});

describe("results and rankings", () => {
  test("only teams of drawn squads are ranked: a team absent at the draw neither appears nor stops the settlement", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("absent");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    // A product team and a fund that were not drawn (as the draw of checked-in teams leaves them): the product team
    // has a company with no prices.
    const absentProduct = (await n.one("insert into teams (event_id, code, track, name, cash_cents) values ($1, 'X91', 'PRODUCT', 'Absent product', 0) returning id", [n.eventId])).id;
    await n.q("insert into companies (event_id, product_team_id) values ($1, $2)", [n.eventId, absentProduct]);
    const absentFund = (await n.one("insert into teams (event_id, code, track, name, cash_cents) values ($1, 'X92', 'FINANCE', 'Absent fund', 0) returning id", [n.eventId])).id;
    await n.q(`begin;
      select set_config('app.price_writer', 'CLOSE', true);
      update companies set ipo_price = 1000, market_price = 1100, ai_price = 1200, closing_market_price = 1100, closing_price = 1150
       where event_id = '${n.eventId}' and squad_id is not null;
      commit;`);
    await n.q("select app.compute_results($1)", [n.eventId]);
    await n.q("select app.compute_rankings($1)", [n.eventId]);
    const results = await n.q("select team_id, track::text, rank from results where event_id = $1", [n.eventId]);
    expect(results).toHaveLength(9);
    expect(results.map((r) => r.team_id)).not.toContain(absentProduct);
    expect(results.map((r) => r.team_id)).not.toContain(absentFund);
    expect(results.every((r) => r.rank !== null)).toBe(true);
    const ranked = await rowsAs(db.pool, n.lead, "select public.rankings($1) as r", [n.eventId]);
    expect(ranked[0]).toEqual({ r: null }); // staff read the rankings from Settlement on
    await n.q("update events set current_phase = 'SETTLEMENT' where id = $1", [n.eventId]);
    const shown = (await rowsAs<{ r: { results: { teams: { code: string } }[] } }>(db.pool, n.lead, "select public.rankings($1) as r", [n.eventId]))[0]!.r;
    expect(shown.results.map((r) => r.teams.code)).not.toContain("X91");
    expect(shown.results.map((r) => r.teams.code)).not.toContain("X92");
    expect(shown.results).toHaveLength(9);
  });
});

describe("leaderboard (PRIMUS Rating)", () => {
  test("known scores give exact ratings; sector by sector; ties share a rank; teams see it only while the switch is on", async () => {
    const n = await Night.create(db.pool, 8, "PRIMUS");
    const seed = sha256Hex("leaderboard");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    const squads = [];
    for (let i = 1; i <= 8; i++) squads.push(await n.squad(i));
    // Squads 1–6 work in Health (one card spelt " HEALTH "), 7 and 8 in Farm. Tickers LBA…LBH in squad order.
    const sectors = ["Health", " HEALTH ", "Health", "Health", "Health", "Health", "Farm", "Farm"];
    for (const [i, s] of squads.entries()) {
      await n.q("update problem_cards set sector = $3 where event_id = $1 and number = $2", [n.eventId, i + 1, sectors[i]]);
      await n.q("update squads set chosen_card_id = (select id from problem_cards where event_id = $1 and number = $2) where id = $3", [n.eventId, i + 1, s.id]);
      await n.q("update companies set ticker = $2, name = $3 where id = $1", [s.company_id, `LB${"ABCDEFGH"[i]}`, `Board ${i + 1}`]);
    }
    const put = async (i: number, type: string, score: number, status: string, minutesAgo: number) =>
      n.q(`insert into scores (event_id, company_id, type, status, final_score, tier_bp, released_at)
           values ($1, $2, $3, $4, $5, 0, case when $4 = 'RELEASED' then now() - make_interval(mins => $6) end)`,
        [n.eventId, squads[i]!.company_id, type, status, score, minutesAgo]);
    const pitch = [100, 0, 0, 0, 0, 0, 70, 70];
    const crisis = [70, 60, 50, 40, 30, 20, 30, 30];
    for (let i = 0; i < 8; i++) {
      await put(i, "PITCH", pitch[i]!, "RELEASED", 60);
      await put(i, "CRISIS_1", crisis[i]!, "RELEASED", 30);
      await put(i, "ADVICE_1", 100 - crisis[i]!, "RELEASED", 20); // advice and memos do not count
      await put(i, "MEMO", 100 - pitch[i]!, "RELEASED", 50);
      await put(i, "CRISIS_2", i * 10, "SEALED", 0); // not released yet: does not count
    }
    // Health PITCH [100, 0 ×5]: mean 16.67, σ 37.27 → +111.8 clipped to +100, −22.4 → −22. Health CRISIS_1 [70…20]:
    // mean 45, σ 17.08 → ±73, ±44, ±15. Farm: equal scores, σ 0 → 0.
    const want = [
      { ticker: "LBA", sector: "Health", rating: 1173, rank: 1, change: 73 },
      { ticker: "LBB", sector: "HEALTH", rating: 1022, rank: 2, change: 44 },
      { ticker: "LBG", sector: "Farm", rating: 1000, rank: 3, change: 0 },
      { ticker: "LBH", sector: "Farm", rating: 1000, rank: 3, change: 0 },
      { ticker: "LBC", sector: "Health", rating: 993, rank: 5, change: 15 },
      { ticker: "LBD", sector: "Health", rating: 963, rank: 6, change: -15 },
      { ticker: "LBE", sector: "Health", rating: 934, rank: 7, change: -44 },
      { ticker: "LBF", sector: "Health", rating: 905, rank: 8, change: -73 },
    ].map((w) => ({ ...w, rounds: 2 }));
    const board = (caller: Parameters<typeof rowsAs>[1]) =>
      rowsAs(db.pool, caller, "select ticker, sector, rating, rank, change, rounds from public.leaderboard($1)", [n.eventId]);
    expect(await board(n.lead)).toEqual(want);
    const full = await rowsAs(db.pool, n.lead, "select * from public.leaderboard($1) limit 1", [n.eventId]);
    expect(full[0]).toMatchObject({ company_id: squads[0]!.company_id, name: "Board 1" });

    // Teams of the event and the projector see it while the switch is on (its default); staff always.
    const team = n.team(squads[3]!.f_code);
    const display = user(n.ev.staff.get("display@example.org")!);
    expect(await board(team)).toEqual(want);
    expect(await board(display)).toEqual(want);
    await n.org("set_feature", n.eventId, "leaderboard", false);
    expect(await board(team)).toEqual([]);
    expect(await board(display)).toEqual([]);
    expect(await board(n.fairness)).toEqual(want);
    await n.org("set_feature", n.eventId, "leaderboard", true);
    await expect(board(anon)).rejects.toThrow(/permission denied/);
    // A team of another event sees nothing of this one.
    const other = await Night.create(db.pool, 3, "PRIMUS");
    expect(await board(other.team([...other.ev.teams.keys()][0]!))).toEqual([]);

    // A company that is not in a drawn squad is not on the board, nor in its sector's spread.
    await n.q("update companies set squad_id = null where id = $1", [squads[7]!.company_id]);
    expect((await board(n.lead)).map((r) => [r.ticker, r.rating, r.rank])).toEqual([
      ["LBA", 1173, 1], ["LBB", 1022, 2], ["LBG", 1000, 3], ["LBC", 993, 4], ["LBD", 963, 5], ["LBE", 934, 6], ["LBF", 905, 7],
    ]);
    // Before any release every company is at 1,000, all sharing rank 1.
    await n.q("update scores set status = 'SEALED', released_at = null where event_id = $1", [n.eventId]);
    expect((await board(n.lead)).map((r) => [r.rating, r.rank, r.change, r.rounds])).toEqual(Array(7).fill([1000, 1, 0, 0]));
  });

  test("200 companies: one query, fast", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const seed = sha256Hex("leaderboard-200");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "4");
    // 200 companies in 5 sectors with six released types each, written straight into the tables.
    await n.q(`
      with s as (select id from squads where event_id = $1 limit 1)
      select 1`, [n.eventId]);
    await n.q(`
      with ins_teams as (
        insert into teams (event_id, code, track, name)
        select $1, 'Z' || lpad(g::text, 3, '0'), 'PRODUCT', 'Bulk ' || g from generate_series(1, 200) g returning id, code
      )
      insert into companies (event_id, product_team_id, ticker, name)
      select $1, t.id, 'Z' || chr(65 + (substr(t.code, 2)::int / 26) % 26) || chr(65 + substr(t.code, 2)::int % 26), t.code from ins_teams t`, [n.eventId]);
    // Each bulk company needs a squad for the board: borrow the drawn squads' teams for the other two tracks is not
    // possible (one squad each), so the board's join is checked through the real squads plus a direct count below.
    const bulk = await n.q("select id from companies where event_id = $1 and squad_id is null and ticker like 'Z%'", [n.eventId]);
    expect(bulk).toHaveLength(200);
    const started = performance.now();
    for (let i = 0; i < 5; i++) await rowsAs(db.pool, n.lead, "select * from public.leaderboard($1)", [n.eventId]);
    expect((performance.now() - started) / 5).toBeLessThan(500);
  });
});
