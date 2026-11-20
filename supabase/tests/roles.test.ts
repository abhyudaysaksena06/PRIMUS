// Migration 074: staff roles. The registration, judging and crisis desks can each call their own functions and are
// refused everything else; organiser-only controls stay organiser-only; each desk reads what its page needs and no
// private data beyond it; the permission lines landed exactly on the intended functions.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Night } from "./night";
import { as, rowsAs, user, type Caller } from "./helpers";
import { createTestDb } from "./pg";

let db: Awaited<ReturnType<typeof createTestDb>>;
let n: Night;
const staff = {} as Record<"REGISTRATION" | "JUDGE" | "CRISIS", Caller>;
let teamCaller: Caller;

beforeAll(async () => {
  db = await createTestDb();
  n = await Night.create(db.pool, 3, "PRIMUS");
  for (const role of ["REGISTRATION", "JUDGE", "CRISIS"] as const) {
    const id = randomUUID();
    await db.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, `${role.toLowerCase()}01@example.org`]);
    await db.pool.query("insert into accounts (user_id, role, display_name) values ($1, $2, $3)", [id, role, `${role} desk`]);
    staff[role] = user(id);
  }
  teamCaller = n.team([...n.ev.teams.keys()][0]!);
  await db.pool.query("insert into roster (event_id, number, team_name, track) values ($1, 1, 'Roster team', 'PRODUCT')", [n.eventId]);
});
afterAll(async () => {
  await db?.drop();
});

/** Calls one function as `caller` (rolled back): "refused" when the permission line stops it, else "allowed". */
async function attempt(caller: Caller, sql: string, params: unknown[]): Promise<"allowed" | "refused"> {
  try {
    await rowsAs(db.pool, caller, sql, params);
    return "allowed";
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "42501" && /^only (an organiser|the fairness officer)/.test(err.message ?? "")) return "refused";
    return "allowed"; // a business refusal (bad input, wrong phase, not found) means the permission check passed
  }
}

const SAMPLE = JSON.stringify([{ sample_no: 1, title: "Sample", expected: { min: 40, max: 70 }, text: "Acme Labs (ACME)\nWe sell anvils." }]);
const DESK = [
  ["select public.set_desk_check_in($1, true)", (e: string) => [e]],
  ["select public.set_registration_open($1, false)", (e: string) => [e]],
  ["select public.import_roster($1, '[]'::jsonb, false)", (e: string) => [e]],
  ["select public.update_roster($1, 'Renamed', 'PRODUCT', '[]'::jsonb)", () => [randomUUID()]],
  ["select public.desk_check_out($1, $2)", (e: string) => [e, randomUUID()]],
  ["select public.desk_check_in($1, 'PRODUCT', null, 'Walk-in team', '[{\"full_name\": \"Asha\"}]'::jsonb)", (e: string) => [e]],
] as const;
const JUDGING = [
  ["select public.start_judging($1, 'PITCH')", (e: string) => [e]],
  ["select public.retry_failed_runs($1, 'PITCH')", (e: string) => [e]],
  ["select public.seal_missing_scores($1, 'PITCH')", (e: string) => [e]],
  ["select public.set_judge_model($1, 'BACKUP')", (e: string) => [e]],
  ["select public.start_calibration($1, $2::jsonb)", (e: string) => [e, SAMPLE]],
  ["select public.rerun_judging($1, 'PITCH', 'a technical re-run')", () => [randomUUID()]],
] as const;
const CONTENT = [
  ["select public.upload_problem_deck($1, '[]'::jsonb)", (e: string) => [e]],
  ["select public.upload_crisis_deck($1, '[]'::jsonb)", (e: string) => [e]],
  ["select public.set_problem_statements($1, '[]'::jsonb)", (e: string) => [e]],
] as const;
const ORGANISER_ONLY = [
  ["select public.release_scores($1, 'PITCH')", (e: string) => [e]],
  ["select public.pause_event($1)", (e: string) => [e]],
  ["select public.resume_event($1)", (e: string) => [e]],
  ["select public.set_feature($1, 'judge_auto', true)", (e: string) => [e]],
  ["select public.advance_phase($1, 'SETUP')", (e: string) => [e]],
  ["select public.extend_event($1, 5)", (e: string) => [e]],
  ["select public.set_phase_end($1, now() + interval '1 hour')", (e: string) => [e]],
  ["select public.apply_appeal($1)", () => [randomUUID()]],
  ["select public.prepare_flash_bulletin($1, 'Flash', 'Body text')", (e: string) => [e]],
  ["select public.run_lottery($1, 'seed', '4')", (e: string) => [e]],
] as const;

type Call = readonly [string, (e: string) => readonly unknown[]];
async function outcomes(caller: Caller, calls: readonly Call[]) {
  const out: Record<string, string> = {};
  for (const [sql, args] of calls) out[sql] = await attempt(caller, sql, args(n.eventId));
  return out;
}
const all = (calls: readonly Call[], v: string) => Object.fromEntries(calls.map(([sql]) => [sql, v]));

