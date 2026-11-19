// Writes out/catch-up-<base>-to-<last>.sql: one file for the Supabase SQL editor that brings the live database from
// <base> (default 20261125000059, the version the live database was last reported at) up to the latest migration,
// applying only what is missing, in one transaction. See scripts/lib/catch-up.ts.
//
//   pnpm catch-up-sql                      # from 20261125000059
//   pnpm catch-up-sql --from 20261129000063

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "./lib/args";
import { catchUpSql, parseMigrationName } from "./lib/catch-up";

const dir = resolve(import.meta.dirname, "..", "supabase", "migrations");
const args = parseArgs(process.argv.slice(2));
const base = String(args.from ?? "20261125000059");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const migrations = files.map((f) => ({ ...parseMigrationName(f), sql: readFileSync(join(dir, f), "utf8") }));
const sql = catchUpSql(migrations, base);
const last = migrations.at(-1)!.version;
mkdirSync("out", { recursive: true });
const path = `out/catch-up-${base}-to-${last}.sql`;
writeFileSync(path, sql);
console.log(`Wrote ${path} (${Math.round(sql.length / 1024)} KB): migrations after ${base} up to ${last}.`);
