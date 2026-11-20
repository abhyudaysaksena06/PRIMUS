// Migration 092: the projector's Teams spotlight (public.display_teams). Only listed teams (checked in when the desk is
// on, or seated by the draw); code, name and track; a firm's base rate and clients; a fund's name only, never cash.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { user } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const one = JSON.stringify([{ full_name: "Asha", roll_number: null }]);
type Card = Record<string, unknown> & { code: string; name: string; track: string };

describe("display_teams", () => {
  test("desk on: only checked-in teams; finance shows no cash; consulting shows its rate and clients", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    const codes = (track: string) => n.ev.plan.teams.filter((t) => t.track === track).map((t) => t.code).sort();
    const [p1] = codes("PRODUCT");
    const [c1] = codes("CONSULTING");
    const [f1] = codes("FINANCE");
    const display = user(n.ev.staff.get("display@example.org")!);

    expect(await n.call(display, "display_teams", n.eventId)).toEqual([]);

    await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p1, "Builders", one);
    await n.ok(n.lead, "desk_check_in", n.eventId, "CONSULTING", c1, "Advisers", one);
    await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", f1, "Fund One", one);

    const cards = (await n.call(display, "display_teams", n.eventId)) as Card[];
    expect(cards.map((c) => [c.code, c.name, c.track])).toEqual([
      [p1, "Builders", "PRODUCT"],
      [c1, "Advisers", "CONSULTING"],
      [f1, "Fund One", "FINANCE"],
    ]);
    const fund = cards.find((c) => c.track === "FINANCE")!;
    expect(Object.keys(fund).sort()).toEqual(["base_rate_bp", "clients", "code", "company", "name", "track"]);
    expect(fund.base_rate_bp).toBeNull();
    expect(fund.clients).toBeNull();
    expect(fund.company).toBeNull();
    expect(JSON.stringify(cards)).not.toMatch(/cash|collateral|holding/i);
    const firm = cards.find((c) => c.track === "CONSULTING")!;
    expect(typeof firm.base_rate_bp).toBe("number");
    expect(firm.clients).toBe(0);

    // Checked out again: gone again. The event's own teams see the same list.
    const id = (await n.one("select id from teams where event_id = $1 and code = $2", [n.eventId, f1])).id;
    await n.ok(n.lead, "desk_check_out", n.eventId, id);
    expect(((await n.call(n.team(p1!), "display_teams", n.eventId)) as Card[]).map((c) => c.code)).toEqual([p1, c1]);
  });

  test("desk off: every team is listed", async () => {
    const n = await Night.create(db.pool, 3);
    const display = user(n.ev.staff.get("display@example.org")!);
    const cards = (await n.call(display, "display_teams", n.eventId)) as Card[];
    expect(cards).toHaveLength(9);
  });

  test("the schema version is 092", async () => {
    expect((await db.pool.query("select public.schema_version() v")).rows[0].v).toBe("20261228000092");
  });
});
