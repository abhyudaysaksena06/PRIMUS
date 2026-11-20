// Migration 071, the hiring platform for the 20 Nov night: a firm's base rate (its Round 1 ZestUp memo score), the
// minimum bid (switch hire_min_bid), the seeded draw that places every company that did not hire at its firm's base
// rate (switch hire_base_rate), and "locked = gone" (an event-wide hire_locked message after every hire).
// Each switch is tested on and off: off is exactly the game as it was.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Rng, rootSeed, sha256Hex, type Stream } from "@msim/engine";
import { Night } from "./night";
import { as } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

type Squad = Awaited<ReturnType<Night["squad"]>>;

// At least 150 words: only a memo that long releases the fee at the due time.
const advice = {
  diagnosis: "The crisis hits the client's busiest channel first, and that channel brings about half of its monthly sales. If nothing changes, two months of disruption cost roughly a third of revenue and push the cash runway below four months. The twist makes it worse: waiting for certainty means the best customers move to rivals while the client is still deciding.",
  advice: "Phase the fix. This week the operations lead protects the top fifth of customers with priority supply and a direct call from the founder. Next week the finance lead renegotiates payment terms with the two largest suppliers. By the end of the month the product lead rebuilds the failing step and tests it with ten customers before the full relaunch.",
  evidence: "The top fifth of customers bring half the sales, so protecting them first saves most of the revenue for a small share of the cost. The fix costs about Rs 12 lakh against roughly Rs 40 lakh of monthly sales at risk, and paying suppliers thirty days later frees enough cash to cover the first phase.",
  fit: "The client's cash covers the first phase without new funding, and its direct relationships with large customers are exactly what this plan relies on.",
};

