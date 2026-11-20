// Migration 076: 200 teams per track. Limits, the desk's card order, the squad draw of only the checked-in teams
// (switch draw_checked_in, both ways), what absent and left-out teams can do afterwards, the practice market with one
// simulated company per checked-in Finance team (switch practice_verified), and the hot spots at 200 companies ×
// 200 funds (the timings are printed: "[scale timings]").

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PRACTICE, Rng, candleTicks, drawLottery, practiceCandles, rootSeed, sha256Hex, type Stream, type Track } from "@msim/engine";
import { Night } from "./night";
import { as, rowsAs, service } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
const timings: Record<string, number> = {};
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  console.log(`[scale timings] ${JSON.stringify(timings)}`);
  await db?.drop();
});

const ms = (t0: number) => Math.round(performance.now() - t0);
const TRACKS: Track[] = ["PRODUCT", "CONSULTING", "FINANCE"];

/** Turns the desk on and checks in `counts[track]` teams of each track (a scattered choice, not the first codes). */
async function checkIn(n: Night, counts: Record<Track, number>) {
  await n.q("update events set desk_check_in = true where id = $1", [n.eventId]);
  for (const track of TRACKS) {
    await n.q(
      "update teams set checked_in_at = now() where id in (select id from teams where event_id = $1 and track = $2 order by md5(code) limit $3)",
      [n.eventId, track, counts[track]],
    );
  }
}

async function codes(n: Night, track: Track, where = "true"): Promise<string[]> {
  return (await n.q(`select code from teams where event_id = $1 and track = $2 and ${where} order by code`, [n.eventId, track])).map((r) => r.code);
}

async function squadCodes(n: Night) {
  return n.q(
    `select s.number, p.code as product, c.code as consulting, f.code as finance
       from squads s join teams p on p.id = s.product_team_id join teams c on c.id = s.consulting_team_id
       join teams f on f.id = s.finance_team_id where s.event_id = $1 order by s.number`,
    [n.eventId],
  );
}

/** The engine mirror of app.lottery_seats: one 'seats' stream; only a track larger than the smallest is shuffled. */
function mirrorSeats(root: string, pools: Record<"product" | "consulting" | "finance", string[]>) {
  const seats = Math.min(pools.product.length, pools.consulting.length, pools.finance.length);
  const rng = new Rng(root, "seats" as Stream);
  const drawn = { product: [] as string[], consulting: [] as string[], finance: [] as string[] };
  const left = { product: [] as string[], consulting: [] as string[], finance: [] as string[] };
  for (const k of ["product", "consulting", "finance"] as const) {
    const sorted = [...pools[k]].sort();
    if (sorted.length <= seats) {
      drawn[k] = sorted;
      continue;
    }
    const s = rng.shuffle(sorted);
    drawn[k] = s.slice(0, seats).sort();
    left[k] = s.slice(seats).sort();
  }
  return { seats, drawn, left };
}

