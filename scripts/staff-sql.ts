// Writes the staff logins for the night as one SQL file for the Supabase SQL editor (no service key on any laptop):
// out/staff.sql (auth users with hashed passwords and their accounts, in one transaction) and out/staff-logins.txt
// (every email and password; keep it private). Safe to run again: existing logins keep their ids and get the file's
// password and role. Needs migration 20261210000074 (the desk roles).
//
//   pnpm staff-sql --domain primus.mrdev4u.com                       # 10 full, 5 display, 2 registration, 1 judge, 2 crisis, 1 fairness
//   pnpm staff-sql --domain primus.mrdev4u.com --full 4 --judge 2    # other counts
//
// Passwords derive from CARD_SECRET (set it in .env to get the same passwords every time).

import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseArgs } from "./lib/args";
import { DEFAULT_COUNTS, staffCounts, staffLogins, staffLoginsText, staffSql } from "./lib/staff-sql";

const USAGE = `pnpm staff-sql --domain <domain> [--full ${DEFAULT_COUNTS.full}] [--display ${DEFAULT_COUNTS.display}] [--registration ${DEFAULT_COUNTS.registration}] [--judge ${DEFAULT_COUNTS.judge}] [--crisis ${DEFAULT_COUNTS.crisis}] [--app-url <url>]
  --domain <domain>   staff emails are full01@<domain>, display01@<domain>, ...
  --full, --display, --registration, --judge, --crisis   how many logins of each kind (0-99)
  --app-url <url>     printed in the logins file (default APP_URL)`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || typeof args.domain !== "string") {
    console.log(USAGE);
    if (!args.help) process.exitCode = 1;
    return;
  }
  const fromEnv = Boolean(process.env.CARD_SECRET);
  const secret = process.env.CARD_SECRET ?? randomUUID();
  const domain = args.domain.toLowerCase();
  const logins = staffLogins({ domain, secret, counts: staffCounts(args) });
  const appUrl = String(args["app-url"] ?? process.env.APP_URL ?? "https://your-app.vercel.app");
  const sql = staffSql(
    logins,
    `-- PRIMUS staff logins: ${logins.length} for ${domain}. Paste into the Supabase SQL editor and run, after the migrations.
-- Safe to run again: existing logins keep their ids and get these passwords and roles; team logins are never touched.`,
  );
  mkdirSync("out", { recursive: true });
  writeFileSync("out/staff.sql", sql);
  writeFileSync(
    "out/staff-logins.txt",
    staffLoginsText(logins, {
      domain,
      appUrl,
      secretNote: fromEnv
        ? "Passwords derive from CARD_SECRET: the same secret gives the same passwords."
        : `CARD_SECRET was not set, so this one was made up: set CARD_SECRET=${secret} to get the same passwords again.`,
    }),
  );
  console.log(`Wrote out/staff.sql and out/staff-logins.txt (private): ${logins.length} staff logins for ${domain}.`);
  if (!fromEnv) console.warn("CARD_SECRET is not set: the passwords are new each time until you set it (see out/staff-logins.txt).");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