/** Plays a PRIMUS night to Round 2 (prices set). Crisis 1 is revealed unless `reveal` is false. */
async function toRound2(n: Night, squads: number, seed: string, dice: string, { reveal = true } = {}): Promise<Squad[]> {
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, dice);
  const s: Squad[] = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    const ticker = `H${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}`;
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Hire Co ${i + 1}`, ticker, problem: "A real problem." }, 0);
    await n.ok(n.team(q.p_code), "submit_submission", "PITCH");
  }
  await n.deadlinePassed("PITCH");
  await n.advanceTo("READING");
  for (const [i, q] of s.entries()) await n.judge(q.company_id, "PITCH", [50 + 5 * i, 50 + 5 * i, 50 + 5 * i]);
  await n.deadlinePassed("CALL_1");
  await n.org("release_scores", n.eventId, "PITCH");
  await n.advanceTo("IPO");
  await n.advanceTo("PRESSURE");
  // Event-wide messages are counted exactly below: no coalescing of broadcasts in these tests.
  await n.org("set_feature", n.eventId, "broadcast_coalesce", false);
  if (reveal) {
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
  }
  return s;
}

/** A released (or only sealed) Round 1 ZestUp memo score for a squad's company: it sets the squad's firm's base rate. */
async function memoScore(n: Night, companyId: string, score: number, status: "RELEASED" | "SEALED" = "RELEASED") {
  await n.q(
    `insert into scores (event_id, company_id, type, status, final_score, released_at)
     values ($1, $2, 'MEMO', $3::text::score_status, $4, case when $3::text = 'RELEASED' then now() end)
     on conflict (company_id, type) do update set status = excluded.status, final_score = excluded.final_score, released_at = excluded.released_at`,
    [n.eventId, companyId, status, score],
  );
}

const baseRate = async (n: Night, firmId: string) => Number((await n.one("select app.firm_base_rate($1) as bp", [firmId])).bp);
const price = async (n: Night, companyId: string) => Number((await n.one("select market_price from companies where id = $1", [companyId])).market_price);
const cashOf = async (n: Night, teamId: string) => BigInt((await n.one("select cash_cents::bigint as c from teams where id = $1", [teamId])).c);
const retained = async (n: Night, teamId: string, companyId: string) =>
  Number((await n.one("select coalesce(sum(qty), 0)::int as q from holdings where team_id = $1 and company_id = $2 and lot = 'RETAINED'", [teamId, companyId])).q);
/** "about $X": the minimum in dollars, rounded up to the next $100. */
const about = (cents: number) => `$${(Math.ceil(cents / 10_000) * 100).toLocaleString("en-US")}`;

/** Total money (every team plus the exchange) and every company's shares (long lots + exchange inventory − shorts). */
async function totals(n: Night) {
  const money = await n.one(
    "select e.exchange_cash_cents + (select coalesce(sum(cash_cents), 0) from teams where event_id = e.id) as total from events e where e.id = $1",
    [n.eventId],
  );
  const shares = await n.q(
    `select c.id, c.exchange_inventory + coalesce(sum(h.qty) filter (where h.lot <> 'SHORT'), 0) - coalesce(sum(h.qty) filter (where h.lot = 'SHORT'), 0) as total
       from companies c left join holdings h on h.company_id = c.id
      where c.event_id = $1 and c.squad_id is not null group by c.id order by c.id`,
    [n.eventId],
  );
  return { money: BigInt(money.total), shares: shares.map((s) => [s.id, Number(s.total)]) };
}

/** The draw replayed independently in TypeScript with the engine's lottery generator (packages/engine/src/lottery.ts). */
function replayDraw(root: string, k: number, companies: string[], firms: { code: string; clients: number }[]): [string, string | null][] {
  const rng = new Rng(root, `hire:${k}` as Stream);
  const order = rng.shuffle([...companies].sort());
  const firmOrder = rng.shuffle(firms.map((f) => f.code).sort());
  const load = new Map(firms.map((f) => [f.code, f.clients]));
  return order.map((c) => {
    let best: string | null = null;
    for (const f of firmOrder) if (load.get(f)! < 2 && (best === null || load.get(f)! < load.get(best)!)) best = f;
    if (best !== null) load.set(best, load.get(best)! + 1);
    return [c, best];
  });
}

const messages = async (n: Night, topic: string, event: string) =>
  (await n.q("select payload from realtime.messages where topic = $1 and event = $2 order by inserted_at, id", [topic, event])).map((m) => m.payload);

describe("base rate", () => {
  test("2% + 0.04% per ZestUp point over 50, kept to 1–4%; only the firm's own squad's released memo counts; firm_values lists it", async () => {
    const n = await Night.create(db.pool, 4, "PRIMUS");
    // Before the draw every firm is listed (no squads yet), all at 2%.
    const before = await as(db.pool, n.lead, async (c) => (await c.query("select code, base_rate_bp from public.firm_values($1)", [n.eventId])).rows);
    expect(before).toHaveLength(4);
    expect(before.every((r) => r.base_rate_bp === 200)).toBe(true);

    const s = await toRound2(n, 4, sha256Hex("base-rate"), "4", { reveal: false });
    const firm = s.map((q) => n.teamId(q.c_code));
    for (const f of firm) expect(await baseRate(n, f)).toBe(200); // no released memo score: 2%

    await memoScore(n, s[0]!.company_id, 80, "SEALED");
    expect(await baseRate(n, firm[0]!)).toBe(200); // sealed, not released: still 2%
    await memoScore(n, s[0]!.company_id, 80);
    await memoScore(n, s[1]!.company_id, 10);
    await memoScore(n, s[2]!.company_id, 100);
    await memoScore(n, s[3]!.company_id, 61);
    expect(await baseRate(n, firm[0]!)).toBe(320); // 2% + 30 × 0.04%
    expect(await baseRate(n, firm[1]!)).toBe(100); // below 25 points: the 1% floor
    expect(await baseRate(n, firm[2]!)).toBe(400); // 100 points: 4%
    expect(await baseRate(n, firm[3]!)).toBe(244);
    // The score is the firm's OWN squad's: squad 1's Product team (not a firm) has no rate of its own.
    expect(await baseRate(n, n.teamId(s[0]!.p_code))).toBe(200);

    // firm_values: each firm's rate, and for a Product team the minimum bid for its own company at today's price.
    const pB = await price(n, s[1]!.company_id);
    const asProduct = await as(db.pool, n.team(s[1]!.p_code), async (c) => (await c.query("select team_id, base_rate_bp, min_bid_cents from public.firm_values($1)", [n.eventId])).rows);
    expect(asProduct).toHaveLength(4);
    for (const r of asProduct) {
      const i = firm.indexOf(r.team_id);
      const bp = [320, 100, 400, 244][i]!;
      expect(r.base_rate_bp).toBe(bp);
      expect(Number(r.min_bid_cents)).toBe(bp * 10 * pB);
    }
    const asFirm = await as(db.pool, n.team(s[0]!.c_code), async (c) => (await c.query("select base_rate_bp, min_bid_cents from public.firm_values($1)", [n.eventId])).rows);
    expect(asFirm.every((r) => r.min_bid_cents === null)).toBe(true);

    // Once the event has drawn, a firm that is in no squad (absent at the draw) is not listed.
    await n.q("insert into teams (event_id, code, track, name) values ($1, 'QZ90', 'CONSULTING', 'Absent firm')", [n.eventId]);
    const listed = await as(db.pool, n.lead, async (c) => (await c.query("select code from public.firm_values($1)", [n.eventId])).rows.map((r) => r.code));
    expect(listed).toHaveLength(4);
    expect(listed).not.toContain("QZ90");
  });
});

describe("minimum bid", () => {
  test("off: any terms as before; on: offers, pitches, counters and accepts below the firm's base rate are refused; hires broadcast hire_locked", async () => {
    const n = await Night.create(db.pool, 4, "PRIMUS");
    const [a, b, c, d] = await toRound2(n, 4, sha256Hex("min-bid"), "2");
    const X = n.teamId(a!.c_code); // memo 80: 3.2%
    const Y = n.teamId(b!.c_code); // no memo: 2%
    const Z = n.teamId(c!.c_code); // memo 10: 1%
    await memoScore(n, a!.company_id, 80);
    await memoScore(n, c!.company_id, 10);
    expect(await n.q("select app.feature_on($1, 'hire_min_bid') as on", [n.eventId])).toEqual([{ on: false }]);

    // Off (the default): a tiny offer is fine, exactly as before.
    const tiny = (await n.ok(n.team(b!.p_code), "make_offer", X, 0, 100, "")).offer;
    await n.ok(n.team(b!.p_code), "respond_offer", tiny.id, "WITHDRAW");

    await n.org("set_feature", n.eventId, "hire_min_bid", true);
    const pB = await price(n, b!.company_id);
    // A company offers below X's minimum (3,200 shares): refused, with the minimum in % and dollars.
    const low = await n.call(n.team(b!.p_code), "make_offer", X, 0, 3199, "");
    expect(low).toMatchObject({ ok: false, code: "BELOW_MIN_BID" });
    expect(low.message).toBe(`This firm's minimum bid is 3.2% of your company (about ${about(3200 * pB)}).`);
    const atMin = (await n.ok(n.team(b!.p_code), "make_offer", X, 0, 3200, "")).offer;
    // Cash counts at its face value: one cent short of 3,200 shares' worth is refused, the exact amount is not.
    const pD = await price(n, d!.company_id);
    expect(await n.call(n.team(d!.p_code), "make_offer", X, 3200 * pD - 1, 0, "")).toMatchObject({ ok: false, code: "BELOW_MIN_BID" });
    await n.ok(n.team(d!.p_code), "make_offer", X, 3200 * pD, 0, "");

    // A firm pitching below its own minimum is refused too (Y has no memo score: 2% = 2,000 shares).
    const pA = await price(n, a!.company_id);
    const pitch = await n.call(n.team(b!.c_code), "make_offer_to", a!.company_id, 0, 1999, "");
    expect(pitch).toMatchObject({ ok: false, code: "BELOW_MIN_BID" });
    expect(pitch.message).toBe(`Your minimum bid is 2% of HAA (about ${about(2000 * pA)}).`);
    await n.ok(n.team(b!.c_code), "make_offer_to", a!.company_id, 0, 2000, "");

    // Counters: the firm cannot counter below its minimum, nor the company; at or above is fine.
    expect(await n.call(n.team(a!.c_code), "respond_offer", atMin.id, "COUNTER", 0, 3000)).toMatchObject({ ok: false, code: "BELOW_MIN_BID" });
    await n.ok(n.team(a!.c_code), "respond_offer", atMin.id, "COUNTER", 0, 3500);
    const back = await n.call(n.team(b!.p_code), "respond_offer", atMin.id, "COUNTER", 0, 3100);
    expect(back).toMatchObject({ ok: false, code: "BELOW_MIN_BID" });
    expect(back.message).toContain("This firm's minimum bid is 3.2% of your company");
    await n.ok(n.team(b!.p_code), "respond_offer", atMin.id, "COUNTER", 0, 3300);

    // An offer made while the switch was off cannot be accepted below the minimum once it is on (the accept checks
    // the terms again); with the switch off again it can, as before.
    await n.org("set_feature", n.eventId, "hire_min_bid", false);
    const old = (await n.ok(n.team(c!.p_code), "make_offer", Z, 0, 500, "")).offer;
    await n.org("set_feature", n.eventId, "hire_min_bid", true);
    const refused = await n.call(n.team(c!.c_code), "respond_offer", old.id, "ACCEPT");
    expect(refused).toMatchObject({ ok: false, code: "BELOW_MIN_BID" });
    expect(refused.message).toBe(`Your minimum bid is 1% of HCC (about ${about(1000 * (await price(n, c!.company_id)))}).`);
    await n.org("set_feature", n.eventId, "hire_min_bid", false);
    await n.ok(n.team(c!.c_code), "respond_offer", old.id, "ACCEPT");

    // Locked = gone: each accept tells every screen (event channel) which company and firm are taken.
    const topic = `event:${n.eventId}`;
    let locked = await messages(n, topic, "hire_locked");
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ kind: "hire_locked", k: 1, company: c!.company_id, firm: Z, firm_full: false });
    // A second client fills X: firm_full.
    await n.ok(n.team(a!.c_code), "respond_offer", atMin.id, "ACCEPT");
    const dOffer = (await n.one("select id from offers where company_id = $1 and firm_team_id = $2 and status = 'OPEN'", [d!.company_id, X])).id;
    await n.org("set_feature", n.eventId, "hire_min_bid", true);
    await n.ok(n.team(a!.c_code), "respond_offer", dOffer, "ACCEPT");
    locked = await messages(n, topic, "hire_locked");
    expect(locked).toHaveLength(3);
    expect(locked[1]).toMatchObject({ k: 1, company: b!.company_id, firm: X, firm_full: false });
    expect(locked[2]).toMatchObject({ k: 1, company: d!.company_id, firm: X, firm_full: true });
    // Offers themselves still go only to the two teams (and staff), and no event message names a team, cash or holdings.
    expect(await messages(n, topic, "offers")).toEqual([]);
    expect(JSON.stringify(locked)).not.toMatch(/cash_cents|holdings|team_id/);
  });
});

