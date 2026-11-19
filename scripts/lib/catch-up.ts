// One SQL file that brings a live database up to the latest migration from the Supabase SQL editor, safely.
//
// Every migration since 20261122000055 sets public.schema_version() to its own number, so the database can say how
// far it is. The file wraps each migration newer than the base in a block that runs it only if the database is
// older than that migration, all inside one transaction: run it on a database at any version from the base on and it
// applies exactly the missing migrations in order, or nothing at all if any of them fails. Running it twice is safe:
// the second run skips everything. It also records the applied migrations in supabase_migrations.schema_migrations
// when that table exists, so a later `supabase db push` does not try to apply them again.

import { basename } from "node:path";

export interface MigrationFile {
  /** e.g. 20261126000060 */
  version: string;
  /** e.g. dilution_floor */
  name: string;
  sql: string;
}

export function parseMigrationName(file: string): { version: string; name: string } {
  const m = /^(\d{14})_(.+)\.sql$/.exec(basename(file));
  if (!m) throw new Error(`not a migration file name: ${file}`);
  return { version: m[1]!, name: m[2]! };
}

export function catchUpSql(all: readonly MigrationFile[], base: string, target?: string): string {
  const sorted = [...all].sort((a, b) => a.version.localeCompare(b.version));
  if (!sorted.some((m) => m.version === base)) throw new Error(`no migration ${base}`);
  const todo = sorted.filter((m) => m.version > base && (!target || m.version <= target));
  if (todo.length === 0) throw new Error(`nothing after ${base}`);
  const last = todo.at(-1)!.version;
  for (const m of todo) {
    if (!m.sql.includes(`select '${m.version}'::text`)) {
      throw new Error(`migration ${m.version} does not set public.schema_version() to its own number`);
    }
  }

  const out: string[] = [];
  out.push(
    `-- PRIMUS catch-up: brings a database at ${base} or later up to ${last} (${todo.length} migrations).`,
    `-- Paste the whole file into Supabase -> SQL Editor -> New query and press Run, once.`,
    `-- One transaction: it applies only the migrations the database is missing, in order, or nothing if one fails.`,
    `-- Safe to run again: a second run skips everything. The last line shows the schema version (expect ${last}).`,
    `--`,
    ...todo.map((m) => `--   ${m.version}  ${m.name}`),
    ``,
    `begin;`,
    ``,
    `do $guard$`,
    `declare v text;`,
    `begin`,
    `  if to_regprocedure('public.schema_version()') is null then`,
    `    raise exception 'This database has no public.schema_version(): it is not a PRIMUS database at ${base} or later.';`,
    `  end if;`,
    `  v := public.schema_version();`,
    `  if v < '${base}' then`,
    `    raise exception 'This database is at %, older than ${base}: apply the migrations up to ${base} first.', v;`,
    `  end if;`,
    `  raise notice 'Database is at %', v;`,
    `end`,
    `$guard$;`,
    ``,
    `-- A database whose functions were pasted into the SQL editor from files with Windows line endings stores them with`,
    `-- \\r\\n, and app.patch_functions matches text exactly, so every patch would refuse. Normalise them to \\n first: only`,
    `-- whitespace changes, and each function is recreated as it is (its grants, owner and settings are kept).`,
    `do $crlf$`,
    `declare f oid; n int := 0;`,
    `begin`,
    `  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace`,
    `            where s.nspname in ('app', 'public') and p.prokind in ('f', 'p') and strpos(p.prosrc, E'\\r') > 0`,
    `              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop`,
    `    execute replace(pg_get_functiondef(f), E'\\r\\n', E'\\n');`,
    `    n := n + 1;`,
    `  end loop;`,
    `  if n > 0 then raise notice 'line endings normalised in % functions', n; end if;`,
    `end`,
    `$crlf$;`,
    ``,
  );
  for (const m of todo) {
    const tag = `m${m.version}`;
    if (m.sql.includes(`$${tag}$`)) throw new Error(`migration ${m.version} contains the quote tag $${tag}$`);
    out.push(
      `-- ─────────────── ${m.version} ${m.name} ───────────────`,
      `do $run${m.version}$`,
      `begin`,
      `  if public.schema_version() >= '${m.version}' then`,
      `    raise notice 'skip ${m.version} ${m.name} (already applied)';`,
      `    return;`,
      `  end if;`,
      `  execute $${tag}$`,
      m.sql.trimEnd(),
      `$${tag}$;`,
      `  if public.schema_version() <> '${m.version}' then`,
      `    raise exception 'migration ${m.version} ran but the schema version is %', public.schema_version();`,
      `  end if;`,
      `  raise notice 'applied ${m.version} ${m.name}';`,
      `end`,
      `$run${m.version}$;`,
      ``,
    );
  }
  out.push(
    `-- Record the migrations for the Supabase CLI, if this project uses its migration table.`,
    `do $record$`,
    `begin`,
    `  if to_regclass('supabase_migrations.schema_migrations') is not null then`,
    `    insert into supabase_migrations.schema_migrations (version, name) values`,
    todo.map((m) => `      ('${m.version}', '${m.name}')`).join(",\n"),
    `    on conflict (version) do nothing;`,
    `  end if;`,
    `end`,
    `$record$;`,
    ``,
    `commit;`,
    ``,
    `select public.schema_version() as schema_version; -- expect ${last}`,
    ``,
  );
  return out.join("\n");
}
