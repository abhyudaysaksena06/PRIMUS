// The catch-up SQL (scripts/lib/catch-up.ts): run on a database left at 059, it must produce exactly the schema the
// full migration history produces; run again, it must change nothing; started from a later version it applies only
// what is missing.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { catchUpSql, parseMigrationName } from "../../scripts/lib/catch-up";
import { createTestDb, migrationFiles, STUB_SQL } from "./pg";

const BASE = "20261125000059";
const files = migrationFiles();
const migrations = files.map((f) => ({ ...parseMigrationName(basename(f)), sql: readFileSync(f, "utf8") }));
const LAST = migrations.at(-1)!.version;

async function partialDb(upTo: string) {
  const adminUrl = inject("pgAdminUrl");
  const name = `msim_cu_${process.pid}_${upTo}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: u.toString() });
  await client.connect();
  client.on("notice", () => {});
  await client.query(readFileSync(STUB_SQL, "utf8"));
  for (const m of migrations.filter((x) => x.version <= upTo)) await client.query(m.sql);
  return {
    client,
    drop: async () => {
      await client.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

// Everything the migrations define: function bodies, policies, columns, indexes, triggers.
const SNAPSHOT = `
  select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prokind in ('f', 'p')
  union all
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || md5(coalesce(qual, '') || coalesce(with_check, '') || cmd || roles::text)
    from pg_policies where schemaname in ('app', 'public', 'realtime')
  union all
  select 'col ' || table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || coalesce(column_default, '') || ' ' || is_nullable
    from information_schema.columns where table_schema in ('app', 'public')
  union all
  select 'idx ' || indexname || ' ' || md5(indexdef) from pg_indexes where schemaname in ('app', 'public')
  union all
  select 'trg ' || tgname || ' ' || md5(pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal
  order by 1`;

let full: Awaited<ReturnType<typeof createTestDb>>;
let expected: string[];
beforeAll(async () => {
  full = await createTestDb();
  expected = (await full.pool.query(SNAPSHOT)).rows.map((r) => r.x);
});
afterAll(async () => {
  await full?.drop();
});

describe("catch-up SQL", () => {
  const sql = catchUpSql(migrations, BASE);

  test("from 059 it gives exactly the schema of the full history, and a second run changes nothing", async () => {
    const db = await partialDb(BASE);
    try {
      expect((await db.client.query("select public.schema_version() as v")).rows[0].v).toBe(BASE);
      await db.client.query(sql);
      expect((await db.client.query("select public.schema_version() as v")).rows[0].v).toBe(LAST);
      expect((await db.client.query(SNAPSHOT)).rows.map((r) => r.x)).toEqual(expected);
      await db.client.query(sql); // again: every block skips
      expect((await db.client.query(SNAPSHOT)).rows.map((r) => r.x)).toEqual(expected);
      expect((await db.client.query("select public.schema_version() as v")).rows[0].v).toBe(LAST);
    } finally {
      await db.drop();
    }
  });

  test("from a later version (063) it applies only the rest", async () => {
    const db = await partialDb("20261129000063");
    try {
      await db.client.query(sql);
      expect((await db.client.query(SNAPSHOT)).rows.map((r) => r.x)).toEqual(expected);
    } finally {
      await db.drop();
    }
  });

  test("a database whose functions have Windows line endings (pasted into the SQL editor) is caught up all the same", async () => {
    const db = await partialDb("20261129000063");
    try {
      // What the live database looked like: every app/public function body stored with CR LF.
      await db.client.query(`do $x$ declare f oid; begin
        for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                  where s.nspname in ('app', 'public') and p.prokind = 'f' and strpos(p.prosrc, chr(10)) > 0 loop
          execute replace(pg_get_functiondef(f), chr(10), chr(13) || chr(10));
        end loop; end $x$`);
      expect(Number((await db.client.query("select count(*) from pg_proc where strpos(prosrc, chr(13)) > 0")).rows[0].count)).toBeGreaterThan(100);
      await db.client.query(sql);
      expect((await db.client.query("select public.schema_version() as v")).rows[0].v).toBe(LAST);
      expect((await db.client.query(SNAPSHOT)).rows.map((r) => r.x)).toEqual(expected);
    } finally {
      await db.drop();
    }
  });

  test("an older database is refused, and nothing changes", async () => {
    const db = await partialDb("20261124000058");
    try {
      await expect(db.client.query(sql)).rejects.toThrow(/older than 20261125000059/);
      await db.client.query("rollback");
      expect((await db.client.query("select public.schema_version() as v")).rows[0].v).toBe("20261124000058");
    } finally {
      await db.drop();
    }
  });
});

describe("night-check SQL", () => {
  test("runs read-only on a migrated database and reports every line", async () => {
    const db = await createTestDb();
    try {
      // The test stub has no pg_cron: give it the two tables the check reads.
      await db.pool.query(`create schema if not exists cron;
        create table cron.job (jobid bigint primary key, jobname text, schedule text, active boolean);
        create table cron.job_run_details (jobid bigint, start_time timestamptz);
        insert into cron.job values (1, 'msim-tick', '2 seconds', true), (2, 'msim-snapshot', '10 seconds', true);
        insert into cron.job_run_details values (1, now()), (2, now());`);
      const check = () => db.pool.query(readFileSync(new URL("../../scripts/sql/night-check.sql", import.meta.url), "utf8")).then((r) => r.rows);
      const rows = await check();
      expect(rows).toHaveLength(17);
      expect(rows[16]).toMatchObject({ n: 17, result: "OK" });
      // The backup job switched off, or not run in the last minute: FIX.
      await db.pool.query("update cron.job set active = false where jobname = 'msim-snapshot'");
      expect((await check())[16]).toMatchObject({ result: "FIX", found: expect.stringMatching(/^off, last ran /) });
      await db.pool.query("update cron.job set active = true where jobname = 'msim-snapshot'; update cron.job_run_details set start_time = now() - interval '2 minutes' where jobid = 2");
      expect((await check())[16]).toMatchObject({ result: "FIX" });
      expect(rows[0]).toMatchObject({ item: "Schema version", found: LAST, result: "OK" });
      expect(rows[1]).toMatchObject({ result: "OK" });
      expect(rows.find((r) => r.item === "Event exists")).toMatchObject({ result: "FIX" }); // no primus-2026 here
    } finally {
      await db.drop();
    }
  });

  test("expects the latest migration", () => {
    expect(readFileSync(new URL("../../scripts/sql/night-check.sql", import.meta.url), "utf8")).toContain(`'${LAST}'::text as v`);
  });
});
