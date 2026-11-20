// Round 3 at 67 companies per sector (migration 077). With draft_by_sector on, each sector drafts its own statements
// in its own queue, all at the same time, the lowest score so far first; the draft's planned length comes from the
// longest queue. With draft_random_fallback on, a missed pick (and everyone still waiting at the deadline) gets the
// first statement with room in the company's seeded order, which anyone can replay from the revealed lottery seed.
// Picks are heard on the staff channel only; teams read public.draft_clock. Both switches off: the draft of before.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Rng, rootSeed, sha256Hex, type Stream } from "@msim/engine";
import { parseStatements } from "../../apps/web/lib/admin/content";
import { createTestDb, ROOT } from "./pg";
import { Night } from "./night";
import { rowsAs, user, type Caller } from "./helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const SEED = sha256Hex("draft-sectors");
const DICE = "4";
const LOTTERY_ROOT = rootSeed(SEED, DICE);
const SECTORS = ["FMCG", "Aviation", "Luxury"];
const PROBLEMS = SECTORS.map((sector, i) => ({ number: i + 1, sector, title: `${sector} brief`, body: `Build a ${sector} startup.` }));
const CRISES = SECTORS.flatMap((sector) =>
  ["OPERATIONS", "MARKET", "TRUST", "MONEY"].map((category, i) => ({ sector, category, number: i + 1, title: `${sector} ${category}`, body: `${sector} crisis ${i + 1}.` })),
);

/** The order in which a company's missed pick tries its sector's statements (as app.random_statement draws it). */
const seededOrder = (companyId: string, numbers: readonly number[]) =>
  new Rng(LOTTERY_ROOT, `draft:${companyId}` as Stream).shuffle([...numbers].sort((a, b) => a - b).map(String)).map(Number);

// Seven squads, moved after the draw into uneven sectors: FMCG 4, Aviation 2, Luxury 1. Squad i's PRD scores SCORES[i]
// and its ticker is TICKERS[i]; squads 2 and 4 tie on 40 and the lower ticker (squad 4's) picks first.
const SPLIT = ["FMCG", "FMCG", "FMCG", "FMCG", "Aviation", "Aviation", "Luxury"];
const SCORES = [60, 40, 50, 40, 70, 30, 55];
const TICKERS = ["DRA", "DRC", "DRD", "DRB", "DRE", "DRF", "DRG"];
// Statements by sector: FMCG room 5 for 4 companies, Aviation 2 for 2, Luxury 2 for 1.
const STATEMENTS = [
  { number: 1, sector: "FMCG", cap: 2 },
  { number: 2, sector: "FMCG", cap: 2 },
  { number: 3, sector: "FMCG", cap: 1 },
  { number: 4, sector: "Aviation", cap: 1 },
  { number: 5, sector: "Aviation", cap: 1 },
  { number: 6, sector: "Luxury", cap: 1 },
  { number: 7, sector: "Luxury", cap: 1 },
].map((s) => ({ ...s, title: `${s.sector} problem ${s.number}`, body: "A problem." }));
const CAP = new Map(STATEMENTS.map((s) => [s.number, s.cap]));
const SECTOR_OF = new Map(STATEMENTS.map((s) => [s.number, s.sector]));

interface Co {
  squad: number;
  id: string;
  code: string;
  consulting: string;
  team: string;
  ticker: string;
  sector: string;
}

/**
 * A PRIMUS night over FMCG, Aviation and Luxury brought to Round 2 (PRESSURE): the squads drawn (then moved into
 * `split`'s sectors, by squad number), every PRD in and scored.
 */
