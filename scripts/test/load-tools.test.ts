import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PHASE_CODES, type Track } from "@msim/engine";
import { backoffMs, limiter, signInRetry } from "../lib/bot-runner";
import { decide, newMemory, practiceTrade, remember, rng, tickerFor, type Snapshot } from "../lib/bots";
import { UsageError, appLoadOptions, realtimeOptions, rehearseOptions } from "../lib/load-args";
import {
  admittedTeams,
  assertDisposable,
  assertRehearsal,
  compareCodes,
  interleaveTracks,
  loadStaff,
  parsePresent,
  parseStaffLogins,
  pickPresent,
  spreadEvenly,
  staffCandidates,
  staffLoginsText,
} from "../lib/load-event";
import { PageLog, adminPages, pageName } from "../lib/load-pages";
import { Deliveries, stableKey } from "../lib/load-realtime";
import {
  clearingCheck,
  deliveryCheck,
  errorCheck,
  pageCheck,
  passed,
  percentile,
  summaryFileName,
  summaryMarkdown,
  summaryTable,
  writeSummary,
  type SummaryRow,
} from "../lib/load-summary";

const cards = (track: Track, letter: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ code: `L${letter}${String(i + 1).padStart(2, "0")}`, track, checked_in_at: null as string | null, disqualified: false }));
const event600 = [...cards("PRODUCT", "P", 200), ...cards("CONSULTING", "C", 200), ...cards("FINANCE", "F", 200)];
const all = { PRODUCT: 200, CONSULTING: 200, FINANCE: 200 };

describe("the live-event guard", () => {
  test("a rehearsal passes; a live event or a missing one is refused", () => {
    expect(assertRehearsal({ is_rehearsal: true }, "load-600")).toEqual({ is_rehearsal: true });
    expect(() => assertRehearsal({ is_rehearsal: false }, "primus-2026")).toThrow(/live event/);
    expect(() => assertRehearsal({ is_rehearsal: null }, "x")).toThrow(/live event/);
    expect(() => assertRehearsal(null, "load-600")).toThrow(/no event "load-600"/);
  });
  test("purge and replace: only a rehearsal this tool made, never the demo", () => {
    expect(() => assertDisposable({ is_rehearsal: true, name: "Load test (load-600)" }, "load-600")).not.toThrow();
    expect(() => assertDisposable({ is_rehearsal: false, name: "Load test (x)" }, "x")).toThrow(/live event/);
    expect(() => assertDisposable({ is_rehearsal: true, name: "Rehearsal 1" }, "reh-1")).toThrow(/--force/);
    expect(() => assertDisposable({ is_rehearsal: true, name: "Rehearsal 1" }, "reh-1", true)).not.toThrow();
    expect(() => assertDisposable({ is_rehearsal: true, name: "Load test" }, "demo", true)).toThrow(/demo/);
  });
});

describe("rehearse options", () => {
  test("defaults: the load-600 event, playing everyone", () => {
    const o = rehearseOptions({});
    expect(o).toMatchObject({ mode: "play", slug: "load-600", autopilot: false, teams: null, present: null, intervalMs: 5000, concurrency: 64, perTrack: 200, speed: 20, prefix: "L" });
  });
  test("play with the desk and the autopilot", () => {
    const o = rehearseOptions({ autopilot: true, present: "400", teams: "300", except: "lp01, lc01", interval: "4000", minutes: "45" });
    expect(o).toMatchObject({ autopilot: true, present: "400", teams: 300, except: ["LP01", "LC01"], intervalMs: 4000, minutes: 45 });
  });
  test("create, check-in and purge are separate modes", () => {
    expect(rehearseOptions({ create: true, "per-track": "150", admins: "20", projectors: "10", replace: true }).mode).toBe("create");
    expect(rehearseOptions({ "check-in": true, present: "140,130,130" }).mode).toBe("check-in");
    expect(rehearseOptions({ purge: true }).mode).toBe("purge");
    expect(() => rehearseOptions({ create: true, purge: true })).toThrow(UsageError);
    expect(() => rehearseOptions({ "check-in": true })).toThrow(/needs --present/);
  });
  test("refuses bad values, unknown flags and the demo's or the live event's card letters", () => {
    expect(() => rehearseOptions({ teams: "601" })).toThrow(/between 1 and 600/);
    expect(() => rehearseOptions({ "per-track": "201" })).toThrow(/between 3 and 200/);
    expect(() => rehearseOptions({ present: true })).toThrow(/--present needs/);
    expect(() => rehearseOptions({ autpilot: true })).toThrow(/unknown option: --autpilot/);
    expect(() => rehearseOptions({ prefix: "X" })).toThrow(/demo/);
    expect(() => rehearseOptions({ prefix: "" })).toThrow(UsageError);
    expect(() => rehearseOptions({ slug: "Live 2026" })).toThrow(/--slug/);
    expect(() => rehearseOptions({ "starts-at": "soon" })).toThrow(/ISO/);
    expect(() => rehearseOptions({ autopilot: "yes" })).toThrow(/takes no value/);
  });
});

