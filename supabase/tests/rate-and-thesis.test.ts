// Migration 089, two rules for the 20 Nov night:
// 1. A consulting firm's base rate is clamp(200 + 4 × (score − 50), 100, 400) basis points of the AVERAGE of its
//    released Round 1 memo score and every released advice memo score so far (2% with none), so it is recalculated
//    when each crisis's advice scores are released; the minimum bid and firm_values follow it.
// 2. The Round 3 investment thesis (THESIS, switch finance_thesis): written by the squad's Finance team, 150–500 words,
//    due with the solutions; judged (judge_auto queues it); released by an organiser, paying each fund
//    $500 × (score − 50) through the ledger (BONUS_THESIS, balanced by the exchange), moving no price. A missing thesis
//    is sealed at 0. Switch off: nobody writes it, judge_auto skips it, release refuses it.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RUBRICS, sha256Hex, thesisBonus, type SubmissionType } from "@msim/engine";
import { Night } from "./night";
import { as, rowsAs, service } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

type Squad = Awaited<ReturnType<Night["squad"]>>;

/** Plays a PRIMUS night to Round 2 (prices set, no crisis revealed). */
async function toRound2(n: Night, squads: number, name: string): Promise<Squad[]> {
  const seed = sha256Hex(name);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, "4");
  const s: Squad[] = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    const ticker = `T${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}`;
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Thesis Co ${i + 1}`, ticker, problem: "A real problem." }, 0);
    await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const [i, q] of s.entries()) await n.judge(q.company_id, "PITCH", [50 + 5 * i, 50 + 5 * i, 50 + 5 * i]);
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  return s;
}

/** A score row written directly (as the judge would seal it): `status` SEALED or RELEASED. */
async function putScore(n: Night, companyId: string, type: SubmissionType, score: number, status: "SEALED" | "RELEASED") {
  await n.q(
    `insert into scores (event_id, company_id, type, status, final_score, tier_bp, released_at)
     values ($1, $2, $3::text::submission_type, $4::text::score_status, $5, 0, case when $4::text = 'RELEASED' then now() end)
     on conflict (company_id, type) do update set status = excluded.status, final_score = excluded.final_score, released_at = excluded.released_at`,
    [n.eventId, companyId, type, status, score],
  );
}

/** An engagement of `firm` by `company` in sub-round k (no fee: the base rate only reads who advised whom). */
async function engage(n: Night, k: number, companyId: string, firmId: string) {
  await n.q("insert into engagements (event_id, k, company_id, firm_team_id, cash_cents, shares) values ($1, $2, $3, $4, 0, 0)", [n.eventId, k, companyId, firmId]);
}

const baseRate = async (n: Night, firmId: string) => Number((await n.one("select app.firm_base_rate($1) as bp", [firmId])).bp);

describe("base rate: the average of the Round 1 memo and every released advice memo", () => {
  test("2% with no released score; the average sets it, clamped to 1–4%; it moves when advice scores are released; firm_values and the minimum bid follow", async () => {
    const n = await Night.create(db.pool, 4, "PRIMUS");
    const s = await toRound2(n, 4, "rate-and-thesis-1");
    const firm = s.map((q) => n.teamId(q.c_code));
    for (const f of firm) expect(await baseRate(n, f)).toBe(200);

    // Round 1 memos: firm 0 scored 80, firm 1 100; firms 2 and 3 have none released (firm 3's is only sealed).
    await putScore(n, s[0]!.company_id, "MEMO", 80, "RELEASED");
    await putScore(n, s[1]!.company_id, "MEMO", 100, "RELEASED");
    await putScore(n, s[3]!.company_id, "MEMO", 90, "SEALED");
    expect(await Promise.all(firm.map((f) => baseRate(n, f)))).toEqual([320, 400, 200, 200]);

    // Crisis 1: firm 0 advises companies 1 and 2 (two advice scores), firm 3 advises company 0; firm 1 and 2 none.
    await engage(n, 1, s[1]!.company_id, firm[0]!);
    await engage(n, 1, s[2]!.company_id, firm[0]!);
    await engage(n, 1, s[0]!.company_id, firm[3]!);
    await putScore(n, s[1]!.company_id, "ADVICE_1", 61, "SEALED");
    await putScore(n, s[2]!.company_id, "ADVICE_1", 40, "SEALED");
    await putScore(n, s[0]!.company_id, "ADVICE_1", 0, "SEALED");
    await putScore(n, s[3]!.company_id, "ADVICE_1", 0, "SEALED");
    // Sealed advice scores do not count yet.
    expect(await Promise.all(firm.map((f) => baseRate(n, f)))).toEqual([320, 400, 200, 200]);

    // The organiser releases crisis 1's advice scores (after the ratings close): the rates are recalculated.
    await n.deadlinePassed("DUE_1");
    await n.deadlinePassed("RATE_1");
    await n.org("release_scores", n.eventId, "ADVICE_1");
    // Firm 0: (80 + 61 + 40) / 3 = 60.33 → 200 + 4 × 10.33 = 241.3 → 241. Firm 3: (0) → 0 → the 1% floor.
    expect(await Promise.all(firm.map((f) => baseRate(n, f)))).toEqual([241, 400, 200, 100]);

    // Crisis 2: firm 1 advises company 3 and scores 50: (100 + 50) / 2 = 75 → 300.
    await engage(n, 2, s[3]!.company_id, firm[1]!);
    await putScore(n, s[3]!.company_id, "ADVICE_2", 50, "RELEASED");
    expect(await baseRate(n, firm[1]!)).toBe(300);
    // A score with no final score never counts.
    await n.q("update scores set final_score = null where company_id = $1 and type = 'ADVICE_2'", [s[3]!.company_id]);
    expect(await baseRate(n, firm[1]!)).toBe(400);
    await n.q("update scores set final_score = 50 where company_id = $1 and type = 'ADVICE_2'", [s[3]!.company_id]);

    // firm_values reads the same rate, and for a Product team the minimum bid for its own company at today's price.
    const price = Number((await n.one("select market_price from companies where id = $1", [s[2]!.company_id])).market_price);
    const rows = await as(db.pool, n.team(s[2]!.p_code), async (c) =>
      (await c.query("select team_id, base_rate_bp, min_bid_cents from public.firm_values($1)", [n.eventId])).rows);
    const want = new Map([[firm[0]!, 241], [firm[1]!, 300], [firm[2]!, 200], [firm[3]!, 100]]);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.base_rate_bp).toBe(want.get(r.team_id));
      expect(Number(r.min_bid_cents)).toBe(want.get(r.team_id)! * 10 * price);
    }

    // The minimum bid uses it: firm 0 now asks 2.41% (2,410 shares).
    await n.org("set_feature", n.eventId, "hire_min_bid", true);
    const minBid = async (shares: number) =>
      (await n.one("select app.min_bid_problem(c, $2, 0, $3, false) as m from companies c where c.id = $1", [s[2]!.company_id, firm[0]!, shares])).m;
    expect(await minBid(2409)).toMatch(/^This firm's minimum bid is 2\.41% of your company/);
    expect(await minBid(2410)).toBeNull();
  });
});

// ───────────────────────────── The investment thesis ─────────────────────────────

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

/** The judge worker: claims every queued run, records its injection check and reports total(run). */
async function work(n: Night, total: (r: Claimed) => number): Promise<Claimed[]> {
  const done: Claimed[] = [];
  for (;;) {
    const runs: Claimed[] = await n.call(service, "claim_judge_runs", n.eventId, 50);
    if (runs.length === 0) return done;
    for (const sub of new Set(runs.map((r) => r.submission_id))) await n.ok(service, "record_injections", sub, "[]");
    for (const r of runs) {
      expect(await n.call(service, "finish_judge_run", r.run_id, { attempt: r.claim_token, ...output(r.type, total(r)) })).toMatchObject({ ok: true, status: "DONE" });
      done.push(r);
    }
  }
}

/** n words of plain text. */
const words = (count: number, word = "evidence") => Array.from({ length: count }, (_, i) => `${word}${i % 7 === 6 ? "." : ""}`).join(" ");
/** A thesis of 4 × `each` words. */
const thesis = (each: number) => ({ backing: words(each, "back"), evidence: words(each), positioning: words(each, "size"), risks: words(each, "risk") });

/** Round 2 → Round 3 with the draft over (3 squads; statements 1 and 2). */
async function toRound3(n: Night, seed: string) {
  const s = await toRound2(n, 3, seed);
  await n.org("set_problem_statements", n.eventId, JSON.stringify([
    { number: 1, title: "Clinic waits", body: "Patients wait hours.", cap: 2 },
    { number: 2, title: "Farm credit", body: "Farmers lack credit." },
  ]));
  await n.advanceTo("SATURATION");
  return s;
}

async function finishDraft(n: Night) {
  const st = Object.fromEntries((await n.q("select number, id from problem_statements where event_id = $1", [n.eventId])).map((r) => [r.number, r.id]));
  const order = (await n.q("select c.product_team_id from draft_picks d join companies c on c.id = d.company_id where d.event_id = $1 order by d.pick_no", [n.eventId]))
    .map((r) => [...n.ev.teams].find(([, t]) => t.teamId === r.product_team_id)![0]);
  for (const [i, code] of order.entries()) await n.ok(n.team(code), "pick_statement", st[i < 2 ? 1 : 2]);
  await n.deadlinePassed("DRAFT");
}

const cash = async (n: Night, teamId: string) => BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [teamId])).c);

describe("the Round 3 investment thesis", () => {
  test("Finance only, 150–500 words, in the Round 3 window; auto-submitted and judged by itself; the release pays $500 × (score − 50) through the ledger, moves no price; an appeal pays the change; it counts in the fund's final value", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    expect(await n.one("select app.feature_on($1, 'finance_thesis') as on", [n.eventId])).toEqual({ on: true });
    await n.org("set_feature", n.eventId, "judge_auto", true);
    const [a, b, c] = await toRound3(n, "rate-and-thesis-2");
    const fund = (q: Squad) => n.teamId(q.f_code);

    // Before the draft is over the thesis is closed.
    expect(await n.call(n.team(a!.f_code), "save_draft", "THESIS", thesis(50), 0)).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
    await finishDraft(n);

    // Only the Finance team writes it.
    expect(await n.call(n.team(a!.p_code), "save_draft", "THESIS", thesis(50), 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a!.c_code), "save_draft", "THESIS", thesis(50), 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a!.p_code), "submit_submission", "THESIS")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });

    // Word limits: at least 150, at most 500 (the save keeps any length; Submit checks).
    await n.ok(n.team(a!.f_code), "save_draft", "THESIS", thesis(30), 0); // 120 words
    expect(await n.call(n.team(a!.f_code), "submit_submission", "THESIS")).toMatchObject({ ok: false, code: "TOO_SHORT" });
    await n.ok(n.team(a!.f_code), "save_draft", "THESIS", thesis(130), 1); // 520 words
    expect(await n.call(n.team(a!.f_code), "submit_submission", "THESIS")).toMatchObject({ ok: false, code: "TOO_LONG" });
    await n.ok(n.team(a!.f_code), "save_draft", "THESIS", thesis(50), 2); // 200 words
    // submit_last_5: Submit opens 5 minutes before 06:00.
    await n.org("set_feature", n.eventId, "submit_last_5", true);
    expect(await n.call(n.team(a!.f_code), "submit_submission", "THESIS")).toMatchObject({ ok: false, code: "SUBMIT_NOT_YET" });
    await n.org("set_feature", n.eventId, "submit_last_5", false);
    const sub = await n.ok(n.team(a!.f_code), "submit_submission", "THESIS");
    expect(sub.submission).toMatchObject({ type: "THESIS", company_id: a!.company_id, word_count: 200, submitted_by_team: fund(a!) });

    // A squad drawn before migration 089 has no THESIS draft row: the first save creates it.
    await n.q("delete from submission_drafts where company_id = $1 and type = 'THESIS'", [b!.company_id]);
    // B's fund saves 200 words at once (a paste-sized jump: flagged for the fairness officer) and never submits.
    await n.ok(n.team(b!.f_code), "save_draft", "THESIS", thesis(50), 0);
    expect(await n.q("select team_id, type, words_before, words_after from writing_flags where event_id = $1 and type = 'THESIS'", [n.eventId]))
      .toEqual(expect.arrayContaining([{ team_id: fund(b!), type: "THESIS", words_before: 0, words_after: 200 }]));
    // C's fund writes nothing.

    // 06:00: B's draft is submitted for it; judge_auto queues both theses after the solutions and advice memos.
    const pricesBefore = await n.prices();
    await n.deadlinePassed("DUE_5");
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.one("select auto_submitted, word_count from submissions where company_id = $1 and type = 'THESIS'", [b!.company_id]))
      .toEqual({ auto_submitted: true, word_count: 200 });
    expect(Number((await n.one("select count(*)::int as c from judge_runs where event_id = $1 and type = 'THESIS'", [n.eventId])).c)).toBe(2);

    // The judge reads every Round 3 company (ticker, sector, statement), the same for every fund.
    const run = await n.one("select id from judge_runs where event_id = $1 and type = 'THESIS' and company_id = $2 and run_no = 1", [n.eventId, a!.company_id]);
    const input = await as(db.pool, service, async (q) => (await q.query("select public.judge_input($1) as i", [run.id])).rows[0].i);
    expect(input.type).toBe("THESIS");
    expect(input.market).toHaveLength(3);
    expect(input.market.map((m: { statement: string }) => m.statement).sort()).toEqual(["Clinic waits", "Clinic waits", "Farm credit"]);

    const total: Record<string, number> = { [a!.company_id]: 80, [b!.company_id]: 30 };
    await work(n, (r) => total[r.company_id]!);
    await n.ok(n.lead, "tick", n.eventId);
    const scores = await n.q("select company_id, status, final_score, missing, tier_bp from scores where event_id = $1 and type = 'THESIS' order by final_score desc", [n.eventId]);
    expect(scores).toEqual([
      { company_id: a!.company_id, status: "SEALED", final_score: 80, missing: false, tier_bp: 0 },
      { company_id: b!.company_id, status: "SEALED", final_score: 30, missing: false, tier_bp: 0 },
      { company_id: c!.company_id, status: "SEALED", final_score: 0, missing: true, tier_bp: 0 },
    ]);
    // Sealed scores stay hidden from the teams.
    expect(await rowsAs(db.pool, n.team(a!.f_code), "select final_score from scores where company_id = $1 and type = 'THESIS'", [a!.company_id])).toEqual([]);

    // The release (one organiser click) pays each fund through the ledger and moves no price.
    const before = await Promise.all([a, b, c].map((q) => cash(n, fund(q!))));
    const product = await cash(n, n.teamId(a!.p_code));
    const released = await n.org("release_scores", n.eventId, "THESIS");
    expect(released).toMatchObject({ ok: true, released: 3, bonus_cents: thesisBonus(80) + thesisBonus(30) + thesisBonus(0) });
    expect([thesisBonus(80), thesisBonus(30), thesisBonus(0)]).toEqual([1_500_000, -1_000_000, -2_500_000]);
    const after = await Promise.all([a, b, c].map((q) => cash(n, fund(q!))));
    expect(after.map((x, i) => x - before[i]!)).toEqual([1_500_000n, -1_000_000n, -2_500_000n]);
    expect(await cash(n, n.teamId(a!.p_code))).toBe(product);
    expect(await n.prices()).toEqual(pricesBefore);
    expect(await n.q("select team_id, cash_delta_cents::bigint as cents, memo from ledger_entries where event_id = $1 and kind = 'BONUS_THESIS' order by cash_delta_cents desc", [n.eventId]))
      .toEqual([
        { team_id: null, cents: "2000000", memo: "Paid by the exchange" },
        { team_id: fund(a!), cents: "1500000", memo: "Investment thesis bonus: $500 × (80 − 50)" },
        { team_id: fund(b!), cents: "-1000000", memo: "Investment thesis bonus: $500 × (30 − 50)" },
        { team_id: fund(c!), cents: "-2500000", memo: "Investment thesis bonus: $500 × (0 − 50)" },
      ]);
    await n.checkInvariants();
    // The fund sees its score now; a second release is refused.
    expect(await rowsAs(db.pool, n.team(a!.f_code), "select final_score from scores where company_id = $1 and type = 'THESIS'", [a!.company_id])).toEqual([{ final_score: 80 }]);
    expect(await n.call(n.lead, "release_scores", n.eventId, "THESIS")).toMatchObject({ ok: false, code: "ALREADY_RELEASED" });

    // An appeal after release: a new score of 60 takes back $10,000; still no price moves.
    await n.org("rerun_judging", a!.company_id, "THESIS", "The judge read a truncated file.");
    await work(n, () => 60);
    const appeal = await n.one("select id from appeals where company_id = $1 and type = 'THESIS' and status = 'READY'", [a!.company_id]);
    const cashA = await cash(n, fund(a!));
    const applied = await n.org("apply_appeal", appeal.id);
    expect(applied.effects).toMatchObject({ score: { from: 80, to: 60 }, plan_bonus_cents: thesisBonus(60) - thesisBonus(80) });
    expect(await cash(n, fund(a!))).toBe(cashA + BigInt(thesisBonus(60) - thesisBonus(80)));
    expect(await n.prices()).toEqual(pricesBefore);
    await n.checkInvariants();

    // The bonus is cash, so it counts in the fund's final value at settlement.
    await n.q("update rounds set status = 'CLEARED' where event_id = $1 and phase = 'SATURATION'", [n.eventId]);
    await n.advanceTo("CLOSE");
    await n.advanceTo("SETTLEMENT");
    await n.checkInvariants();
    for (const q of [a, b, c]) {
      const r = await n.one("select final_value_cents::bigint as v, (details ->> 'cash')::bigint as cash from results where team_id = $1", [fund(q!)]);
      expect(BigInt(r.cash)).toBe(await cash(n, fund(q!)));
    }
  });

  test("switch off: no Finance team may write it, judge_auto skips it, and its release is refused", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await n.org("set_feature", n.eventId, "finance_thesis", false);
    await n.org("set_feature", n.eventId, "judge_auto", true);
    const [a] = await toRound3(n, "rate-and-thesis-3");
    await finishDraft(n);
    expect(await n.call(n.team(a!.f_code), "save_draft", "THESIS", thesis(50), 0)).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await n.call(n.team(a!.f_code), "submit_submission", "THESIS")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    await n.deadlinePassed("DUE_5");
    await n.ok(n.lead, "tick", n.eventId);
    await n.ok(n.lead, "tick", n.eventId);
    expect(await n.q("select type::text from judge_auto where event_id = $1 and type::text = 'THESIS'", [n.eventId])).toEqual([]);
    expect(await n.q("select id from scores where event_id = $1 and type = 'THESIS'", [n.eventId])).toEqual([]);
    await n.org("seal_missing_scores", n.eventId, "THESIS");
    expect(await n.call(n.lead, "release_scores", n.eventId, "THESIS")).toMatchObject({ ok: false, code: "SWITCH_OFF" });
    expect(await n.q("select id from ledger_entries where event_id = $1 and kind = 'BONUS_THESIS'", [n.eventId])).toEqual([]);
    // The Run page lists the switch.
    const switches = await as(db.pool, n.lead, async (q) => (await q.query("select key, kind, is_on, on_by_default from public.feature_switches($1) where key = 'finance_thesis'", [n.eventId])).rows);
    expect(switches).toEqual([{ key: "finance_thesis", kind: "RULE", is_on: false, on_by_default: true }]);
  });
});
