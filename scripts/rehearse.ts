// A rehearsal night played by bots (Phase 7), sized for the bot test of up to 600 teams (docs/LOAD-TEST.md). Every
// present team signs in with the password on its card and plays through the real public game functions: problem
// cards, the PRD and the crisis memo, practice trades, IPO bids, orders every round, hiring offers and answers, crisis
// plans and advice memos, ratings, the Round 3 draft and the solution. With --autopilot the script also does the
// organisers' part (as the service role): the seed commitment and the draw, auto-advance, judging (the judge worker
// in-process: the fake judge with JUDGE_FAKE=1, else the real model), the releases, the Round 3 statements, the flash
// bulletin and the fairness decisions. Humans can watch (and act) on /admin, /display and /team at the same time.
//
//   pnpm rehearse --create --slug load-600 --per-track 200 --speed 20          the throwaway event (once)
//   JUDGE_FAKE=1 pnpm rehearse --slug load-600 --autopilot --present 400       the desk checks in 400, bots play
//   pnpm rehearse --purge --slug load-600                                      afterwards: event and logins gone
//
// --present N simulates the registration desk: before the draw it checks in N teams (the lowest cards of each track,
// spread evenly, or P,C,F per track) and only they play; the other cards stay locked out, as on the night. Every mode
// refuses a live event. Ends with the summary table, also written to out/load-<timestamp>.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adviceOf, phaseReached, planOf, sha256Hex, type PhaseCode, type SubmissionType } from "@msim/engine";
import { createJudge, judgeConfig, promptLoader, runWorker, supabaseJudgeDb } from "../apps/web/lib/judge/index";
import { parseStatements } from "../apps/web/lib/admin/content";
import { parseArgs, required } from "./lib/args";
import { Bot, emptyStats, limiter, pool, signInCounts, signInTeam, sleep, type BotStats, type Env } from "./lib/bot-runner";
import { REHEARSE_USAGE, UsageError, rehearseOptions, type RehearseOptions } from "./lib/load-args";
import {
  admittedTeams,
  checkInPresent,
  countByTrack,
  createLoadEvent,
  interleaveTracks,
  loadEvent,
  loadTeams,
  parsePresent,
  purgeLoadEvent,
  staffLoginsText,
  type LoadTeam,
} from "./lib/load-event";
import { clearingCheck, errorCheck, report, signInCheck, spread, type SummaryRow } from "./lib/load-summary";

const time = () => new Date().toISOString().slice(11, 19);
const say = (m: string) => console.log(`${time()}  ${m}`);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(REHEARSE_USAGE);
    return 0;
  }
  let o: RehearseOptions;
  try {
    o = rehearseOptions(args);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.log(`${e.message}\n\n${REHEARSE_USAGE}`);
    return 1;
  }
  const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

  if (o.mode === "create") return create(admin, o);
  if (o.mode === "purge") {
    await purgeLoadEvent(admin, { slug: o.slug, emailDomain: required("TEAM_EMAIL_DOMAIN").toLowerCase(), force: o.force }, say);
    return 0;
  }

  const event = await loadEvent(admin, o.slug); // refuses a live event
  const teams = await loadTeams(admin, event.id);
  const counts = parsePresent(o.present ?? undefined, countByTrack(teams));
  const playable: LoadTeam[] = counts ? await checkInPresent(admin, event, teams, counts, say) : admittedTeams(teams, event.desk_check_in);
  if (o.mode === "check-in") return 0;
  return play(admin, o, event, playable);
}

/** --create: the throwaway event, its consoles' and projectors' logins written to out/<slug>-staff-logins.txt. */
async function create(admin: SupabaseClient, o: RehearseOptions): Promise<number> {
  const startsAt = o.startsAt ?? new Date(Date.now() + o.startsInMinutes * 60_000);
  const { eventId, staff, teams } = await createLoadEvent(
    admin,
    {
      slug: o.slug,
      perTrack: o.perTrack,
      speed: o.speed,
      startsAt,
      admins: o.admins,
      projectors: o.projectors,
      prefix: o.prefix,
      replace: o.replace,
      force: o.force,
      problems: o.problems,
      crises: o.crises,
      statements: o.statements,
      cardSecret: required("CARD_SECRET"),
      emailDomain: required("TEAM_EMAIL_DOMAIN").toLowerCase(),
    },
    say,
  );
  mkdirSync("out", { recursive: true });
  const file = `out/${o.slug}-staff-logins.txt`;
  writeFileSync(file, staffLoginsText(staff));
  say(`Created "${o.slug}" (${eventId}): ${teams} cards, the night starts ${startsAt.toISOString()} at ×${o.speed}.`);
  say(`${staff.length} staff logins (${o.admins} consoles, ${o.projectors} projectors) in ${file}: it holds passwords, keep it private.`);
  say(`Next: JUDGE_FAKE=1 pnpm rehearse --slug ${o.slug} --autopilot --present 400   (docs/LOAD-TEST.md)`);
  return 0;
}

