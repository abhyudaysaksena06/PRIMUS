// The app-server load test (docs/LOAD-TEST.md): the night's screens loading the real pages through the deployed app.
//
//   pnpm app-load-test --base https://<app> [--slug load-600] [--teams 400] --projectors 10 --admins 20 [--duration 900]
//   pnpm app-load-test --base https://<app> --burst 1.2      a round clears: every screen re-reads within 1.2 s
//   pnpm app-load-test --base https://<app> --rush 60        check-in: every present team signs in within 60 s
//
// Team screens: ONE per present team (the night's rule; --teams N takes N of them, in turn from each track). Each opens
// its track's pages one after another with a pause (--think seconds, random around it), pings every 20 s like the
// app's heartbeat, and re-reads its page after each event message (250 ms plus up to 1.2 s, as the app spreads them).
// Projectors (--projectors N) load /display/<slug> and re-read it after each event message and every 60 s (every
// 10 s with --no-realtime, as when the projector's channel is down). Organiser consoles (--admins N) open admin pages,
// call public.tick() every second like the real console, re-read after each event or staff message and, with
// --judge-loop, work the judge queue as "Run the judge here" does (off by default: it judges with the deployment's
// model). Projectors and consoles hold real realtime connections; team screens follow one of them (the realtime
// test, pnpm load-test, holds the teams' connections).
//
// It measures what the room feels: each page's time from the app and the failures. Pass: 95% of pages under 2 s and
// under 1% errors (and every tick answered). Refuses a live event. Writes out/load-<timestamp>.md; exits 1 on a fail.
// Run it against the deployment (or a production build: next build && next start), never the dev server.

import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { teamEmail, type Track } from "@msim/engine";
import { signInWithRetry } from "../apps/web/lib/auth/retry";
import { parseArgs, required } from "./lib/args";
import { derivePassword } from "./lib/credentials";
import { pool, sleep } from "./lib/bot-runner";
import { APP_LOAD_USAGE, UsageError, appLoadOptions, type AppLoadOptions } from "./lib/load-args";
import { admittedTeams, interleaveTracks, loadEvent, loadStaff, loadTeams, parseStaffLogins, staffPassword, type StaffLogin } from "./lib/load-event";
import { PageLog, TEAM_PAGES, adminPages, debounced, displayPath, type ScreenKind } from "./lib/load-pages";
import { errorCheck, joinCheck, pageCheck, report, signInCheck, spread, type Check, type SummaryRow } from "./lib/load-summary";

const PING_MS = 20_000;
const TICK_MS = 1_000;
const PROJECTOR_SAFETY_MS = 60_000;
const PROJECTOR_DOWN_MS = 10_000;
const time = () => new Date().toISOString().slice(11, 19);
const say = (m: string) => console.log(`${time()}  ${m}`);

interface Session {
  email: string;
  sb: SupabaseClient;
  /** The app's session cookies (the same @supabase/ssr format the login page sets), read fresh for each request. */
  cookie: () => string;
  token: () => Promise<string>;
}

