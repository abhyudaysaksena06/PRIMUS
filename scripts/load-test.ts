// The realtime load test (docs/LOAD-TEST.md): the night's live screens and every fund trading in a round's last
// minute, measured against the bot test's targets (realtime delivery at least 99%, a clearing under 5 s).
//
//   pnpm load-test [--slug load-600] [--connections 450] [--rounds 1] [--orders-per-fund 6] [--window 60] [--sample 50]
//
//   1. Signs in the present teams (checked in, when the event uses the desk) and opens --connections realtime
//      connections (default 450: Supabase Pro allows 500 connections and 500 messages a second, which leaves room for
//      the projectors and consoles), each on the event's private channel, its team's channel and its squad's chat.
//   2. Records every event broadcast each connection hears, from the moment all have joined: a broadcast's delivery is
//      the share of the connected screens that heard it, its latency how long after its "at" (the server's time) and
//      after the first screen each one heard it. Also the busiest second (deliveries a second, against Pro's 500).
//   3. For each of --rounds trading rounds: waits for an open round with --window seconds or less to go, every present
//      fund places its orders at random moments in that window while the other teams re-read their pages every 5 s,
//      then measures the clearing (close → CLEARED) and how fast a sample of screens reads the new prices.
//
// Run it while the bots play the event (pnpm rehearse --autopilot). Refuses a live event. Writes out/load-<timestamp>.md
// and exits 1 when a target is missed.

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { parseArgs, required } from "./lib/args";
import { call, pool, signInTeam, sleep, snapshot, type Env, type TeamLogin } from "./lib/bot-runner";
import { rng, roundOrders } from "./lib/bots";
import { REALTIME_USAGE, UsageError, realtimeOptions, type RealtimeOptions } from "./lib/load-args";
import { admittedTeams, interleaveTracks, loadEvent, loadTeams } from "./lib/load-event";
import { Deliveries } from "./lib/load-realtime";
import { TARGETS, clearingCheck, deliveryCheck, errorCheck, joinCheck, report, spread, type SummaryRow } from "./lib/load-summary";