describe("the hiring draw", () => {
  test("pure draw: replayable from the seed, independent of input order, least busy first, never more than 2 clients", async () => {
    const companies = Array.from({ length: 23 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`);
    const firms = Array.from({ length: 9 }, (_, i) => ({ code: `C${String(i + 1).padStart(2, "0")}`, clients: [0, 1, 0, 1, 0, 0, 1, 0, 0][i]! }));
    const root = sha256Hex("a seed" + "5");
    const draw = async (k: number, cs: string[], fs: typeof firms) =>
      (await db.pool.query("select app.hire_draw($1, $2, $3, $4, $5) as d", [root, k, cs, fs.map((f) => f.code), fs.map((f) => f.clients)])).rows[0]!
        .d as { company: string; firm: string | null }[];
    for (const k of [1, 2, 5]) {
      const d = await draw(k, companies, firms);
      const got = d.map((p): [string, string | null] => [p.company, p.firm]);
      expect(got).toEqual(replayDraw(root, k, companies, firms));
      // The same input in another order gives the same draw, and so does drawing again.
      expect(await draw(k, [...companies].reverse(), [...firms].reverse())).toEqual(d);
      expect(await draw(k, companies, firms)).toEqual(d);
      // 9 firms with 3 clients already: 15 places for 23 companies; the last 8 drawn go without; nobody gets a third.
      const load = new Map(firms.map((f) => [f.code, f.clients]));
      for (const [, f] of got) if (f) load.set(f, load.get(f)! + 1);
      expect([...load.values()].every((v) => v <= 2)).toBe(true);
      expect(got.filter(([, f]) => f === null)).toHaveLength(8);
      expect(got.slice(15).every(([, f]) => f === null)).toBe(true);
      // Least busy first: the six firms with no client each get one before any firm gets a second.
      expect(new Set(got.slice(0, 6).map(([, f]) => f)).size).toBe(6);
      expect(got.slice(0, 6).every(([, f]) => firms.find((x) => x.code === f)!.clients === 0)).toBe(true);
    }
    // Each sub-round has its own draw.
    expect(await draw(1, companies, firms)).not.toEqual(await draw(2, companies, firms));
  });

  test("on: every present company that did not hire gets a present firm with room, at that firm's base rate in escrowed shares (cash when the floor blocks); money and shares are conserved through settlement", async () => {
    const n = await Night.create(db.pool, 6, "PRIMUS");
    const seed = sha256Hex("hire-draw");
    const s = await toRound2(n, 6, seed, "6", { reveal: false });
    const [A, B, C, D, E, F] = s;
    const firm = (q: Squad) => n.teamId(q.c_code);
    const product = (q: Squad) => n.teamId(q.p_code);
    await memoScore(n, A!.company_id, 80); // A's firm 3.2%
    await memoScore(n, B!.company_id, 10); // B's firm 1%
    await memoScore(n, C!.company_id, 100); // C's firm 4% (it fills up in the market below)
    await memoScore(n, D!.company_id, 61); // D's firm 2.44%; E's firm: no memo, 2%

    // D raises 10% from Finance before crisis 1 and 10% again in it: it is left at its 40,000-share floor, so any fee
    // in shares is blocked and its draw fee is paid in cash.
    for (const fund of [A!, B!]) {
      if (fund === B) {
        await n.deadlinePassed("REVEAL_1");
        await n.ok(n.lead, "tick", n.eventId);
      }
      const r = (await n.ok(n.team(D!.p_code), "post_raise", 10_000, "")).raise;
      await n.ok(n.team(fund.f_code), "fund_raise", r.id);
      // Since migration 079 a raise before the reveal counts as crisis 1's (one raise per crisis): this test only needs
      // D at its floor, so the first raise is filed under "before crisis 1" to allow the second.
      if (fund === A) await n.q("update raises set k = 0 where id = $1", [r.id]);
    }
    expect(await retained(n, product(D!), D!.company_id)).toBe(40_000);

    // The market: A and B hire C's firm, which is now full.
    for (const q of [A!, B!]) {
      const o = (await n.ok(n.team(q.p_code), "make_offer", firm(C!), 0, 1500, "")).offer;
      await n.ok(n.team(C!.c_code), "respond_offer", o.id, "ACCEPT");
    }
    // The desk is on: everyone is checked in except F's firm and F's company (no-shows).
    await n.q("update events set desk_check_in = true where id = $1", [n.eventId]);
    await n.q("update teams set checked_in_at = now() where event_id = $1 and id not in ($2, $3)", [n.eventId, firm(F!), product(F!)]);
    await n.org("set_feature", n.eventId, "hire_base_rate", true);

    const before = await totals(n);
    const cashF = await cashOf(n, product(F!));
    const cashD = await cashOf(n, product(D!));
    const exchangeBefore = BigInt((await n.one("select exchange_cash_cents from events where id = $1", [n.eventId])).exchange_cash_cents);
    const rates = new Map<string, number>();
    for (const q of s) rates.set(firm(q), await baseRate(n, firm(q)));
    await n.q("delete from realtime.messages");

    await n.deadlinePassed("HIRE_1");
    await n.ok(n.lead, "tick", n.eventId);

    // Who got whom: exactly the TypeScript replay of the draw from the event's seed and dice.
    const eng = await n.q(
      `select e.*, pt.code as p_code, ft.code as f_code from engagements e join companies c on c.id = e.company_id
         join teams pt on pt.id = c.product_team_id join teams ft on ft.id = e.firm_team_id
        where e.event_id = $1 and e.k = 1 and e.assigned order by pt.code`,
      [n.eventId],
    );
    const expected = replayDraw(rootSeed(seed, "6"), 1, [C!, D!, E!].map((q) => q.p_code), [A!, B!, D!, E!].map((q) => ({ code: q.c_code, clients: 0 })));
    expect(eng.map((e) => [e.p_code, e.f_code]).sort()).toEqual(expected.map(([c, f]) => [c, f]).sort());
    // The absent company was not placed and kept its cash; the absent firm and the full firm got nobody.
    expect(eng.find((e) => e.company_id === F!.company_id)).toBeUndefined();
    expect(await cashOf(n, product(F!))).toBe(cashF);
    expect(eng.some((e) => e.firm_team_id === firm(F!) || e.firm_team_id === firm(C!))).toBe(false);
    const perFirm = await n.q("select firm_team_id, count(*)::int as n from engagements where event_id = $1 and k = 1 group by 1", [n.eventId]);
    expect(perFirm.every((r) => r.n <= 2)).toBe(true);

    // The fee is that firm's base rate: in shares, held like an accepted share offer (still in the company's retained
    // lot, no ledger rows until the due time); D, at its floor, pays the shares' cash value into escrow instead.
    for (const e of eng) {
      const bp = rates.get(e.firm_team_id)!;
      expect(e.escrow).toBe("HELD");
      if (e.company_id === D!.company_id) {
        // The shares' value in cash, never more than the base fee or the company's cash (migration 081).
        const value = BigInt(bp * 10 * (await price(n, D!.company_id)));
        const fee = [value, 2_250_000n, cashD].reduce((m, x) => (x < m ? x : m));
        expect([Number(e.cash_cents), e.shares]).toEqual([Number(fee), 0]);
        expect(await cashOf(n, product(D!))).toBe(cashD - fee);
        const rows = await n.q("select kind, team_id, cash_delta_cents::bigint as cash, ref_table from ledger_entries where ref_id = $1 order by cash_delta_cents", [e.id]);
        expect(rows.map((r) => [r.kind, r.team_id, BigInt(r.cash), r.ref_table])).toEqual([
          ["ESCROW_HOLD", product(D!), -fee, "engagements"],
          ["ESCROW_HOLD", null, fee, "engagements"],
        ]);
        expect(BigInt((await n.one("select exchange_cash_cents from events where id = $1", [n.eventId])).exchange_cash_cents)).toBe(exchangeBefore + fee);
      } else {
        expect([Number(e.cash_cents), e.shares]).toEqual([0, bp * 10]);
        expect(await n.q("select 1 from ledger_entries where ref_id = $1", [e.id])).toEqual([]);
        const owner = s.find((q) => q.company_id === e.company_id)!;
        expect(await retained(n, product(owner), e.company_id)).toBe(60_000);
      }
      const pub = await n.one("select label, shares, cash_cents::bigint as cash, details from public_ledger where kind = 'HIRE' and company_id = $1 and (details ->> 'k')::int = 1", [e.company_id]);
      expect(pub.label).toMatch(/was assigned a firm by the draw \(crisis 1\)$/);
      expect(pub.details).toMatchObject({ k: 1, firm: e.firm_team_id, assigned: true, draw: true, base_rate_bp: bp });
      expect([pub.shares, Number(pub.cash)]).toEqual([e.shares, Number(e.cash_cents)]);
    }
    // The fee shares now count against the company's floor: E cannot promise more than it has left above 40,000.
    const eE = eng.find((e) => e.company_id === E!.company_id)!;
    const left = 20_000 - eE.shares;
    expect(await n.one("select app.offer_problem(c, 2, 0, $2) as p from companies c where c.id = $1", [E!.company_id, left + 1]))
      .toEqual({ p: `A company keeps at least 40000 shares (40% of itself). You have ${left} left to offer.` });
    expect(await n.one("select app.offer_problem(c, 2, 0, $2) as p from companies c where c.id = $1", [E!.company_id, left])).toEqual({ p: null });

    // Money and shares are conserved by the draw, and every ledger invariant holds.
    expect(await totals(n)).toEqual(before);
    await n.checkInvariants();

    // Locked = gone: one event-wide message for the pass; each placed pair hears it on its own channels, by name.
    expect(await messages(n, `event:${n.eventId}`, "hire_locked")).toEqual([expect.objectContaining({ k: 1, assigned: true })]);
    for (const e of eng) {
      const toFirm = await messages(n, `team:${e.firm_team_id}`, "offers");
      expect(toFirm).toEqual([expect.objectContaining({ assigned: true, draw: true, k: 1, firm_code: e.f_code, base_rate_bp: rates.get(e.firm_team_id) })]);
      expect(toFirm[0].ticker).toMatch(/^H[A-F]{2}$/);
    }

    // Settlement: E's firm sends its memo (paid: the shares move to the firm), D's firm does not (D gets its cash back).
    const eD = eng.find((e) => e.company_id === D!.company_id)!;
    const firmOfE = eng.find((e) => e.company_id === E!.company_id)!.firm_team_id;
    const firmCode = (await n.one("select code from teams where id = $1", [firmOfE])).code;
    await n.ok(n.team(firmCode), "save_draft_for", E!.company_id, "ADVICE_1", advice, 0);
    await n.ok(n.team(firmCode), "submit_for", E!.company_id, "ADVICE_1");
    await n.deadlinePassed("DUE_1");
    await n.ok(n.lead, "tick", n.eventId);
    const settled = await n.q("select company_id, escrow, shares, cash_cents::bigint as cash from engagements where event_id = $1 and k = 1 and assigned", [n.eventId]);
    expect(settled.find((e) => e.company_id === E!.company_id)).toMatchObject({ escrow: "RELEASED", shares: eE.shares });
    expect(settled.find((e) => e.company_id === D!.company_id)).toMatchObject({ escrow: "REFUNDED" });
    expect(await retained(n, product(E!), E!.company_id)).toBe(60_000 - eE.shares);
    expect(Number((await n.one("select coalesce(sum(qty), 0)::int as q from holdings where team_id = $1 and company_id = $2 and lot = 'FEE'", [firmOfE, E!.company_id])).q)).toBe(eE.shares);
    expect(await cashOf(n, product(D!))).toBe(cashD); // refunded: no memo
    expect(Number(eD.cash_cents)).toBeGreaterThan(0);
    expect(await totals(n)).toEqual(before);
    await n.checkInvariants();
  });

  test("off: the least busy firm at the base fee in cash, exactly as before; Round 3 on and off; the cash fee never exceeds the company's cash", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    const s = await toRound2(n, 3, sha256Hex("hire-off"), "3");
    const [A, B, C] = s;
    await memoScore(n, A!.company_id, 90); // A's firm: 3.6%
    expect(await n.q("select app.feature_on($1, 'hire_base_rate') as on", [n.eventId])).toEqual([{ on: false }]);
    // B hires A's firm in the market.
    const o = (await n.ok(n.team(B!.p_code), "make_offer", n.teamId(A!.c_code), 0, 500, "")).offer;
    await n.ok(n.team(A!.c_code), "respond_offer", o.id, "ACCEPT");
    const cash = new Map<string, bigint>();
    for (const q of s) cash.set(q.company_id, await cashOf(n, n.teamId(q.p_code)));
    const before = await totals(n);

    await n.deadlinePassed("HIRE_1");
    await n.ok(n.lead, "tick", n.eventId);
    // Companies in ticker order (HAA, HCC) take the least busy firm, then the lowest code: B's and C's firms have no
    // client, A's has one. The fee is $22,500 in cash (or all the company's cash, if less), as before the switch.
    const firmsByCode = s.map((q) => ({ id: n.teamId(q.c_code), code: q.c_code })).filter((f) => f.id !== n.teamId(A!.c_code)).sort((x, y) => (x.code < y.code ? -1 : 1));
    const eng = await n.q("select company_id, firm_team_id, cash_cents::bigint as cash, shares, assigned from engagements where event_id = $1 and k = 1 and assigned order by company_id", [n.eventId]);
    expect(eng).toHaveLength(2);
    const ea = eng.find((e) => e.company_id === A!.company_id)!;
    const ec = eng.find((e) => e.company_id === C!.company_id)!;
    expect(ea.firm_team_id).toBe(firmsByCode[0]!.id);
    expect(ec.firm_team_id).toBe(firmsByCode[1]!.id);
    for (const e of [ea, ec]) {
      const fee = cash.get(e.company_id)! < 2_250_000n ? cash.get(e.company_id)! : 2_250_000n;
      expect([BigInt(e.cash), e.shares]).toEqual([fee, 0]);
    }
    expect(await totals(n)).toEqual(before);
    await n.checkInvariants();

    // Round 3 (k = 5), called as the tick would: 10% of the company's cash, switch off or on (migration 081: Round 3
    // keeps its old fee, never the base rate). (Rolled back.)
    const client = await db.pool.connect();
    try {
      await client.query("begin");
      const q = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows;
      await q("select app.assign_default_firms($1, 5)", [n.eventId]);
      const off5 = await q("select company_id, cash_cents::bigint as cash, shares from engagements where event_id = $1 and k = 5", [n.eventId]);
      expect(off5).toHaveLength(3);
      for (const e of off5) expect([BigInt(e.cash), e.shares]).toEqual([(await cashOf(n, (await n.one("select product_team_id from companies where id = $1", [e.company_id])).product_team_id)) / 10n, 0]);
      await q("delete from engagements where event_id = $1 and k = 5", [n.eventId]);

      await q("update events set features = features || '{\"hire_base_rate\": true}' where id = $1", [n.eventId]);
      // C has spent nearly everything and sits at its floor: its fee is all it has left.
      await q("update teams set cash_cents = 1234 where id = $1", [n.teamId(C!.p_code)]);
      await q("update holdings set qty = 40000 where team_id = $1 and company_id = $2 and lot = 'RETAINED'", [n.teamId(C!.p_code), C!.company_id]);
      const cash5 = new Map((await q("select c.id, t.cash_cents::bigint as cash from companies c join teams t on t.id = c.product_team_id where c.event_id = $1", [n.eventId])).map((r) => [r.id, BigInt(r.cash)]));
      await q("select app.assign_default_firms($1, 5)", [n.eventId]);
      const on5 = await q(
        "select e.company_id, e.firm_team_id, e.cash_cents::bigint as cash, e.shares, app.firm_base_rate(e.firm_team_id) as bp from engagements e where e.event_id = $1 and e.k = 5",
        [n.eventId],
      );
      expect(on5).toHaveLength(3);
      for (const e of on5) expect([BigInt(e.cash), e.shares]).toEqual([cash5.get(e.company_id)! / 10n, 0]);
      expect(on5.find((e) => e.company_id === C!.company_id)!.cash).toBe("123");
      const label = await q("select label from public_ledger where company_id = $1 and (details ->> 'k')::int = 5 and details ? 'draw'", [A!.company_id]);
      expect(label.map((r) => r.label)).toEqual([expect.stringMatching(/by the draw \(Round 3\)$/)]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