/** Signs one login in the way the app's login action does; `once` gives up as a phone would (the rush). */
async function signIn(url: string, anonKey: string, email: string, password: string, once = false): Promise<Session> {
  const jar = new Map<string, string>();
  const sb = createServerClient(url, anonKey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) },
  });
  // The app's own retry; for the set-up sign-ins (not the rush) more tries, Auth's rate limit refilling meanwhile.
  const { error } = await signInWithRetry(() => sb.auth.signInWithPassword({ email, password }), once ? {} : { attempts: 6, rateLimitedAttempts: 14 });
  if (error) throw Object.assign(new Error(`${email} could not sign in: ${(error as { message?: string }).message ?? error.status}`), { status: error.status });
  return {
    email,
    sb,
    cookie: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
    token: async () => (await sb.auth.getSession()).data.session?.access_token ?? "",
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(APP_LOAD_USAGE);
    return 0;
  }
  let o: AppLoadOptions;
  try {
    o = appLoadOptions(args);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.log(`${e.message}\n\n${APP_LOAD_USAGE}`);
    return 1;
  }
  const url = required("SUPABASE_URL");
  const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const cardSecret = required("CARD_SECRET");
  const domain = required("TEAM_EMAIL_DOMAIN");
  const admin = createClient(url, required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const event = await loadEvent(admin, o.slug); // refuses a live event
  const present = admittedTeams(await loadTeams(admin, event.id), event.desk_check_in);
  const teams = interleaveTracks(present, o.teams ?? present.length);
  if (o.teams !== null && o.teams > present.length) say(`Only ${present.length} teams can sign in (checked in): ${teams.length} team screens.`);
  const password = (code: string) => derivePassword(cardSecret, o.slug, code);
  const email = (code: string) => teamEmail(code, domain);
  if (o.rushMs !== null) return rush(o, event.slug, teams, (t) => signIn(url, anonKey, email(t.code), password(t.code), true));

  // 1. Sign-ins: one session per team (its screens share it); each projector and console its own.
  const staff = staffLogins(o, domain, cardSecret);
  let t0 = Date.now();
  const failures: string[] = [];
  const signInOrNull = async (e: string, p: string) => {
    try {
      return await signIn(url, anonKey, e, p);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
      return null;
    }
  };
  const teamSessions = await pool(teams, 10, (t) => signInOrNull(email(t.code), password(t.code)));
  const projectorSessions = await pool(staff.projectors, 5, (s) => signInOrNull(s.email, s.password));
  const adminSessions = await pool(staff.admins, 5, (s) => signInOrNull(s.email, s.password));
  const wanted = teams.length + staff.projectors.length + staff.admins.length;
  const signedIn = [...teamSessions, ...projectorSessions, ...adminSessions].filter(Boolean).length;
  say(`${signedIn} of ${wanted} logins signed in in ${((Date.now() - t0) / 1000).toFixed(1)} s${failures.length ? `; failed: ${failures.slice(0, 3).join("; ")}` : ""}`);

  // 2. The screens run until the end (or, in a burst, load one page each).
  const log = new PageLog(o.slug);
  const end = Date.now() + o.durationMs;
  const burst = o.burstMs;
  const running = () => Date.now() < end;
  const base = (i: number) => o.bases[i % o.bases.length]!;
  let baseIndex = 0;
  const load = async (kind: ScreenKind, b: string, path: string, s: Session) => {
    const started = Date.now();
    try {
      const r = await fetch(b + path, { headers: { cookie: s.cookie(), "user-agent": "app-load-test" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      await r.arrayBuffer();
      log.served(kind, path, r.status, Date.now() - started);
    } catch (e) {
      log.failed(kind, path, (e as Error).name);
    }
  };
  const rpcStats = { tick: [] as number[], tickErrors: 0, pings: 0, pingErrors: 0, judgeTurns: 0, judgeDone: 0, judgeErrors: [] as string[] };
  const timers: ReturnType<typeof setInterval>[] = [];
  const pinger = (s: Session, area: "team" | "admin" | "display", realtime: () => string) => {
    if (!o.ping || burst !== null) return;
    const client = randomUUID();
    const ping = async () => {
      if (!running()) return;
      const { error } = await s.sb.rpc("ping", { p_client: client, p_event: event.id, p_area: area, p_realtime: realtime() });
      rpcStats.pings++;
      if (error) rpcStats.pingErrors++;
    };
    setTimeout(() => {
      void ping();
      timers.push(setInterval(() => void ping(), PING_MS));
    }, Math.random() * PING_MS);
  };

  // Realtime: projectors and consoles each hold a connection; team screens follow the first one's event messages.
  const followers: (() => void)[] = [];
  let relayed = 0;
  const connections = { requested: 0, joined: 0 };
  const sockets: SupabaseClient[] = [];
  const listen = async (s: Session, topics: string[], onMessage: (topic: string) => void): Promise<boolean> => {
    connections.requested++;
    const token = await s.token();
    const rt = createClient(url, anonKey, { accessToken: async () => token });
    sockets.push(rt);
    await rt.realtime.setAuth(token);
    const joined = await Promise.all(
      topics.map(
        (topic) =>
          new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 30_000);
            const ch: RealtimeChannel = rt.channel(topic, { config: { private: true } }).on("broadcast", { event: "*" }, () => onMessage(topic));
            ch.subscribe((st) => {
              if (st === "SUBSCRIBED" || st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
                clearTimeout(timer);
                resolve(st === "SUBSCRIBED");
              }
            });
          }),
      ),
    );
    const ok = joined.every(Boolean);
    if (ok) connections.joined++;
    return ok;
  };
  let relayChosen = false;
  const relay = (topic: string) => {
    if (topic !== `event:${event.id}`) return;
    relayed++;
    for (const f of followers) f();
  };

  const projector = async (s: Session, k: number) => {
    const b = base(baseIndex++);
    const path = displayPath(o.slug);
    const reread = debounced(() => void load("projector", b, path, s));
    let live = false;
    if (o.realtime && burst === null) {
      const isRelay = !relayChosen;
      relayChosen = true;
      live = await listen(s, [`event:${event.id}`], (topic) => {
        reread.trigger(250);
        if (isRelay) relay(topic);
      });
    }
    pinger(s, "display", () => (live ? "SUBSCRIBED" : "CLOSED"));
    if (burst !== null) {
      await sleep(Math.random() * burst);
      return load("projector", b, path, s);
    }
    await sleep(Math.random() * 3000 + k * 50);
    await load("projector", b, path, s);
    const every = live ? PROJECTOR_SAFETY_MS : PROJECTOR_DOWN_MS;
    while (running()) {
      await sleep(Math.min(every, Math.max(0, end - Date.now())));
      if (running()) await load("projector", b, path, s);
    }
    reread.cancel();
  };

  const console_ = async (s: Session, k: number) => {
    const b = base(baseIndex++);
    const pages = adminPages(o.slug);
    let current = pages[k % pages.length]!;
    const reread = debounced(() => void load("admin", b, current, s));
    let live = false;
    if (o.realtime && burst === null) {
      const isRelay = !relayChosen;
      relayChosen = true;
      live = await listen(s, [`event:${event.id}`, `staff:${event.id}`], (topic) => {
        reread.trigger(250);
        if (isRelay) relay(topic);
      });
    }
    pinger(s, "admin", () => (live ? "SUBSCRIBED" : "CLOSED"));
    if (burst !== null) {
      await sleep(Math.random() * burst);
      return load("admin", b, current, s);
    }
    // The organiser console runs the game clock once a second (public.tick is idempotent; a second tick does nothing).
    timers.push(
      setInterval(() => {
        if (!running()) return;
        const a = Date.now();
        void s.sb.rpc("tick", { p_event: event.id }).then(({ error }) => {
          if (error) rpcStats.tickErrors++;
          else rpcStats.tick.push(Date.now() - a);
        }, () => void rpcStats.tickErrors++);
      }, TICK_MS),
    );
    const judging = o.judgeLoop ? judgeLoop(b, s) : Promise.resolve();
    await sleep(Math.random() * 3000);
    for (let i = k; running(); i++) {
      current = pages[i % pages.length]!;
      await load("admin", b, current, s);
      await sleep(Math.min(o.adminThinkMs * (0.5 + Math.random()), Math.max(0, end - Date.now())));
    }
    reread.cancel();
    await judging;
  };

  // "Run the judge here": POST /api/judge/work again and again; idle 5 s when nothing was claimed; stops on a refusal.
  const judgeLoop = async (b: string, s: Session) => {
    while (running()) {
      try {
        const r = await fetch(`${b}/api/judge/work`, {
          method: "POST",
          headers: { cookie: s.cookie(), "content-type": "application/json", "user-agent": "app-load-test" },
          body: JSON.stringify({ event: event.id }),
          signal: AbortSignal.timeout(300_000),
        });
        const body = (await r.json().catch(() => null)) as { claimed?: number; done?: number; error?: string; reason?: string } | null;
        rpcStats.judgeTurns++;
        if (!r.ok || !body) {
          rpcStats.judgeErrors.push(`${r.status} ${body?.error ?? body?.reason ?? ""}`.trim());
          return; // the console switches its judge off on a refusal
        }
        rpcStats.judgeDone += body.done ?? 0;
        if (!body.claimed) await sleep(5000);
      } catch (e) {
        rpcStats.judgeErrors.push((e as Error).name);
        return;
      }
    }
  };

  const team = async (s: Session, track: Track, n: number) => {
    const b = base(baseIndex++);
    const pages = TEAM_PAGES[track];
    let current = pages[n % pages.length]!;
    if (burst !== null) {
      await sleep(Math.random() * burst);
      return load("team", b, current, s);
    }
    const reread = debounced(() => void load("team", b, current, s));
    if (o.realtime) followers.push(() => reread.trigger(250 + Math.random() * 1200));
    await sleep(Math.random() * o.thinkMs); // the room filling up
    for (let i = n; running(); i++) {
      current = pages[i % pages.length]!;
      await load("team", b, current, s);
      await sleep(Math.min(o.thinkMs * (0.5 + Math.random()), Math.max(0, end - Date.now())));
    }
    reread.cancel();
  };

  // Team screens follow the first staff connection; with none, one team login listens for them.
  const firstTeam = teamSessions.find((s): s is Session => s !== null);
  if (o.realtime && burst === null && !projectorSessions.some(Boolean) && !adminSessions.some(Boolean) && firstTeam) {
    relayChosen = true;
    await listen(firstTeam, [`event:${event.id}`], relay);
  }
  const teamScreens = teams.length * o.screens;
  say(
    `${teamScreens} team screens, ${projectorSessions.filter(Boolean).length} projectors, ${adminSessions.filter(Boolean).length} consoles start` +
      (burst !== null ? ` (burst: one page each within ${burst / 1000} s)` : ` for ${o.durationMs / 1000} s${o.realtime ? ", following the event's messages" : ""}`),
  );
  t0 = Date.now();
  const progress = setInterval(() => {
    const s = spread(log.latencies);
    say(`pages ${log.pages} · failed ${log.failures} · p50 ${s.p50 ?? "—"} ms · p95 ${s.p95 ?? "—"} ms · ticks ${rpcStats.tick.length} (${rpcStats.tickErrors} errors) · messages ${relayed}`);
  }, 30_000);
  for (const [i, s] of teamSessions.entries()) if (s) pinger(s, "team", () => (o.realtime ? "SUBSCRIBED" : "CLOSED"));
  await Promise.all([
    ...teams.flatMap((t, i) => (teamSessions[i] ? Array.from({ length: o.screens }, (_, n) => team(teamSessions[i]!, t.track, i * o.screens + n)) : [])),
    ...projectorSessions.map((s, k) => (s ? projector(s, k) : Promise.resolve())),
    ...adminSessions.map((s, k) => (s ? console_(s, k) : Promise.resolve())),
  ]);
  clearInterval(progress);
  for (const t of timers) clearInterval(t);
  await Promise.all(sockets.map((c) => c.removeAllChannels()));
  const seconds = (Date.now() - t0) / 1000;

  // 3. The summary.
  const kinds = log.byKind();
  const ticks = spread(rpcStats.tick);
  const checks: Check[] = [
    signInCheck(signedIn, wanted, "screens signed in"),
    pageCheck(log.latencies),
    errorCheck(log.failures, log.pages, "page errors"),
    ...(rpcStats.tick.length + rpcStats.tickErrors ? [errorCheck(rpcStats.tickErrors, rpcStats.tick.length + rpcStats.tickErrors, "tick() errors")] : []),
    ...(connections.requested ? [joinCheck(connections.joined, connections.requested)] : []),
  ];
  const all = spread(log.latencies);
  const row: SummaryRow = {
    run: burst !== null ? `app-load-test (burst ${burst / 1000} s)` : "app-load-test",
    slug: o.slug,
    screens: teamSessions.filter(Boolean).length * o.screens + projectorSessions.filter(Boolean).length + adminSessions.filter(Boolean).length,
    connections: connections.requested ? connections : null,
    latencyOf: "page",
    p50Ms: all.p50,
    p95Ms: all.p95,
    errors: { failed: log.failures, total: log.pages },
    clearingMs: null,
    deliveryPct: null,
    checks,
  };
  const errorRows = Object.entries(log.errors()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ×${v}`);
  const details = [
    `App: ${o.bases.join(", ")}. ${teamScreens} team screens (${o.screens} per team) of ${present.length} present teams, ${staff.projectors.length} projectors, ${staff.admins.length} consoles; ` +
      (burst !== null ? `burst within ${burst / 1000} s, all served after ${((log.lastDone - t0) / 1000).toFixed(1)} s.` : `${Math.round(seconds)} s, think ${o.thinkMs / 1000} s (consoles ${o.adminThinkMs / 1000} s), ${(log.pages / seconds).toFixed(1)} pages/s.`),
    "",
    "| Screens | Pages | p50 ms | p95 ms | max ms | Failed |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(["team", "projector", "admin"] as const).map((k) => `| ${k} | ${kinds[k].n + kinds[k].failed} | ${kinds[k].p50 ?? "—"} | ${kinds[k].p95 ?? "—"} | ${kinds[k].max ?? "—"} | ${kinds[k].failed} |`),
    "",
    "| Page | Served | p95 ms | Failed |",
    "| --- | --- | --- | --- |",
    ...log.byPage().map((p) => `| ${p.path} | ${p.n} | ${p.p95 ?? "—"} | ${p.failed} |`),
    "",
    `tick(): ${rpcStats.tick.length} answered (p50 ${ticks.p50 ?? "—"} ms, p95 ${ticks.p95 ?? "—"} ms), ${rpcStats.tickErrors} errors. Pings: ${rpcStats.pings} (${rpcStats.pingErrors} errors).` +
      (o.realtime ? ` Realtime: ${connections.joined} of ${connections.requested} connections joined; ${relayed} event messages followed by every team screen.` : " Realtime off: projectors re-read every 10 s."),
    ...(o.judgeLoop ? [`Judge loop: ${rpcStats.judgeTurns} turns, ${rpcStats.judgeDone} runs done${rpcStats.judgeErrors.length ? `, stopped: ${rpcStats.judgeErrors.slice(0, 3).join("; ")}` : ""}.`] : []),
    ...(errorRows.length ? ["", `Failures: ${errorRows.join(", ")}.`] : []),
    ...(failures.length ? [`Sign-in failures: ${failures.slice(0, 5).join("; ")}.`] : []),
  ].join("\n");
  return report([row], { title: `App load test: ${event.name}`, details });
}

/** The logins of the projectors and consoles: the staff file (default out/<slug>-staff-logins.txt) or derived ones. */
function staffLogins(o: AppLoadOptions, domain: string, cardSecret: string): { admins: StaffLogin[]; projectors: StaffLogin[] } {
  const file = o.staffFile ?? `out/${o.slug}-staff-logins.txt`;
  let logins: StaffLogin[];
  if (existsSync(file)) logins = parseStaffLogins(readFileSync(file, "utf8"));
  else if (o.staffFile) throw new Error(`no staff logins file ${file}`);
  else logins = loadStaff(o.slug, domain, o.admins, o.projectors).map((s) => ({ role: s.role, email: s.email, password: staffPassword(cardSecret, s.email) }));
  const of = (roles: string[]) => logins.filter((l) => roles.includes(l.role));
  const organisers = of(["ORGANISER"]);
  const displays = of(["DISPLAY"]).length ? of(["DISPLAY"]) : organisers;
  if (o.admins && !organisers.length) throw new Error(`${file}: no ORGANISER login for the consoles`);
  if (o.projectors && !displays.length) throw new Error(`${file}: no DISPLAY login for the projectors`);
  // More screens than logins: a login opens several (each signs in on its own, as a second device would).
  const take = (xs: StaffLogin[], n: number) => Array.from({ length: n }, (_, i) => xs[i % xs.length]!);
  if (o.admins > organisers.length || o.projectors > displays.length) say(`Fewer staff logins than screens in ${file}: some logins open two screens.`);
  return { admins: take(organisers, o.admins), projectors: take(displays, o.projectors) };
}

/** Check-in: every phone signs in itself within the spread, then loads its home page once. */
async function rush(o: AppLoadOptions, slug: string, teams: { code: string; track: Track }[], signInTeam: (t: { code: string }) => Promise<Session>): Promise<number> {
  const signIns: number[] = [];
  const homes: number[] = [];
  const refused: Record<string, number> = {};
  const spreadMs = o.rushMs!;
  const t0 = Date.now();
  let last = 0;
  const phone = async (t: { code: string }, n: number) => {
    await sleep(Math.random() * spreadMs);
    const started = Date.now();
    let s: Session;
    try {
      s = await signInTeam(t);
      signIns.push(Date.now() - started);
    } catch (e) {
      const k = `sign-in ${(e as { status?: number }).status ?? (e as Error).name}`;
      refused[k] = (refused[k] ?? 0) + 1;
      return;
    }
    const p0 = Date.now();
    try {
      const r = await fetch(o.bases[n % o.bases.length] + "/team", { headers: { cookie: s.cookie(), "user-agent": "app-load-test" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      const html = await r.text();
      if (r.status === 200 && html.includes("<title>Home")) homes.push(Date.now() - p0);
      else refused[`home ${r.status}`] = (refused[`home ${r.status}`] ?? 0) + 1;
    } catch (e) {
      refused[`home ${(e as Error).name}`] = (refused[`home ${(e as Error).name}`] ?? 0) + 1;
    }
    last = Math.max(last, Date.now());
  };
  say(`${teams.length * o.screens} phones sign in within ${spreadMs / 1000} s…`);
  await Promise.all(teams.flatMap((t, i) => Array.from({ length: o.screens }, (_, n) => phone(t, i * o.screens + n))));
  const phones = teams.length * o.screens;
  const failed = Object.values(refused).reduce((a, b) => a + b, 0);
  const s = spread(signIns);
  const row: SummaryRow = {
    run: `app-load-test (check-in rush ${spreadMs / 1000} s)`,
    slug,
    screens: phones,
    connections: null,
    latencyOf: "sign-in",
    p50Ms: s.p50,
    p95Ms: s.p95,
    errors: { failed, total: phones },
    clearingMs: null,
    deliveryPct: null,
    checks: [
      signInCheck(signIns.length, phones, "phones signed in"),
      pageCheck(signIns, "sign-ins"),
      pageCheck(homes, "home pages"),
      errorCheck(failed, phones, "sign-in or home page failures"),
    ],
  };
  const h = spread(homes);
  const details = [
    `${phones} phones within ${spreadMs / 1000} s: ${signIns.length} signed in, ${homes.length} opened their home page (p50 ${h.p50 ?? "—"} ms, p95 ${h.p95 ?? "—"} ms); all done after ${((last - t0) / 1000).toFixed(1)} s.`,
    ...(failed ? [`Failures: ${Object.entries(refused).map(([k, v]) => `${k} ×${v}`).join(", ")}.`] : []),
    ...(refused["sign-in 429"] ? [`${refused["sign-in 429"]} were refused by Auth's sign-in rate limit: raise it (Supabase → Authentication → Rate Limits).`] : []),
  ].join("\n");
  return report([row], { title: `Check-in rush: ${slug}`, details });
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
