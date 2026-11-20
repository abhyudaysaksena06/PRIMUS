// Round 3 draft, the organisers' rule for 20 Nov (migration 088). The 10 lowest-scoring companies in each sector pick a
// statement, lowest first, 20 seconds each, each statement once. Every other company in the sector is given a
// statement at random, spread evenly across the ten: in the order md5(event || company), always the statement with the
// fewest companies so far (ties: md5(event || company || number)), never above its cap. A missed pick gets a random
// statement no picker has taken. A sector with 10 or fewer companies: everyone picks.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Rng, rootSeed, sha256Hex, type Stream } from "@msim/engine";
import { parseStatements } from "../../apps/web/lib/admin/content";
import { createTestDb, ROOT } from "./pg";
import { Night } from "./night";
import { rowsAs, type Caller } from "./helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const SEED = sha256Hex("draft-bottom10");
const DICE = "2";
const LOTTERY_ROOT = rootSeed(SEED, DICE);
const SECTORS = ["FMCG", "Aviation", "Luxury"];
const PROBLEMS = SECTORS.map((sector, i) => ({ number: i + 1, sector, title: `${sector} brief`, body: `Build a ${sector} startup.` }));
const CRISES = SECTORS.flatMap((sector) =>
  ["OPERATIONS", "MARKET", "TRUST", "MONEY"].map((category, i) => ({ sector, category, number: i + 1, title: `${sector} ${category}`, body: `${sector} crisis ${i + 1}.` })),
);
const seededOrder = (companyId: string, numbers: readonly number[]) =>
  new Rng(LOTTERY_ROOT, `draft:${companyId}` as Stream).shuffle([...numbers].sort((a, b) => a - b).map(String)).map(Number);
