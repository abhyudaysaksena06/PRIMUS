// The throwaway rehearsal event of the bot test (docs/LOAD-TEST.md): the live-event guard every load tool runs first,
// the teams in card order, who is present (the registration desk's check-in, simulated), and creating and purging the
// event with its logins. Used by pnpm rehearse, pnpm app-load-test and pnpm load-test only.
//
// Everything here refuses a live event. The event is made with its own code letter (default L: LP01–LP200), so its
// cards never collide with the live event's (P01…) or the demo's (XP01…): team codes are unique across the database,
// and a rehearsal seeded with the demo's X prefix would reset the demo's passwords before failing.

import { readFileSync } from "node:fs";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { TRACKS, crisisCardsFromCsv, problemCardsFromCsv, type Track } from "@msim/engine";
import { parseStatements } from "../../apps/web/lib/admin/content";
import { derivePassword } from "./credentials";
import { buildSeedPlan, type StaffRow } from "./seed-plan";
import { seedWithLogins } from "./seed-run";

/** The bot test's event: a throwaway rehearsal, purged after the test. */
export const DEFAULT_SLUG = "load-600";
/** The code letter of the load event's cards (LP01, LC01, LF01, …). */
export const DEFAULT_PREFIX = "L";
/** The load event's name starts with this; --purge and --replace touch only such events (unless --force). */
export const NAME_MARK = "Load test";
/** At most this many consoles and projectors of each kind are made (and looked for when purging). */
export const MAX_STAFF = 99;

export interface LoadEvent {
  id: string;
  slug: string;
  name: string;
  is_rehearsal: boolean;
  current_phase: string;
  drawn_at: string | null;
  desk_check_in: boolean;
  format: string | null;
}

export interface LoadTeam {
  id: string;
  code: string;
  track: Track;
  checked_in_at: string | null;
  disqualified: boolean;
}

export type PerTrack = Record<Track, number>;

// ───────────────────────────── The guard ─────────────────────────────

/** Every load tool's first step: the event exists and is a rehearsal. A live event is refused, whatever was asked. */
export function assertRehearsal<T extends { is_rehearsal?: boolean | null }>(event: T | null | undefined, slug: string): T {
  if (!event) throw new Error(`no event "${slug}" (create it first: pnpm rehearse --create --slug ${slug})`);
  if (event.is_rehearsal !== true) throw new Error(`"${slug}" is a live event: the bots and the load tests run on rehearsal events only`);
  return event;
}

/** Purging or replacing: a rehearsal, and one this tool made (its name), unless forced. The demo is never touched. */
export function assertDisposable(event: { is_rehearsal?: boolean | null; name?: string | null; slug?: string | null }, slug: string, force = false): void {
  assertRehearsal(event, slug);
  if (slug === "demo") throw new Error(`"demo" is the demo event: the load tools never purge or replace it`);
  if (!force && !(event.name ?? "").startsWith(NAME_MARK)) {
    throw new Error(`"${slug}" was not made by pnpm rehearse --create (its name does not start with "${NAME_MARK}"): add --force to purge or replace it anyway`);
  }
}

// ───────────────────────────── Cards, in the desk's order ─────────────────────────────

/** A team code's letters and number: LP007 → { letters: "LP", number: 7 }. */
export function splitCode(code: string): { letters: string; number: number } {
  const m = /^([A-Z]*)(\d+)$/.exec(code.trim().toUpperCase());
  return m ? { letters: m[1]!, number: Number(m[2]) } : { letters: code, number: 0 };
}

/** Card order: by letters, then by number (P9 before P10 before P100; text order would put P100 before P2). */
export function compareCodes(a: string, b: string): number {
  const x = splitCode(a);
  const y = splitCode(b);
  if (x.letters !== y.letters) return x.letters < y.letters ? -1 : 1;
  return x.number - y.number;
}

export const byCode = <T extends { code: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => compareCodes(a.code, b.code));

export function countByTrack(teams: readonly { track: Track }[]): PerTrack {
  const out: PerTrack = { PRODUCT: 0, CONSULTING: 0, FINANCE: 0 };
  for (const t of teams) out[t.track]++;
  return out;
}