describe("app-load-test and load-test options", () => {
  test("one screen per team by default; projectors and consoles on request", () => {
    const o = appLoadOptions({ base: "https://primus.example.org/", teams: "400", projectors: "10", admins: "20", duration: "900" });
    expect(o).toMatchObject({ bases: ["https://primus.example.org"], slug: "load-600", teams: 400, screens: 1, projectors: 10, admins: 20, durationMs: 900_000, realtime: true, judgeLoop: false, ping: true });
    expect(appLoadOptions({ base: "http://a:3000,http://b:3000", burst: "1.2", "no-realtime": true }).burstMs).toBe(1200);
    expect(appLoadOptions({ base: "http://a:3000", "judge-loop": true }).judgeLoop).toBe(true);
  });
  test("app-load-test refusals", () => {
    expect(() => appLoadOptions({})).toThrow(/--base is required/);
    expect(() => appLoadOptions({ base: "primus.example.org" })).toThrow(/http/);
    expect(() => appLoadOptions({ base: "http://a", burst: "1", rush: "60" })).toThrow(/not both/);
    expect(() => appLoadOptions({ base: "http://a", projector: "10" })).toThrow(/unknown option: --projector/);
    expect(() => appLoadOptions({ base: "http://a", admins: "51" })).toThrow(/between 0 and 50/);
  });
  test("load-test: 450 connections by default (Supabase Pro allows 500)", () => {
    expect(realtimeOptions({})).toEqual({ slug: "load-600", connections: 450, ordersPerFund: 6, windowMs: 60_000, sample: 50, rounds: 1 });
    expect(realtimeOptions({ connections: "480", rounds: "3" })).toMatchObject({ connections: 480, rounds: 3 });
    expect(() => realtimeOptions({ connections: "0" })).toThrow(UsageError);
  });
});

describe("the desk: who is present", () => {
  test("a total is spread evenly; the remainder goes to Product, then Consulting", () => {
    expect(spreadEvenly(400)).toEqual({ PRODUCT: 134, CONSULTING: 133, FINANCE: 133 });
    expect(spreadEvenly(401)).toEqual({ PRODUCT: 134, CONSULTING: 134, FINANCE: 133 });
    expect(spreadEvenly(600)).toEqual({ PRODUCT: 200, CONSULTING: 200, FINANCE: 200 });
    expect(parsePresent("400", all)).toEqual({ PRODUCT: 134, CONSULTING: 133, FINANCE: 133 });
    expect(parsePresent("140,130,130", all)).toEqual({ PRODUCT: 140, CONSULTING: 130, FINANCE: 130 });
    expect(parsePresent(undefined, all)).toBeNull();
  });
  test("refuses more than the cards, an empty track and nonsense", () => {
    expect(() => parsePresent("700", all)).toThrow(/only 200/);
    expect(() => parsePresent("0,200,200", all)).toThrow(/at least one product/);
    expect(() => parsePresent("4OO", all)).toThrow(/whole number/);
    expect(() => parsePresent("1,2", all)).toThrow(/three counts/);
    expect(() => parsePresent(true, all)).toThrow(/needs/);
  });
  test("the lowest cards of each track check in, in number order (P9 before P10 before P100)", () => {
    expect(compareCodes("LP9", "LP10")).toBeLessThan(0);
    expect(compareCodes("LP100", "LP20")).toBeGreaterThan(0);
    expect(compareCodes("LC99", "LP01")).toBeLessThan(0);
    const shuffled = [...event600].sort(() => Math.random() - 0.5);
    const present = pickPresent(shuffled, { PRODUCT: 134, CONSULTING: 133, FINANCE: 133 });
    expect(present).toHaveLength(400);
    expect(present.filter((t) => t.track === "PRODUCT").map((t) => t.code).slice(-2)).toEqual(["LP133", "LP134"]);
    expect(present.filter((t) => t.track === "FINANCE").at(-1)!.code).toBe("LF133");
  });
  test("only admitted teams play when the desk is on; screens are taken in turn from each track", () => {
    const teams = event600.map((t, i) => ({ ...t, checked_in_at: i % 2 ? "2026-11-20T10:00:00Z" : null, disqualified: i === 1 }));
    expect(admittedTeams(teams, false)).toHaveLength(599);
    expect(admittedTeams(teams, true)).toHaveLength(299);
    expect(interleaveTracks(event600, 5).map((t) => t.code)).toEqual(["LP01", "LC01", "LF01", "LP02", "LC02"]);
    expect(interleaveTracks(event600.slice(0, 3), 10)).toHaveLength(3);
  });
});