const time = () => new Date().toISOString().slice(11, 19);
const say = (m: string) => console.log(`${time()}  ${m}`);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(REALTIME_USAGE);
    return 0;
  }
  let o: RealtimeOptions;
  try {
    o = realtimeOptions(args);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.log(`${e.message}\n\n${REALTIME_USAGE}`);
    return 1;
  }
  const env: Env = {
    url: required("SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    cardSecret: required("CARD_SECRET"),
    emailDomain: required("TEAM_EMAIL_DOMAIN"),
  };
  const admin = createClient(env.url, required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const event = await loadEvent(admin, o.slug); // refuses a live event
  const present = admittedTeams(await loadTeams(admin, event.id), event.desk_check_in);
  // As many teams as connections (a team with two connections is a second phone), in turn from each track.
  const teams = interleaveTracks(present, Math.min(present.length, o.connections)) as TeamLogin[];
  if (!teams.length) throw new Error(`no team of ${o.slug} can sign in (none checked in?)`);

  // 1. Sign-ins.
  let t0 = Date.now();
  const failedSignIns: string[] = [];
  const signed = await pool(teams, 10, async (t) => {
    try {
      return await signInTeam(env, o.slug, t.code);
    } catch (e) {
      failedSignIns.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  });
  const pairs = teams.map((t, i) => ({ t, sb: signed[i] })).filter((x): x is { t: TeamLogin; sb: SupabaseClient } => x.sb !== null);
  say(`${pairs.length} of ${teams.length} teams signed in in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const tokens = await Promise.all(pairs.map(async (p) => (await p.sb.auth.getSession()).data.session!.access_token));

  // The server's clock: offset = server − local, from the quickest of a few round trips.
  let offset = 0;
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const a = Date.now();
    const { data } = await admin.rpc("server_time");
    const b = Date.now();
    if (b - a < best) {
      best = b - a;
      offset = Date.parse(data as string) - (a + b) / 2;
    }
  }
  const serverNow = () => Date.now() + offset;

  // 2. Connections: each its own socket (a phone), on the event's channel, its team's and its squad's chat.
  const deliveries = new Deliveries();
  const joinFailures: Record<string, number> = {};
  const extra = { team: { ok: 0, failed: 0 }, squad: { ok: 0, failed: 0 } };
  const sockets: SupabaseClient[] = [];
  /** Joins a channel; once joined, a later drop is reported to onDrop (a channel is subscribed only once). */
  const join = (ch: RealtimeChannel, onFail?: (why: string) => void, onDrop?: () => void) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        onFail?.("TIMED_OUT (30 s)");
        resolve(false);
      }, 30_000);
      ch.subscribe((st, err) => {
        if (settled) {
          if (st !== "SUBSCRIBED") onDrop?.();
          return;
        }
        if (st === "SUBSCRIBED") {
          settled = true;
          clearTimeout(timer);
          resolve(true);
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
          settled = true;
          clearTimeout(timer);
          onFail?.(`${st}${err ? `: ${err.message}` : ""}`.slice(0, 120));
          resolve(false);
        }
      });
    });
  t0 = Date.now();
  const screenSb: SupabaseClient[] = [];
  const joined = await pool(Array.from({ length: o.connections }, (_, i) => i), 25, async (i) => {
    const { t } = pairs[i % pairs.length]!;
    const token = tokens[i % pairs.length]!;
    const sb = createClient(env.url, env.anonKey, { accessToken: async () => token });
    sockets.push(sb);
    await sb.realtime.setAuth(token);
    const ch = sb.channel(`event:${event.id}`, { config: { private: true } });
    ch.on("broadcast", { event: "*" }, (msg) => deliveries.heard(i, msg.event, (msg.payload ?? {}) as Record<string, unknown>, serverNow()));
    const ok = await join(
      ch,
      (why) => void (joinFailures[why] = (joinFailures[why] ?? 0) + 1),
      () => deliveries.dropped(i, serverNow()),
    );
    if (!ok) return false;
    deliveries.connected(i, serverNow());
    screenSb.push(sb);
    if (await join(sb.channel(`team:${t.id}`, { config: { private: true } }))) extra.team.ok++;
    else extra.team.failed++;
    const { data: squad } = await sb
      .from("squads")
      .select("id")
      .or(`product_team_id.eq.${t.id},consulting_team_id.eq.${t.id},finance_team_id.eq.${t.id}`)
      .maybeSingle<{ id: string }>();
    if (squad) {
      if (await join(sb.channel(`squad:${squad.id}`, { config: { private: true } }))) extra.squad.ok++;
      else extra.squad.failed++;
    }
    return true;
  });
  const joinedCount = joined.filter(Boolean).length;
  const allJoinedAt = serverNow();
  deliveries.measureFrom(allJoinedAt);
  say(
    `${joinedCount} of ${o.connections} connections joined in ${((Date.now() - t0) / 1000).toFixed(1)} s` +
      `${joinedCount < o.connections ? ` (failed: ${JSON.stringify(joinFailures)})` : ""}; team channels ${extra.team.ok} joined, ${extra.team.failed} failed; squad chats ${extra.squad.ok} joined, ${extra.squad.failed} failed`,
  );

  // 3. Rounds.
  const orderMs: number[] = [];
  const readMs: number[] = [];
  const rereadMs: number[] = [];
  const outcomes: Record<string, number> = {};
  const clearings: { round: number; ms: number }[] = [];
  let measured = 0;
  for (let k = 0; k < o.rounds; k++) {
    let round: { number: number; closes_at: string } | null = null;
    for (;;) {
      const { data } = await admin.rpc("event_status", { p_event: event.id });
      const st = data as { phase?: string; open_round: { number: number; closes_at: string } | null } | null;
      const open = st?.open_round ?? null;
      const left = open ? Date.parse(open.closes_at) - serverNow() : 0;
      if (open && left <= o.windowMs && left > 5000 && !clearings.some((c) => c.round === open.number)) {
        round = open;
        break;
      }
      if (st?.phase === "AWARDS" || st?.phase === "SETTLEMENT" || st?.phase === "APPEALS") break;
      process.stdout.write(`\r${time()}  waiting for an open round with ${o.windowMs / 1000} s or less to go (${st?.phase ?? "?"})…   `);
      await sleep(1000);
    }
    if (!round) {
      console.log(`\n${time()}  the trading is over: ${measured} round${measured === 1 ? "" : "s"} measured`);
      break;
    }
    const closesAt = Date.parse(round.closes_at);
    console.log(`\n${time()}  round ${round.number} closes in ${((closesAt - serverNow()) / 1000).toFixed(0)} s: trading`);
    const end = closesAt - 3000;
    await Promise.all(
      pairs.map(async ({ t, sb }) => {
        if (t.track === "FINANCE") {
          let s;
          try {
            s = await snapshot(sb, event.id, t);
          } catch (e) {
            const key = `read failed: ${e instanceof Error ? e.message : e}`;
            outcomes[key] = (outcomes[key] ?? 0) + 1;
            return;
          }
          const companies = s.companies.filter((c) => c.squad_id !== null && c.squad_id !== s.squad?.id);
          const orders = roundOrders(s, companies, rng(`${t.code}-${round!.number}`), o.ordersPerFund);
          const at = orders.map(() => serverNow() + Math.random() * Math.max(0, end - serverNow())).sort((a, b) => a - b);
          for (const [i, a] of orders.entries()) {
            await sleep(Math.max(0, at[i]! - serverNow()));
            const started = Date.now();
            const r = await call(sb, a.fn, a.args as Record<string, unknown>);
            orderMs.push(Date.now() - started);
            const key = r.ok ? "ok" : (r.code ?? "?");
            outcomes[key] = (outcomes[key] ?? 0) + 1;
          }
        } else {
          while (serverNow() < end) {
            const a = Date.now();
            // What every team page reads: the status, the prices, the team's own row and its "Do this now" facts.
            await Promise.all([
              sb.rpc("event_status", { p_event: event.id }),
              sb.from("companies").select("id, ticker, market_price").eq("event_id", event.id),
              sb.from("teams").select("cash_cents").eq("id", t.id),
              sb.rpc("team_plan_facts"),
            ]);
            readMs.push(Date.now() - a);
            await sleep(5000 * (0.8 + Math.random() * 0.4));
          }
        }
      }),
    );
    // The clearing, seen from the database: when the round is CLEARED (polled every 100 ms).
    let clearedAt: number | null = null;
    while (serverNow() < closesAt + 60_000) {
      const { data } = await admin.from("rounds").select("status").eq("event_id", event.id).eq("number", round.number).single();
      if (data?.status === "CLEARED") {
        clearedAt = serverNow();
        break;
      }
      await sleep(100);
    }
    if (clearedAt === null) {
      say(`round ${round.number} did not clear within 60 s of its close`);
      clearings.push({ round: round.number, ms: 60_000 });
      continue;
    }
    clearings.push({ round: round.number, ms: Math.round(clearedAt - closesAt) });
    measured++;
    // A sample of screens reads the new prices.
    await sleep(1000);
    await pool(screenSb.slice(0, o.sample), 25, async (sb) => {
      const a = Date.now();
      await Promise.all([
        sb.rpc("event_status", { p_event: event.id }),
        sb.from("companies").select("id, ticker, market_price").eq("event_id", event.id),
        sb.rpc("team_plan_facts"),
      ]);
      rereadMs.push(Date.now() - a);
    });
    say(`round ${round.number}: ${orderMs.length} orders so far (${JSON.stringify(outcomes)}); cleared ${clearings.at(-1)!.ms} ms after its close`);
  }

  // Stragglers: give the last broadcasts 10 s to arrive, then count.
  await sleep(10_000);
  const d = deliveries.result(serverNow() - 10_000);
  for (const sb of sockets) void sb.removeAllChannels();

  const orderErrors = Object.entries(outcomes).filter(([k]) => k === "ERROR" || k.startsWith("read failed")).reduce((a, [, v]) => a + v, 0);
  const orders = spread(orderMs);
  const reread = spread(rereadMs);
  const row: SummaryRow = {
    run: "load-test (realtime)",
    slug: o.slug,
    screens: pairs.length,
    connections: { joined: joinedCount, requested: o.connections },
    latencyOf: "delivery after sent",
    p50Ms: d.sinceSent.p50,
    p95Ms: d.sinceSent.p95,
    errors: { failed: orderErrors + (o.connections - joinedCount), total: orderMs.length + o.connections },
    clearingMs: clearings.length ? Math.max(...clearings.map((c) => c.ms)) : null,
    deliveryPct: d.expected ? (d.delivered / d.expected) * 100 : null,
    checks: [
      joinCheck(joinedCount, o.connections),
      deliveryCheck(d.delivered, d.expected),
      clearingCheck(clearings.map((c) => c.ms)),
      errorCheck(orderErrors, orderMs.length, "order errors"),
    ],
  };
  const details = [
    `${pairs.length} of ${teams.length} present teams signed in${failedSignIns.length ? ` (failed: ${failedSignIns.slice(0, 3).join("; ")})` : ""}; ${joinedCount} of ${o.connections} connections joined` +
      `${Object.keys(joinFailures).length ? ` (failures: ${JSON.stringify(joinFailures)})` : ""}; team channels ${extra.team.ok}/${extra.team.ok + extra.team.failed}, squad chats ${extra.squad.ok}/${extra.squad.ok + extra.squad.failed}.`,
    `Event broadcasts measured: ${d.messages} (${d.byEvent.map(([e, n]) => `${e} ${n}`).join(", ") || "none"}); delivered ${d.delivered} of ${d.expected} expected (screens connected when each was sent).`,
    `Delivery latency after the broadcast's "at": p50 ${d.sinceSent.p50 ?? "—"} ms, p95 ${d.sinceSent.p95 ?? "—"} ms, max ${d.sinceSent.max ?? "—"} ms (includes the sending transaction's own time). After the first screen heard it: p50 ${d.spread.p50 ?? "—"} ms, p95 ${d.spread.p95 ?? "—"} ms.`,
    `Busiest second: ${d.peakPerSecond} deliveries (Pro allows ${TARGETS.proMessagesPerSecond} messages a second; above it Supabase may hold messages back).`,
    `Rounds: ${clearings.map((c) => `${c.round} cleared ${c.ms} ms after the close`).join("; ") || "none measured"}. Orders ${orderMs.length} (p50 ${orders.p50 ?? "—"} ms, p95 ${orders.p95 ?? "—"} ms): ${JSON.stringify(outcomes)}.`,
    `Page reads during trading: p95 ${spread(readMs).p95 ?? "—"} ms; a sample of ${rereadMs.length} screens re-read the prices after the clearing in p50 ${reread.p50 ?? "—"} ms, p95 ${reread.p95 ?? "—"} ms.`,
  ].join("\n");
  return report([row], { title: `Realtime load test: ${event.name}`, details });
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
