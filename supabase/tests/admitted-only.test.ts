// Migration 090: no team is shown anywhere until the registration desk has checked it in (desk check-in on). Other
// teams' names and codes reach a team or the projector only through the firm directory (firm_values) and the rankings;
// both leave out the cards not checked in. With the desk off (classic and rehearsal events) nothing changes. The desk
// adds a walk-in team on the spot on a typed card or the track's next free card, and never hands one card out twice.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./pg";
import { as, rowsAs, setPhase, user } from "./helpers";
import { Night } from "./night";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const one = JSON.stringify([{ full_name: "Asha", roll_number: null }]);
const codesOf = (n: Night, track: string) =>
  n.ev.plan.teams
    .filter((t) => t.track === track)
    .map((t) => t.code)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1));

async function firmCodes(n: Night, caller: Parameters<Night["call"]>[0]): Promise<string[]> {
  return as(db.pool, caller, async (c) => (await c.query("select code from public.firm_values($1) order by code", [n.eventId])).rows.map((r) => r.code));
}

async function rankingCodes(n: Night, caller: Parameters<Night["call"]>[0]): Promise<string[]> {
  const r = (await n.call(caller, "rankings", n.eventId)) as { results: { teams: { code: string } }[] } | null;
  return (r?.results ?? []).map((x) => x.teams.code).sort();
}

describe("teams not checked in are invisible", () => {
  test("desk off: every team is listed, exactly as before", async () => {
    const n = await Night.create(db.pool, 3);
    const consulting = codesOf(n, "CONSULTING");
    const product = codesOf(n, "PRODUCT")[0]!;
    expect((await firmCodes(n, n.team(product))).sort()).toEqual([...consulting].sort());
    expect((await firmCodes(n, n.lead)).sort()).toEqual([...consulting].sort());
  });

  test("desk on: the firm directory lists only checked-in firms; a firm appears right after its check-in", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    const [p1] = codesOf(n, "PRODUCT");
    const [c1, c2] = codesOf(n, "CONSULTING");
    await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", p1, "Builders", one);
    const product = n.team(p1!);

    expect(await firmCodes(n, product)).toEqual([]);
    expect(await firmCodes(n, n.lead)).toEqual([]);

    await n.ok(n.lead, "desk_check_in", n.eventId, "CONSULTING", c2, "Advisers", JSON.stringify([{ full_name: "Bilal" }]));
    expect(await firmCodes(n, product)).toEqual([c2]);
    expect(await firmCodes(n, n.lead)).toEqual([c2]);

    // Checked out again: gone again.
    const id = (await n.one("select id from teams where event_id = $1 and code = $2", [n.eventId, c2])).id;
    await n.ok(n.lead, "desk_check_out", n.eventId, id);
    expect(await firmCodes(n, product)).toEqual([]);
    // A team still only reads its own row of teams (row-level security).
    expect(await rowsAs(db.pool, product, "select code from teams")).toEqual([{ code: p1 }]);
    expect(c1).toBeDefined();
  });

  test("rankings (teams, the projector): only teams checked in or seated; desk off lists every result", async () => {
    const n = await Night.create(db.pool, 3);
    const finance = codesOf(n, "FINANCE");
    for (const code of finance) {
      await n.q(
        `insert into results (event_id, team_id, track, final_value_cents, start_value_cents, return_bp, rank)
         select event_id, id, 'FINANCE', 50000000, 50000000, 0, 1 from teams where event_id = $1 and code = $2`,
        [n.eventId, code],
      );
    }
    await setPhase(db.pool, n.eventId, "AWARDS");
    const display = user(n.ev.staff.get("display@example.org")!);
    expect(await rankingCodes(n, display)).toEqual([...finance].sort());

    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    expect(await rankingCodes(n, display)).toEqual([]);
    expect(await rankingCodes(n, n.lead)).toEqual([]);
    await n.ok(n.lead, "desk_check_in", n.eventId, "FINANCE", finance[1], "Fund", one);
    expect(await rankingCodes(n, display)).toEqual([finance[1]]);
    expect(await rankingCodes(n, n.team(finance[1]!))).toEqual([finance[1]]);
  });
});