async function play(admin: SupabaseClient, o: RehearseOptions, event: { id: string; name: string; slug: string }, playable: LoadTeam[]): Promise<number> {
  const env: Env = {
    url: required("SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    cardSecret: required("CARD_SECRET"),
    emailDomain: required("TEAM_EMAIL_DOMAIN"),
  };
  const except = new Set(o.except);
  const playing = interleaveTracks(playable.filter((t) => !except.has(t.code)), o.teams ?? playable.length);
  if (!playing.length) {
    say("No team can play: none is checked in (use --present) or all are excepted.");
    return 1;
  }
  const until = o.minutes !== null ? Date.now() + o.minutes * 60_000 : Number.POSITIVE_INFINITY;
  const started = new Date();

  say(`Signing in ${playing.length} teams of ${event.name}…`);
  const stats = emptyStats();
  const signInFailures: string[] = [];
  const t0 = Date.now();
  const bots = (
    await pool(playing, 10, async (t) => {
      try {
        return new Bot(await signInTeam(env, o.slug, t.code), event.id, t, stats, () => signInTeam(env, o.slug, t.code));
      } catch (e) {
        signInFailures.push(e instanceof Error ? e.message : String(e));
        return null;
      }
    })
  ).filter((b): b is Bot => b !== null);
  say(
    `${bots.length} of ${playing.length} bots signed in in ${((Date.now() - t0) / 1000).toFixed(1)} s` +
      (signInCounts.rateLimited ? ` (${signInCounts.rateLimited} answers were Auth's rate limit: raise it for the test)` : "") +
      (signInFailures.length ? `; failed: ${signInFailures.slice(0, 3).join("; ")}` : "") +
      `; one turn each every ${o.intervalMs / 1000} s, at most ${o.concurrency} at once.`,
  );
  if (!bots.length) return 1;

  let stop = false;
  let stopping = 0;
  process.on("SIGINT", () => {
    if (++stopping > 1) process.exit(130);
    stop = true;
    console.log("\nStopping after the current turns (Ctrl-C again to quit at once)…");
  });
  let awards = false;
  const done = () => stop || awards || Date.now() > until;

  const run = limiter(o.concurrency);
  const loops = bots.map(async (b, i) => {
    await sleep((o.intervalMs * i) / bots.length); // spread the turns
    while (!done()) {
      await run(() => b.turn());
      if (b.phase === "AWARDS" && !o.autopilot) awards = true;
      await sleep(o.intervalMs * (0.8 + Math.random() * 0.4));
    }
  });
  const pilotLog: string[] = [];
  const pilot = o.autopilot
    ? autopilot(admin, event.id, o, done, pilotLog).then(() => void (awards = true)) // the night is over (or the pilot stopped)
    : Promise.resolve();
  let mark = { calls: 0, turns: 0, at: Date.now() };
  const progress = setInterval(() => {
    const refused = Object.entries(stats.refused).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", ");
    const recent = spread(stats.callMs.slice(mark.calls));
    const perS = ((stats.turns - mark.turns) / ((Date.now() - mark.at) / 1000)).toFixed(1);
    mark = { calls: stats.callMs.length, turns: stats.turns, at: Date.now() };
    say(
      `${bots[0]?.phase ?? "?"} · turns ${stats.turns} (${perS}/s) · calls ${stats.calls} · ok ${stats.ok} · errors ${stats.errors}` +
        `${recent.p95 !== null ? ` · call p95 ${recent.p95} ms` : ""}${refused ? ` · refused: ${refused}` : ""}` +
        `${stats.lastErrors.length ? ` · last error: ${stats.lastErrors.at(-1)}` : ""}`,
    );
  }, 30_000);
  await Promise.all([...loops, pilot]);
  clearInterval(progress);

  const clearings = await roundClearings(admin, event.id, started);
  const finalPhase = bots.find((b) => b.phase)?.phase ?? null;
  return summarise(o, event, playing.length, bots.length, signInFailures, stats, clearings, finalPhase, pilotLog);
}