describe("200 teams per track", () => {
  test("seeds 600 teams; seed_event takes 3 to 200 per track; the desk hands out P99 before P100", async () => {
    let t0 = performance.now();
    const n = await Night.create(db.pool, 200, "PRIMUS");
    timings.seed_600_teams_ms = ms(t0);
    expect(await n.q("select track, count(*)::int as n from teams where event_id = $1 group by track order by track", [n.eventId])).toEqual([
      { track: "PRODUCT", n: 200 },
      { track: "CONSULTING", n: 200 },
      { track: "FINANCE", n: 200 },
    ]);
    expect((await n.one("select count(*)::int as n from companies where event_id = $1", [n.eventId])).n).toBe(200);

    // 201 and 2 per track are refused before anything is written (so the logins need not exist).
    const payload = (perTrack: number) => ({
      event: { slug: `too-${perTrack}`, name: "x", is_rehearsal: false, starts_at: new Date().toISOString() },
      schedule: { phases: [], rounds: [], deadlines: [] },
      teams: TRACKS.flatMap((track) =>
        Array.from({ length: perTrack }, (_, i) => ({ code: `Z${track[0]}${i + 1}`, track, name: "t", user_id: crypto.randomUUID() })),
      ),
    });
    for (const [k, msg] of [[201, /between 3 and 200 teams per track are needed \(got 201\)/], [2, /between 3 and 200/]] as const) {
      await expect(as(db.pool, service, (c) => c.query("select public.seed_event($1)", [payload(k)]))).rejects.toThrow(msg);
    }

    // The desk: with P01–P98 checked in, the next free Product cards are P99, P100, P101 (text order gave P100 first).
    await n.q("update events set desk_check_in = true where id = $1", [n.eventId]);
    await n.q(
      "update teams set checked_in_at = now() where event_id = $1 and track = 'PRODUCT' and regexp_replace(code, '[^0-9]', '', 'g')::int <= 98",
      [n.eventId],
    );
    const prefix = (await codes(n, "PRODUCT"))[0]!.replace(/P\d+$/, "");
    const handed: string[] = [];
    t0 = performance.now();
    for (let i = 0; i < 3; i++) {
      const r = await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", "", `Walk-in ${i}`, JSON.stringify([{ full_name: `Member ${i}` }]));
      handed.push(r.card);
    }
    timings.desk_check_in_ms = Math.round(ms(t0) / 3);
    expect(handed).toEqual([`${prefix}P99`, `${prefix}P100`, `${prefix}P101`]);
    // And P9 before P10 on a fresh track.
    const r = await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", "", "First fund", JSON.stringify([{ full_name: "F" }]));
    expect(r.card).toBe(`${prefix}F01`);
    await n.q("update teams set checked_in_at = now() where event_id = $1 and track = 'FINANCE' and regexp_replace(code, '[^0-9]', '', 'g')::int <= 8", [n.eventId]);
    expect((await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", "", "Ninth", JSON.stringify([{ full_name: "N" }]))).card).toBe(`${prefix}F09`);
    expect((await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", "", "Tenth", JSON.stringify([{ full_name: "T" }]))).card).toBe(`${prefix}F10`);
  });

  test("uneven check-ins: the smallest track sets the squads, the rest are left out by the seed; provable and repeatable", async () => {
    const n = await Night.create(db.pool, 200, "PRIMUS");
    const seed = sha256Hex("scale-draw");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await checkIn(n, { PRODUCT: 160, CONSULTING: 170, FINANCE: 167 });
    const pools = {
      product: await codes(n, "PRODUCT", "checked_in_at is not null"),
      consulting: await codes(n, "CONSULTING", "checked_in_at is not null"),
      finance: await codes(n, "FINANCE", "checked_in_at is not null"),
    };

    // The preview (organisers only): 160 squads; 10 Consulting and 7 Finance teams would be left out.
    const preview = await n.org("draw_preview", n.eventId);
    expect(preview).toMatchObject({ drawn: false, rule: "CHECKED_IN", desk: true, squads: 160, ready: true, left_out: 17, empty_seats: 0 });
    expect(preview.tracks).toEqual([
      { track: "PRODUCT", cards: 200, checked_in: 160, drawn: 160, left_out: 0, empty_seats: 0 },
      { track: "CONSULTING", cards: 200, checked_in: 170, drawn: 160, left_out: 10, empty_seats: 0 },
      { track: "FINANCE", cards: 200, checked_in: 167, drawn: 160, left_out: 7, empty_seats: 0 },
    ]);
    expect(preview.message).toBe("160 squads (the smallest track). 17 checked-in teams would be left out: 10 Consulting, 7 Finance.");
    const someTeam = n.team(pools.finance[0]!);
    await expect(n.call(someTeam, "draw_preview", n.eventId)).rejects.toThrow(/only an organiser/);

    const t0 = performance.now();
    const r = await n.org("run_lottery", n.eventId, seed, "5");
    timings.run_lottery_160_squads_ms = ms(t0);
    expect(r.squads).toBe(160);

    // Exactly the engine's draw of the teams the 'seats' stream picks (anyone with the seed and the dice can redo it).
    const mirror = mirrorSeats(rootSeed(seed, "5"), pools);
    expect(mirror.seats).toBe(160);
    expect([mirror.left.product.length, mirror.left.consulting.length, mirror.left.finance.length]).toEqual([0, 10, 7]);
    const cards = Array.from({ length: 202 }, (_, i) => String(i + 1));
    const expected = drawLottery(seed, "5", mirror.drawn, cards);
    const got = await squadCodes(n);
    expect(got).toEqual(expected.squads.map((s) => ({ number: s.number, product: s.product, consulting: s.consulting, finance: s.finance })));
    // The SQL selection itself, run again, is the same (pure).
    const again = await n.one("select app.lottery_seats($1, $2, $3, $4) as s", [rootSeed(seed, "5"), pools.product, pools.consulting, pools.finance]);
    expect(again.s.left_out).toEqual(mirror.left);

    // The draw record; the left-out teams are no longer checked in, have no squad, and cannot sign in or play.
    const rec = await n.one("select seats, left_count, entrants, left_out from draw_records where event_id = $1", [n.eventId]);
    expect(rec).toMatchObject({ seats: 160, left_count: 17, entrants: pools, left_out: mirror.left });
    const leftOut = [...mirror.left.consulting, ...mirror.left.finance];
    expect(await n.q("select code from teams where event_id = $1 and code = any($2) and checked_in_at is not null", [n.eventId, leftOut])).toEqual([]);
    const seated = new Set(got.flatMap((s) => [s.product, s.consulting, s.finance]));
    for (const code of leftOut) expect(seated.has(code), code).toBe(false);
    const fund = n.team(mirror.left.finance[0]!);
    expect(await n.call(fund, "my_desk_status")).toEqual({ team: true, admitted: false });
    // Finance pays, so it is the one to check: it cannot place an order or read its own team row.
    const someCompany = (await n.one("select id from companies where event_id = $1 and squad_id is not null limit 1", [n.eventId])).id;
    await expect(n.call(fund, "place_order", someCompany, "BUY", 10)).rejects.toThrow(/only a team/);
    expect(await rowsAs(db.pool, fund, "select id from teams")).toEqual([]);
    // Every checked-in team that was drawn still is; the absent cards (never checked in) have no squad either.
    expect((await n.one("select count(*)::int as n from teams where event_id = $1 and checked_in_at is not null", [n.eventId])).n).toBe(480);
    expect((await n.one("select count(*)::int as n from companies where event_id = $1 and squad_id is not null", [n.eventId])).n).toBe(160);
    expect(await n.one("select count(*)::int as n from event_log where event_id = $1 and what like 'Squad draw: 160 squads%17 left out%'", [n.eventId])).toEqual({ n: 1 });

    // After the draw the preview reports what happened.
    expect(await n.org("draw_preview", n.eventId)).toMatchObject({
      drawn: true, rule: "CHECKED_IN", squads: 160, left_out: 17,
      message: "160 squads were drawn. 17 checked-in teams were left out and can no longer sign in.",
    });
    await n.checkInvariants();
  });

  test("switch off: every card is drawn, a card nobody checked in is an empty seat (as before)", async () => {
    const n = await Night.create(db.pool, 200, "PRIMUS");
    const seed = sha256Hex("scale-draw-off");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.org("set_feature", n.eventId, "draw_checked_in", false);
    await n.advanceTo("SQUAD_DRAW");
    await checkIn(n, { PRODUCT: 160, CONSULTING: 170, FINANCE: 167 });
    expect(await n.org("draw_preview", n.eventId)).toMatchObject({
      drawn: false, rule: "ALL_TEAMS", squads: 200, left_out: 0, empty_seats: 103,
      message: "200 squads: every card is drawn; 103 cards not checked in become empty seats.",
    });
    const t0 = performance.now();
    expect((await n.org("run_lottery", n.eventId, seed, "2")).squads).toBe(200);
    timings.run_lottery_200_squads_ms = ms(t0);
    const all = { product: await codes(n, "PRODUCT"), consulting: await codes(n, "CONSULTING"), finance: await codes(n, "FINANCE") };
    const expected = drawLottery(seed, "2", all, Array.from({ length: 202 }, (_, i) => String(i + 1)));
    expect(await squadCodes(n)).toEqual(expected.squads.map((s) => ({ number: s.number, product: s.product, consulting: s.consulting, finance: s.finance })));
    expect((await n.one("select count(*)::int as n from teams where event_id = $1 and checked_in_at is not null", [n.eventId])).n).toBe(497);
    expect(await n.q("select 1 from draw_records where event_id = $1", [n.eventId])).toEqual([]);
    await n.checkInvariants();
  });
});

describe("after a draw of the checked-in teams", () => {
  test("absent and left-out teams stay out; the practice market has one company per verified Finance team (6), traded by the seated funds (4)", async () => {
    const n = await Night.create(db.pool, 6, "PRIMUS");
    const seed = sha256Hex("scale-small");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await checkIn(n, { PRODUCT: 4, CONSULTING: 5, FINANCE: 6 });
    await n.org("run_lottery", n.eventId, seed, "3");
    const squads = [await n.squad(1), await n.squad(2), await n.squad(3), await n.squad(4)];
    expect((await n.one("select count(*)::int as n from squads where event_id = $1", [n.eventId])).n).toBe(4);
    const rec = await n.one("select left_out from draw_records where event_id = $1", [n.eventId]);
    expect([rec.left_out.product.length, rec.left_out.consulting.length, rec.left_out.finance.length]).toEqual([0, 1, 2]);
    const leftFund = n.team(rec.left_out.finance[0]);
    const leftFirm = n.teamId(rec.left_out.consulting[0]);

    // Before Round 1 the market cannot be prepared; a team never can.
    expect(await n.call(n.lead, "prepare_practice_market", n.eventId, PRACTICE.tickSeconds, PRACTICE.candles * PRACTICE.candleTicks, "[]")).toMatchObject({
      ok: false, code: "NOT_ROUND_1",
    });
    await n.advanceTo("BUILD");
    await expect(n.call(n.team(squads[0]!.f_code), "prepare_practice_market", n.eventId, 5, 10, "[]")).rejects.toThrow(/only an organiser/);
    await expect(n.call(n.team(squads[0]!.f_code), "practice_market_status", n.eventId)).rejects.toThrow(/only staff/);
    expect(await n.org("practice_market_status", n.eventId)).toMatchObject({ prepared: false, switch: true, phase: "BUILD", funds: 6 });

    // The first call fixes the companies: one per Finance team that entered the draw (6: migration 082), four-letter
    // tickers, fixed names. Only the 4 seated funds trade them.
    const steps = PRACTICE.candles * PRACTICE.candleTicks;
    const first = await n.org("prepare_practice_market", n.eventId, PRACTICE.tickSeconds, steps, "[]");
    expect(first).toMatchObject({ prepared: true, simulated: true, companies: 6, loaded: 0, ready: false, steps, tick_seconds: PRACTICE.tickSeconds });
    const list = first.list as { id: string; ticker: string; name: string }[];
    expect(list.map((c) => c.ticker)).toEqual([...list.map((c) => c.ticker)].sort());
    for (const c of list) {
      expect(c.ticker).toMatch(/^[A-Z]{4}$/);
      expect(c.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
    expect(new Set(list.map((c) => c.ticker)).size).toBe(6);
    expect(new Set(list.map((c) => c.id)).size).toBe(6);
    expect((await n.one("select app.practice_companies($1) as c", [n.eventId])).c).toEqual(list);
    // Keys are Product cards (as practice_trade expects); nothing about them is shown.
    expect((await n.q("select track from teams where id = any($1::uuid[]) group by track", [list.map((c) => c.id)]))).toEqual([{ track: "PRODUCT" }]);
    const build = (await n.one("select started_at from phases where event_id = $1 and code = 'BUILD'", [n.eventId])).started_at;
    expect(new Date((await n.one("select starts_at from practice_markets where event_id = $1", [n.eventId])).starts_at).getTime()).toBe(new Date(build).getTime());

    // In chunks: two companies, then all six (the two stored are not stored again), then nothing more.
    const rows = list.map((c) => ({ ticker: c.id, prices: practiceCandles(`${n.eventId}:practice:${c.ticker}`).flatMap((k) => candleTicks(k)) }));
    expect(rows[0]!.prices).toHaveLength(steps);
    const half = await n.org("prepare_practice_market", n.eventId, PRACTICE.tickSeconds, steps, JSON.stringify(rows.slice(0, 2)));
    expect(half).toMatchObject({ loaded: 2, ready: false, added_ticks: 2 * steps });
    expect(half.missing).toEqual(list.slice(2).map((c) => c.id));
    const all = await n.org("prepare_practice_market", n.eventId, PRACTICE.tickSeconds, steps, JSON.stringify(rows));
    expect(all).toMatchObject({ loaded: 6, ready: true, added_ticks: 4 * steps, missing: [] });
    expect(await n.org("prepare_practice_market", n.eventId, PRACTICE.tickSeconds, steps, JSON.stringify(rows))).toMatchObject({ added_ticks: 0, ready: true });
    const bad = [{ ticker: list[0]!.id, prices: [100, 200] }];
    expect(await n.call(n.lead, "prepare_practice_market", n.eventId, 5, steps, JSON.stringify(bad))).toMatchObject({ ok: false, code: "BAD_CONTENT" });
    const stranger = [{ ticker: n.teamId(squads[0]!.f_code), prices: rows[0]!.prices }];
    expect(await n.call(n.lead, "prepare_practice_market", n.eventId, 5, steps, JSON.stringify(stranger))).toMatchObject({ ok: false, code: "BAD_CONTENT" });
    expect((await n.one("select count(*)::int as n from practice_ticks where event_id = $1", [n.eventId])).n).toBe(6 * steps);
    expect(await n.org("practice_market_status", n.eventId)).toMatchObject({ prepared: true, companies: 6, loaded: 6, ready: true });

    // A seated fund trades a simulated company; the left-out fund cannot. A team reads the companies (names only).
    await n.ok(n.team(squads[0]!.f_code), "practice_trade", list[0]!.id, "BUY", 10);
    await expect(n.call(leftFund, "practice_trade", list[0]!.id, "BUY", 10)).rejects.toThrow(/only a team/);
    const seen = await rowsAs(db.pool, n.team(squads[1]!.f_code), "select companies from practice_markets");
    expect(seen[0]!.companies).toEqual(list);

    // Round 1 ends and the night goes on: only the drawn companies are listed, the practice market settles once.
    for (const [i, s] of squads.entries()) {
      await n.ok(n.team(s.p_code), "save_draft", "PITCH", { company_name: `Scale Co ${i}`, ticker: ["SCA", "SCB", "SCC", "SCD"][i], problem: "A real problem." }, 0);
      await n.ok(n.team(s.p_code), "submit_submission", "PITCH");
    }
    await n.deadlinePassed("PITCH");
    await n.advanceTo("READING");
    expect((await n.one("select settled_at is not null as s from practice_markets where event_id = $1", [n.eventId])).s).toBe(true);
    expect((await n.one("select count(*)::int as n from companies where event_id = $1 and ticker is not null", [n.eventId])).n).toBe(4);
    for (const s of squads) await n.judge(s.company_id, "PITCH", [60, 60, 60]);
    await n.deadlinePassed("CALL_1");
    await n.org("release_scores", n.eventId, "PITCH");
    await n.advanceTo("IPO");
    await n.advanceTo("PRESSURE");
    await n.deadlinePassed("REVEAL_1");
    await n.ok(n.lead, "tick", n.eventId);
    await n.deadlinePassed("HIRE_1");
    await n.ok(n.lead, "tick", n.eventId);
    // Hiring closed: every drawn company has a firm, never the left-out firm or a card nobody checked in.
    const firms = await n.q(
      "select e.company_id, e.firm_team_id, t.code, t.checked_in_at is not null as present from engagements e join teams t on t.id = e.firm_team_id where e.event_id = $1 and e.k = 1",
      [n.eventId],
    );
    expect(firms.map((f) => f.company_id).sort()).toEqual(squads.map((s) => s.company_id).sort());
    for (const f of firms) {
      expect(f.present, f.code).toBe(true);
      expect(f.code).not.toBe(rec.left_out.consulting[0]);
    }
    expect(firms.some((f) => f.firm_team_id === leftFirm)).toBe(false);
    await n.checkInvariants();
  });

  test("practice switch off: the organiser's button refuses and the Finance page prepares it as before", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await n.org("set_feature", n.eventId, "practice_verified", false);
    expect(await n.call(n.lead, "prepare_practice_market", n.eventId, 5, 10, "[]")).toMatchObject({ ok: false, code: "SWITCH_OFF" });
    const products = await n.q("select id, code from teams where event_id = $1 and track = 'PRODUCT' order by code", [n.eventId]);
    const rows = products.map((p) => ({ ticker: p.id, prices: practiceCandles(`${n.eventId}:${p.code}`, 2).flatMap((k) => candleTicks(k)) }));
    expect((await n.call(service, "practice_prepare", n.eventId, new Date().toISOString(), 5, JSON.stringify(rows))).ok).toBe(true);
    expect(await n.org("practice_market_status", n.eventId)).toMatchObject({ prepared: true, simulated: false, companies: 3, loaded: 3, ready: true, switch: false });
  });
});

describe("hot spots at 200 companies × 200 funds", () => {
  test("clearing a full order book, the flags, the indicative price and the tick's draft scan (timings printed)", async () => {
    const n = await Night.create(db.pool, 200, "PRIMUS");
    const seed = sha256Hex("scale-perf");
    await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
    await n.advanceTo("SQUAD_DRAW");
    await n.org("run_lottery", n.eventId, seed, "1");
    const E = n.eventId;

    // Every company listed at a price, as after the IPO (written as the engine writes prices).
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.price_writer', 'IPO', true)");
      await c.query(
        `update companies co set ticker = x.t, name = 'Co ' || x.t, ipo_price = x.p, market_price = x.p, ai_price = x.p
           from (select id, 'Q' || chr(65 + (k / 676) % 26) || chr(65 + (k / 26) % 26) || chr(65 + k % 26) as t, 800 + (k * 37) % 900 as p
                   from (select id, row_number() over (order by id)::int as k from companies where event_id = $1 and squad_id is not null) s) x
          where co.id = x.id`,
        [E],
      );
      await c.query("commit");
    } finally {
      c.release();
    }
    const openRound = async (number: number) => {
      const id = (await n.one("select id from rounds where event_id = $1 and number = $2", [E, number])).id as string;
      await n.q("update rounds set status = 'OPEN', opened_at = now(), opens_at = now() - interval '1 minute', closes_at = now() + interval '1 hour' where id = $1", [id]);
      return id;
    };
    // A book written straight into the table (the order checks and the indicative-price trigger are not what is
    // measured): each fund orders each company with probability share/256 (BUY or SHORT, 1 to 50 shares).
    const book = async (roundId: string, share = 256) => {
      const b = await db.pool.connect();
      try {
        await b.query("begin");
        await b.query("set local session_replication_role = replica");
        await b.query(
          `insert into orders (event_id, round_id, team_id, company_id, type, qty, entry_price, reserve_cents)
           select $1::uuid, $2::uuid, f.id, co.id,
                  (case when get_byte(decode(md5(f.id::text || co.id::text || $2::text), 'hex'), 0) < 128 then 'BUY' else 'SHORT' end)::order_type,
                  1 + get_byte(decode(md5(co.id::text || f.id::text || $2::text), 'hex'), 1) % 50, co.market_price, 0
             from teams f cross join companies co
            where f.event_id = $1::uuid and f.track = 'FINANCE' and co.event_id = $1::uuid and co.squad_id is not null
              and get_byte(decode(md5(f.id::text || co.id::text || $2::text), 'hex'), 2) < $3`,
          [E, roundId, share],
        );
        await b.query("commit");
      } finally {
        b.release();
      }
      await n.q("analyze orders");
      return (await n.one("select count(*)::int as n from orders where round_id = $1", [roundId])).n as number;
    };

    // Round 1: a busy but realistic round, about 20 orders per fund (~4,000).
    const round1 = await openRound(1);
    timings.realistic_book_orders = await book(round1, 26);
    let t0 = performance.now();
    await n.q("select app.clear_round($1, true)", [round1]);
    timings.clear_round_200x200_realistic_book_ms = ms(t0);

    // Round 2: the full book, every fund on every company (40,000 orders).
    const round2 = await openRound(2);
    expect(await book(round2)).toBe(40_000);
    t0 = performance.now();
    await n.q("select app.clear_round($1, true)", [round2]);
    timings.clear_round_200x200_full_book_ms = ms(t0);
    expect((await n.one("select count(*)::int as n from orders where round_id = $1 and status = 'FILLED'", [round2])).n).toBe(40_000);
    expect((await n.one("select count(*)::int as n from round_prices where round_id = $1", [round2])).n).toBe(200);
    await n.checkInvariants();

    t0 = performance.now();
    const flags = (await n.one("select app.generate_flags($1) as n", [E])).n;
    timings.generate_flags_200_funds_ms = ms(t0);
    timings.generate_flags_200_funds_flags = Number(flags);

    // The indicative price (app.track_round_range, on every order) with round 3's book already full.
    const round3 = await openRound(3);
    await book(round3);
    const funds = await n.q("select id from teams where event_id = $1 and track = 'FINANCE' order by code limit 50", [E]);
    const target = await n.one("select id, market_price from companies where event_id = $1 and squad_id is not null order by ticker limit 1", [E]);
    t0 = performance.now();
    for (const f of funds) {
      await n.q("insert into orders (event_id, round_id, team_id, company_id, type, qty, entry_price, reserve_cents) values ($1, $2, $3, $4, 'BUY', 5, $5, 0)", [
        E, round3, f.id, target.id, target.market_price,
      ]);
    }
    timings.order_with_range_trigger_full_book_ms = Math.round((ms(t0) / funds.length) * 100) / 100;
    expect((await n.one("select count(*)::int as n from round_ranges where round_id = $1", [round3])).n).toBe(1);

    // The tick's draft scan with every squad's drafts saved and nothing due (the usual tick), with and without the index.
    await n.q("update submission_drafts set version = 1 where event_id = $1", [E]);
    await n.q("analyze submission_drafts");
    const scan = async () => {
      const t = performance.now();
      for (let i = 0; i < 10; i++) await n.q("select app.auto_submit_due_drafts($1)", [E]);
      return Math.round((ms(t) / 10) * 100) / 100;
    };
    timings.auto_submit_scan_ms = await scan();
    // The same scan with the deadline checked once per type (a suggested rewrite of auto_submit_due_drafts).
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) {
      await n.q(
        `select dr.id from submission_drafts dr
          where dr.event_id = $1 and dr.version > 0
            and dr.type in (select t from unnest(enum_range(null::submission_type)) t where app.scoring_closed($1, t))
            and not exists (select 1 from submissions s where s.company_id = dr.company_id and s.type = dr.type)`,
        [E],
      );
    }
    timings.auto_submit_scan_per_type_ms = Math.round((ms(t1) / 10) * 100) / 100;
    const plan = (await n.q("explain select 1 from submission_drafts dr where dr.event_id = $1 and dr.version > 0", [E])).map((r) => r["QUERY PLAN"]).join(" ");
    expect(plan).toMatch(/submission_drafts_event_type_idx/);
    timings.drafts = (await n.one("select count(*)::int as n from submission_drafts where event_id = $1", [E])).n;
  });
});