describe("the desk adds a team on the spot", () => {
  test("a walk-in team on a typed card or the next free card, with no team list row; clear refusals", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    expect((await n.one("select count(*)::int c from roster where event_id = $1", [n.eventId])).c).toBe(0);
    const product = codesOf(n, "PRODUCT");
    const consulting = codesOf(n, "CONSULTING");

    // Typed card, no roster row: the placeholder's name and members are written from scratch.
    const r = await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", product[2], "Walk In", JSON.stringify([
      { full_name: "Asha", roll_number: "W1" },
      { full_name: "Bilal", roll_number: "W2" },
    ]));
    expect(r).toMatchObject({ card: product[2], new: true });
    const t = await n.one("select id, name, checked_in_at from teams where event_id = $1 and code = $2", [n.eventId, product[2]]);
    expect(t.name).toBe("Walk In");
    expect(t.checked_in_at).not.toBeNull();
    expect((await n.q("select full_name from members where team_id = $1 order by full_name", [t.id])).map((m) => m.full_name)).toEqual(["Asha", "Bilal"]);
    expect((await n.one("select source, team_id from roster where team_id = $1", [t.id])).source).toBe("DESK");
    expect(await n.call(n.team(product[2]!), "my_desk_status")).toEqual({ team: true, admitted: true });

    // Next free card: the lowest unused code of the track.
    expect(await n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "Second", one.replace("Asha", "Chen"))).toMatchObject({ card: product[0] });

    // A card already checked in is refused with a clear message; so is a card of another track.
    const taken = await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", product[2], "Other", JSON.stringify([{ full_name: "X" }]));
    expect(taken).toMatchObject({ ok: false, code: "CARD_TAKEN" });
    expect(taken.message).toMatch(new RegExp(`${product[2]} is already checked in to Walk In`));
    const wrong = await n.call(n.lead, "desk_check_in", n.eventId, "PRODUCT", consulting[0], "Wrong", JSON.stringify([{ full_name: "Y" }]));
    expect(wrong).toMatchObject({ ok: false, code: "WRONG_TRACK" });
    expect((await n.one("select checked_in_at from teams where event_id = $1 and code = $2", [n.eventId, consulting[0]])).checked_in_at).toBeNull();
    // Without a track, a typed code is taken as it is (the old call shape).
    expect(await n.ok(n.lead, "desk_check_in", n.eventId, null, consulting[0], "Advisers", JSON.stringify([{ full_name: "Z" }]))).toMatchObject({
      card: consulting[0],
    });
  });

  test("two desk admins typing the same card at once: one gets it, the other is refused", async () => {
    const n = await Night.create(db.pool, 3);
    await n.ok(n.lead, "set_desk_check_in", n.eventId, true);
    const code = codesOf(n, "FINANCE")[1]!;
    const [a, b] = await Promise.all([
      n.call(n.lead, "desk_check_in", n.eventId, "FINANCE", code, "Team A", JSON.stringify([{ full_name: "A" }])),
      n.call(n.lead, "desk_check_in", n.eventId, "FINANCE", code, "Team B", JSON.stringify([{ full_name: "B" }])),
    ]);
    const oks = [a, b].filter((x) => x.ok !== false);
    const refused = [a, b].filter((x) => x.ok === false);
    expect(oks).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ code: "CARD_TAKEN" });
    const team = await n.one("select id, name from teams where event_id = $1 and code = $2", [n.eventId, code]);
    expect(["Team A", "Team B"]).toContain(team.name);
    expect((await n.one("select count(*)::int c from members where team_id = $1", [team.id])).c).toBe(1);

    // Two admins pressing "next free card" at once get two different cards.
    const [x, y] = await Promise.all([
      n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "X", JSON.stringify([{ full_name: "X" }])),
      n.ok(n.lead, "desk_check_in", n.eventId, "PRODUCT", null, "Y", JSON.stringify([{ full_name: "Y" }])),
    ]);
    expect(x.card).not.toBe(y.card);
  });
});