/** How long each round took to clear after its close (ms), for rounds cleared during this run. */
async function roundClearings(sb: SupabaseClient, eventId: string, since: Date): Promise<{ round: number; ms: number }[]> {
  const { data } = await sb.from("rounds").select("number, closes_at, cleared_at").eq("event_id", eventId).not("cleared_at", "is", null).order("number");
  return ((data ?? []) as { number: number; closes_at: string; cleared_at: string }[])
    .filter((r) => Date.parse(r.cleared_at) >= since.getTime())
    .map((r) => ({ round: r.number, ms: Math.max(0, Date.parse(r.cleared_at) - Date.parse(r.closes_at)) }));
}

function summarise(
  o: RehearseOptions,
  event: { slug: string; name: string },
  wanted: number,
  signedIn: number,
  signInFailures: string[],
  stats: BotStats,
  clearings: { round: number; ms: number }[],
  finalPhase: PhaseCode | null,
  pilotLog: string[],
): number {
  const calls = spread(stats.callMs);
  const reads = spread(stats.readMs);
  const tradingReached = finalPhase !== null && phaseReached(finalPhase, "PRESSURE");
  const row: SummaryRow = {
    run: "rehearse (bots)",
    slug: event.slug,
    screens: signedIn,
    connections: null,
    latencyOf: "game call",
    p50Ms: calls.p50,
    p95Ms: calls.p95,
    errors: { failed: stats.errors, total: stats.turns + stats.calls },
    clearingMs: clearings.length ? Math.max(...clearings.map((c) => c.ms)) : null,
    deliveryPct: null,
    checks: [
      signInCheck(signedIn, wanted, "bots signed in"),
      errorCheck(stats.errors, stats.turns + stats.calls, "errors (turn reads and game calls)"),
      ...(clearings.length || tradingReached ? [clearingCheck(clearings.map((c) => c.ms))] : []),
    ],
  };
  const fnRows = Object.entries(stats.byFn)
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([fn, f]) => `| ${fn} | ${f.calls} | ${f.ok} | ${f.refused} | ${f.errors} |`);
  const refusals = Object.entries(stats.refused).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  const details = [
    `Bots: ${signedIn} of ${wanted} signed in (Auth answered 429 ${signInCounts.rateLimited} times; ${stats.resignIns} signed in again after a lapsed session).` +
      (signInFailures.length ? ` Failed: ${signInFailures.slice(0, 5).join("; ")}` : ""),
    `Options: ${o.autopilot ? "autopilot, " : ""}${o.present ? `present ${o.present}, ` : ""}one turn every ${o.intervalMs / 1000} s, at most ${o.concurrency} at once. Reached: ${finalPhase ?? "?"}.`,
    `Turns ${stats.turns} (reads p50 ${reads.p50 ?? "—"} ms, p95 ${reads.p95 ?? "—"} ms); game calls ${stats.calls} (p50 ${calls.p50 ?? "—"} ms, p95 ${calls.p95 ?? "—"} ms, max ${calls.max ?? "—"} ms).`,
    "",
    "| Game function | Calls | OK | Refused | Errors |",
    "| --- | --- | --- | --- | --- |",
    ...fnRows,
    "",
    `Refusals (the game's own answers, not errors): ${refusals || "none"}.`,
    `Rounds cleared during the run: ${clearings.length ? clearings.map((c) => `${c.round}: ${c.ms} ms`).join(", ") : "none"}.`,
    ...(stats.lastErrors.length ? [`Last errors: ${stats.lastErrors.join(" · ")}`] : []),
    ...(pilotLog.length ? ["", "Autopilot:", "", ...pilotLog.slice(-60).map((l) => `- ${l}`)] : []),
  ].join("\n");
  return report([row], { title: `Bot night: ${event.name}`, details });
}

