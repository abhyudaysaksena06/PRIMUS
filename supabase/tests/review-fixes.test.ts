// Migration 081: the fixes from the deep review of tonight's build (20 Nov).

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

type Squad = Awaited<ReturnType<Night["squad"]>>;

/** Functions (app and public) whose source contains `needle`. */
const landed = async (n: Night, needle: string) =>
  (await n.one(
    `select coalesce(string_agg(s.nspname || '.' || p.proname, ',' order by p.proname), '') as f
       from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('app', 'public') and strpos(p.prosrc, $1) > 0`,
    [needle],
  )).f as string;

/** Plays a PRIMUS night to Round 2 (prices set). Crisis 1 is revealed unless `reveal` is false. */
async function toRound2(n: Night, squads: number, tag: string, { reveal = true, before }: { reveal?: boolean; before?: () => Promise<void> } = {}): Promise<Squad[]> {
  const seed = sha256Hex(tag);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, String(squads));
  const s: Squad[] = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    const ticker = `R${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}`;
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Review Co ${i + 1}`, ticker, problem: "A real problem." }, 0);
    await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const [i, q] of s.entries()) await n.judge(q.company_id, "PITCH", [50 + 5 * i, 50 + 5 * i, 50 + 5 * i]);
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  if (before) await before();
  await n.advanceTo("PRESSURE");
  await n.org("set_feature", n.eventId, "broadcast_coalesce", false);
  if (reveal) {
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
  }
  return s;
}

/** Sets a company's price directly (as the IPO would). */
const setPrice = (n: Night, companyId: string, cents: bigint | number) =>
  n.q(`begin; select set_config('app.price_writer', 'IPO', true); update companies set market_price = ${BigInt(cents)} where id = '${companyId}'; commit;`);
const cashOf = async (n: Night, teamId: string) => BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [teamId])).c);

describe("F1: Round 3 hiring fees", () => {
  test("patches landed", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    expect(await landed(n, "case when v_k = 5 then null else app.min_bid_problem(")).toBe("public.make_offer,public.make_offer_to");
    expect(await landed(n, "case when v_offer.k = 5 then null else app.min_bid_problem(")).toBe("public.respond_offer");
    expect(await landed(n, "app.default_hire_fee(), greatest(coalesce(v_cash, 0), 0));")).toBe("app.assign_firms_by_draw");
  });

  test("Round 3: no minimum bid (the 5–20% band only); the draw charges 10% of cash; crises: floor fallback capped at $22,500", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const [a, b, c] = await toRound2(n, 3, "f1-r3");
    const original = (await n.one("select pg_get_functiondef('app.hiring_subround(uuid)'::regprocedure) as d")).d as string;
    try {
      await n.q("create or replace function app.hiring_subround(p_event uuid) returns smallint language sql stable as $$ select 5::smallint $$");
      // A price that puts every firm's minimum bid (2,000 shares at 2%) above twice the company's cash.
      const cashA = await cashOf(n, a!.product_team_id);
      await setPrice(n, a!.company_id, cashA / 1000n);
      const tenth = Number(cashA / 10n);
      const offer = await n.call(n.team(a!.p_code), "make_offer", n.teamId(b!.c_code), tenth, 0, "Round 3");
      expect(offer).toMatchObject({ ok: true });
      expect(offer.offer.k).toBe(5);
      // The band still holds.
      expect(await n.call(n.team(a!.p_code), "make_offer", n.teamId(c!.c_code), Number(cashA / 100n), 0, "")).toMatchObject({ ok: false, code: "BAD_TERMS" });
      // A firm's pitch and a counter below its minimum bid go through too; the accept is not refused either.
      expect(await n.call(n.team(c!.c_code), "make_offer_to", a!.company_id, tenth, 0, "")).toMatchObject({ ok: true });
      expect(await n.call(n.team(b!.c_code), "respond_offer", offer.offer.id, "COUNTER", tenth + 100, 0)).toMatchObject({ ok: true });
      expect(await n.call(n.team(a!.p_code), "respond_offer", offer.offer.id, "ACCEPT", null, null)).toMatchObject({ ok: true });
    } finally {
      await n.q(original);
    }

    // The draw for Round 3: 10% of cash, no shares.
    const cashB = await cashOf(n, b!.product_team_id);
    const cashC = await cashOf(n, c!.product_team_id);
    await n.q("select app.assign_firms_by_draw($1, 5)", [n.eventId]);
    const r3 = await n.q("select company_id, cash_cents::bigint as cash, shares from engagements where event_id = $1 and k = 5 and assigned order by company_id", [n.eventId]);
    expect(r3).toHaveLength(2);
    for (const e of r3) {
      const before = e.company_id === b!.company_id ? cashB : cashC;
      expect(BigInt(e.cash)).toBe(before / 10n);
      expect(e.shares).toBe(0);
    }
  });

  test("crises: a floor-blocked draw pays at most the base fee in cash", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const [a] = await toRound2(n, 3, "f1-floor");
    // Company A at its 40,000-share floor and a high price: 2,000 shares would be worth $2,000,000.
    await n.q("update holdings set qty = app.min_retained_shares() where company_id = $1 and team_id = $2 and lot = 'RETAINED'", [a!.company_id, a!.product_team_id]);
    await setPrice(n, a!.company_id, 100000);
    const cash = await cashOf(n, a!.product_team_id);
    expect(cash).toBeGreaterThan(2_250_000n);
    await n.q("select app.assign_firms_by_draw($1, 1)", [n.eventId]);
    const e = await n.one("select cash_cents::bigint as cash, shares from engagements where company_id = $1 and k = 1", [a!.company_id]);
    expect(BigInt(e.cash)).toBe(2_250_000n);
    expect(e.shares).toBe(0);
    expect(await cashOf(n, a!.product_team_id)).toBe(cash - 2_250_000n);
  });
});

describe("F2: the draft and a pause", () => {
  test("a 60 s pause during a by-sector draft defaults nobody; no pick while paused", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const s = await toRound2(n, 3, "f2-draft", { reveal: false });
    await n.org("set_feature", n.eventId, "draft_by_sector", true);
    // The companies' own sector (none when the squads hold no problem card with one).
    const sector = (await n.one("select app.company_sector($1) as s", [s[0]!.company_id])).s as string | null;
    const statements = [1, 2, 3].map((number) => ({ number, ...(sector ? { sector } : {}), cap: 1, title: `Statement ${number}`, body: "A problem." }));
    await n.org("set_problem_statements", n.eventId, JSON.stringify(statements));
    await n.q(
      `update deadlines set at = now() + case code when 'DRAFT' then interval '10 seconds' when 'HIRE_5' then interval '55 seconds'
                                                   when 'DUE_5' then interval '190 seconds' else interval '235 seconds' end
        where event_id = $1 and code in ('DRAFT', 'HIRE_5', 'DUE_5', 'RATE_5')`,
      [n.eventId],
    );
    await n.advanceTo("SATURATION");
    const before = await n.q("select company_id, extract(epoch from closes_at - now())::float8 as closes from draft_picks where event_id = $1 order by pick_no", [n.eventId]);
    expect(before).toHaveLength(3);
    expect(before[0]!.closes).toBeGreaterThan(5);

    await n.org("pause_event", n.eventId);
    // No pick while paused.
    const onClock = s.find((q) => q.company_id === before[0]!.company_id)!;
    const st1 = (await n.one("select id from problem_statements where event_id = $1 and number = 1", [n.eventId])).id;
    expect(await n.call(n.team(onClock.p_code), "pick_statement", st1)).toMatchObject({ ok: false, code: "PAUSED" });

    // 60 seconds pass while paused (everything that was planned is now 60 s nearer, or past).
    await n.q("update events set paused_at = paused_at - interval '60 seconds' where id = $1", [n.eventId]);
    await n.q("update deadlines set at = at - interval '60 seconds' where event_id = $1", [n.eventId]);
    await n.q("update draft_picks set opens_at = opens_at - interval '60 seconds', closes_at = closes_at - interval '60 seconds' where event_id = $1", [n.eventId]);
    await n.org("resume_event", n.eventId);
    const after = await n.q("select extract(epoch from closes_at - now())::float8 as closes from draft_picks where event_id = $1 order by pick_no", [n.eventId]);
    for (const [i, p] of after.entries()) expect(Math.abs(p.closes - before[i]!.closes)).toBeLessThan(3);
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select count(*)::int as c from draft_picks where event_id = $1 and (by_default or statement_id is not null)", [n.eventId])).c).toBe(0);
    // And the company on the clock can pick.
    const picked = await n.call(n.team(onClock.p_code), "pick_statement", st1);
    expect(picked.message ?? "").toBe("");
    expect(picked.ok).toBe(true);
  });
});

describe("F3: one failing step does not stop the heartbeat", () => {
  test("crisis 1's hiring close raises: crisis 2 is still revealed, the broadcasts still flushed, the error logged once; it retries", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await toRound2(n, 3, "f3-isolation");
    expect(await landed(n, "perform app.tick_step_failed(p_event, 'hire_' || v_k, sqlerrm, sqlstate);")).toBe("app.primus_tick");
    expect(await landed(n, "perform app.tick_step_failed(p_event, 'clear_round_' || r.number, sqlerrm, sqlstate);")).toBe("public.tick");
    expect(await landed(n, "perform app.tick_step_failed(p_event, 'hold', sqlerrm, sqlstate);")).toBe("public.tick");
    // Test only: closing crisis 1's hiring raises.
    await n.q(`create function public.f3_boom() returns trigger language plpgsql as $$ begin raise exception 'f3 boom'; end $$`);
    await n.q(`create trigger f3_boom before update of hiring_closed_at on public.subrounds for each row
               when (new.k = 1 and new.hiring_closed_at is not null) execute function public.f3_boom()`);
    try {
      await n.deadlinePassed("HIRE_1");
      await n.deadlinePassed("REVEAL_2");
      await n.q("insert into app.broadcast_pending (event_id, kind, at) values ($1, 'raises', now() - interval '10 seconds')", [n.eventId]);
      await n.q("delete from realtime.messages");
      for (let i = 0; i < 2; i++) expect((await n.call(n.lead, "tick", n.eventId)).ok).toBe(true);
      const sub = await n.q("select k, revealed_at, hiring_closed_at from subrounds where event_id = $1 and k in (1, 2) order by k", [n.eventId]);
      expect(sub[0]!.hiring_closed_at).toBeNull();
      expect(sub[1]!.revealed_at).not.toBeNull();
      expect((await n.one("select count(*)::int as c from app.broadcast_pending where event_id = $1", [n.eventId])).c).toBe(0);
      expect((await n.q("select 1 from realtime.messages where topic = $1 and event = 'refresh'", [`event:${n.eventId}`])).length).toBe(1);
      const errors = await n.q("select source, message from error_log where event_id = $1 and source like 'tick:%'", [n.eventId]);
      expect(errors).toEqual([{ source: "tick:hire_1", message: "f3 boom" }]);
    } finally {
      await n.q("drop trigger f3_boom on public.subrounds");
      await n.q("drop function public.f3_boom()");
    }
    // Fixed: the next beat closes the hiring.
    await n.ok(n.lead, "tick", n.eventId);
    expect((await n.one("select hiring_closed_at from subrounds where event_id = $1 and k = 1", [n.eventId])).hiring_closed_at).not.toBeNull();
  });
});
