// The options of the bot test's three tools (docs/LOAD-TEST.md), checked before anything is signed in or sent:
// pnpm rehearse (bots play the night), pnpm app-load-test (virtual screens load the app) and pnpm load-test (realtime).
// A mistyped or unknown flag is refused rather than ignored, so a run never silently measures something else.

import { DEFAULT_PREFIX, DEFAULT_SLUG } from "./load-event";

export class UsageError extends Error {}

type Args = Record<string, string | true>;

/** The most teams one event can hold: 200 per track (W1, migration 076). */
export const MAX_TEAMS = 600;
export const MAX_PER_TRACK = 200;

function known(args: Args, keys: readonly string[]) {
  const unknown = Object.keys(args).filter((k) => !keys.includes(k));
  if (unknown.length) throw new UsageError(`unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `--${k}`).join(", ")}`);
}

function str(args: Args, key: string): string | undefined {
  const v = args[key];
  if (v === true) throw new UsageError(`--${key} needs a value`);
  return v;
}

function int(args: Args, key: string, def: number, min: number, max: number): number;
function int(args: Args, key: string, def: null, min: number, max: number): number | null;
function int(args: Args, key: string, def: number | null, min: number, max: number): number | null {
  const v = str(args, key);
  if (v === undefined) return def;
  if (!/^\d+$/.test(v.trim())) throw new UsageError(`--${key} ${v}: a whole number is needed`);
  const n = Number(v.trim());
  if (n < min || n > max) throw new UsageError(`--${key} ${v}: between ${min} and ${max}`);
  return n;
}

/** Seconds (fractions allowed) as milliseconds. */
function seconds(args: Args, key: string, def: number | null, min: number, max: number): number | null {
  const v = str(args, key);
  if (v === undefined) return def === null ? null : def * 1000;
  const n = Number(v.trim());
  if (!/^\d+(\.\d+)?$/.test(v.trim()) || n < min || n > max) throw new UsageError(`--${key} ${v}: seconds between ${min} and ${max}`);
  return Math.round(n * 1000);
}

const flag = (args: Args, key: string): boolean => {
  const v = args[key];
  if (v === undefined) return false;
  if (v === true) return true;
  throw new UsageError(`--${key} takes no value (got "${v}")`);
};

function slugOf(args: Args): string {
  const slug = str(args, "slug") ?? DEFAULT_SLUG;
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) throw new UsageError(`--slug ${slug}: lower-case letters, digits and dashes`);
  return slug;
}

// ───────────────────────────── pnpm rehearse ─────────────────────────────

export type RehearseMode = "play" | "create" | "purge" | "check-in";

export interface RehearseOptions {
  mode: RehearseMode;
  slug: string;
  /** Also play the organisers (draw, advance, judge, release, flags). */
  autopilot: boolean;
  /** How many of the playing teams get a bot (null: all). */
  teams: number | null;
  /** Codes the bots leave alone, for people to play. */
  except: string[];
  /** --present as given (a total or Product,Consulting,Finance); resolved against the event's cards. */
  present: string | null;
  intervalMs: number;
  minutes: number | null;
  /** Bot turns running at once (bounds the open connections of one laptop). */
  concurrency: number;
  /** Round 3 statements the autopilot uploads if the event has none. */
  statements: string;
  // --create
  perTrack: number;
  speed: number;
  startsAt: Date | null;
  startsInMinutes: number;
  admins: number;
  projectors: number;
  prefix: string;
  replace: boolean;
  force: boolean;
  problems: string;
  crises: string;
}

export const REHEARSE_USAGE = `pnpm rehearse [--slug ${DEFAULT_SLUG}] [--autopilot] [--present N|P,C,F] [--teams N] [--except CODES] [--interval ms] [--minutes N] [--concurrency N]
pnpm rehearse --create [--slug ${DEFAULT_SLUG}] [--per-track 200] [--speed 20] [--starts-in 10 | --starts-at ISO] [--admins 20] [--projectors 10] [--prefix ${DEFAULT_PREFIX}] [--replace]
pnpm rehearse --check-in --present N|P,C,F [--slug ${DEFAULT_SLUG}]
pnpm rehearse --purge [--slug ${DEFAULT_SLUG}]

Playing (the default): every present team signs in with its card's password and plays the real game functions.
  --autopilot     also play the organisers: start the night, draw, auto-advance, judge (JUDGE_FAKE=1: the fake judge),
                  release, statements, flash bulletin, flags
  --present N     the desk checks in N teams before the draw (spread evenly), or P,C,F per track (140,130,130);
                  only they play; the other cards stay locked out. Default: everyone, no desk
  --teams N       only the first N of the present teams play (taken in turn from each track)
  --except CODES  cards the bots leave alone, for people (comma-separated, e.g. LP01,LC01)
  --interval ms   one turn per team every ms (default 5000)
  --minutes N     stop after N minutes (default: when the night reaches AWARDS)
  --concurrency N bot turns at once (default 64)
  --statements F  Round 3 statements the autopilot uploads if there are none (default seed/sectors/statements.csv)
Creating the throwaway event (--create): a PRIMUS rehearsal named "Load test (<slug>)" with its own card letter
  --per-track N   cards per track (3–${MAX_PER_TRACK}, default 200)     --speed N   clock speed (default 20: the night in ~35 min)
  --starts-in M   the night starts M minutes from now (default 10)  --starts-at ISO  an exact start instead
  --admins N      organiser consoles for app-load-test (default 20) --projectors N  projector logins (default 10)
  --prefix L      the card letter (default ${DEFAULT_PREFIX}: LP01–LP200; never X, the demo's)
  --replace       purge and re-create an existing load event        --force  also for an event not made by --create
--purge deletes the event, its team logins and its consoles' and projectors' logins (refuses a live event).
Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, CARD_SECRET, TEAM_EMAIL_DOMAIN
(and JUDGE_FAKE=1 or ANTHROPIC_API_KEY with --autopilot).`;