describe("the load event's staff logins", () => {
  test("consoles and projectors with exact addresses; purge looks for exactly those", () => {
    const staff = loadStaff("load-600", "Teams.Example.org", 20, 10);
    expect(staff).toHaveLength(30);
    expect(staff[0]).toEqual({ email: "load-600-admin-01@teams.example.org", role: "ORGANISER", name: "Load test console 01" });
    expect(staff[29]!.email).toBe("load-600-projector-10@teams.example.org");
    expect(staff.filter((s) => s.role === "DISPLAY")).toHaveLength(10);
    const candidates = staffCandidates("load-600", "teams.example.org");
    expect(candidates).toHaveLength(198);
    expect(staff.every((s) => candidates.includes(s.email))).toBe(true);
    expect(candidates.some((e) => e.startsWith("lp01@"))).toBe(false);
    expect(() => loadStaff("x", "d.org", 100, 0)).toThrow(/at most 99/);
  });
  test("the logins file reads back what it wrote (the format pnpm seed writes)", () => {
    const logins = [{ role: "ORGANISER", email: "a@x.org", password: "AAAA-BBBB-CCCC" }, { role: "DISPLAY", email: "b@x.org", password: "DDDD-EEEE-FFFF" }];
    expect(parseStaffLogins(staffLoginsText(logins))).toEqual(logins);
    expect(parseStaffLogins("# staff\nORGANISER  lead@x.org  PASS-WORD-1234\n\n")).toHaveLength(1);
    expect(() => parseStaffLogins("ORGANISER lead@x.org")).toThrow(/line 1/);
  });
});

const row = (extra: Partial<SummaryRow> = {}): SummaryRow => ({
  run: "app-load-test",
  slug: "load-600",
  screens: 430,
  connections: { joined: 30, requested: 30 },
  latencyOf: "page",
  p50Ms: 310,
  p95Ms: 1480,
  errors: { failed: 3, total: 1000 },
  clearingMs: null,
  deliveryPct: null,
  checks: [pageCheck([300, 400, 1500]), errorCheck(3, 1000)],
  ...extra,
});