describe("staff roles: who may call what", () => {
  test("the registration desk runs the desk and nothing else", async () => {
    expect(await outcomes(staff.REGISTRATION, DESK)).toEqual(all(DESK, "allowed"));
    expect(await outcomes(staff.REGISTRATION, JUDGING)).toEqual(all(JUDGING, "refused"));
    expect(await outcomes(staff.REGISTRATION, CONTENT)).toEqual(all(CONTENT, "refused"));
    expect(await outcomes(staff.REGISTRATION, ORGANISER_ONLY)).toEqual(all(ORGANISER_ONLY, "refused"));
  });

  test("the judging desk runs judging and calibration, not the release or anything else", async () => {
    expect(await outcomes(staff.JUDGE, JUDGING)).toEqual(all(JUDGING, "allowed"));
    expect(await outcomes(staff.JUDGE, DESK)).toEqual(all(DESK, "refused"));
    expect(await outcomes(staff.JUDGE, CONTENT)).toEqual(all(CONTENT, "refused"));
    expect(await outcomes(staff.JUDGE, ORGANISER_ONLY)).toEqual(all(ORGANISER_ONLY, "refused"));
  });

  test("the crisis desk uploads the decks and statements and nothing else", async () => {
    expect(await outcomes(staff.CRISIS, CONTENT)).toEqual(all(CONTENT, "allowed"));
    expect(await outcomes(staff.CRISIS, DESK)).toEqual(all(DESK, "refused"));
    expect(await outcomes(staff.CRISIS, JUDGING)).toEqual(all(JUDGING, "refused"));
    expect(await outcomes(staff.CRISIS, ORGANISER_ONLY)).toEqual(all(ORGANISER_ONLY, "refused"));
  });

  test("organisers keep everything; the fairness officer and teams gain nothing", async () => {
    const every = [...DESK, ...JUDGING, ...CONTENT, ...ORGANISER_ONLY];
    expect(await outcomes(n.lead, every)).toEqual(all(every, "allowed"));
    const desks = [...DESK, ...JUDGING, ...CONTENT];
    expect(await outcomes(n.fairness, desks)).toEqual(all(desks, "refused"));
    expect(await outcomes(teamCaller, desks)).toEqual(all(desks, "refused"));
    // The refusal names the desk that may do it.
    await expect(rowsAs(db.pool, staff.JUDGE, "select public.set_desk_check_in($1, true)", [n.eventId])).rejects.toThrow(
      /only an organiser or the registration desk can do this/,
    );
  });

  test("a desk's call really changes the game (committed, as the page would)", async () => {
    expect(await n.call(staff.REGISTRATION, "set_desk_check_in", n.eventId, true)).toMatchObject({ ok: true });
    expect((await n.one("select desk_check_in from events where id = $1", [n.eventId])).desk_check_in).toBe(true);
    expect(await n.call(staff.JUDGE, "set_judge_model", n.eventId, "BACKUP")).toMatchObject({ ok: true });
    expect((await n.one("select judge_model_slot from events where id = $1", [n.eventId])).judge_model_slot).toBe("BACKUP");
    await as(db.pool, staff.JUDGE, (c) => c.query("select public.start_calibration($1, $2::jsonb)", [n.eventId, SAMPLE]), { commit: true });
    expect((await n.one("select count(*)::int as n from calibration_samples where event_id = $1", [n.eventId])).n).toBe(1);
  });
});