/** The organisers' part, as the service role (organiser functions accept the system caller). */
async function autopilot(sb: SupabaseClient, eventId: string, o: RehearseOptions, done: () => boolean, log: string[]) {
  const slug = o.slug;
  const rpc = async (fn: string, a: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, a);
    if (error) return { ok: false, code: "ERROR", message: error.message };
    return data as { ok: boolean; code?: string; message?: string };
  };
  const seedFile = `out/${slug}-rehearsal-seed.txt`;
  let seed = existsSync(seedFile) ? readFileSync(seedFile, "utf8").trim() : "";
  const started = new Set<string>();
  const released = new Set<string>();
  let statementsSet = false;
  let over = false; // the awards are up: the judge loop stops too
  const finished = () => over || done();
  const said = new Set<string>();
  const note = (m: string) => {
    say(`[autopilot] ${m}`);
    log.push(`${time()} ${m}`);
  };
  /** Says a message once (the loop runs every 2 s; a refusal that repeats is said the first time). */
  const once = (m: string) => {
    if (said.has(m)) return;
    said.add(m);
    note(m);
  };

  // The judge, in-process: works whatever is queued.
  const config = judgeConfig();
  const judging = (async () => {
    const db = supabaseJudgeDb(sb, eventId);
    const judge = createJudge(config);
    const prompts = promptLoader();
    while (!finished()) {
      const s = await runWorker({ db, judge, budgetMs: 20_000, concurrency: config.concurrency, models: config.models, prompts, eventId });
      if (s.claimed === 0) await sleep(3000);
      else note(`judge: ${s.done} done, ${s.sealed} sealed, ${s.failed} failed`);
      if (s.stopped === "fatal") {
        note(`judge stopped: ${s.reason}`);
        return;
      }
    }
  })();

  let lastPhase: string | null = null;
  let buildSeen: number | null = null;
  let practiceNagged = 0;
  while (!done()) {
    const { data: ev, error: evError } = await sb.from("events").select("current_phase, seed_commitment, drawn_at, auto_advance, format").eq("id", eventId).single();
    if (evError || !ev) {
      say(`[autopilot] could not read the event (${evError?.message ?? "no answer"}); trying again`);
      await sleep(2000);
      continue;
    }
    const phase = ev.current_phase as PhaseCode;
    if (phase !== lastPhase) {
      note(`phase ${phase}`);
      lastPhase = phase;
    }
    // Every deadline in one read; a deadline has passed once its time has come.
    const { data: dl } = await sb.from("deadlines").select("code, at").eq("event_id", eventId);
    const deadlines = new Map(((dl ?? []) as { code: string; at: string }[]).map((d) => [d.code, Date.parse(d.at)]));
    const passed = (code: string) => (deadlines.get(code) ?? Number.POSITIVE_INFINITY) <= Date.now();

    if (phase === "SETUP" && !ev.seed_commitment) {
      seed = randomBytes(32).toString("hex");
      mkdirSync("out", { recursive: true });
      writeFileSync(seedFile, seed + "\n");
      note(`seed commitment: ${(await rpc("set_seed_commitment", { p_event: eventId, p_commitment: sha256Hex(seed) })).ok ? "set" : "refused"}`);
    }
    // The heartbeat never starts a night by itself (an event in SETUP is not ticked): start it at its planned time.
    if (phase === "SETUP" && ev.seed_commitment) {
      const { data: setup } = await sb.from("phases").select("ends_at").eq("event_id", eventId).eq("code", "SETUP").single();
      if (setup && Date.parse(setup.ends_at) <= Date.now()) {
        const r = await rpc("advance_phase", { p_event: eventId, p_from: "SETUP" });
        note(`start the night: ${r.ok ? "CHECKIN" : r.message}`);
      }
    }
    if (!ev.auto_advance) note(`auto-advance on: ${(await rpc("set_auto_advance", { p_event: eventId, p_on: true })).ok}`);
    if (phase === "SQUAD_DRAW" && !ev.drawn_at) {
      if (!seed) throw new Error(`the seed of ${slug} is not in ${seedFile}; draw it in /admin instead`);
      const r = await rpc("run_lottery", { p_event: eventId, p_seed: seed, p_dice: "4" });
      // An uneven check-in can hold the draw until the surplus is confirmed on the Desk page: say so once, keep trying.
      if (r.ok) note("draw: done");
      else once(`draw refused (${r.code}): ${r.message} — if the Desk page asks to confirm the surplus, confirm it there; the autopilot keeps trying`);
    }
    const judge = async (type: SubmissionType) => {
      if (started.has(type)) return;
      const r = await rpc("start_judging", { p_event: eventId, p_type: type });
      if (r.ok || (r.code ?? "").startsWith("ALREADY")) {
        started.add(type);
        note(`start judging ${type}: ${r.ok ? "queued" : r.code}`);
      }
    };
    const release = async (type: SubmissionType) => {
      if (released.has(type)) return;
      await rpc("seal_missing_scores", { p_event: eventId, p_type: type });
      const r = await rpc("release_scores", { p_event: eventId, p_type: type });
      if (r.ok) {
        released.add(type);
        note(`released ${type}`);
      }
    };
    for (const [type, deadline] of [["PITCH", "PITCH"], ["PLAN", "PLAN"], ["FLASH", "FLASH"]] as [SubmissionType, string][]) {
      if (passed(deadline)) await judge(type);
    }
    if (ev.format === "PRIMUS") {
      // Round 1: the practice market is prepared by the organisers (the Run page) or the first Finance screen.
      if (phase === "BUILD") {
        buildSeen ??= Date.now();
        if (Date.now() - buildSeen > 30_000 && Date.now() - practiceNagged > 60_000) {
          const { count } = await sb.from("practice_markets").select("event_id", { count: "exact", head: true }).eq("event_id", eventId);
          if (!count) {
            practiceNagged = Date.now();
            note("the practice market is not prepared yet: prepare it on the Run page (or open a Finance team's practice page); the funds' bots trade once it is");
          }
        }
      }
      // Round 1: the firms' crisis memo is judged with the PRDs and released at Reading.
      if (passed("PITCH")) await judge("MEMO");
      if (phase === "READING") await release("MEMO");
      // Round 3's statements, once, before Round 3.
      if ((phase === "PRESSURE" || phase === "SATURATION") && !statementsSet) statementsSet = await ensureStatements(sb, eventId, o.statements, note);
      // Each crisis (1–4) and Round 3 (5): judge the plans and memos at the due time; release the plans then (the
      // last trading round of each waits for them) and the memos once ratings close.
      for (let k = 1; k <= 5; k++) {
        if (!passed(`DUE_${k}`)) continue;
        await judge(planOf(k));
        await judge(adviceOf(k));
        await release(planOf(k));
        if (passed(`RATE_${k}`)) await release(adviceOf(k));
      }
    }
    if (phase === "READING") await release("PITCH");
    if (phase === "VERDICTS") await release("PLAN");
    if (phase === "ROUNDS_13_21") {
      if (passed("FLASH_BULLETIN")) {
        const { count } = await sb.from("bulletins").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("kind", "FLASH").not("published_at", "is", null);
        if (!count) {
          await rpc("prepare_flash_bulletin", { p_event: eventId, p_title: "Interest rates rise", p_body: "Investors now want a path to profit within 12 months." });
          note(`flash bulletin: ${(await rpc("publish_flash_bulletin", { p_event: eventId })).ok ? "published" : "refused"}`);
        }
      }
      await release("FLASH");
    }
    if (phase === "APPEALS") {
      const { data: flags } = await sb.from("flags").select("id").eq("event_id", eventId).eq("status", "OPEN");
      for (const f of flags ?? []) await rpc("decide_flag", { p_flag: f.id, p_status: "CLEARED", p_reason: "Rehearsal: cleared by the autopilot." });
    }
    if (phase === "AWARDS") {
      note("the awards are up: the night is over");
      over = true;
      break;
    }
    await sleep(2000);
  }
  over = true;
  await judging;
}

