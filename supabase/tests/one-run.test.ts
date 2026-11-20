// Migration 094: one judge run per document (organisers, 20 Nov). start_judging, judging by itself (judge_auto),
// a re-run and calibration each queue exactly one run per submission (or sample); finishing it seals the score at that
// run's total; runs 4–5 never appear, even for a total that would have spread.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RUBRICS, sha256Hex, type SubmissionType } from "@msim/engine";
import { createTestDb } from "./pg";
import { service } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("one-run");

async function pitched(auto = false) {
  const n = auto ? await Night.create(db.pool, 3, "PRIMUS") : await Night.create(db.pool, 3);
  if (auto) await n.org("set_feature", n.eventId, "judge_auto", true);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, "5");
  const s = [await n.squad(1), await n.squad(2), await n.squad(3)];
  await n.advanceTo("BUILD");
  for (const [i, x] of s.entries()) {
    await n.ok(n.team(x.p_code), "save_draft", "PITCH", { company_name: `One ${i}`, ticker: `ON${"ABC"[i]}`, problem: "A real problem." }, 0);
    await n.ok(n.team(x.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  return { n, s };
}

function output(type: SubmissionType, total: number) {
  let left = total;
  const breakdown = Object.fromEntries(RUBRICS[type].map((line) => {
    const v = Math.min(line.max, left);
    left -= v;
    return [line.key, v];
  }));
  return {
    ok: true, attempt: 1, model: "test-model", prompt_sha: "a".repeat(64), request_text: "<submission>…</submission>",
    raw_response: JSON.stringify({ breakdown, total }), breakdown, total, rationale: "One. Two. Three.", latency_ms: 900,
  };
}

type Claimed = { run_id: string; submission_id: string; company_id: string; run_no: number; generation: number };
const claim = async (n: Night): Promise<Claimed[]> => n.call(service, "claim_judge_runs", n.eventId, 50);
const runNos = async (n: Night) =>
  (await n.q("select company_id, generation, run_no from judge_runs where event_id = $1 order by company_id, generation, run_no", [n.eventId]));
const score = (n: Night, c: string) =>
  n.one("select status, final_score, median, run_totals, generation from scores where company_id = $1 and type = 'PITCH'", [c]);

/** Judges every claimed run: company i gets totals[i]. */
async function judgeAll(n: Night, totals: Map<string, number>) {
  const runs = await claim(n);
  for (const sub of new Set(runs.map((r) => r.submission_id))) await n.ok(service, "record_injections", sub, "[]");
  for (const r of runs) expect(await n.call(service, "finish_judge_run", r.run_id, output("PITCH", totals.get(r.company_id)!))).toMatchObject({ ok: true, status: "DONE" });
  return runs;
}

describe("one judge run per document", () => {
  test("app.judge_runs() is 1", async () => {
    const n = await Night.create(db.pool, 3);
    expect((await n.one("select app.judge_runs() as r")).r).toBe(1);
  });

  test("start_judging queues 1 run per submission; finishing it seals the score at its total; no runs 4–5, ever", async () => {
    const { n, s } = await pitched();
    expect(await n.org("start_judging", n.eventId, "PITCH")).toMatchObject({ queued: 3, companies: 3 });
    expect((await runNos(n)).map((r) => r.run_no)).toEqual([1, 1, 1]);
    const totals = new Map(s.map((x, i) => [x.company_id, [12, 88, 61][i]!]));
    const runs = await judgeAll(n, totals);
    expect(runs).toHaveLength(3);
    for (const x of s) {
      const t = totals.get(x.company_id)!;
      expect(await score(n, x.company_id)).toMatchObject({ status: "SEALED", final_score: t, median: t, run_totals: [t], generation: 1 });
    }
    // Totals as far apart as 12 and 88 queue nothing more.
    expect(await claim(n)).toEqual([]);
    expect(await n.q("select 1 from judge_runs where event_id = $1 and run_no > 1", [n.eventId])).toEqual([]);
  });

  test("judging by itself (judge_auto) queues 1 run per submission and seals each at its total", async () => {
    const { n, s } = await pitched(true);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await runNos(n)).map((r) => r.run_no)).toEqual([1, 1, 1]);
    expect((await n.one("select runs, submissions from judge_auto where event_id = $1 and type = 'PITCH'", [n.eventId])))
      .toMatchObject({ runs: 3, submissions: 3 });
    const totals = new Map(s.map((x, i) => [x.company_id, [70, 20, 95][i]!]));
    await judgeAll(n, totals);
    for (const x of s) expect(await score(n, x.company_id)).toMatchObject({ status: "SEALED", final_score: totals.get(x.company_id)! });
    expect(await n.q("select 1 from judge_runs where event_id = $1 and run_no > 1", [n.eventId])).toEqual([]);
  });

  test("a re-run queues 1 run (generation 2), which seals the score again at its total", async () => {
    const { n, s } = await pitched();
    const c = s[0]!.company_id;
    await n.org("start_judging", n.eventId, "PITCH");
    await judgeAll(n, new Map(s.map((x) => [x.company_id, 40])));
    expect(await score(n, c)).toMatchObject({ status: "SEALED", final_score: 40 });
    expect(await n.org("rerun_judging", c, "PITCH", "The judge timed out mid-answer.")).toMatchObject({ generation: 2 });
    expect((await runNos(n)).filter((r) => r.company_id === c).map((r) => [r.generation, r.run_no])).toEqual([[1, 1], [2, 1]]);
    await judgeAll(n, new Map([[c, 77]]));
    expect(await score(n, c)).toMatchObject({ status: "SEALED", final_score: 77, run_totals: [77], generation: 2 });
  });

  test("calibration queues 1 run per sample and never runs 4–5", async () => {
    const n = await Night.create(db.pool, 3);
    const sample = (no: number) => ({ sample_no: no, title: `S${no}`, expected: { min: 40, max: 55 }, text: `Sample ${no} (SC${"AB"[no - 1]})\n\nThe problem:\nSomething.` });
    expect(await n.org("start_calibration", n.eventId, JSON.stringify([sample(1), sample(2)]))).toMatchObject({ batch: 1, queued: 2 });
    const runs: { run_id: string; run_no: number }[] = await n.call(service, "claim_calibration_runs", n.eventId, 10);
    expect(runs.map((r) => r.run_no)).toEqual([1, 1]);
    for (const [i, r] of runs.entries()) {
      const out = await n.call(service, "finish_calibration_run", r.run_id, output("PITCH", [5, 95][i]!));
      expect(out).toMatchObject({ ok: true, status: "DONE" });
      expect(out.extra_runs).toBeUndefined();
    }
    expect(await n.call(service, "claim_calibration_runs", n.eventId, 10)).toEqual([]);
  });
});