/** n teams over the three tracks as evenly as can be; the remainder goes to Product, then Consulting. */
export function spreadEvenly(n: number): PerTrack {
  const base = Math.floor(n / 3);
  const rest = n - base * 3;
  return { PRODUCT: base + (rest > 0 ? 1 : 0), CONSULTING: base + (rest > 1 ? 1 : 0), FINANCE: base };
}

const wholeNumber = (raw: string, what: string): number => {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${what}: "${raw}" is not a whole number`);
  return Number(raw.trim());
};

/**
 * --present: how many teams the desk checks in before the draw. A total (400: spread evenly, 134/133/133) or one count
 * per track in the order Product,Consulting,Finance (140,130,130). Undefined: everyone (no check-in simulated).
 */
export function parsePresent(raw: string | true | undefined, available: PerTrack): PerTrack | null {
  if (raw === undefined) return null;
  if (raw === true) throw new Error("--present needs the teams at the desk: a total (400) or Product,Consulting,Finance (134,133,133)");
  const parts = raw.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  let counts: PerTrack;
  if (parts.length === 1) counts = spreadEvenly(wholeNumber(parts[0]!, "--present"));
  else if (parts.length === 3) {
    counts = { PRODUCT: wholeNumber(parts[0]!, "--present"), CONSULTING: wholeNumber(parts[1]!, "--present"), FINANCE: wholeNumber(parts[2]!, "--present") };
  } else throw new Error(`--present ${raw}: give a total (400) or three counts, Product,Consulting,Finance (134,133,133)`);
  for (const track of TRACKS) {
    if (counts[track] < 1) throw new Error(`--present ${raw}: at least one ${track.toLowerCase()} team must check in`);
    if (counts[track] > available[track]) throw new Error(`--present ${raw}: the event has only ${available[track]} ${track.toLowerCase()} cards`);
  }
  return counts;
}

/** The teams the desk checks in: the lowest card numbers of each track (the desk hands cards out in order). */
export function pickPresent<T extends { code: string; track: Track }>(teams: readonly T[], counts: PerTrack): T[] {
  return TRACKS.flatMap((track) => byCode(teams.filter((t) => t.track === track)).slice(0, counts[track]));
}

/** The teams that can play: not disqualified and, when the event uses the desk, checked in. */
export function admittedTeams<T extends { checked_in_at?: string | null; disqualified?: boolean | null }>(teams: readonly T[], deskCheckIn: boolean): T[] {
  return teams.filter((t) => !t.disqualified && (!deskCheckIn || !!t.checked_in_at));
}

/** The first n teams taken in turn from each track (P1, C1, F1, P2, …), so a smaller run still covers all three. */
export function interleaveTracks<T extends { code: string; track: Track }>(teams: readonly T[], n = teams.length): T[] {
  const lists = TRACKS.map((track) => byCode(teams.filter((t) => t.track === track)));
  const out: T[] = [];
  for (let i = 0; out.length < n && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < n) out.push(l[i]!);
  }
  return out;
}

// ───────────────────────────── Staff logins of the load event ─────────────────────────────

export interface StaffLogin {
  role: string;
  email: string;
  password: string;
}

const two = (i: number) => String(i).padStart(2, "0");

/** The load event's own consoles (organisers) and projectors: <slug>-admin-01@<domain>, <slug>-projector-01@<domain>. */
export function loadStaff(slug: string, domain: string, admins: number, projectors: number): StaffRow[] {
  if (admins > MAX_STAFF || projectors > MAX_STAFF) throw new Error(`at most ${MAX_STAFF} consoles and ${MAX_STAFF} projectors`);
  const d = domain.trim().toLowerCase();
  return [
    ...Array.from({ length: admins }, (_, i): StaffRow => ({ email: `${slug}-admin-${two(i + 1)}@${d}`, role: "ORGANISER", name: `${NAME_MARK} console ${two(i + 1)}` })),
    ...Array.from({ length: projectors }, (_, i): StaffRow => ({ email: `${slug}-projector-${two(i + 1)}@${d}`, role: "DISPLAY", name: `${NAME_MARK} projector ${two(i + 1)}` })),
  ];
}

/** Every email loadStaff could have made for this slug: what --purge looks for (exact addresses, never a pattern). */
export function staffCandidates(slug: string, domain: string): string[] {
  return loadStaff(slug, domain, MAX_STAFF, MAX_STAFF).map((s) => s.email);
}

/** Staff passwords are derived as pnpm seed derives them: HMAC(CARD_SECRET, "staff:<email>"). */
export const staffPassword = (cardSecret: string, email: string) => derivePassword(cardSecret, "staff", email.trim().toLowerCase());

/** The staff logins file, in the format pnpm seed writes (out/<slug>-staff-logins.txt): "ROLE email  password". */
export function staffLoginsText(logins: readonly StaffLogin[]): string {
  return logins.map((s) => `${s.role.padEnd(9)} ${s.email}  ${s.password}`).join("\n") + "\n";
}

export function parseStaffLogins(text: string): StaffLogin[] {
  const out: StaffLogin[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [role, email, password, ...rest] = line.split(/\s+/);
    if (!role || !email?.includes("@") || !password || rest.length) throw new Error(`staff logins line ${i + 1}: expected "ROLE email password"`);
    out.push({ role: role.toUpperCase(), email: email.toLowerCase(), password });
  }
  return out;
}

// ───────────────────────────── Reading the event (service role) ─────────────────────────────

type Rpc = { ok: boolean; code?: string; message?: string; [k: string]: unknown };

async function rpc(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, code: "ERROR", message: error.message };
  return (data ?? { ok: false, code: "EMPTY" }) as Rpc;
}

async function inPool<T>(items: readonly T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await fn(items[i]!);
  }));
}

/** The event (refused unless it is a rehearsal). */
export async function loadEvent(admin: SupabaseClient, slug: string): Promise<LoadEvent> {
  const { data, error } = await admin
    .from("events")
    .select("id, slug, name, is_rehearsal, current_phase, drawn_at, desk_check_in, format")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`could not read event "${slug}": ${error.message}`);
  return assertRehearsal(data as LoadEvent | null, slug);
}

/** Every team of the event, in card order (read a page at a time: never cut off at 1,000 rows). */
export async function loadTeams(admin: SupabaseClient, eventId: string): Promise<LoadTeam[]> {
  const out: LoadTeam[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("teams")
      .select("id, code, track, checked_in_at, disqualified")
      .eq("event_id", eventId)
      .order("code")
      .range(from, from + 999);
    if (error) throw new Error(`could not read the teams: ${error.message}`);
    out.push(...((data ?? []) as LoadTeam[]));
    if ((data ?? []).length < 1000) return byCode(out);
  }
}

// ───────────────────────────── Check-in at the desk ─────────────────────────────

/**
 * The registration desk before the draw: switches the desk on for the event (so absent cards stay locked out) and
 * checks in the present teams with the desk's own function, as an organiser would. Re-running is safe: teams already
 * in are left as they are. After the draw nothing changes. Returns the teams that can play.
 */
export async function checkInPresent(admin: SupabaseClient, event: LoadEvent, teams: readonly LoadTeam[], counts: PerTrack, log: (s: string) => void): Promise<LoadTeam[]> {
  if (event.drawn_at) {
    log("The squads are drawn already: check-in is over; playing with the teams admitted.");
    return admittedTeams(teams, event.desk_check_in);
  }
  const present = pickPresent(teams, counts);
  const wanted = new Set(present.map((t) => t.id));
  const extra = teams.filter((t) => t.checked_in_at && !wanted.has(t.id));
  if (extra.length) log(`${extra.length} other teams are checked in already (e.g. ${extra.slice(0, 3).map((t) => t.code).join(", ")}); they stay in.`);
  if (!event.desk_check_in) {
    const r = await rpc(admin, "set_desk_check_in", { p_event: event.id, p_on: true });
    if (!r.ok) throw new Error(`could not switch the desk on: ${r.message ?? r.code}`);
    event.desk_check_in = true;
  }
  const todo = present.filter((t) => !t.checked_in_at);
  const failed: string[] = [];
  const t0 = Date.now();
  // A few at a time, as several desks would. The desk numbers walk-ins max+1, so two at the same instant can clash
  // (ROLL_TAKEN on roster_event_id_number_key): such a check-in is simply tried again.
  await inPool(todo, 4, async (t) => {
    for (let attempt = 1; ; attempt++) {
      const r = await rpc(admin, "desk_check_in", {
        p_event: event.id,
        p_track: t.track,
        p_code: t.code,
        p_name: `${NAME_MARK} team ${t.code}`,
        p_members: [{ full_name: `Bot ${t.code}` }],
      });
      if (r.ok) return;
      if (attempt >= 5 || (r.code !== "ROLL_TAKEN" && r.code !== "ERROR")) {
        failed.push(`${t.code}: ${r.code} ${r.message ?? ""}`.trim());
        return;
      }
      await new Promise((res) => setTimeout(res, 100 * attempt + Math.random() * 200));
    }
  });
  const now = await loadTeams(admin, event.id);
  const playing = admittedTeams(now, true);
  const c = countByTrack(playing);
  log(
    `Desk: ${todo.length} checked in now in ${((Date.now() - t0) / 1000).toFixed(1)} s; present: ${c.PRODUCT} Product, ${c.CONSULTING} Consulting, ` +
      `${c.FINANCE} Finance (${playing.length}); ${teams.length - playing.length} cards stay locked out.` +
      (failed.length ? ` ${failed.length} refused, e.g. ${failed.slice(0, 3).join("; ")}` : ""),
  );
  const smallest = Math.min(c.PRODUCT, c.CONSULTING, c.FINANCE);
  if (smallest !== Math.max(c.PRODUCT, c.CONSULTING, c.FINANCE)) {
    log(`Uneven tracks: ${smallest} squads can form; the desk handles the surplus before the draw (the Desk page).`);
  }
  return playing;
}

// ───────────────────────────── Create and purge ─────────────────────────────

export interface CreateOptions {
  slug: string;
  perTrack: number;
  speed: number;
  startsAt: Date;
  admins: number;
  projectors: number;
  prefix: string;
  replace: boolean;
  force: boolean;
  problems: string;
  crises: string;
  statements: string;
  cardSecret: string;
  emailDomain: string;
}

/** Team codes (of `codes`) that belong to another event than `own`. */
async function codesElsewhere(admin: SupabaseClient, codes: readonly string[], own: string | null): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < codes.length; i += 150) {
    const { data, error } = await admin.from("teams").select("code, event_id").in("code", codes.slice(i, i + 150));
    if (error) throw new Error(`could not check the team codes: ${error.message}`);
    for (const r of (data ?? []) as { code: string; event_id: string }[]) if (r.event_id !== own) out.push(r.code);
  }
  return byCode(out.map((code) => ({ code }))).map((x) => x.code);
}

/**
 * Creates the throwaway PRIMUS rehearsal (logins first, then the event in one transaction), uploads the Round 3
 * statements and returns the staff logins (to be written to out/<slug>-staff-logins.txt). Refuses a live event, an
 * event of this slug it did not make, and card codes that another event uses.
 */
export async function createLoadEvent(admin: SupabaseClient, o: CreateOptions, log: (s: string) => void): Promise<{ eventId: string; staff: StaffLogin[]; teams: number }> {
  const { data: existing, error } = await admin.from("events").select("id, slug, name, is_rehearsal").eq("slug", o.slug).maybeSingle();
  if (error) throw new Error(`could not read events: ${error.message}`);
  if (existing) {
    assertDisposable(existing, o.slug, o.force);
    if (!o.replace) throw new Error(`"${o.slug}" exists already: add --replace to purge and re-create it, or purge it with --purge`);
  }
  const read = (path: string) => readFileSync(path, "utf8");
  const staff = loadStaff(o.slug, o.emailDomain, o.admins, o.projectors);
  const plan = buildSeedPlan({
    slug: o.slug,
    name: `${NAME_MARK} (${o.slug})`,
    rehearsal: true,
    clockSpeed: o.speed,
    startsAt: o.startsAt,
    teamsPerTrack: o.perTrack,
    cardSecret: o.cardSecret,
    emailDomain: o.emailDomain,
    staff,
    problemCards: problemCardsFromCsv(read(o.problems)),
    crisisCards: crisisCardsFromCsv(read(o.crises)),
    codePrefix: o.prefix,
    format: "PRIMUS",
  });
  const clash = await codesElsewhere(admin, plan.teams.map((t) => t.code), (existing as { id: string } | null)?.id ?? null);
  if (clash.length) throw new Error(`card codes ${clash.slice(0, 4).join(", ")}${clash.length > 4 ? ` and ${clash.length - 4} more` : ""} belong to another event: choose another --prefix`);

  log(`Creating "${plan.event.name}": ${plan.teams.length} teams (${plan.teams[0]!.code}–${plan.teams.at(-1)!.code}), ${staff.length} staff logins, PRIMUS at ×${o.speed}, starts ${plan.event.starts_at}…`);
  const { eventId } = await seedWithLogins(admin, plan, { replace: !!existing });

  // The Round 3 statements, as the organisers upload them before the draw (the Content page; pnpm upload-decks).
  try {
    const parsed = parseStatements(read(o.statements));
    if (!parsed.ok) log(`Round 3 statements not uploaded (${o.statements}: ${parsed.message}); the autopilot makes some before Round 3.`);
    else {
      const r = await rpc(admin, "set_problem_statements", { p_event: eventId, p_rows: parsed.value });
      log(r.ok ? `Round 3 statements: ${parsed.value.length} uploaded from ${o.statements}.` : `Round 3 statements refused (${r.message ?? r.code}); the autopilot makes some before Round 3.`);
    }
  } catch (e) {
    log(`Round 3 statements not uploaded (${e instanceof Error ? e.message : e}); the autopilot makes some before Round 3.`);
  }
  return { eventId, staff: plan.staff.map((s) => ({ role: s.role, email: s.email, password: s.password })), teams: plan.teams.length };
}

async function allUsers(admin: SupabaseClient): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`could not list the logins: ${error.message}`);
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}

/**
 * Purges the load event (public.purge_event: the event and everything in it) and deletes its logins: the team logins
 * of its cards and the consoles and projectors made for it, found by exact address. Nothing else is touched.
 */
export async function purgeLoadEvent(admin: SupabaseClient, o: { slug: string; emailDomain: string; force: boolean }, log: (s: string) => void): Promise<{ teamLogins: number; staffLogins: number }> {
  const { data: event, error } = await admin.from("events").select("id, slug, name, is_rehearsal").eq("slug", o.slug).maybeSingle();
  if (error) throw new Error(`could not read events: ${error.message}`);
  const teamUsers: string[] = [];
  if (event) {
    assertDisposable(event, o.slug, o.force);
    const ids = (await loadTeams(admin, event.id)).map((t) => t.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: e } = await admin.from("accounts").select("user_id").in("team_id", ids.slice(i, i + 100));
      if (e) throw new Error(`could not read the event's logins: ${e.message}`);
      teamUsers.push(...((data ?? []) as { user_id: string }[]).map((a) => a.user_id));
    }
  } else log(`No event "${o.slug}": looking only for its staff logins.`);
  const candidates = new Set(staffCandidates(o.slug, o.emailDomain));
  const staffUsers = (await allUsers(admin)).filter((u) => u.email && candidates.has(u.email.toLowerCase())).map((u) => u.id);

  if (event) {
    const { error: e } = await admin.rpc("purge_event", { p_slug: o.slug });
    if (e) throw new Error(`purge_event: ${e.message}`);
    log(`Purged event "${o.slug}" and everything in it.`);
  }
  const failed: string[] = [];
  await inPool([...teamUsers, ...staffUsers], 10, async (id) => {
    const { error: e } = await admin.auth.admin.deleteUser(id);
    if (e) failed.push(e.message);
  });
  log(`Deleted ${teamUsers.length + staffUsers.length - failed.length} logins (${teamUsers.length} team, ${staffUsers.length} staff)${failed.length ? `; ${failed.length} failed: ${failed[0]}` : ""}.`);
  return { teamLogins: teamUsers.length, staffLogins: staffUsers.length };
}