describe("the summary", () => {
  test("percentiles by nearest rank", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 100)).toBe(100);
    expect(percentile([], 95)).toBeNull();
  });
  test("the checks against the bot test's targets", () => {
    expect(pageCheck([...Array(95).fill(500), ...Array(5).fill(2500)]).ok).toBe(true);
    expect(pageCheck([...Array(94).fill(500), ...Array(6).fill(2500)]).ok).toBe(false);
    expect(pageCheck([]).ok).toBe(false);
    expect(errorCheck(9, 1000).ok).toBe(true);
    expect(errorCheck(10, 1000).ok).toBe(false);
    expect(errorCheck(0, 0).ok).toBe(false);
    expect(clearingCheck([1200, 4999]).ok).toBe(true);
    expect(clearingCheck([5000]).ok).toBe(false);
    expect(clearingCheck([]).ok).toBe(false);
    expect(deliveryCheck(990, 1000).ok).toBe(true);
    expect(deliveryCheck(989, 1000).ok).toBe(false);
    expect(deliveryCheck(0, 0).ok).toBe(false);
  });
  test("one table: screens, connections, p50/p95, errors, clearing, delivery and the result", () => {
    const table = summaryTable([row(), row({ run: "load-test", connections: { joined: 450, requested: 450 }, clearingMs: 2100, deliveryPct: 99.5, checks: [deliveryCheck(995, 1000), clearingCheck([2100])] })]);
    const lines = table.split("\n");
    expect(lines[0]).toBe("| Run | Event | Screens | Connections | p50 ms | p95 ms | Errors | Clearing ms | Realtime delivery | Result |");
    expect(lines[2]).toBe("| app-load-test | load-600 | 430 | 30 of 30 | 310 (page) | 1480 (page) | 0.30% (3/1000) | — | — | PASS |");
    expect(lines[3]).toContain("| 2100 | 99.50% | PASS |");
    expect(passed(row({ checks: [errorCheck(50, 1000)] }))).toBe(false);
    expect(passed(row({ checks: [] }))).toBe(false);
  });
  test("written to out/load-<timestamp>.md, never over another run's file", () => {
    const at = new Date("2026-11-20T10:31:05.123Z");
    expect(summaryFileName(at)).toBe("load-2026-11-20T10-31-05-123Z.md");
    const dir = mkdtempSync(join(tmpdir(), "load-summary-"));
    const a = writeSummary([row()], { title: "App load test", at, dir });
    const b = writeSummary([row()], { title: "App load test", at, dir });
    expect(a).toBe(join(dir, "load-2026-11-20T10-31-05-123Z.md"));
    expect(b).toBe(join(dir, "load-2026-11-20T10-31-05-123Z-2.md"));
    const md = readFileSync(a, "utf8");
    expect(md).toContain("# App load test");
    expect(md).toContain("· PASS ·");
    expect(md).toContain("## Checks");
    expect(summaryMarkdown([row({ checks: [errorCheck(50, 100)] })], { title: "t", at, details: "x" })).toMatch(/FAIL[\s\S]*## Details\n\nx/);
  });
});

describe("realtime delivery", () => {
  test("delivery counts the screens connected when a broadcast was sent; latency from its 'at'", () => {
    const d = new Deliveries();
    for (let s = 0; s < 4; s++) d.connected(s, 1000);
    d.connected(4, 9_500); // joined just before: not expected to hear it
    d.measureFrom(2000);
    const p = { round: 3, at: new Date(9_900).toISOString() };
    d.heard(0, "round_cleared", p, 10_000);
    d.heard(1, "round_cleared", { at: p.at, round: 3 }, 10_200); // same message, keys in another order
    d.heard(1, "round_cleared", p, 10_300); // heard twice: counted once
    d.heard(2, "round_cleared", p, 10_400);
    d.heard(4, "round_cleared", p, 10_100);
    d.heard(0, "old", { at: new Date(500).toISOString() }, 1500); // before measuring
    const r = d.result(20_000);
    expect(r.messages).toBe(1);
    expect(r.expected).toBe(4);
    expect(r.delivered).toBe(3);
    expect(r.sinceSent.max).toBe(500);
    expect(r.spread.p50).toBe(200);
    expect(r.peakPerSecond).toBe(4);
    expect(r.byEvent).toEqual([["round_cleared", 1]]);
  });
  test("a screen that dropped is not expected to hear later broadcasts", () => {
    const d = new Deliveries();
    d.connected(0, 0);
    d.connected(1, 0);
    d.dropped(1, 4000);
    d.heard(0, "features", { at: new Date(5000).toISOString() }, 5000);
    expect(d.result(10_000)).toMatchObject({ expected: 1, delivered: 1 });
    expect(stableKey("e", { b: [1, { y: 1, x: 2 }], a: 1 })).toBe(stableKey("e", { a: 1, b: [1, { x: 2, y: 1 }] }));
  });
});