export function rehearseOptions(args: Args): RehearseOptions {
  known(args, [
    "slug", "autopilot", "present", "teams", "except", "interval", "minutes", "concurrency", "statements",
    "create", "check-in", "purge", "per-track", "speed", "starts-in", "starts-at", "admins", "projectors", "prefix", "replace", "force",
    "problems", "crises",
  ]);
  const modes = (["create", "check-in", "purge"] as const).filter((m) => flag(args, m));
  if (modes.length > 1) throw new UsageError(`choose one of --create, --check-in and --purge (got ${modes.map((m) => `--${m}`).join(" and ")})`);
  const mode: RehearseMode = modes[0] ?? "play";
  if (args.present === true) throw new UsageError("--present needs the teams at the desk: a total (400) or Product,Consulting,Finance (134,133,133)");
  const present = str(args, "present") ?? null;
  if (mode === "check-in" && present === null) throw new UsageError("--check-in needs --present (how many teams the desk checks in)");
  const prefix = (str(args, "prefix") ?? DEFAULT_PREFIX).toUpperCase();
  if (!/^[A-Z]$/.test(prefix)) throw new UsageError(`--prefix ${prefix}: one letter (the live event's cards have none: a load event never takes them)`);
  if (prefix === "X") throw new UsageError("--prefix X is the demo's card letter: choose another (default L)");
  const startsAtRaw = str(args, "starts-at");
  const startsAt = startsAtRaw === undefined ? null : new Date(startsAtRaw);
  if (startsAt && Number.isNaN(startsAt.getTime())) throw new UsageError(`--starts-at ${startsAtRaw}: an ISO time, e.g. 2026-11-20T10:00:00Z`);
  if (startsAt && args["starts-in"] !== undefined) throw new UsageError("give --starts-in or --starts-at, not both");
  const except = (str(args, "except") ?? "").toUpperCase().split(",").map((c) => c.trim()).filter(Boolean);
  return {
    mode,
    slug: slugOf(args),
    autopilot: flag(args, "autopilot"),
    teams: int(args, "teams", null, 1, MAX_TEAMS),
    except,
    present,
    intervalMs: int(args, "interval", 5000, 500, 60_000),
    minutes: int(args, "minutes", null, 1, 600),
    concurrency: int(args, "concurrency", 64, 1, MAX_TEAMS),
    statements: str(args, "statements") ?? "seed/sectors/statements.csv",
    perTrack: int(args, "per-track", MAX_PER_TRACK, 3, MAX_PER_TRACK),
    speed: int(args, "speed", 20, 1, 60),
    startsAt,
    startsInMinutes: int(args, "starts-in", 10, 0, 24 * 60),
    admins: int(args, "admins", 20, 0, 99),
    projectors: int(args, "projectors", 10, 0, 99),
    prefix,
    replace: flag(args, "replace"),
    force: flag(args, "force"),
    problems: str(args, "problems") ?? "seed/sectors/problem-cards.csv",
    crises: str(args, "crises") ?? "seed/sectors/crisis-cards.csv",
  };
}

// ───────────────────────────── pnpm app-load-test ─────────────────────────────

export interface AppLoadOptions {
  /** One or more app servers (comma-separated): screens are spread over them. */
  bases: string[];
  slug: string;
  /** Team screens: one per team (the night's rule); null = every present team. */
  teams: number | null;
  /** Screens per team (1 on the night; more only to try "what if a team opens two phones"). */
  screens: number;
  projectors: number;
  admins: number;
  durationMs: number;
  /** A team screen's pause between pages (random around it). */
  thinkMs: number;
  /** An organiser console's pause between admin pages. */
  adminThinkMs: number;
  /** --burst S: every screen loads one page within S seconds (a round clears) instead of browsing. */
  burstMs: number | null;
  /** --rush S: check-in, every present team signs in within S seconds and opens its home page. */
  rushMs: number | null;
  /** Projectors and consoles listen on the event's channel and re-read after each message; team screens follow it. */
  realtime: boolean;
  /** Each console also works the judge queue (POST /api/judge/work) as "Run the judge here" does. Off by default. */
  judgeLoop: boolean;
  /** Every screen pings every 20 s, as the app's heartbeat does. */
  ping: boolean;
  /** Staff logins ("ROLE email password" lines); default out/<slug>-staff-logins.txt, else derived from CARD_SECRET. */
  staffFile: string | null;
}