async function round2(switches: Record<string, boolean>, split = SPLIT, scores = SCORES, tickers = TICKERS) {
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
    cos.push({ squad: i, id: s.company_id, code: s.p_code, consulting: s.c_code, team: s.product_team_id, ticker: tickers[i - 1]!, sector: split[i - 1]! });
  }
  for (const c of cos) {
    await n.ok(n.team(c.code), "save_draft", "PITCH", { company_name: `Draft Co ${c.squad}`, ticker: c.ticker, problem: "A real problem." }, 0);
    await n.ok(n.team(c.code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const c of cos) await n.judge(c.id, "PITCH", Array(3).fill(scores[c.squad - 1]));
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  return { n, cos, by: (squad: number) => cos.find((c) => c.squad === squad)! };
}

/** A fast rehearsal clock: the draft's planned end is 10 s away, then hiring, the due time and the rating. */
async function fastClock(n: Night) {
  await n.q(
    `update deadlines set at = now() + case code when 'DRAFT' then interval '10 seconds' when 'HIRE_5' then interval '55 seconds'
                                                 when 'DUE_5' then interval '190 seconds' else interval '235 seconds' end
      where event_id = $1 and code in ('DRAFT', 'HIRE_5', 'DUE_5', 'RATE_5')`,
    [n.eventId],
  );
}

const schedule = (n: Night) =>
  n.one(
    `select extract(epoch from (select at from deadlines where event_id = $1 and code = 'DRAFT') - now())::int as draft,
            (select array_agg(extract(epoch from d.at - (select at from deadlines where event_id = $1 and code = 'DRAFT'))::int order by d.at)
               from deadlines d where d.event_id = $1 and d.code in ('HIRE_5', 'DUE_5', 'RATE_5')) as after_draft`,
    [n.eventId],
  );

const picks = (n: Night) =>
  n.q<{ company_id: string; pick_no: number; sector: string | null; statement: number | null; by_default: boolean; opens: number; closes: number }>(
    `select d.company_id, d.pick_no, d.sector, st.number as statement, d.by_default,
            extract(epoch from d.opens_at - now())::float8 as opens, extract(epoch from d.closes_at - now())::float8 as closes
       from draft_picks d left join problem_statements st on st.id = d.statement_id
      where d.event_id = $1 order by d.pick_no`,
    [n.eventId],
  );

const statementId = async (n: Night, number: number) => (await n.one("select id from problem_statements where event_id = $1 and number = $2", [n.eventId, number])).id as string;

/** The draft broadcasts so far: on the event channel (every screen) and on the staff channel. */
const messages = (n: Night) =>
  n.q<{ topic: string; payload: Record<string, unknown> }>(
    "select topic, payload from realtime.messages where event = 'draft' and topic in ($1, $2) order by id",
    [`event:${n.eventId}`, `staff:${n.eventId}`],
  );
const onEvent = async (n: Night) => (await messages(n)).filter((m) => m.topic === `event:${n.eventId}`).map((m) => m.payload);
const onStaff = async (n: Night) => (await messages(n)).filter((m) => m.topic === `staff:${n.eventId}`).length;

const clock = async (n: Night, caller: Caller) =>
  (await rowsAs<{ r: any }>(db.pool, caller, "select public.draft_clock($1) as r", [n.eventId]))[0]!.r;
const facts = async (n: Night, code: string) =>
  (await rowsAs<{ r: any }>(db.pool, n.team(code), "select public.team_plan_facts() as r"))[0]!.r.primus;
const draftOver = async (n: Night) => (await n.one("select app.subround_open($1, 5) as open", [n.eventId])).open as boolean;

/**
 * Replays the deadline: every pick still to make, queue by queue ("C" order of the sectors) and in pick order, gets the
 * first statement with room in its company's seeded order.
 */
function replayDeadline(rows: { company_id: string; pick_no: number; sector: string | null; statement: number | null }[], sectorOf: (c: string) => string) {
  const count = new Map<number, number>();
  for (const r of rows) if (r.statement !== null) count.set(r.statement, (count.get(r.statement) ?? 0) + 1);
  const queues = [...new Set(rows.filter((r) => r.statement === null).map((r) => r.sector ?? ""))].sort();
  const out = new Map<string, number>();
  for (const q of queues) {
    for (const r of rows.filter((x) => x.statement === null && (x.sector ?? "") === q).sort((a, b) => a.pick_no - b.pick_no)) {
      const own = STATEMENTS.filter((s) => s.sector === sectorOf(r.company_id)).map((s) => s.number);
      const pick = seededOrder(r.company_id, own).find((no) => (count.get(no) ?? 0) < CAP.get(no)!)!;
      count.set(pick, (count.get(pick) ?? 0) + 1);
      out.set(r.company_id, pick);
    }
  }
  return out;
}

describe("Round 3 draft by sector", () => {
  test("three sectors draft at the same time, lowest score first; caps hold; missed picks get their seeded statement; all placed by the deadline", async () => {
    const { n, cos, by } = await round2({ draft_by_sector: true, draft_random_fallback: true });
    const sectorOf = (id: string) => cos.find((c) => c.id === id)!.sector;

    // Each sector's statements need room for that sector's companies (Aviation has 2).
    const tooSmall = STATEMENTS.map((s) => (s.number === 5 ? { ...s, sector: "Luxury" } : s));
    expect(await n.call(n.lead, "set_problem_statements", n.eventId, JSON.stringify(tooSmall))).toMatchObject({
      ok: false,
      code: "NOT_ENOUGH_ROOM",
      message: expect.stringContaining("aviation: room for 1, 2 companies"),
    });
    await n.org("set_problem_statements", n.eventId, JSON.stringify(STATEMENTS));
    await fastClock(n);
    await n.advanceTo("SATURATION");

    // Three queues side by side: Aviation (squads 6, 5), FMCG (4 and 2 tie on 40: the lower ticker first; then 3, 1),
    // Luxury (7). pick_no runs round by round across the sectors.
    const start = await picks(n);
    expect(start.map((p) => [cos.find((c) => c.id === p.company_id)!.squad, p.sector])).toEqual([
      [6, "aviation"], [4, "fmcg"], [7, "luxury"], [5, "aviation"], [2, "fmcg"], [3, "fmcg"], [1, "fmcg"],
    ]);
    expect(start.map((p) => p.pick_no)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 20 seconds each, the queues' first picks all on the clock now.
    const place = new Map<string, number>();
    for (const p of start) place.set(p.company_id, start.filter((x) => x.sector === p.sector && x.pick_no <= p.pick_no).length);
    for (const p of start) {
      expect(p.opens).toBeCloseTo(20 * (place.get(p.company_id)! - 1), 0);
      expect(p.closes).toBeCloseTo(20 * place.get(p.company_id)!, 0);
    }
    // The planned length is the longest queue's (FMCG: 4 × 20 s + 20 s), not every company's (7 × 20 s + 20 s = 160 s);
    // the rest of Round 3 moved with it, keeping its gaps.
    const t = await schedule(n);
    expect(t.draft).toBeGreaterThanOrEqual(99);
    expect(t.draft).toBeLessThanOrEqual(101);
    expect(t.after_draft).toEqual([45, 180, 225]);
    expect(await onEvent(n)).toEqual([expect.objectContaining({ step: "start", by_sector: true })]);
    expect((await onEvent(n))[0]).not.toHaveProperty("next_product");

    // Where the draft stands: staff and the projector see every queue; a team its own sector's.
    const lead = await clock(n, n.lead);
    expect(lead).toMatchObject({ by_sector: true, picks: 7, left: 7 });
    expect(lead.heads.map((h: any) => [h.sector, h.company_id, h.place, h.queue, h.left, h.mine])).toEqual([
      ["aviation", by(6).id, 1, 2, 2, false], ["fmcg", by(4).id, 1, 4, 4, false], ["luxury", by(7).id, 1, 1, 1, false],
    ]);
    expect((await clock(n, user(n.ev.staff.get("display@example.org")!))).heads).toHaveLength(3);
    expect((await clock(n, n.team(by(4).code))).heads.map((h: any) => [h.company_id, h.mine])).toEqual([[by(4).id, true]]);
    expect((await clock(n, n.team(by(2).code))).heads.map((h: any) => [h.company_id, h.mine])).toEqual([[by(4).id, false]]);
    expect((await clock(n, n.team(by(5).consulting))).heads.map((h: any) => h.company_id)).toEqual([by(6).id]);
    expect(await rowsAs(db.pool, n.team(by(4).code), "select public.draft_clock(gen_random_uuid()) as r")).toEqual([{ r: null }]);
    // Each team's plan: the three companies on the clock are told it is their turn, with their own end time.
    for (const squad of [6, 4, 7]) expect((await facts(n, by(squad).code)).draft).toMatchObject({ my_turn: true, picked: false });
    expect((await facts(n, by(2).code)).draft).toMatchObject({ my_turn: false, closes_at: null });

    // Luxury's only company and Aviation's first pick at the same time.
    const st = Object.fromEntries(await Promise.all(STATEMENTS.map(async (s) => [s.number, await statementId(n, s.number)])));
    await n.ok(n.team(by(7).code), "pick_statement", st[6]);
    const fmcgHeadBefore = (await picks(n)).find((p) => p.company_id === by(4).id)!.closes;
    await n.ok(n.team(by(6).code), "pick_statement", st[4]);
    const afterHand = await picks(n);
    // Aviation's next company starts its 20 seconds now; FMCG's clock is untouched.
    expect(afterHand.find((p) => p.company_id === by(5).id)!.closes).toBeCloseTo(20, 0);
    expect(afterHand.find((p) => p.company_id === by(4).id)!.closes).toBeCloseTo(fmcgHeadBefore, 0);
    // Caps and sectors hold; only each queue's company on the clock may pick.
    expect(await n.call(n.team(by(5).code), "pick_statement", st[4])).toMatchObject({ ok: false, code: "STATEMENT_FULL" });
    expect(await n.call(n.team(by(5).code), "pick_statement", st[1])).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await n.call(n.team(by(2).code), "pick_statement", st[1])).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    // Luxury is done, but hiring and writing wait for the whole draft.
    expect(await draftOver(n)).toBe(false);
    expect(await facts(n, by(7).code)).toMatchObject({ work_open: false, draft: { picked: true } });
    // The picks went to the staff channel only.
    expect(await onEvent(n)).toHaveLength(1);
    expect(await onStaff(n)).toBe(2);

    // Turning draft_by_sector off now does not change a draft already under way.
    await n.org("set_feature", n.eventId, "draft_by_sector", false);
    expect((await clock(n, n.lead)).heads).toHaveLength(2);
    await n.org("set_feature", n.eventId, "draft_by_sector", true);

    // FMCG's first company lets its 20 seconds run out: it gets the first statement with room in its seeded order.
    await n.q("update draft_picks set closes_at = now() - interval '1 second' where company_id = $1", [by(4).id]);
    await n.ok(n.lead, "tick", n.eventId);
    const fmcg = [1, 2, 3];
    const expected4 = seededOrder(by(4).id, fmcg)[0]!;
    let now = await picks(n);
    expect(now.find((p) => p.company_id === by(4).id)).toMatchObject({ statement: expected4, by_default: true });
    expect(now.find((p) => p.company_id === by(2).id)!.closes).toBeCloseTo(20, 0); // FMCG's next starts now
    expect(now.find((p) => p.company_id === by(5).id)!.statement).toBeNull(); // Aviation's clock had not run out
    // Replayable: the same draw, asked again, gives the same statement; and it is the TypeScript lottery's.
    const again = await n.q("select (select number from problem_statements where id = app.random_statement($1, $2)) as no from generate_series(1, 2)", [n.eventId, by(2).id]);
    const counted = (no: number) => now.filter((p) => p.statement === no).length;
    const expected2 = seededOrder(by(2).id, fmcg).find((no) => counted(no) < CAP.get(no)!)!;
    expect(again.map((r) => r.no)).toEqual([expected2, expected2]);

    // draft_random_fallback is read at each missed pick: off, FMCG's next company gets the least-crowded statement.
    await n.org("set_feature", n.eventId, "draft_random_fallback", false);
    await n.q("update draft_picks set closes_at = now() - interval '1 second' where company_id = $1", [by(2).id]);
    await n.ok(n.lead, "tick", n.eventId);
    now = await picks(n);
    const leastCrowded = fmcg.filter((no) => no !== expected4)[0]!; // the lowest-numbered statement nobody has yet
    expect(now.find((p) => p.company_id === by(2).id)).toMatchObject({ statement: leastCrowded, by_default: true });
    await n.org("set_feature", n.eventId, "draft_random_fallback", true);

    // The draft's deadline: everyone still waiting is placed, in queue order, each on the first statement with room in
    // its own seeded order. Every cap holds and every company stays in its sector.
    const expected = replayDeadline(now, sectorOf);
    await n.deadlinePassed("DRAFT");
    await n.ok(n.lead, "tick", n.eventId);
    const end = await picks(n);
    for (const [company, no] of expected) expect(end.find((p) => p.company_id === company)).toMatchObject({ statement: no, by_default: true });
    expect(end.every((p) => p.statement !== null)).toBe(true);
    for (const p of end) expect(SECTOR_OF.get(p.statement!)).toBe(sectorOf(p.company_id));
    for (const s of STATEMENTS) expect(end.filter((p) => p.statement === s.number).length).toBeLessThanOrEqual(s.cap);
    // The end of the draft is heard by every screen, once; hiring and writing open for everyone at once.
    expect((await onEvent(n)).map((m) => m.step)).toEqual(["start", "done"]);
    expect(await draftOver(n)).toBe(true);
    expect(await facts(n, by(7).code)).toMatchObject({ work_open: true });
    expect(await clock(n, n.lead)).toMatchObject({ left: 0, heads: [] });
    await n.checkInvariants();
  }, 180_000);

  test("both switches off: one queue over every company, the least-crowded statement, broadcasts on the event channel", async () => {
    const { n, cos, by } = await round2({ draft_by_sector: false, draft_random_fallback: false });
    await n.org("set_problem_statements", n.eventId, JSON.stringify(STATEMENTS));
    await fastClock(n);
    await n.advanceTo("SATURATION");

    // Lowest score so far first over every company (ties: the lower ticker): 6, 4, 2, 3, 7, 1, 5; no queues.
    const start = await picks(n);
    expect(start.map((p) => cos.find((c) => c.id === p.company_id)!.squad)).toEqual([6, 4, 2, 3, 7, 1, 5]);
    expect(start.every((p) => p.sector === null)).toBe(true);
    for (const [i, p] of start.entries()) expect(p.closes).toBeCloseTo(20 * (i + 1), 0);
    const t = await schedule(n);
    expect(t.draft).toBeGreaterThanOrEqual(159); // 7 × 20 s + 20 s
    expect(t.after_draft).toEqual([45, 180, 225]);
    // The first company's team hears "Your pick!" with the start.
    expect(await onEvent(n)).toEqual([expect.objectContaining({ step: "start", next_product: by(6).team })]);
    expect(await clock(n, n.lead)).toMatchObject({ by_sector: false, left: 7, heads: [{ company_id: by(6).id, place: 1, queue: 7 }] });
    expect((await clock(n, n.team(by(4).code))).heads.map((h: any) => h.company_id)).toEqual([by(6).id]);
    expect((await facts(n, by(6).code)).draft).toMatchObject({ my_turn: true });
    expect((await facts(n, by(4).code)).draft).toMatchObject({ my_turn: false, ahead: 1 });

    const st = Object.fromEntries(await Promise.all(STATEMENTS.map(async (s) => [s.number, await statementId(n, s.number)])));
    expect(await n.call(n.team(by(4).code), "pick_statement", st[1])).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
    await n.ok(n.team(by(6).code), "pick_statement", st[4]);
    expect((await onEvent(n)).at(-1)).toMatchObject({ step: "pick", pick_no: 1, next_product: by(4).team });
    // A missed pick: the least-crowded statement of its sector (all empty: the lowest number).
    await n.q("update draft_picks set closes_at = now() - interval '1 second' where company_id = $1", [by(4).id]);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await picks(n)).find((p) => p.company_id === by(4).id)).toMatchObject({ statement: 1, by_default: true });
    expect((await onEvent(n)).at(-1)).toMatchObject({ step: "pick", by_default: true, next_product: by(2).team });
    // The deadline: 2 → #2, 3 → #3 (FMCG's least crowded in turn), 7 → #6, 1 → #1 (one each now: the lowest), 5 → #5.
    await n.deadlinePassed("DRAFT");
    await n.ok(n.lead, "tick", n.eventId);
    const end = await picks(n);
    expect(Object.fromEntries(end.map((p) => [cos.find((c) => c.id === p.company_id)!.squad, p.statement]))).toEqual({
      6: 4, 4: 1, 2: 2, 3: 3, 7: 6, 1: 1, 5: 5,
    });
    expect(await onStaff(n)).toBe(0);
    expect(await draftOver(n)).toBe(true);
    await n.checkInvariants();
  }, 180_000);

  test("draft_by_sector off, draft_random_fallback on: one queue, each missed pick on its seeded statement", async () => {
    const { n, cos } = await round2({ draft_by_sector: false, draft_random_fallback: true });
    await n.org("set_problem_statements", n.eventId, JSON.stringify(STATEMENTS));
    await n.advanceTo("SATURATION");
    const start = await picks(n);
    expect(start.every((p) => p.sector === null)).toBe(true);
    // In one queue the deadline places the companies in pick order.
    const sectorOf = (id: string) => cos.find((c) => c.id === id)!.sector;
    const expected = replayDeadline(start, sectorOf);
    await n.deadlinePassed("DRAFT");
    await n.ok(n.lead, "tick", n.eventId);
    const end = await picks(n);
    for (const [company, no] of expected) expect(end.find((p) => p.company_id === company)!.statement).toBe(no);
  }, 180_000);

  test("before the draw, statements naming sectors need room for each sector's share of the companies", async () => {
    const n = await Night.create(db.pool, 7, "PRIMUS");
    await n.org("upload_problem_deck", n.eventId, JSON.stringify(PROBLEMS));
    // 7 companies dealt over 3 sector cards: up to 3 per sector.
    const rows = (luxuryCap: number) =>
      JSON.stringify(SECTORS.map((sector, i) => ({ number: i + 1, sector, title: `${sector} problem`, body: "A problem.", cap: sector === "Luxury" ? luxuryCap : 3 })));
    expect(await n.call(n.lead, "set_problem_statements", n.eventId, rows(2))).toMatchObject({
      ok: false,
      code: "NOT_ENOUGH_ROOM",
      message: "Each sector needs room for its companies. luxury: room for 2, up to 3 companies (7 companies over 3 sector cards). Add statements or raise their caps.",
    });
    await n.org("set_problem_statements", n.eventId, rows(3));
  }, 120_000);

  test("the event's statements.csv (10 per sector, cap 7): 50 companies draft in queues of 17, 17 and 16 and are all placed", async () => {
    const n = await Night.create(db.pool, 50, "PRIMUS");
    await n.org("upload_problem_deck", n.eventId, JSON.stringify(PROBLEMS));
    const csv = parseStatements(readFileSync(join(ROOT, "seed/sectors/statements.csv"), "utf8"));
    expect(csv.ok).toBe(true);
    if (!csv.ok) return;
    // Room 70 per sector: uploaded before the draw, as on the night.
    expect(csv.value.every((s) => s.cap === 7)).toBe(true);
    await n.org("set_problem_statements", n.eventId, JSON.stringify(csv.value));
    await n.org("set_seed_commitment", n.eventId, sha256Hex(SEED));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, SEED, DICE);
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    await n.org("seal_missing_scores", n.eventId, "PITCH");
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.advanceTo("SATURATION");
    const queues = await n.q("select sector, count(*)::int as n from draft_picks where event_id = $1 group by 1 order by 1", [n.eventId]);
    expect(queues.map((q) => q.n).sort()).toEqual([16, 17, 17]);
    // The planned length is the longest queue's: 17 × 20 s + 20 s = 6 min (at 67 per sector: 22 min 40 s).
    expect((await schedule(n)).draft).toBeGreaterThanOrEqual(359);
    await n.deadlinePassed("DRAFT");
    const t0 = Date.now();
    await n.ok(n.lead, "tick", n.eventId);
    const ms = Date.now() - t0;
    const placed = await n.q(
      `select count(*)::int as n, count(*) filter (where app.norm_sector(st.sector) = d.sector)::int as own,
              max((select count(*) from draft_picks x where x.statement_id = d.statement_id) - st.cap) as over
         from draft_picks d join problem_statements st on st.id = d.statement_id where d.event_id = $1`,
      [n.eventId],
    );
    expect(placed).toEqual([{ n: 50, own: 50, over: expect.any(String) }]);
    expect(Number(placed[0]!.over)).toBeLessThanOrEqual(0);
    expect(ms).toBeLessThan(10_000);
  }, 240_000);
});