describe("the runner at 600 teams", () => {
  test("the limiter never runs more than its slots at once, and runs everything", async () => {
    const run = limiter(3);
    let active = 0;
    let most = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        run(async () => {
          most = Math.max(most, ++active);
          await new Promise((r) => setTimeout(r, 1 + (i % 3)));
          active--;
          done.push(i);
        }),
      ),
    );
    expect(most).toBe(3);
    expect(done).toHaveLength(20);
  });
  test("sign-ins: a wrong password fails at once; Auth's rate limit is waited out longer", () => {
    expect(signInRetry({ status: 400, message: "Invalid login credentials" }, 1)).toBe("fail");
    expect(signInRetry({ status: 429, message: "Request rate limit reached" }, 7)).toBe("retry");
    expect(signInRetry({ status: 429, message: "Request rate limit reached" }, 8)).toBe("fail");
    expect(signInRetry({ status: 500, message: "boom" }, 3)).toBe("retry");
    expect(signInRetry({ status: 500, message: "boom" }, 4)).toBe("fail");
    expect(backoffMs(1, () => 0.5)).toBe(1000);
    expect(backoffMs(10, () => 0.5)).toBe(30_000);
  });
  test("tickers stay unique for 200 squads", () => {
    const all200 = Array.from({ length: 200 }, (_, i) => tickerFor(i + 1));
    expect(new Set(all200).size).toBe(200);
  });
  test("pages are named without the slug; the log splits by screen kind", () => {
    expect(adminPages("load-600")[0]).toBe("/admin/load-600/run");
    expect(pageName("/admin/load-600/run", "load-600")).toBe("/admin/<slug>/run");
    const log = new PageLog("load-600");
    log.served("team", "/team", 200, 300);
    log.served("team", "/team", 307, 20);
    log.served("admin", "/admin/load-600/run", 200, 900);
    log.failed("projector", "/display/load-600", "TimeoutError");
    expect(log.pages).toBe(4);
    expect(log.failures).toBe(2);
    expect(log.latencies).toEqual([300, 900]);
    expect(log.byKind().team).toMatchObject({ n: 1, failed: 1 });
    expect(log.errors()).toEqual({ "307 /team": 1, "TimeoutError /display/<slug>": 1 });
  });
});

describe("practice trades (Round 1, Finance)", () => {
  const snap = (practice: Snapshot["practice"]): Snapshot => ({
    phase: "BUILD", trading: "HALTED", openRound: null, team: { id: "f1", code: "LF01", track: "FINANCE", cash_cents: 50_000_000 },
    squad: { id: "s1", number: 1, dealt_card_ids: [], chosen_card_id: null }, companyId: null, drafts: {}, submitted: {}, fee: null, deal: null,
    calls: [], companies: [], holdings: [], pendingOrders: [], ipoBids: 0, flashPublished: false, format: "PRIMUS", primus: null, practice,
  });
  test("a fund buys while the market is open, sells what it holds, and stops after six", () => {
    const m = newMemory();
    m.done.add("chat-hello");
    expect(decide(snap(null), m, rng("x"), 0, PHASE_CODES)).toEqual([]);
    expect(decide(snap({ open: false, tickers: ["t1"], positions: {} }), m, rng("x"), 0, PHASE_CODES)).toEqual([]);
    const open = snap({ open: true, tickers: ["t1", "t2"], positions: {} });
    const [a] = decide(open, m, rng("x"), 0, PHASE_CODES);
    expect(a).toMatchObject({ fn: "practice_trade", key: "practice-0", args: { p_type: "BUY" } });
    expect((a!.args as { p_qty: number }).p_qty % 10).toBe(0);
    remember(m, a!, { ok: true }, 0, open);
    expect(m.practiceTrades).toBe(1);
    const sells = Array.from({ length: 30 }, (_, i) => practiceTrade(snap({ open: true, tickers: ["t1"], positions: { t1: 120 } }), m, rng(`s${i}`)))
      .filter((x) => (x?.args as { p_type?: string } | undefined)?.p_type === "SELL");
    expect(sells.length).toBeGreaterThan(0);
    expect(sells.every((x) => (x!.args as { p_qty: number }).p_qty === 120)).toBe(true);
    m.practiceTrades = 6;
    expect(practiceTrade(open, m, rng("x"))).toBeNull();
  });
  test("never buys past the 4,000-share limit; a closed market is 'not now'", () => {
    const m = newMemory();
    expect(practiceTrade(snap({ open: true, tickers: ["t1"], positions: { t1: 4000 } }), m, () => 0.9)).toBeNull();
    const s = snap({ open: true, tickers: ["t1"], positions: {} });
    const a = practiceTrade(s, m, rng("y"))!;
    remember(m, a, { ok: false, code: "PRACTICE_CLOSED" }, 1000, s);
    expect(m.done.has(a.key)).toBe(false);
    expect(m.wait.get(a.key)).toBe(16_000);
  });
});
