// pnpm demo-sql: the file loads the demo next to a live event (no code clash), its logins file holds passwords that
// sign in, and running it again replaces the demo without touching any other event's logins.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb, ROOT } from "./pg";
import { seedEvent } from "./helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
  // What the event SQL needs from real Supabase that the test stub leaves out.
  await db.pool.query(`
    create extension if not exists pgcrypto schema extensions;
    alter table auth.users add column if not exists instance_id uuid, add column if not exists aud text,
      add column if not exists role text, add column if not exists email_confirmed_at timestamptz,
      add column if not exists raw_user_meta_data jsonb, add column if not exists updated_at timestamptz,
      add column if not exists confirmation_token text, add column if not exists email_change text,
      add column if not exists email_change_token_new text, add column if not exists recovery_token text;
    create table if not exists auth.identities (id uuid primary key, user_id uuid references auth.users (id) on delete cascade,
      provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);`);
});
afterAll(async () => {
  await db?.drop();
});

const DOMAIN = "teams.demo-sql.test";
function generate(): { sql: string; logins: string } {
  execFileSync("pnpm", ["-s", "demo-sql", "--domain", DOMAIN], { cwd: ROOT, stdio: "pipe" });
  return { sql: readFileSync(join(ROOT, "out/demo-event.sql"), "utf8"), logins: readFileSync(join(ROOT, "out/demo-logins.txt"), "utf8") };
}
const signsIn = async (email: string, password: string) =>
  (await db.pool.query("select encrypted_password = extensions.crypt($2, encrypted_password) as ok from auth.users where email = $1", [email, password]))
    .rows[0]?.ok === true;

describe("demo SQL", () => {
  test("loads beside a live-style event, signs in, and can be run again", async () => {
    // A non-demo event with the live codes P01, C01, F01… and a login on the same domain shape.
    const other = await seedEvent(db.pool, { slug: "other-live", teamsPerTrack: 3, codePrefix: "", emailDomain: DOMAIN });
    const otherUsers = Number((await db.pool.query("select count(*) from auth.users")).rows[0].count);
    expect(other).toBeTruthy();

    const first = generate();
    await db.pool.query(first.sql);
    const teams = (await db.pool.query("select t.code from teams t join events e on e.id = t.event_id where e.slug = 'demo' order by t.code")).rows.map((r) => r.code);
    expect(teams).toEqual(["XC01", "XC02", "XC03", "XF01", "XF02", "XF03", "XP01", "XP02", "XP03"]);
    expect((await db.pool.query("select format, is_rehearsal from events where slug = 'demo'")).rows[0]).toEqual({ format: "PRIMUS", is_rehearsal: true });
    // The final sector decks.
    const sectors = (await db.pool.query("select distinct sector from problem_cards p join events e on e.id = p.event_id where e.slug = 'demo' order by 1")).rows.map((r) => r.sector);
    expect(sectors.join(",")).toMatch(/Aviation/);

    const pw = (label: RegExp) => label.exec(first.logins)?.[1] ?? "";
    expect(await signsIn("organiser@msim.demo", pw(/ORGANISER\s+organiser@msim\.demo\s+(\S+)/))).toBe(true);
    expect(await signsIn(`xp01@${DOMAIN}`, pw(/XP01 \(PRODUCT\)\s+(\S+)/))).toBe(true);

    // Again: the old demo goes, a new one comes with new passwords, and the other event's logins are all still there.
    const second = generate();
    await db.pool.query(second.sql);
    expect(await signsIn(`xp01@${DOMAIN}`, pw(/XP01 \(PRODUCT\)\s+(\S+)/))).toBe(false);
    expect(await signsIn(`xp01@${DOMAIN}`, /XP01 \(PRODUCT\)\s+(\S+)/.exec(second.logins)![1]!)).toBe(true);
    expect(Number((await db.pool.query("select count(*) from auth.users")).rows[0].count)).toBe(otherUsers + 12);
    expect((await db.pool.query("select count(*)::int as c from teams t join events e on e.id = t.event_id where e.slug = 'other-live'")).rows[0].c).toBe(9);
  });
});
