// Migration 099: desk check-in cannot be switched off on a live event.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

describe("desk check-in on a live event", () => {
  test("can be switched on but not off; a rehearsal can do both", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, false); // a rehearsal (Night events are rehearsals)
    await n.q("update events set is_rehearsal = false where id = $1", [n.eventId]);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    expect((await n.call(n.lead, "set_desk_check_in", n.eventId, false)).code).toBe("DESK_LOCKED");
    expect((await n.one("select desk_check_in from events where id = $1", [n.eventId])).desk_check_in).toBe(true);
  });
});
