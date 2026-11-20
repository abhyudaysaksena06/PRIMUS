// Migration 072: Submit only in the last 5 minutes (switch submit_last_5), a note for the fairness officer when a draft
// grows too fast to have been typed (switch paste_flag), and the crisis category for the reveal pop-up.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256Hex } from "@msim/engine";
import { Night } from "./night";
import { as, rowsAs } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

/** `n` words of filler, unique per call so a save always changes the text. */
let wordSeq = 0;
const words = (n: number) => Array.from({ length: n }, () => `w${wordSeq++}`).join(" ");

// An advice memo of at least 150 words (a shorter one is refused).
const advice = () => ({ diagnosis: words(60), advice: words(60), evidence: words(30), fit: words(20) });

async function toCrisis1(n: Night, squads: number, tag: string) {
  const seed = sha256Hex(tag);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, String(squads));
  const s = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Write Co ${i}`, ticker: ["WRA", "WRB", "WRC", "WRD"][i], problem: "A real problem." }, 0);
    await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const q of s) await n.judge(q.company_id, "PITCH", [60, 60, 60]);
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  await n.deadlinePassed("REVEAL_1");
  await n.ok(n.lead, "tick", n.eventId);
  return s;
}

/** The squad's firm (its own Consulting team) hired by its company for crisis 1. */
async function hireOwnFirm(n: Night, sq: { p_code: string; c_code: string }) {
  const firm = n.team(sq.c_code);
  await n.ok(firm, "save_firm_profile", "Operations", ["operations"], "From $500", 0);
  const offer = (await n.ok(n.team(sq.p_code), "make_offer", n.teamId(sq.c_code), 50000, 0, "Help us")).offer;
  await n.ok(firm, "respond_offer", offer.id, "ACCEPT");
  return firm;
}

const hhmm = async (n: Night, at: string) => (await n.one("select to_char($1::timestamptz at time zone 'Asia/Kolkata', 'HH24:MI') as t", [at])).t as string;
const setDue = (n: Night, code: string, minutesFromNow: number) =>
  n.q(`update deadlines set at = now() + make_interval(secs => $3) where event_id = $1 and code = $2`, [n.eventId, code, minutesFromNow * 60]);
const deadline = async (n: Night, code: string) => (await n.one("select at from deadlines where event_id = $1 and code = $2", [n.eventId, code])).at as Date;
const clearLimits = (n: Night) => n.q("delete from rate_limits where team_id in (select id from teams where event_id = $1)", [n.eventId]);

describe("submit_last_5: Submit opens 5 minutes before the deadline", () => {
  test("off: submit any time in the window; on: refused until the last 5 minutes, for plans, memos and the PRD; auto-submit unaffected", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    // Round 1 first: the PRD's deadline is PITCH.
    const seed = sha256Hex("submit-window");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const [a, b, c] = [await n.squad(1), await n.squad(2), await n.squad(3)];
    await n.advanceTo("BUILD");
    const prd = (i: number) => ({ company_name: `Window Co ${i}`, ticker: ["WIA", "WIB", "WIC"][i], problem: "A real problem." });

    // Off (the default): Submit works as before, an hour before the deadline.
    expect((await n.one("select app.feature_on($1, 'submit_last_5') as on", [n.eventId])).on).toBe(false);
    await setDue(n, "PITCH", 60);
    await n.ok(n.team(a!.p_code), "save_draft", "PITCH", prd(0), 0);
    await n.ok(n.team(a!.p_code), "submit_submission", "PITCH");

    // On: refused, with the time Submit opens (5 minutes before PITCH, in IST); logged like every refusal.
    await n.org("set_feature", n.eventId, "submit_last_5", true);
    await n.ok(n.team(b!.p_code), "save_draft", "PITCH", prd(1), 0);
    const opens = await hhmm(n, new Date((await deadline(n, "PITCH")).getTime() - 5 * 60_000).toISOString());
    const early = await n.call(n.team(b!.p_code), "submit_submission", "PITCH");
    expect(early).toMatchObject({ ok: false, code: "SUBMIT_NOT_YET", message: `Submit opens at ${opens} (the last 5 minutes).` });
    const logged = await n.q("select after from audit_log where event_id = $1 and action = 'rejected' and entity = 'submit' and after ->> 'code' = 'SUBMIT_NOT_YET'", [n.eventId]);
    expect(logged).toHaveLength(1);
    expect(logged[0].after).toMatchObject({ type: "PITCH" });
    expect(await n.q("select 1 from submissions where company_id = $1", [b!.company_id])).toEqual([]);
    // Saving is never limited.
    await n.ok(n.team(b!.p_code), "save_draft", "PITCH", { ...prd(1), problem: "A better problem." }, 1);

    // In the last 5 minutes it is accepted.
    await setDue(n, "PITCH", 4);
    await n.ok(n.team(b!.p_code), "submit_submission", "PITCH");

    // While the event is paused the clock stands still: paused before Submit opened, it stays shut.
    await setDue(n, "PITCH", 2);
    await n.q("update events set paused = true, paused_at = now() - interval '10 minutes' where id = $1", [n.eventId]);
    await n.ok(n.team(c!.p_code), "save_draft", "PITCH", prd(2), 0);
    expect(await n.call(n.team(c!.p_code), "submit_submission", "PITCH")).toMatchObject({ ok: false, code: "SUBMIT_NOT_YET" });
    await n.q("update events set paused = false, paused_at = null where id = $1", [n.eventId]);
    await n.ok(n.team(c!.p_code), "submit_submission", "PITCH");

    // Round 2: the crisis plan (DUE_1) and the firm's advice memo (submit_for) follow the same rule.
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    for (const q of [a!, b!, c!]) await n.judge(q.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
    const firm = await hireOwnFirm(n, a!);
    await setDue(n, "DUE_1", 30);
    await n.ok(n.team(a!.p_code), "save_draft", "CRISIS_1", { impact: words(40), response: words(40) }, 0);
    const opens1 = await hhmm(n, new Date((await deadline(n, "DUE_1")).getTime() - 5 * 60_000).toISOString());
    expect(await n.call(n.team(a!.p_code), "submit_submission", "CRISIS_1")).toMatchObject({
      ok: false,
      code: "SUBMIT_NOT_YET",
      message: `Submit opens at ${opens1} (the last 5 minutes).`,
    });
    await n.ok(firm, "save_draft_for", a!.company_id, "ADVICE_1", advice(), 0);
    expect(await n.call(firm, "submit_for", a!.company_id, "ADVICE_1")).toMatchObject({ ok: false, code: "SUBMIT_NOT_YET", message: `Submit opens at ${opens1} (the last 5 minutes).` });
    // Other refusals still come first: a team that cannot submit this hears that, not the time.
    expect(await n.call(n.team(b!.c_code), "submit_for", a!.company_id, "ADVICE_1")).toMatchObject({ ok: false, code: "NOT_ALLOWED" });

    // B saves a plan and never submits: at the deadline it is submitted for it, switch or not.
    await n.ok(n.team(b!.p_code), "save_draft", "CRISIS_1", { impact: words(30), response: words(30) }, 0);

    await setDue(n, "DUE_1", 3);
    await clearLimits(n);
    await n.ok(n.team(a!.p_code), "submit_submission", "CRISIS_1");
    await n.ok(firm, "submit_for", a!.company_id, "ADVICE_1");

    await n.deadlinePassed("HIRE_1");
    await n.deadlinePassed("DUE_1");
    await n.ok(n.lead, "tick", n.eventId);
    const auto = await n.one("select auto_submitted, word_count from submissions where company_id = $1 and type = 'CRISIS_1' and superseded_at is null", [b!.company_id]);
    expect(auto).toEqual({ auto_submitted: true, word_count: 60 });
    expect(await n.call(n.team(c!.p_code), "submit_submission", "CRISIS_1")).toMatchObject({ ok: false, code: "DEADLINE_PASSED" });
  });

  test("the switch turned off again: Submit is open for the whole window", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const [a] = await toCrisis1(n, 3, "submit-off-again");
    await n.org("set_feature", n.eventId, "submit_last_5", true);
    await setDue(n, "DUE_1", 40);
    await n.ok(n.team(a!.p_code), "save_draft", "CRISIS_1", { impact: words(20) }, 0);
    expect(await n.call(n.team(a!.p_code), "submit_submission", "CRISIS_1")).toMatchObject({ ok: false, code: "SUBMIT_NOT_YET" });
    await n.org("set_feature", n.eventId, "submit_last_5", false);
    await n.ok(n.team(a!.p_code), "submit_submission", "CRISIS_1");
    expect((await n.one("select app.submit_opens_at($1, 'CRISIS_1') as at", [n.eventId])).at).toBeNull();
  });
});

describe("paste_flag: a draft that grows too fast to have been typed", () => {
  const flags = (n: Night) =>
    n.q("select team_id, company_id, type, version, words_before, words_after, seconds from writing_flags where event_id = $1 order by created_at, version", [n.eventId]);

  test("noted for the fairness officer (never blocking the save); over 120 words within 60 s, or in a first save; off: nothing", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const [a, b] = await toCrisis1(n, 3, "paste-flag");
    const p = n.team(a!.p_code);
    expect((await n.one("select app.feature_on($1, 'paste_flag') as on", [n.eventId])).on).toBe(true);

    // A first save of 120 words is not noted; a first save of more is (migration 081), with 0 words before.
    await n.ok(p, "save_draft", "CRISIS_1", { impact: words(120) }, 0);
    expect(await flags(n)).toEqual([]);
    await n.q("update submission_drafts set version = 0, content = '{}' where company_id = $1 and type = 'CRISIS_1'", [a!.company_id]);
    await n.ok(p, "save_draft", "CRISIS_1", { impact: words(300) }, 0);
    expect(await flags(n)).toEqual([expect.objectContaining({ version: 1, words_before: 0, words_after: 300 })]);
    await n.q("delete from writing_flags where event_id = $1", [n.eventId]);
    // 120 more words within 60 s: not more than 120, not noted.
    const base = words(300);
    await n.ok(p, "save_draft", "CRISIS_1", { impact: base }, 1);
    await n.ok(p, "save_draft", "CRISIS_1", { impact: base, response: words(120) }, 2);
    expect(await flags(n)).toEqual([]);
    // 130 more words within 60 s: the save goes ahead, and it is noted.
    const r = await n.ok(p, "save_draft", "CRISIS_1", { impact: base, response: words(250) }, 3);
    expect(r.draft.version).toBe(4);
    const noted = await flags(n);
    expect(noted).toHaveLength(1);
    expect(noted[0]).toMatchObject({ team_id: n.teamId(a!.p_code), company_id: a!.company_id, type: "CRISIS_1", version: 4, words_before: 420, words_after: 550 });
    expect(Number(noted[0].seconds)).toBeLessThan(10);

    // The same jump 50 s after the previous save: noted too (migration 081: within 60 s).
    await n.q("update submission_drafts set updated_at = now() - interval '50 seconds' where company_id = $1 and type = 'CRISIS_1'", [a!.company_id]);
    await n.ok(p, "save_draft", "CRISIS_1", { impact: base, response: words(250), money: words(200) }, 4);
    expect(await flags(n)).toHaveLength(2);
    await n.q("delete from writing_flags where version = 5 and event_id = $1", [n.eventId]);
    // More than 60 s after the previous save: not noted.
    await n.q("update submission_drafts set updated_at = now() - interval '61 seconds' where company_id = $1 and type = 'CRISIS_1'", [a!.company_id]);
    await n.ok(p, "save_draft", "CRISIS_1", { impact: base, response: words(250), money: words(400) }, 5);
    expect(await flags(n)).toHaveLength(1);

    // A hired firm writing its client's memo is noted under its own name.
    const firm = await hireOwnFirm(n, a!);
    await n.ok(firm, "save_draft_for", a!.company_id, "ADVICE_1", { diagnosis: words(5) }, 0);
    await n.ok(firm, "save_draft_for", a!.company_id, "ADVICE_1", { diagnosis: words(5), advice: words(200) }, 1);
    const all = await flags(n);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ team_id: n.teamId(a!.c_code), company_id: a!.company_id, type: "ADVICE_1", version: 2, words_before: 5, words_after: 205 });

    // Only the fairness officer reads the notes: not the organisers, not the teams.
    expect((await rowsAs(db.pool, n.fairness, "select count(*)::int as c from writing_flags where event_id = $1", [n.eventId])).at(0)).toEqual({ c: 2 });
    expect((await rowsAs(db.pool, n.lead, "select count(*)::int as c from writing_flags where event_id = $1", [n.eventId])).at(0)).toEqual({ c: 0 });
    expect((await rowsAs(db.pool, n.team(a!.p_code), "select count(*)::int as c from writing_flags where event_id = $1", [n.eventId])).at(0)).toEqual({ c: 0 });
    // Teams cannot write one.
    await expect(
      as(db.pool, n.team(b!.p_code), (cl) =>
        cl.query("insert into writing_flags (event_id, company_id, team_id, type, version, words_before, words_after, seconds) values ($1, $2, $3, 'CRISIS_1', 1, 0, 0, 0)", [
          n.eventId,
          b!.company_id,
          n.teamId(b!.p_code),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);

    // A note that cannot be stored never costs the team its save.
    const bp = n.team(b!.p_code);
    await n.ok(bp, "save_draft", "CRISIS_1", { impact: words(3) }, 0);
    await n.q("alter table writing_flags add constraint writing_flags_test_block check (false) not valid");
    const saved = await n.ok(bp, "save_draft", "CRISIS_1", { impact: words(300) }, 1);
    expect(saved.draft.version).toBe(2);
    await n.q("alter table writing_flags drop constraint writing_flags_test_block");
    expect(await flags(n)).toHaveLength(2);

    // Off: today's behaviour, nothing is noted.
    await n.org("set_feature", n.eventId, "paste_flag", false);
    await n.ok(bp, "save_draft", "CRISIS_1", { impact: words(600) }, 2);
    expect(await flags(n)).toHaveLength(2);
  });
});

describe("crisis_category: the theme of a crisis for the reveal pop-up", () => {
  test("the category every company shares, once revealed; null when they differ, before the reveal, or outside the event", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const other = await Night.create(db.pool, 3, "PRIMUS");
    // The sector deck deals every company the same category in crisis k.
    await n.q(
      "update crisis_cards c set category = 'Market', number = x.rn from (select id, row_number() over (order by id) as rn from crisis_cards where event_id = $1) x where c.id = x.id",
      [n.eventId],
    );
    const category = (caller: ReturnType<Night["team"]>, k = 1) =>
      as(db.pool, caller, async (cl) => (await cl.query("select public.crisis_category($1, $2) as c", [n.eventId, k])).rows[0].c);
    const seed = sha256Hex("crisis-category");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "3");
    const a = await n.squad(1);
    expect(await category(n.team(a.p_code))).toBeNull(); // before the reveal
    const [s] = await toCrisis1Again(n);
    expect(await category(n.team(s!.p_code))).toBe("Market");
    expect(await category(n.team(s!.f_code))).toBe("Market");
    expect(await category(n.lead)).toBe("Market");
    expect(await category(n.team(s!.p_code), 2)).toBeNull(); // not revealed yet
    // A team of another event learns nothing.
    const outsider = other.team([...other.ev.teams.keys()][0]!);
    expect(await category(outsider)).toBeNull();
    // The card itself stays sealed until hiring closes.
    expect(await rowsAs(db.pool, n.team(s!.p_code), "select count(*)::int as c from subround_crises")).toEqual([{ c: 0 }]);
    // Companies facing different categories: no single theme to show.
    const dealt = await n.q("select company_id, crisis_card_id from subround_crises where event_id = $1 and k = 1 order by company_id", [n.eventId]);
    await n.q("update crisis_cards set category = 'Trust' where id = $1", [dealt[0].crisis_card_id]);
    if (new Set(dealt.map((d) => d.crisis_card_id)).size === 1) {
      const spare = await n.one("select id from crisis_cards where event_id = $1 and id <> $2 limit 1", [n.eventId, dealt[0].crisis_card_id]);
      await n.q("update subround_crises set crisis_card_id = $1 where event_id = $2 and k = 1 and company_id = $3", [spare.id, n.eventId, dealt[1].company_id]);
    }
    expect(await category(n.team(s!.p_code))).toBeNull();
  });
});

/** From the squad draw (already run) to crisis 1 revealed. */
async function toCrisis1Again(n: Night) {
  const s = [await n.squad(1), await n.squad(2), await n.squad(3)];
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Theme Co ${i}`, ticker: ["THA", "THB", "THC"][i], problem: "A real problem." }, 0);
    await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const q of s) await n.judge(q.company_id, "PITCH", [60, 60, 60]);
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  await n.deadlinePassed("REVEAL_1");
  await n.ok(n.lead, "tick", n.eventId);
  return s;
}