const ticker = (i: number) => `T${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;

interface Co {
  squad: number;
  id: string;
  code: string;
  sector: string;
  score: number;
}
interface Statement {
  id: string;
  number: number;
  sector: string;
  cap: number;
}

/** A PRIMUS night brought to Round 2 with the squads moved into `split`'s sectors; squad i scores 20 + i (all different). */
async function round2(split: string[], switches: Record<string, boolean>) {
  const n = await Night.create(db.pool, split.length, "PRIMUS");
  await n.org("upload_problem_deck", n.eventId, JSON.stringify(PROBLEMS));
  await n.org("upload_crisis_deck", n.eventId, JSON.stringify(CRISES));
  for (const [key, on] of Object.entries(switches)) await n.org("set_feature", n.eventId, key, on);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, SEED, DICE);
  await n.q(
    `update squads s set chosen_card_id = pc.id, dealt_card_ids = array[pc.id]
       from unnest($2::text[]) with ordinality as x(sector, i) join problem_cards pc on pc.event_id = $1 and pc.sector = x.sector
      where s.event_id = $1 and s.number = x.i`,
    [n.eventId, split],
  );
  await n.advanceTo("BUILD");
  const cos: Co[] = [];
  for (let i = 1; i <= split.length; i++) {
    const s = await n.squad(i);
    cos.push({ squad: i, id: s.company_id, code: s.p_code, sector: split[i - 1]!.toLowerCase(), score: 20 + i });
  }
  for (const c of cos) {
    await n.ok(n.team(c.code), "save_draft", "PITCH", { company_name: `Bottom Co ${c.squad}`, ticker: ticker(c.squad), problem: "A real problem." }, 0);
    await n.ok(n.team(c.code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const c of cos) await n.judge(c.id, "PITCH", Array(3).fill(c.score));
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  return { n, cos };
}

async function fastClock(n: Night) {
  await n.q(
    `update deadlines set at = now() + case code when 'DRAFT' then interval '10 seconds' when 'HIRE_5' then interval '55 seconds'
                                                 when 'DUE_5' then interval '190 seconds' else interval '235 seconds' end
      where event_id = $1 and code in ('DRAFT', 'HIRE_5', 'DUE_5', 'RATE_5')`,
    [n.eventId],
  );
}

interface Pick {
  company_id: string;
  pick_no: number;
  sector: string;
  auto: boolean;
  statement: number | null;
  by_default: boolean;
  opens: number;
  closes: number;
}
const picks = (n: Night) =>
  n.q<Pick>(
    `select d.company_id, d.pick_no, d.sector, d.auto, st.number as statement, d.by_default,
            extract(epoch from d.opens_at - now())::float8 as opens, extract(epoch from d.closes_at - now())::float8 as closes
       from draft_picks d left join problem_statements st on st.id = d.statement_id
      where d.event_id = $1 order by d.pick_no`,
    [n.eventId],
  );
const statements = async (n: Night) =>
  (await n.q<Statement>("select id, number, app.norm_sector(sector) as sector, cap from problem_statements where event_id = $1 order by number", [n.eventId]));
const clock = async (n: Night, caller: Caller) =>
  (await rowsAs<{ r: any }>(db.pool, caller, "select public.draft_clock($1) as r", [n.eventId]))[0]!.r;
const facts = async (n: Night, code: string) =>
  (await rowsAs<{ r: any }>(db.pool, n.team(code), "select public.team_plan_facts() as r"))[0]!.r.primus;
const draftOver = async (n: Night) => (await n.one("select app.subround_open($1, 5) as open", [n.eventId])).open as boolean;
const onEvent = async (n: Night) =>
  (await n.q("select payload from realtime.messages where event = 'draft' and topic = $1 order by id", [`event:${n.eventId}`])).map((m) => m.payload);

/** The allocation of a sector's others, as app.allocate_rest does it, from the picks already made. */
function replayRest(eventId: string, rows: Pick[], sector: string, sts: Statement[]) {
  const own = sts.filter((s) => s.sector === sector);
  const count = new Map(own.map((s) => [s.number, rows.filter((r) => r.statement === s.number && !r.auto).length]));
  const others = rows
    .filter((r) => r.sector === sector && r.auto)
    .sort((a, b) => md5(eventId + a.company_id).localeCompare(md5(eventId + b.company_id)));
  const out = new Map<string, number>();
  for (const r of others) {
    const pick = own
      .filter((s) => count.get(s.number)! < s.cap)
      .sort((a, b) => count.get(a.number)! - count.get(b.number)! || md5(eventId + r.company_id + a.number).localeCompare(md5(eventId + r.company_id + b.number)))[0]!;
    count.set(pick.number, count.get(pick.number)! + 1);
    out.set(r.company_id, pick.number);
  }
  return out;
}

/** Per sector: the pickers' statements are all different; every company is in its sector; caps hold; the spread is even. */
function checkSector(rows: Pick[], sector: string, sts: Statement[]) {
  const own = sts.filter((s) => s.sector === sector);
  const mine = rows.filter((r) => r.sector === sector);
  expect(mine.every((r) => r.statement !== null)).toBe(true);
  const pickers = mine.filter((r) => !r.auto).map((r) => r.statement);
  expect(new Set(pickers).size).toBe(pickers.length);
  for (const r of mine) expect(own.map((s) => s.number)).toContain(r.statement);
  const counts = own.map((s) => mine.filter((r) => r.statement === s.number).length);
  for (const [i, s] of own.entries()) expect(counts[i]).toBeLessThanOrEqual(s.cap);
  return counts;
}

// FMCG 14, Aviation 13, Luxury 8 (sectors mixed through the squad numbers, so scores interleave).
const SPLIT = Array.from({ length: 35 }, (_, i) => (i < 8 * 3 ? SECTORS[i % 3]! : i < 30 ? (i % 2 ? "FMCG" : "Aviation") : i < 34 ? (i % 2 ? "Aviation" : "FMCG") : "FMCG"));

describe("Round 3 draft: the 10 lowest-scoring companies of each sector pick", () => {
  test("bottom 10 per sector pick, each statement once; a missed pick gets an untaken statement; the others are spread evenly; pause shifts the clock; the draft ends and Round 3 opens", async () => {
    const size = (s: string) => SPLIT.filter((x) => x === s).length;
    expect([size("FMCG"), size("Aviation"), size("Luxury")]).toEqual([14, 13, 8]);
    const { n, cos } = await round2(SPLIT, { draft_by_sector: true, draft_random_fallback: true });
    const csv = parseStatements(readFileSync(join(ROOT, "seed/sectors/statements.csv"), "utf8"));
    if (!csv.ok) throw new Error(csv.message);
    await n.org("set_problem_statements", n.eventId, JSON.stringify(csv.value));
    await fastClock(n);
    await n.advanceTo("SATURATION");
    const sts = await statements(n);
    const st = (sector: string, number: number) => sts.find((s) => s.sector === sector && s.number === number)!;
    const byId = (id: string) => cos.find((c) => c.id === id)!;

    // Only the 10 lowest-scoring of each sector pick (Luxury has 8: all of them), in score order, 20 s each; the others
    // wait for their sector's picks to end (200 s).
    const start = await picks(n);
    for (const sector of ["fmcg", "aviation", "luxury"]) {
      const ranked = cos.filter((c) => c.sector === sector).sort((a, b) => a.score - b.score);
      const pickers = start.filter((p) => p.sector === sector && !p.auto);
      expect(pickers.map((p) => p.company_id)).toEqual(ranked.slice(0, 10).map((c) => c.id));
      expect(start.filter((p) => p.sector === sector && p.auto).map((p) => p.company_id).sort()).toEqual(ranked.slice(10).map((c) => c.id).sort());
      for (const [i, p] of pickers.entries()) {
        expect(p.opens).toBeCloseTo(20 * i, 0);
        expect(p.closes).toBeCloseTo(20 * (i + 1), 0);
      }
      for (const p of start.filter((x) => x.sector === sector && x.auto)) expect(p.closes).toBeCloseTo(200, 0);
    }
    expect(start.filter((p) => p.auto)).toHaveLength(4 + 3);
    // Pickers come first in pick_no, round by round across the sectors.
    expect(start.slice(0, 28).every((p) => !p.auto)).toBe(true);
    // The planned length: 10 picks × 20 s + 20 s.
    const draftIn = (await n.one("select extract(epoch from at - now())::int as s from deadlines where event_id = $1 and code = 'DRAFT'", [n.eventId])).s;
    expect(draftIn).toBeGreaterThanOrEqual(219);
    expect(draftIn).toBeLessThanOrEqual(221);
    const lead = await clock(n, n.lead);
    expect(lead).toMatchObject({ by_sector: true, pickers: 10, picks: 35, left: 35 });
    expect(lead.heads.map((h: any) => [h.sector, h.place, h.queue, h.left, h.others])).toEqual([
      ["aviation", 1, 10, 10, 3], ["fmcg", 1, 10, 10, 4], ["luxury", 1, 8, 8, 0],
    ]);

    const fmcg = start.filter((p) => p.sector === "fmcg" && !p.auto);
    const fOther = byId(start.find((p) => p.sector === "fmcg" && p.auto)!.company_id);
    // A company beyond the 10 never picks and is never on the clock.
    expect(await n.call(n.team(fOther.code), "pick_statement", st("fmcg", 1).id)).toMatchObject({
      ok: false,
      code: "NOT_A_PICKER",
      message: expect.stringContaining("Only the 10 lowest-scoring companies in each sector pick"),
    });
    expect((await facts(n, fOther.code)).draft).toMatchObject({ my_turn: false, auto: true, ahead: 10, picked: false });
    expect((await clock(n, n.team(fOther.code))).my_auto).toBe(true);
    expect((await facts(n, byId(fmcg[0]!.company_id).code)).draft).toMatchObject({ my_turn: true, auto: false });

    // Each statement once: FMCG's first takes #1; the second cannot, and takes #2.
    await n.ok(n.team(byId(fmcg[0]!.company_id).code), "pick_statement", st("fmcg", 1).id);
    expect(await n.call(n.team(byId(fmcg[1]!.company_id).code), "pick_statement", st("fmcg", 1).id)).toMatchObject({
      ok: false,
      code: "STATEMENT_TAKEN",
      message: `Statement 1 has already been picked by ${ticker(byId(fmcg[0]!.company_id).squad)}. Each statement can be picked only once: choose another.`,
    });
    await n.ok(n.team(byId(fmcg[1]!.company_id).code), "pick_statement", st("fmcg", 2).id);

    // Pause and resume still shift the clock (the others' rows too); no pick while paused; nobody defaulted.
    const before = await picks(n);
    await n.org("pause_event", n.eventId);
    expect(await n.call(n.team(byId(fmcg[2]!.company_id).code), "pick_statement", st("fmcg", 3).id)).toMatchObject({ ok: false, code: "PAUSED" });
    await n.q("update events set paused_at = paused_at - interval '60 seconds' where id = $1", [n.eventId]);
    await n.q("update deadlines set at = at - interval '60 seconds' where event_id = $1", [n.eventId]);
    await n.q("update draft_picks set opens_at = opens_at - interval '60 seconds', closes_at = closes_at - interval '60 seconds' where event_id = $1 and statement_id is null", [n.eventId]);
    await n.org("resume_event", n.eventId);
    const after = await picks(n);
    for (const p of after.filter((x) => x.statement === null)) {
      expect(Math.abs(p.closes - before.find((b) => b.company_id === p.company_id)!.closes)).toBeLessThan(3);
    }
    await n.ok(n.lead, "tick", n.eventId);
    expect((await picks(n)).filter((p) => p.statement !== null)).toHaveLength(2);

    // FMCG's third misses its 20 s: a random statement no picker has taken (its seeded order's first untaken).
    await n.q("update draft_picks set closes_at = now() - interval '1 second' where company_id = $1", [fmcg[2]!.company_id]);
    await n.ok(n.lead, "tick", n.eventId);
    const fNumbers = sts.filter((s) => s.sector === "fmcg").map((s) => s.number);
    const missed = seededOrder(fmcg[2]!.company_id, fNumbers).find((no) => no !== 1 && no !== 2)!;
    expect((await picks(n)).find((p) => p.company_id === fmcg[2]!.company_id)).toMatchObject({ statement: missed, by_default: true });

    // FMCG's other seven pick the untaken statements in turn. At the tenth pick the four others are placed at once.
    const untaken = fNumbers.filter((no) => ![1, 2, missed].includes(no));
    for (const [i, p] of fmcg.slice(3).entries()) {
      if (i === 6) expect((await picks(n)).filter((x) => x.sector === "fmcg" && x.auto).every((x) => x.statement === null)).toBe(true);
      await n.ok(n.team(byId(p.company_id).code), "pick_statement", st("fmcg", untaken[i]!).id);
    }
    let rows = await picks(n);
    const fExpected = replayRest(n.eventId, rows.map((r) => (r.auto ? { ...r, statement: null } : r)), "fmcg", sts);
    for (const [company, no] of fExpected) expect(rows.find((r) => r.company_id === company)).toMatchObject({ statement: no, by_default: true });
    // Spread evenly: four statements with 2 companies, six with 1.
    expect(checkSector(rows, "fmcg", sts).sort()).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(await draftOver(n)).toBe(false); // Aviation and Luxury still pick

    // The deadline: every picker still waiting gets an untaken statement, then the others are placed.
    await n.deadlinePassed("DRAFT");
    await n.ok(n.lead, "tick", n.eventId);
    rows = await picks(n);
    expect(checkSector(rows, "aviation", sts).sort()).toEqual([1, 1, 1, 1, 1, 1, 1, 2, 2, 2]);
    // Luxury (8 companies): everyone picked, 8 different statements, no others.
    expect(rows.filter((r) => r.sector === "luxury" && r.auto)).toHaveLength(0);
    expect(checkSector(rows, "luxury", sts).sort()).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    const aExpected = replayRest(n.eventId, rows.map((r) => (r.auto ? { ...r, statement: null } : r)), "aviation", sts);
    for (const [company, no] of aExpected) expect(rows.find((r) => r.company_id === company)!.statement).toBe(no);

    // Deterministic: allocating the others again, from the same picks, gives the same statements.
    await n.q("update draft_picks set statement_id = null, by_default = false where event_id = $1 and auto", [n.eventId]);
    await n.q("select app.allocate_rest($1, 'fmcg'), app.allocate_rest($1, 'aviation')", [n.eventId]);
    const again = await picks(n);
    expect(again.map((r) => [r.company_id, r.statement])).toEqual(rows.map((r) => [r.company_id, r.statement]));

    // The draft is over: every screen hears it once; hiring and writing open for Round 3.
    expect((await onEvent(n)).map((m) => m.step)).toEqual(["start", "done"]);
    expect(await draftOver(n)).toBe(true);
    expect(await facts(n, fOther.code)).toMatchObject({ work_open: true, draft: { picked: true, by_default: true, auto: true } });
    expect(await clock(n, n.lead)).toMatchObject({ left: 0, heads: [] });
    await n.checkInvariants();
  }, 300_000);

  test("tight caps: the others never go above a statement's cap; draft_random_fallback off still gives pickers untaken statements; a sector of 2 all pick", async () => {
    const split = [...Array(14).fill("FMCG"), "Aviation", "Aviation"];
    const { n } = await round2(split, { draft_by_sector: true, draft_random_fallback: false });
    const caps = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2]; // room 14 for 14 companies
    const rowsIn = [
      ...caps.map((cap, i) => ({ number: i + 1, sector: "FMCG", cap, title: `FMCG problem ${i + 1}`, body: "A problem." })),
      { number: 11, sector: "Aviation", cap: 1, title: "Aviation problem 11", body: "A problem." },
      { number: 12, sector: "Aviation", cap: 1, title: "Aviation problem 12", body: "A problem." },
    ];
    await n.org("set_problem_statements", n.eventId, JSON.stringify(rowsIn));
    await n.advanceTo("SATURATION");
    const sts = await statements(n);
    const start = await picks(n);
    expect(start.filter((p) => p.sector === "fmcg" && !p.auto)).toHaveLength(10);
    expect(start.filter((p) => p.sector === "aviation" && !p.auto)).toHaveLength(2);
    // Everyone misses: the least-crowded statement for each picker is an untaken one.
    await n.deadlinePassed("DRAFT");
    await n.ok(n.lead, "tick", n.eventId);
    const rows = await picks(n);
    // The four others can only go to the four statements of cap 2: exactly 2 each, never 3.
    expect(checkSector(rows, "fmcg", sts)).toEqual(caps);
    expect(checkSector(rows, "aviation", sts)).toEqual([1, 1]);
    expect(rows.every((r) => r.by_default)).toBe(true);
    expect(await draftOver(n)).toBe(true);
    await n.checkInvariants();
  }, 240_000);
});