describe("staff roles: what each desk reads", () => {
  const count = async (caller: Caller, table: string) =>
    Number((await rowsAs<{ n: string }>(db.pool, caller, `select count(*) as n from ${table} where event_id = $1`, [n.eventId]))[0]!.n);

  test("every desk sees the event, its clock and switches (public data, as the projector does)", async () => {
    for (const caller of Object.values(staff)) {
      expect(await count(caller, "phases")).toBeGreaterThan(0);
      const status = await as(db.pool, caller, async (c) => (await c.query("select public.event_status($1) as s", [n.eventId])).rows[0].s);
      expect(status.phase).toBe("SETUP");
      expect(Object.keys(status.features)).toContain("leaderboard");
      expect((await rowsAs(db.pool, caller, "select key from public.feature_switches($1)", [n.eventId])).length).toBeGreaterThan(0);
      // Staff consoles hear the staff channel's change signals.
      expect((await rowsAs<{ ok: boolean }>(db.pool, caller, "select app.can_hear('staff:' || $1) as ok", [n.eventId]))[0]!.ok).toBe(true);
    }
    expect((await rowsAs<{ ok: boolean }>(db.pool, teamCaller, "select app.can_hear('staff:' || $1) as ok", [n.eventId]))[0]!.ok).toBe(false);
  });

  test("each desk reads its own tables and no other desk's", async () => {
    const lead = { teams: await count(n.lead, "teams"), roster: await count(n.lead, "roster") };
    expect(lead.teams).toBe(9);
    expect(lead.roster).toBe(1);
    // Registration: teams and the roster.
    expect(await count(staff.REGISTRATION, "teams")).toBe(9);
    expect(await count(staff.REGISTRATION, "roster")).toBe(1);
    // Judging: calibration (and the judging tables), not the roster or teams.
    expect(await count(staff.JUDGE, "calibration_samples")).toBe(1);
    expect(await count(staff.JUDGE, "roster")).toBe(0);
    expect(await count(staff.JUDGE, "teams")).toBe(0);
    // Crisis: the decks before any reveal, and the team count for the statements' room.
    expect(await count(n.lead, "crisis_cards")).toBe(10);
    expect(await count(staff.CRISIS, "crisis_cards")).toBe(10);
    expect(await count(staff.CRISIS, "problem_cards")).toBe(await count(n.lead, "problem_cards"));
    expect(await count(staff.CRISIS, "teams")).toBe(9);
    expect(await count(staff.CRISIS, "roster")).toBe(0);
    expect(await count(staff.CRISIS, "calibration_samples")).toBe(0);
    // The sealed decks stay sealed for the other desks.
    for (const caller of [staff.REGISTRATION, staff.JUDGE]) {
      expect(await count(caller, "crisis_cards")).toBe(0);
      expect(await count(caller, "problem_cards")).toBe(0);
    }
    expect(await count(staff.REGISTRATION, "calibration_samples")).toBe(0);
  });

  test("private game data stays with organisers and the fairness officer", async () => {
    const ledger = await count(n.lead, "ledger_entries");
    expect(ledger).toBeGreaterThan(0);
    for (const caller of Object.values(staff)) {
      for (const t of ["ledger_entries", "holdings", "event_log", "corrections", "client_pings", "members"]) {
        expect(await count(caller, t), t).toBe(0);
      }
      expect((await rowsAs(db.pool, caller, "select 1 from flags")).length).toBe(0);
      await expect(rowsAs(db.pool, caller, "select public.admin_health($1)", [n.eventId])).rejects.toThrow(/only staff/);
    }
  });

  test("the judging tables each have a judging-desk read policy", async () => {
    const { rows } = await db.pool.query<{ tablename: string }>(
      "select tablename from pg_policies where schemaname = 'public' and policyname like '%_judge_read' order by 1",
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "appeals", "calibration_runs", "calibration_samples", "companies", "judge_runs", "scores", "squads", "submissions",
    ]);
  });
});

describe("migration 074 patched exactly the intended permission lines", () => {
  const using = async (needle: string) =>
    (
      await db.pool.query<{ name: string }>(
        `select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('app', 'public') and strpos(p.prosrc, $1) > 0 order by 1`,
        [needle],
      )
    ).rows.map((r) => r.name);

  test("desk, judging and content functions; nothing else", async () => {
    expect(await using("perform app.require_desk();")).toEqual([
      "public.desk_check_in", "public.desk_check_out", "public.import_roster", "public.set_desk_check_in",
      "public.set_registration_open", "public.update_roster",
    ]);
    expect(await using("perform app.require_judge_ops();")).toEqual([
      "public.rerun_judging", "public.retry_failed_runs", "public.seal_missing_scores", "public.set_judge_model",
      "public.start_calibration", "public.start_judging",
    ]);
    expect(await using("perform app.require_crisis();")).toEqual([
      "public.set_problem_statements", "public.upload_crisis_deck", "public.upload_problem_deck",
    ]);
    expect(await using("app.is_any_staff()")).toEqual(["app.can_hear"]);
    // The organiser-only controls still check for an organiser.
    const organiserOnly = await using("perform app.require_organiser();");
    for (const f of ["release_scores", "apply_appeal", "dismiss_appeal", "pause_event", "resume_event", "set_feature", "advance_phase", "prepare_flash_bulletin"]) {
      expect(organiserOnly, f).toContain(`public.${f}`);
    }
    for (const f of [
      "desk_check_in", "desk_check_out", "import_roster", "update_roster", "set_desk_check_in", "set_registration_open",
      "start_judging", "retry_failed_runs", "seal_missing_scores", "start_calibration", "set_judge_model", "rerun_judging",
      "upload_problem_deck", "upload_crisis_deck", "set_problem_statements",
    ]) {
      expect(organiserOnly, f).not.toContain(`public.${f}`);
    }
  });

  test("the roles are enum values; the schema is at 074 or later", async () => {
    const { rows } = await db.pool.query<{ r: string }>("select unnest(enum_range(null::public.account_role))::text as r");
    expect(rows.map((r) => r.r)).toEqual(["TEAM", "ORGANISER", "FAIRNESS", "DISPLAY", "REGISTRATION", "JUDGE", "CRISIS"]);
    expect((await n.one("select public.schema_version() >= '20261210000074' as ok")).ok).toBe(true);
  });

  test("patch_one_function refuses a text that is missing or appears twice", async () => {
    await expect(
      db.pool.query("select app.patch_one_function('public.pause_event(uuid)'::regprocedure, 'no such text anywhere', 'x')"),
    ).rejects.toThrow(/expected once/);
  });
});