/**
 * Round 3's statements, if the event has none: the organisers' file (seed/sectors/statements.csv), or else ten per
 * sector of the problem cards, each with room for a tenth of the companies (so any one sector can take them all).
 */
async function ensureStatements(sb: SupabaseClient, eventId: string, file: string, note: (m: string) => void): Promise<boolean> {
  const { count } = await sb.from("problem_statements").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  if (count) return true;
  try {
    const parsed = parseStatements(readFileSync(file, "utf8"));
    if (parsed.ok) {
      const { data, error } = await sb.rpc("set_problem_statements", { p_event: eventId, p_rows: parsed.value });
      const r = data as { ok?: boolean; message?: string } | null;
      if (!error && r?.ok) {
        note(`Round 3 statements: ${parsed.value.length} uploaded from ${file}`);
        return true;
      }
      note(`Round 3 statements from ${file} refused (${error?.message ?? r?.message}); making some instead`);
    }
  } catch {
    // No file: made below.
  }
  const [{ data: cards }, { count: companies }] = await Promise.all([
    sb.from("problem_cards").select("sector").eq("event_id", eventId),
    sb.from("companies").select("id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  const sectors = [...new Set(((cards ?? []) as { sector: string | null }[]).map((c) => (c.sector ?? "").trim()).filter(Boolean))];
  const cap = Math.min(50, Math.max(5, Math.ceil((companies ?? 0) / 10) + 1));
  const rows = sectors.length >= 2 && sectors.length <= 6
    ? sectors.flatMap((sector, i) => Array.from({ length: 10 }, (_, j) => ({ number: i * 10 + j + 1, sector, title: `${sector} problem ${j + 1}`, body: `A Round 3 problem in ${sector}.`, cap })))
    : Array.from({ length: 12 }, (_, j) => ({ number: j + 1, title: `Problem ${j + 1}`, body: "A Round 3 problem.", cap }));
  const { data, error } = await sb.rpc("set_problem_statements", { p_event: eventId, p_rows: rows });
  const r = data as { ok?: boolean; message?: string } | null;
  note(`Round 3 statements: ${!error && r?.ok ? `${rows.length} made (cap ${cap})` : (error?.message ?? r?.message)}`);
  return !error && !!r?.ok;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
