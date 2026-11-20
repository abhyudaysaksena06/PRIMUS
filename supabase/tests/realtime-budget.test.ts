// Migration 078: realtime within the Supabase Pro budget. Raises and hires are gathered and sent by the heartbeat as one
// "refresh" message; everything else goes at once; an automatic hold tells every screen that the times moved.

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

async function toCrisis1(n: Night, squads: number, tag: string) {
  const seed = sha256Hex(tag);
  await n.org("set_seed_commitment", n.eventId, sha256Hex(seed));
  await n.advanceTo("SQUAD_DRAW");
  await n.org("run_lottery", n.eventId, seed, String(squads));
  const s = [];
  for (let i = 1; i <= squads; i++) s.push(await n.squad(i));
  await n.advanceTo("BUILD");
  for (const [i, q] of s.entries()) {
    await n.ok(n.team(q.p_code), "save_draft", "PITCH", { company_name: `Live Co ${i}`, ticker: ["RTA", "RTB", "RTC"][i], problem: "A real problem." }, 0);
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

const sent = (n: Night) =>
  n.q<{ event: string; payload: Record<string, unknown> }>("select event, payload from realtime.messages where topic = $1 order by id", [`event:${n.eventId}`]);
const clearSent = (n: Night) => n.q("delete from realtime.messages where topic = $1", [`event:${n.eventId}`]);

describe("realtime budget", () => {
  test("raises and hires are gathered into one refresh by the heartbeat; other kinds go at once; switch off sends at once", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await clearSent(n);
    for (const kind of ["raises", "hire_locked", "raises", "hire_locked"]) {
      await n.q("select app.broadcast($1, $2, '{}'::jsonb)", [n.eventId, kind]);
    }
    expect(await sent(n)).toEqual([]);
    expect((await n.one("select count(*)::int as c from app.broadcast_pending where event_id = $1", [n.eventId])).c).toBe(4);
    // A bulletin is not gathered.
    await n.q("select app.broadcast($1, 'bulletin', '{}'::jsonb)", [n.eventId]);
    expect((await sent(n)).map((m) => m.event)).toEqual(["bulletin"]);

    // The heartbeat sends the gathered ones as one message, even while paused.
    await n.q("update events set paused = true, paused_at = now() where id = $1", [n.eventId]);
    await n.ok(n.lead, "tick", n.eventId);
    const msgs = await sent(n);
    expect(msgs.map((m) => m.event)).toEqual(["bulletin", "refresh"]);
    expect(msgs[1]!.payload).toMatchObject({ kind: "refresh", kinds: ["hire_locked", "raises"] });
    expect((await n.one("select count(*)::int as c from app.broadcast_pending where event_id = $1", [n.eventId])).c).toBe(0);
    // Nothing gathered: the next beat sends nothing.
    await n.ok(n.lead, "tick", n.eventId);
    expect((await sent(n)).length).toBe(2);

    // Switch off: a raise goes at once, as before.
    await n.org("set_feature", n.eventId, "broadcast_coalesce", false);
    await clearSent(n);
    await n.q("select app.broadcast($1, 'raises', '{}'::jsonb)", [n.eventId]);
    expect((await sent(n)).map((m) => m.event)).toEqual(["raises"]);
  });

  test("an automatic hold sends 'extended'; each patch landed in exactly one function", async () => {
    const n = await Night.create(db.pool, 3, "PRIMUS");
    await toCrisis1(n, 3, "realtime-hold");
    await n.org("set_manual_starts", n.eventId, true);
    await n.org("set_hold_steps", n.eventId, true);
    await n.q("update deadlines set at = now() + interval '20 seconds' where event_id = $1 and code = 'HIRE_1'", [n.eventId]);
    await clearSent(n);
    await n.ok(n.lead, "tick", n.eventId);
    const extended = (await sent(n)).filter((m) => m.event === "extended");
    expect(extended).toHaveLength(1);
    expect(extended[0]!.payload).toMatchObject({ kind: "extended", held: true });

    const landed = async (needle: string) =>
      (await n.one(
        `select string_agg(s.nspname || '.' || p.proname, ',' order by p.proname) as f
           from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname in ('app', 'public') and strpos(p.prosrc, $1) > 0`,
        [needle],
      )).f;
    expect(await landed("perform app.flush_broadcasts(p_event);")).toBe("public.tick");
    expect(await landed("jsonb_build_object('held', true)")).toBe("app.hold_tick");
  });
});
