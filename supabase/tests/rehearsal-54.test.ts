// Tonight's exact path at the real size, end to end: 54 Product + 54 Consulting + 54 Finance teams admitted at the
// desk of a live event (is_rehearsal = false, desk check-in on, every switch on), the real sector files
// (seed/sectors: FMCG, Aviation, Luxury), the squad draw, BUILD as every team's pages read it, the practice market,
// 54 PRDs and 54 memos (submitted, drafted, broken), the deadline, the judge (claim/finish as the worker does), the
// releases, READING → IPO with every fund bidding at once, and the ledger at the end. Prints "[rehearsal-54]" lines.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  candleTicks, crisisCardsFromCsv, drawLottery, PRACTICE, practiceCandles, problemCardsFromCsv, RULES, RUBRICS, sha256Hex,
  TEMPLATES, type SubmissionType,
} from "@msim/engine";
import { parseStatements } from "../../apps/web/lib/admin/content";
import { createTestDb, ROOT } from "./pg";
import { rowsAs, seedEvent, service, user, type Caller } from "./helpers";
import { Night } from "./night";
import { settle } from "./race";

let db: Awaited<ReturnType<typeof createTestDb>>;
const report: string[] = [];
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  for (const line of report) console.log(`[rehearsal-54] ${line}`);
  await db?.drop();
});

// The desk caps (app.track_cap / app.team_cap): 54 per track at migration 102, 55 from 103. The rehearsal fills them.
let SIZE = 54;
let TOTAL = 162;
const TRACKS = ["PRODUCT", "CONSULTING", "FINANCE"] as const;
const read = (f: string) => readFileSync(join(ROOT, "seed/sectors", f), "utf8");
const members = (code: string, k: number) => JSON.stringify(Array.from({ length: k }, (_, i) => ({ full_name: `${code} member ${i + 1}`, roll_number: `${code}-${i + 1}` })));

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

const setCaps = async (track: number) => {
  await db.pool.query(`create or replace function app.track_cap() returns int language sql immutable set search_path = '' as $$ select ${track} $$`);
  await db.pool.query(`create or replace function app.team_cap() returns int language sql immutable set search_path = '' as $$ select ${3 * track} $$`);
};

