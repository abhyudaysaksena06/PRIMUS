// Writes one SQL file that loads a demo event into Supabase from the SQL editor, with no keys or command line: the
// logins are created straight in auth.users. Run the migrations first.
//
//   pnpm demo-sql --domain teams.example.org   → out/demo-event.sql and out/demo-logins.txt
//
// The demo event (slug "demo") is a PRIMUS-format rehearsal with 3 teams per track (XP01–XP03, XC01–XC03, XF01–XF03) plus an
// organiser, a fairness officer and a projector login, dealt the final sector decks (FMCG, Aviation, Luxury). The X prefix
// keeps its codes apart from the live event's P01–P50, so both can sit in the same database. The file first removes any
// earlier demo (event and logins), so it can be run again for fresh passwords. Passwords are random each run and only in
// the logins file.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eventStartIST } from "@msim/engine";
import { parseArgs } from "./lib/args";
import { buildSeedPlan, crisisCardsFromCsv, problemCardsFromCsv } from "./lib/seed-plan";
import { eventSql } from "./lib/event-sql";

const args = parseArgs(process.argv.slice(2));
const domain = String(args.domain ?? "teams.example.org").toLowerCase();
const slug = "demo";
const read = (p: string) => readFileSync(p, "utf8");

const plan = buildSeedPlan({
  slug,
  name: "PRIMUS demo",
  format: "PRIMUS",
  rehearsal: true,
  clockSpeed: 10,
  startsAt: eventStartIST(String(args.date ?? "2026-11-20")),
  teamsPerTrack: Number(args["teams-per-track"] ?? 3),
  cardSecret: randomUUID(),
  emailDomain: domain,
  codePrefix: "X",
  staff: [
    { email: "organiser@msim.demo", role: "ORGANISER", name: "Demo organiser" },
    { email: "fairness@msim.demo", role: "FAIRNESS", name: "Demo fairness officer" },
    { email: "projector@msim.demo", role: "DISPLAY", name: "Demo projector" },
  ],
  problemCards: problemCardsFromCsv(read(String(args.problems ?? "seed/sectors/problem-cards.csv"))),
  crisisCards: crisisCardsFromCsv(read(String(args.crises ?? "seed/sectors/crisis-cards.csv"))),
});

const { sql, logins } = eventSql(
  plan,
  `-- PRIMUS demo event (${slug}). Paste into the Supabase SQL editor and run, after the migrations.
-- Team logins use the domain ${domain}: it must equal NEXT_PUBLIC_TEAM_EMAIL_DOMAIN on Vercel.`,
);

// Only the demo's own logins: its staff (@msim.demo) and the accounts of its teams, noted before the event is purged.
// Never by an email pattern, which would also match the live event's or a rehearsal's team logins.
const removeDemo = `create temp table demo_logins on commit drop as
  select a.user_id from public.accounts a join public.teams t on t.id = a.team_id join public.events e on e.id = t.event_id
   where e.slug = '${slug}';
select public.purge_event('${slug}');
delete from auth.users where email like '%@msim.demo' or id in (select user_id from demo_logins);`;
const cleanup = `-- Remove the demo event and its logins (Supabase SQL editor):
begin;
${removeDemo}
commit;`;

const text = `Market Simulation demo logins (event "${slug}"; demo only)

Sign in at /login.
Staff (the "Organiser" sign-in, with the email):
${logins.filter((l) => l.role !== "TEAM").map((l) => `  ${l.role.padEnd(9)} ${l.email}   ${l.password}`).join("\n")}

Team cards (the team sign-in: code and password):
${logins.filter((l) => l.role === "TEAM").map((l) => `  ${l.label.padEnd(16)} ${l.password}`).join("\n")}

${cleanup}
`;

mkdirSync("out", { recursive: true });
// Replace any earlier demo first, in its own transaction, so the file can be run again.
writeFileSync("out/demo-event.sql", `-- Remove any earlier demo event and its logins.\nbegin;\n${removeDemo}\ncommit;\n\n${sql}`);
writeFileSync("out/demo-logins.txt", text);
console.log(`Wrote out/demo-event.sql (${Math.round(sql.length / 1024)} KB) and out/demo-logins.txt`);