export const APP_LOAD_USAGE = `pnpm app-load-test --base <app url[,url…]> [--slug ${DEFAULT_SLUG}] [--teams N] [--projectors 10] [--admins 20] [--duration 300] [--think 6]
                   [--admin-think 20] [--no-realtime] [--judge-loop] [--no-ping] [--staff-file out/<slug>-staff-logins.txt]
pnpm app-load-test --base … --burst 1.2      every screen re-reads one page within 1.2 s (a round clears)
pnpm app-load-test --base … --rush 60        check-in: every present team signs in within 60 s and opens its home page
  --teams N       team screens, ONE per team (the night's rule); default every present (checked-in) team
  --projectors N  each loads /display/<slug>, re-reads after each event message and every 60 s (every 10 s with --no-realtime)
  --admins N      organiser consoles: admin pages, public.tick() every second like the real console, a re-read after
                  each event or staff message; --judge-loop also works the judge queue (never on a live event)
  --screens K     screens per team (default 1; more only to test extra phones)
Pass: 95% of pages under 2 s and under 1% errors. Writes out/load-<timestamp>.md.
Environment: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CARD_SECRET, TEAM_EMAIL_DOMAIN.`;

export function appLoadOptions(args: Args): AppLoadOptions {
  known(args, [
    "base", "slug", "teams", "screens", "projectors", "admins", "duration", "think", "admin-think", "burst", "rush",
    "no-realtime", "judge-loop", "no-ping", "staff-file",
  ]);
  const base = str(args, "base");
  if (!base) throw new UsageError("--base is required: the app's address, e.g. https://primus.example.org");
  const bases = base.split(",").map((b) => b.trim().replace(/\/+$/, "")).filter(Boolean);
  for (const b of bases) if (!/^https?:\/\/[^/\s]+$/.test(b)) throw new UsageError(`--base ${b}: an http(s) address with no path`);
  const burstMs = seconds(args, "burst", null, 0, 600);
  const rushMs = seconds(args, "rush", null, 1, 3600);
  if (burstMs !== null && rushMs !== null) throw new UsageError("choose --burst or --rush, not both");
  return {
    bases,
    slug: slugOf(args),
    teams: int(args, "teams", null, 1, MAX_TEAMS),
    screens: int(args, "screens", 1, 1, 8),
    projectors: int(args, "projectors", 0, 0, 50),
    admins: int(args, "admins", 0, 0, 50),
    durationMs: seconds(args, "duration", 120, 10, 7200)!,
    thinkMs: seconds(args, "think", 6, 0.5, 600)!,
    adminThinkMs: seconds(args, "admin-think", 20, 1, 600)!,
    burstMs,
    rushMs,
    realtime: !flag(args, "no-realtime"),
    judgeLoop: flag(args, "judge-loop"),
    ping: !flag(args, "no-ping"),
    staffFile: str(args, "staff-file") ?? null,
  };
}

// ───────────────────────────── pnpm load-test ─────────────────────────────

export interface RealtimeOptions {
  slug: string;
  /** Realtime connections (default 450: Supabase Pro allows 500, leaving room for projectors and consoles). */
  connections: number;
  ordersPerFund: number;
  windowMs: number;
  sample: number;
  /** Trading rounds measured one after another. */
  rounds: number;
}

export const REALTIME_USAGE = `pnpm load-test [--slug ${DEFAULT_SLUG}] [--connections 450] [--rounds 1] [--orders-per-fund 6] [--window 60] [--sample 50]
  --connections N    realtime connections (default 450; Supabase Pro allows 500 and 500 messages a second)
  --rounds N         trading rounds measured one after another (default 1)
  --orders-per-fund  orders each present fund places in a round's last --window seconds (default 6)
  --sample N         screens that re-read the prices after each clearing (default 50)
Measures every event broadcast's delivery (% of connected screens that got it, and how late), the clearing time
under load, and the peak messages a second. Pass: delivery at least 99%, clearing under 5 s, 99% of connections
joined. Writes out/load-<timestamp>.md.
Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, CARD_SECRET, TEAM_EMAIL_DOMAIN.`;

export function realtimeOptions(args: Args): RealtimeOptions {
  known(args, ["slug", "connections", "rounds", "orders-per-fund", "window", "sample"]);
  return {
    slug: slugOf(args),
    connections: int(args, "connections", 450, 1, 2000),
    ordersPerFund: int(args, "orders-per-fund", 6, 0, 50),
    windowMs: seconds(args, "window", 60, 10, 900)!,
    sample: int(args, "sample", 50, 0, 1000),
    rounds: int(args, "rounds", 1, 1, 30),
  };
}