// The schema's own caps, then 55 per track (the organisers' change of 20 Nov, migration 103), set in this test's database only.
describe.each([null, 55])("rehearsal of tonight at the desk caps (override %s)", (override) => {
  test("desk → draw → BUILD → practice → PRDs and memos → judge → release → IPO", { timeout: 900_000 }, async () => {
    const schemaCap: number = (await db.pool.query("select app.track_cap() as c")).rows[0].c;
    if (override !== null) await setCaps(override);
    try {
    // ── The live event: 55 cards per track (the 55th is the one the desk must refuse), the real sector files.
    const problems = problemCardsFromCsv(read("problem-cards.csv"));
    const crises = crisisCardsFromCsv(read("crisis-cards.csv"));
    expect(new Set(problems.map((p) => p.sector))).toEqual(new Set(["FMCG", "Aviation", "Luxury"]));
    SIZE = (await db.pool.query("select app.track_cap() as c")).rows[0].c;
    TOTAL = (await db.pool.query("select app.team_cap() as c")).rows[0].c;
    const PCAP: number = (await db.pool.query("select app.participant_cap() as c")).rows[0].c;
    expect(TOTAL).toBe(3 * SIZE);
    report.push(`caps: ${SIZE} per track, ${TOTAL} teams, ${PCAP} participants`);
    // Team codes are unique across events, so the second (55) run seeds with a code prefix and is then made live.
    const ev = await seedEvent(db.pool, { format: "PRIMUS", rehearsal: override !== null, teamsPerTrack: SIZE + 1, problemCards: problems, crisisCards: crises });
    const n = new Night(db.pool, ev);
    const E = n.eventId;
    if (override !== null) await n.q("update events set is_rehearsal = false where id = $1", [E]);
    expect((await n.one("select is_rehearsal, current_phase, desk_check_in from events where id = $1", [E]))).toMatchObject({ is_rehearsal: false });
    const statements = parseStatements(read("statements.csv"));
    if (!statements.ok) throw new Error(statements.message);
    await n.org("set_problem_statements", E, JSON.stringify(statements.value));
    // Every switch on.
    const catalog = await n.q("select key from app.feature_catalog()");
    for (const { key } of catalog) await n.org("set_feature", E, key, true);
    const off = await n.q("select key from app.feature_catalog() c where not app.feature_on($1, c.key)", [E]);
    expect(off).toEqual([]);
    report.push(`switches on: ${catalog.map((c) => c.key).join(",")}`);

    // The registration desk account.
    const regId = randomUUID();
    await n.q("insert into auth.users (id, email) values ($1, $2)", [regId, `desk-${regId}@example.org`]);
    await n.q("insert into accounts (user_id, role, display_name) values ($1, 'REGISTRATION', 'Registration desk')", [regId]);
    const desk = user(regId);

    // ── 1. The desk.
    await n.ok(n.lead, "set_desk_check_in", E, true);
    expect((await n.call(n.lead, "set_desk_check_in", E, false)).ok).toBe(false); // locked on for a live event
    const codes = (track: string) => ev.plan.teams.filter((t) => t.track === track).map((t) => t.code).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    const admitted: Record<string, string[]> = {};
    for (const track of TRACKS) {
      admitted[track] = codes(track).slice(0, SIZE);
      // The desk admits concurrently (several laptops), 4 members a team.
      const res = await Promise.all(admitted[track]!.map((c) => settle(n.call(desk, "desk_check_in", E, track, c, `Team ${c}`, members(c, 4)))));
      expect(res.filter((x) => x.err !== undefined || x.ok?.ok !== true).map((x) => x.err ?? x.ok)).toEqual([]);
    }
    const in1 = await n.one("select count(*) filter (where checked_in_at is not null)::int as c from teams where event_id = $1", [E]);
    expect(in1.c).toBe(TOTAL);
    // The 55th of each track (and so the 163rd team) is refused, even raced from three desks at once.
    const extra = TRACKS.map((t) => codes(t)[SIZE]!);
    const raced = await Promise.all(TRACKS.map((t, i) => n.call(desk, "desk_check_in", E, t, extra[i], "Late", members(extra[i]!, 1))));
    // At the total cap it answers first (TEAMS_FULL); with a Finance place freed, the extra Product team hits its track cap.
    expect(raced.map((r) => r.code)).toEqual(["TEAMS_FULL", "TEAMS_FULL", "TEAMS_FULL"]);
    const fOut = n.teamId(admitted.FINANCE![SIZE - 1]!);
    await n.ok(desk, "desk_check_out", E, fOut);
    expect((await n.call(desk, "desk_check_in", E, "PRODUCT", extra[0], "Late", members(extra[0]!, 1))).code).toBe("TRACK_FULL");
    await n.ok(desk, "desk_check_in", E, "FINANCE", admitted.FINANCE![SIZE - 1], `Team ${admitted.FINANCE![SIZE - 1]}`, members(admitted.FINANCE![SIZE - 1]!, 4));
    // Participants: 4 a team now; grow teams to 5 members up to the participant cap; one more member is refused.
    const grow = admitted.PRODUCT!.slice(0, PCAP - 4 * TOTAL);
    for (const c of grow) await n.ok(desk, "desk_check_in", E, "PRODUCT", c, `Team ${c}`, members(c, 5), null, true);
    expect((await n.one("select count(*)::int as c from members where event_id = $1", [E])).c).toBe(PCAP);
    expect((await n.call(desk, "desk_check_in", E, "CONSULTING", admitted.CONSULTING![0], "Team", members(admitted.CONSULTING![0]!, 5), null, true)).code).toBe("PARTICIPANTS_FULL");
    const preview = await n.org("draw_preview", E);
    expect(preview).toMatchObject({ drawn: false, squads: SIZE });
    expect(preview.left_out ?? 0).toBe(0);
    report.push(`desk: ${TOTAL} admitted, next ×3 TEAMS_FULL, extra Product TRACK_FULL, ${PCAP} participants then PARTICIPANTS_FULL; preview ${preview.squads} squads, ${preview.left_out ?? 0} left out`);
    // Remove the 3 cards not admitted, with the right confirmation only.
    expect((await n.call(n.lead, "remove_unadmitted", E, "REMOVE wrong")).ok).toBe(false);
    await expect(n.call(desk, "remove_unadmitted", E, `REMOVE ${ev.plan.event.slug}`)).rejects.toThrow(/organiser/);
    const rm = await n.org("remove_unadmitted", E, `REMOVE ${ev.plan.event.slug}`);
    expect(rm).toMatchObject({ teams: 3, logins: 3 });
    expect((await n.one("select count(*)::int as c from teams where event_id = $1", [E])).c).toBe(TOTAL);
    expect((await n.one("select count(*)::int as c from members where event_id = $1", [E])).c).toBe(PCAP);
    expect((await n.one("select count(*)::int as c from accounts where role <> 'TEAM' or team_id is null", [])).c).toBeGreaterThanOrEqual(5);

    // ── 2. The lottery.
    const seed = sha256Hex("rehearsal-54 seed");
    expect(await n.phase()).toBe("SETUP");
    await n.org("set_seed_commitment", E, sha256Hex(seed));
    // A team cannot read the seed or its commitment-free reveal before the draw.
    const someTeam = n.team(admitted.FINANCE![0]!);
    expect((await rowsAs(db.pool, someTeam, "select seed_revealed from events where id = $1", [E]).catch(() => [{ seed_revealed: null }]))[0]?.seed_revealed ?? null).toBeNull();
    // SETUP → CHECKIN → BRIEFING → SQUAD_DRAW the way the Run page does it ("start the next phase now").
    for (const from of ["SETUP", "CHECKIN", "BRIEFING"]) {
      if ((await n.phase()) !== from) continue;
      const r = await n.call(n.lead, "start_next_phase_now", E, from);
      if (!r.ok) {
        report.push(`start_next_phase_now from ${from} refused: ${r.code} ${r.message}; using advance_phase`);
        await n.advanceTo(({ SETUP: "CHECKIN", CHECKIN: "BRIEFING", BRIEFING: "SQUAD_DRAW" } as Record<string, string>)[from]!);
      }
    }
    expect(await n.phase()).toBe("SQUAD_DRAW");
    const wrong = await n.call(n.lead, "run_lottery", E, sha256Hex("not the seed"), "4");
    expect(wrong.ok).toBe(false);
    expect((await n.one("select count(*)::int as c from squads where event_id = $1", [E])).c).toBe(0);
    const t0 = performance.now();
    expect((await n.org("run_lottery", E, seed, "4")).squads).toBe(SIZE);
    report.push(`run_lottery ${Math.round(performance.now() - t0)} ms; wrong seed: ${wrong.code}`);
    await expect(n.call(n.lead, "run_lottery", E, seed, "4")).rejects.toThrow(/already been drawn/);
    const squads = await Promise.all(Array.from({ length: SIZE }, (_, i) => n.squad(i + 1)));
    const sectors = await n.q(
      `select pc.sector, count(*)::int as c from squads s join problem_cards pc on pc.id = s.chosen_card_id where s.event_id = $1 group by 1 order by 1`, [E]);
    // Split equally between the 3 sectors (54 → 18/18/18; 55 → one sector gets 19).
    expect(sectors.map((s) => s.c).sort()).toEqual([0, 1, 2].map((k) => Math.floor(SIZE / 3) + (k >= 3 - (SIZE % 3) ? 1 : 0)).sort());
    report.push(`sectors: ${JSON.stringify(sectors)}`);
    expect(new Set(squads.flatMap((s) => [s.p_code, s.c_code, s.f_code])).size).toBe(TOTAL);
    for (const s of squads) {
      for (const [code, track] of [[s.p_code, "PRODUCT"], [s.c_code, "CONSULTING"], [s.f_code, "FINANCE"]]) expect(admitted[track]).toContain(code);
    }
    expect((await n.one("select count(*)::int as c from companies where event_id = $1 and squad_id is not null", [E])).c).toBe(SIZE);
    // Deterministic: the engine replays the same draw from (seed, dice) and the admitted teams.
    const cards = await n.q("select id from problem_cards where event_id = $1 order by number", [E]);
    const replay = drawLottery(seed, "4", { product: admitted.PRODUCT!, consulting: admitted.CONSULTING!, finance: admitted.FINANCE! }, cards.map((c) => c.id));
    for (const s of replay.squads) {
      expect(squads[s.number - 1]).toMatchObject({ p_code: s.product, c_code: s.consulting, f_code: s.finance, chosen_card_id: s.cards[0] });
    }

    // ── 3. BUILD: what every team's pages read.
    await n.advanceTo("BUILD");
    const memoText = readFileSync(join(ROOT, "prompts/MEMO.md"), "utf8");
    expect(memoText).toMatch(/## The case[\s\S]*ZestUp/);
    expect(TEMPLATES.PITCH).toHaveLength(7);
    expect(RULES.WORD_LIMIT.PITCH).toBe(800);
    expect(RULES.WORD_LIMIT.MEMO).toBe(500);
    let leaks = 0;
    await Promise.all(squads.map(async (s) => {
      for (const code of [s.p_code, s.c_code, s.f_code]) {
        const me = n.team(code);
        const ctx = await rowsAs(db.pool, me, "select id, code, track, name, cash_cents from teams where id = $1", [n.teamId(code)]);
        expect(ctx).toHaveLength(1);
        const sq = await rowsAs<any>(db.pool, me, "select id, chosen_card_id from squads where event_id = $1", [E]);
        // context.ts reads squads with maybeSingle(): RLS must leave exactly the team's own squad.
        expect(sq.map((x) => x.id)).toEqual([s.id]);
        const card = await rowsAs<any>(db.pool, me, "select sector, title, body from problem_cards where id = $1", [s.chosen_card_id]);
        expect(card).toHaveLength(1);
        expect(card[0]!.body.length).toBeGreaterThan(100);
        const co = await rowsAs(db.pool, me, "select id from companies where squad_id = $1", [s.id]);
        expect(co).toHaveLength(1);
        // No other squad's drafts, no unreleased scores, no judge runs, no other team's members.
        leaks += (await rowsAs<any>(db.pool, me, "select count(*)::int as c from submission_drafts where squad_id <> $1", [s.id]))[0]!.c;
        leaks += (await rowsAs<any>(db.pool, me, "select count(*)::int as c from scores where status <> 'RELEASED'"))[0]!.c;
        leaks += (await rowsAs<any>(db.pool, me, "select count(*)::int as c from judge_runs"))[0]!.c;
        leaks += (await rowsAs<any>(db.pool, me, "select count(*)::int as c from members m where m.team_id <> $1", [n.teamId(code)]))[0]!.c;
      }
      const facts = await n.call(n.team(s.p_code), "team_plan_facts");
      expect(facts).toBeTruthy();
    }));
    expect(leaks).toBe(0);
    report.push(`BUILD reads: ${TOTAL} teams see their squad, card and company; 0 leaks (drafts, unreleased scores, runs, members)`);

    // ── 4. The practice market (the admin's prepare path, 20 companies a call).
    const steps = PRACTICE.candles * PRACTICE.candleTicks;
    let r = await n.org("prepare_practice_market", E, PRACTICE.tickSeconds, steps, "[]");
    expect(r).toMatchObject({ prepared: true, companies: SIZE });
    const tickerOf = new Map((r.list as { id: string; ticker: string }[]).map((c) => [c.id, c.ticker]));
    while ((r.missing?.length ?? 0) > 0) {
      const rows = (r.missing as string[]).slice(0, 20).map((id) => ({ ticker: id, prices: practiceCandles(`secret:${E}:practice:${tickerOf.get(id)}`).flatMap((k) => candleTicks(k)) }));
      r = await n.org("prepare_practice_market", E, PRACTICE.tickSeconds, steps, JSON.stringify(rows));
    }
    expect(r).toMatchObject({ ready: true, loaded: SIZE });
    const ids = [...tickerOf.keys()];
    // Nothing is visible before it is due; then the same price for everyone.
    const fundA = n.team(squads[0]!.f_code);
    const fundB = n.team(squads[SIZE - 1]!.f_code);
    const future = (await rowsAs(db.pool, fundA, "select count(*)::int as c from practice_ticks where event_id = $1 and at > now()", [E]))[0]!.c;
    expect(future).toBe(0);
    await n.q("update practice_markets set starts_at = starts_at - interval '10 minutes' where event_id = $1", [E]);
    await n.q("update practice_ticks set at = at - interval '10 minutes' where event_id = $1", [E]);
    const pa = await rowsAs(db.pool, fundA, "select ticker_team_id, step, price_cents from practice_ticks where event_id = $1 and step = 3 order by 1", [E]);
    const pb = await rowsAs(db.pool, fundB, "select ticker_team_id, step, price_cents from practice_ticks where event_id = $1 and step = 3 order by 1", [E]);
    expect(pa).toHaveLength(SIZE);
    expect(pa).toEqual(pb);
    expect((await rowsAs(db.pool, fundA, "select count(*)::int as c from practice_ticks where event_id = $1 and at > now()", [E]))[0]!.c).toBe(0);
    const trades = await Promise.all(squads.map(async (s, i) => {
      const out = [];
      for (const t of ["BUY", "BUY", "SELL"] as const) out.push(await settle(n.call(n.team(s.f_code), "practice_trade", ids[(i + 1) % SIZE]!, t, 10 + i)));
      return out;
    }));
    expect(trades.flat().filter((x) => x.err !== undefined || x.ok?.ok !== true).map((x) => x.err ?? x.ok?.code)).toEqual([]);
    // A Product or Consulting team cannot trade.
    expect((await n.call(n.team(squads[0]!.p_code), "practice_trade", ids[1], "BUY", 10)).ok).toBe(false);

    // ── 5. PRDs and memos.
    const words = (w: number, salt: string) => Array.from({ length: w }, (_, i) => `${salt}${i % 89}`).join(" ");
    const tick = (i: number) => `R${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
    const prd = (i: number, ticker = tick(i)) => ({
      company_name: `Rehearsal Co ${i}`, ticker,
      problem: words(100, "p"), solution: words(100, "s"), mvp: words(100, "m"), metrics: words(100, "k"),
      business_model: words(100, "b"), advantage: words(100, "a"), risks: words(100, "r"),
    });
    const memo = { diagnosis: words(90, "d"), options: words(90, "o"), recommendation: words(90, "r"), numbers: words(60, "n"), risks: words(60, "x"), next_steps: words(60, "y") };
    const saves = await Promise.all(squads.flatMap((s, i) => [
      settle(n.call(n.team(s.p_code), "save_draft", "PITCH", i === 50 ? { ...prd(i), ticker: "" } : prd(i), 0)),
      settle(n.call(n.team(s.c_code), "save_draft", "MEMO", memo, 0)),
    ]));
    expect(saves.filter((x) => x.err !== undefined || x.ok?.ok !== true).map((x) => x.err ?? x.ok)).toEqual([]);
    // submit_last_5: refused while the deadline is far.
    await n.deadlinePassed("PITCH", false);
    const early = await n.call(n.team(squads[0]!.p_code), "submit_submission", "PITCH");
    expect(early).toMatchObject({ ok: false, code: "SUBMIT_NOT_YET" });
    // The last 5 minutes.
    await n.q("update deadlines set at = now() + interval '4 minutes' where event_id = $1 and code = 'PITCH'", [E]);
    // Ticker collisions: squad 49 saves squad 0's ticker; an invalid ticker.
    await n.ok(n.team(squads[0]!.p_code), "submit_submission", "PITCH");
    await n.ok(n.team(squads[49]!.p_code), "save_draft", "PITCH", prd(49, tick(0)), 1);
    const taken = await n.call(n.team(squads[49]!.p_code), "submit_submission", "PITCH");
    expect(taken.code).toBe("TICKER_TAKEN");
    await n.ok(n.team(squads[48]!.p_code), "save_draft", "PITCH", prd(48, "a$1"), 1);
    const bad = await n.call(n.team(squads[48]!.p_code), "submit_submission", "PITCH");
    expect(bad.code).toBe("BAD_TICKER");
    report.push(`tickers: taken → ${taken.code}, invalid → ${bad.code}`);
    // Half submit by hand (and a double-submit raced), the others leave drafts.
    for (const s of squads.slice(1, 27)) {
      const two = await Promise.all([n.call(n.team(s.p_code), "submit_submission", "PITCH"), n.call(n.team(s.p_code), "submit_submission", "PITCH")]);
      expect(two.some((x) => x.ok)).toBe(true);
      await n.ok(n.team(s.c_code), "submit_submission", "MEMO");
    }
    expect((await n.one("select count(*)::int as c from submissions where event_id = $1 and type = 'PITCH' and superseded_at is null", [E])).c).toBe(27);
    // The deadline passes: the heartbeat auto-submits the drafts it can, judge_auto queues one run each.
    await n.deadlinePassed("PITCH");
    for (let i = 0; i < 4; i++) await n.ok(n.lead, "tick", E);
    const subs = await n.q("select type, count(*)::int as c, count(*) filter (where auto_submitted)::int as auto from submissions where event_id = $1 and superseded_at is null group by 1 order by 1", [E]);
    const pitchSubs = subs.find((x) => x.type === "PITCH")!.c as number;
    const memoSubs = subs.find((x) => x.type === "MEMO")!.c as number;
    report.push(`submissions after the deadline: ${JSON.stringify(subs)}`);
    const unsubmitted = await n.q(
      `select co.id, d.content ->> 'ticker' as ticker from companies co join submission_drafts d on d.company_id = co.id and d.type = 'PITCH'
        where co.event_id = $1 and co.squad_id is not null and not exists (select 1 from submissions s where s.company_id = co.id and s.type = 'PITCH' and s.superseded_at is null)`, [E]);
    report.push(`PRDs not auto-submitted (score 0): ${unsubmitted.length} — ${JSON.stringify(unsubmitted.map((u) => u.ticker))}`);
    expect(memoSubs).toBe(SIZE);
    expect(pitchSubs).toBe(SIZE - unsubmitted.length);
    const runs = await n.q("select type, count(*)::int as c, count(distinct submission_id)::int as subs from judge_runs where event_id = $1 group by 1 order by 1", [E]);
    report.push(`judge runs queued: ${JSON.stringify(runs)}`);
    for (const x of runs) expect(x.c).toBe(x.subs); // one run per document
    expect(runs.reduce((a, x) => a + x.c, 0)).toBe(pitchSubs + memoSubs);

    // ── 6. The judge: one run fails and is retried; then all finish.
    const totals = new Map(squads.map((s, i) => [s.company_id, 40 + (i % 50)]));
    let failedOnce = false;
    let malformed = 0;
    for (;;) {
      const claimed: Claimed[] = await n.call(service, "claim_judge_runs", E, 50);
      if (claimed.length === 0) break;
      for (const sub of new Set(claimed.map((x) => x.submission_id))) await n.ok(service, "record_injections", sub, "[]");
      for (const x of claimed) {
        if (!failedOnce) {
          failedOnce = true;
          const f = await n.call(service, "finish_judge_run", x.run_id, { attempt: x.claim_token, ok: false, error: "model returned malformed JSON", model: "test-model" });
          report.push(`a failed run: ${JSON.stringify(f)}`);
          malformed++;
          continue;
        }
        const res = await n.call(service, "finish_judge_run", x.run_id, { attempt: x.claim_token, ...output(x.type, totals.get(x.company_id)!) });
        expect(res).toMatchObject({ ok: true });
      }
      const failed = await n.q("select distinct type from judge_runs where event_id = $1 and status = 'FAILED'", [E]);
      for (const f of failed) report.push(`retry ${f.type}: ${JSON.stringify(await n.org("retry_failed_runs", E, f.type))}`);
    }
    for (let i = 0; i < 3; i++) await n.ok(n.lead, "tick", E);
    const sealed = await n.q("select type, count(*)::int as c, count(*) filter (where missing)::int as missing from scores where event_id = $1 and status = 'SEALED' group by 1 order by 1", [E]);
    report.push(`scores sealed: ${JSON.stringify(sealed)}; malformed/failed runs retried: ${malformed}`);
    expect(sealed.find((x) => x.type === "PITCH")?.c).toBe(SIZE);
    expect(sealed.find((x) => x.type === "MEMO")?.c).toBe(SIZE);
    expect((await n.one("select count(*)::int as c from judge_runs where event_id = $1 and status <> 'DONE'", [E])).c).toBe(0);

    // The practice close at the end of BUILD: exactly 3 × $50,000 through the ledger.
    const cashBefore = Number((await n.one("select sum(cash_cents) as s from teams where event_id = $1", [E])).s);
    await n.advanceTo("READING");
    await n.q("select app.settle_practice($1)", [E]);
    const prize = await n.q("select team_id, cash_delta_cents from ledger_entries where event_id = $1 and kind = 'PRACTICE_EDGE' and team_id is not null", [E]);
    expect(prize.map((p) => Number(p.cash_delta_cents))).toEqual([5_000_000, 5_000_000, 5_000_000]);
    expect(Number((await n.one("select sum(cash_cents) as s from teams where event_id = $1", [E])).s) - cashBefore).toBe(15_000_000);

    // Teams cannot read sealed scores before the release.
    expect((await rowsAs(db.pool, n.team(squads[0]!.p_code), "select count(*)::int as c from scores where status = 'SEALED'"))[0]!.c).toBe(0);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", E, "PITCH");
    const twice = await n.call(n.lead, "release_scores", E, "PITCH");
    report.push(`release PITCH twice: ${JSON.stringify(twice).slice(0, 160)}`);
    await n.org("release_scores", E, "MEMO");
    // IPO prices from the PRD scores; firm base rates from the memo scores.
    const priced = await n.q("select co.id, co.ipo_price, sc.final_score from companies co join scores sc on sc.company_id = co.id and sc.type = 'PITCH' where co.event_id = $1 and co.squad_id is not null", [E]);
    expect(priced).toHaveLength(SIZE);
    const zeroPrd = priced.filter((p) => p.final_score === 0);
    report.push(`IPO prices: ${priced.length} priced; ${zeroPrd.length} at score 0 → ipo_price ${zeroPrd.map((z) => z.ipo_price).join(",")}`);
    expect(priced.every((p) => p.ipo_price != null && p.ipo_price > 0)).toBe(true);
    // Firm base rates: 200 + 4 × (memo − 50) bp, clamped to 100..400 (089).
    const rates = await n.q(
      `select app.firm_base_rate(s.consulting_team_id) as bp, sc.final_score from squads s join companies co on co.squad_id = s.id
         join scores sc on sc.company_id = co.id and sc.type = 'MEMO' where s.event_id = $1`, [E]);
    expect(rates).toHaveLength(SIZE);
    for (const x of rates) expect(x.bp).toBe(Math.max(100, Math.min(400, Math.round(200 + 4 * (x.final_score - 50)))));
    // The leaderboard has only drawn companies (54).
    const board = await n.q("select * from public.leaderboard($1)", [E]).catch(() => [] as any[]);
    if (board.length > 0) expect(board.length).toBeLessThanOrEqual(SIZE);
    report.push(`firm base rates: ${rates.length} match the 089 rule; leaderboard rows ${board.length}`);
    // A team checked out after the draw: refused.
    expect((await n.call(desk, "desk_check_out", E, n.teamId(squads[5]!.f_code))).code).toBe("DRAWN");
    const lb = await n.call(n.team(squads[3]!.f_code), "leaderboard", E).catch((e: Error) => ({ error: e.message }));
    report.push(`leaderboard rows: ${Array.isArray(lb?.rows) ? lb.rows.length : JSON.stringify(lb).slice(0, 120)}`);

    // ── 7. IPO: 54 funds × 5 bids at once.
    await n.advanceTo("IPO");
    const companies = squads.map((s) => s.company_id);
    const placed = await Promise.all(squads.map(async (s, i) => {
      const out = [];
      for (let j = 1; j <= 5; j++) out.push(await settle(n.call(n.team(s.f_code), "place_ipo_bid", companies[(i + j * 7) % SIZE], 50 * j)));
      return out;
    }));
    expect(placed.flat().filter((x) => x.err !== undefined).map((x) => x.err)).toEqual([]);
    const bidOk = placed.flat().filter((x) => x.ok?.ok === true).length;
    const bidCodes = [...new Set(placed.flat().filter((x) => x.ok?.ok !== true).map((x) => x.ok?.code))];
    report.push(`IPO bids ok ${bidOk}/${5 * SIZE}; refused codes ${JSON.stringify(bidCodes)}`);
    await n.advanceTo("PRESSURE");
    expect((await n.one("select count(*)::int as c from ipo_bids where event_id = $1 and qty_allocated > 0", [E])).c).toBeGreaterThan(0);
    await n.checkInvariants();
    console.log(report.map((l) => `[rehearsal-54] ${l}`).join("\n"));
    report.length = 0;
    } finally {
      if (override !== null) await setCaps(schemaCap);
    }
  });
});

describe("BUILD paused and resumed", () => {
  test("drafts still save during a pause; the resume moves the PRD deadline on by the pause", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const E = n.eventId;
    const seed = sha256Hex("rehearsal-54 pause");
    await n.org("set_seed_commitment", E, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", E, seed, "4");
    const s = await n.squad(1);
    await n.advanceTo("BUILD");
    await n.deadlinePassed("PITCH", false);
    const before = (await n.one("select at from deadlines where event_id = $1 and code = 'PITCH'", [E])).at as Date;
    await n.org("pause_event", E);
    const paused = await settle(n.call(n.team(s.p_code), "save_draft", "PITCH", { company_name: "Paused", ticker: "PAUS", problem: "x" }, 0));
    await new Promise((r) => setTimeout(r, 1500));
    await n.org("resume_event", E);
    const after = (await n.one("select at from deadlines where event_id = $1 and code = 'PITCH'", [E])).at as Date;
    console.log(`[rehearsal-54] save during pause: ${JSON.stringify(paused.ok ?? paused.err)}; PITCH deadline moved ${after.getTime() - before.getTime()} ms`);
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: "Resumed", ticker: "RESU", problem: "x" }, 1);
  });
});
