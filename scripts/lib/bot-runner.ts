// Signs teams in (with the passwords on their login cards, derived from CARD_SECRET) and plays their turns: read what
// the team can see through RLS, decide (bots.ts), call the public game functions as the team. Used by
// `pnpm rehearse` (bots playing a rehearsal night) and `pnpm load-test` (the sign-ins and connections).
//
// Sized for the bot test (docs/LOAD-TEST.md): up to 600 teams from one laptop. A turn reads only what its track needs
// in the current phase (two rounds of parallel reads), sign-ins back off when Auth's rate limit answers 429, a bot
// whose session lapses signs in again, and the caller bounds how many turns run at once (limiter).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PHASE_CODES, TRADING_PHASES, teamEmail, type PhaseCode, type SubmissionType, type Track } from "@msim/engine";
import { derivePassword } from "./credentials";
import { decide, newMemory, remember, rng, type Action, type Memory, type Snapshot } from "./bots";

export interface Env {
  url: string;
  anonKey: string;
  cardSecret: string;
  emailDomain: string;
}

export interface TeamLogin {
  id: string;
  code: string;
  track: Track;
}

const noSession = { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false };

/** Sign-ins of this process: how many worked, failed, and were refused for Auth's rate limit (429) on the way. */
export const signInCounts = { ok: 0, failed: 0, rateLimited: 0, retried: 0 };

/** Back-off before sign-in attempt `attempt + 1`: 1, 2, 4 … up to 30 s, with jitter (half to one and a half). */
export const backoffMs = (attempt: number, random = Math.random) => Math.min(30_000, 1000 * 2 ** (attempt - 1)) * (0.5 + random());

/** A wrong password never gets better by trying again; a rate limit does. */
export function signInRetry(error: { status?: number; message?: string }, attempt: number): "retry" | "fail" {
  const msg = error.message ?? "";
  if (/invalid login credentials/i.test(msg)) return "fail";
  const limited = error.status === 429 || /rate limit|too many/i.test(msg);
  return attempt < (limited ? 8 : 4) ? "retry" : "fail";
}

/** A signed-in client for one team. Retries with back-off (sign-ins are rate limited per IP: 429). */
export async function signInTeam(env: Env, slug: string, code: string): Promise<SupabaseClient> {
  const sb = createClient(env.url, env.anonKey, { auth: noSession });
  const credentials = { email: teamEmail(code, env.emailDomain), password: derivePassword(env.cardSecret, slug, code) };
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.auth.signInWithPassword(credentials);
    if (!error) {
      signInCounts.ok++;
      return sb;
    }
    if (error.status === 429 || /rate limit|too many/i.test(error.message)) signInCounts.rateLimited++;
    if (signInRetry(error, attempt) === "fail") {
      signInCounts.failed++;
      const hint = /invalid login credentials/i.test(error.message) ? " (is CARD_SECRET the one the event was created with?)" : "";
      throw new Error(`${code} could not sign in: ${error.message}${hint}`);
    }
    signInCounts.retried++;
    await sleep(backoffMs(attempt));
  }
}

/** Runs `fn` over `items` with at most `limit` at a time. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i);
    }),
  );
  return out;
}

/** At most `n` calls of run() at once; the others wait their turn in order (a finished one hands its slot on). */
export function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active < n) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A game function's result as { ok, code? }: a refusal is data; a raised error is reported as ERROR. */
export async function call(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; code?: string; message?: string; data?: unknown }> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, code: "ERROR", message: error.message };
  const d = data as { ok?: boolean; code?: string; message?: string } | null;
  return { ok: d?.ok === true, code: d?.code, message: d?.message, data };
}

/** The session has lapsed (or was never there): sign in again rather than fail every call until the end. */
export const authLapsed = (message: string) => /JWT expired|invalid JWT|PGRST30[123]|JWSError|not signed in/i.test(message);

/** What a bot keeps between turns so it does not read it again: the practice market's simulated companies. */
export interface SnapshotCache {
  practiceTickers?: string[];
}

const RESCUE: readonly PhaseCode[] = ["CRISIS", "RESCUE_1", "BREAK", "RESCUE_2"];
const MARKET_PHASES: ReadonlySet<PhaseCode> = new Set<PhaseCode>(["IPO", ...TRADING_PHASES]);

/** Everything a bot reads for one turn, through RLS as its team: only what its track needs in this phase. */
export async function snapshot(sb: SupabaseClient, eventId: string, team: TeamLogin, cache: SnapshotCache = {}): Promise<Snapshot> {
  // 1. The phase, the squad, the team's cash and its "do this now" facts.
  const [res, squad, me, facts] = await Promise.all([
    sb.rpc("event_status", { p_event: eventId }),
    sb.from("squads").select("id, number, dealt_card_ids, chosen_card_id").maybeSingle(),
    sb.from("teams").select("cash_cents").eq("id", team.id).single(),
    sb.rpc("team_plan_facts"),
  ]);
  if (res.error || !res.data) throw new Error(`event_status: ${res.error?.message ?? "no answer"}`);
  if (me.error) throw new Error(`teams: ${me.error.message}`);
  const status = res.data as { phase: PhaseCode; trading: string; open_round: { number: number } | null };
  const s: Snapshot = {
    phase: status.phase,
    trading: status.trading,
    openRound: status.open_round?.number ?? null,
    team: { id: team.id, code: team.code, track: team.track, cash_cents: Number(me.data?.cash_cents ?? 0) },
    squad: squad.data ?? null,
    companyId: null,
    drafts: {},
    submitted: {},
    fee: null,
    deal: null,
    calls: [],
    companies: [],
    holdings: [],
    pendingOrders: [],
    ipoBids: 0,
    flashPublished: false,
    format: (facts.data as { format?: "CLASSIC" | "PRIMUS" } | null)?.format ?? "CLASSIC",
    primus: (facts.data as { primus?: Snapshot["primus"] } | null)?.primus ?? null,
  };
  const p = s.phase;
  const classic = s.format !== "PRIMUS";

  // 2. The rest, in parallel. A fund reads every company only while the market needs them (the IPO and trading);
  //    everyone else reads its own squad's company.
  const reads: PromiseLike<unknown>[] = [];
  const COMPANY = "id, ticker, squad_id, ipo_price, market_price, post_crisis_price";
  const companiesRead = (async () => {
    if (team.track === "FINANCE" && MARKET_PHASES.has(p)) {
      s.companies = ((await sb.from("companies").select(COMPANY).eq("event_id", eventId)).data ?? []) as Snapshot["companies"];
    } else if (s.squad) {
      s.companies = ((await sb.from("companies").select(COMPANY).eq("squad_id", s.squad.id)).data ?? []) as Snapshot["companies"];
    }
    s.companyId = s.companies.find((c) => c.squad_id === s.squad?.id)?.id ?? null;
  })();
  reads.push(companiesRead);
  if (team.track !== "FINANCE") {
    reads.push(
      sb.from("submission_drafts").select("type, version").then(({ data }) => {
        for (const d of data ?? []) s.drafts[d.type as SubmissionType] = d.version;
      }),
      s.squad
        ? sb.from("submissions").select("type").is("superseded_at", null).eq("squad_id", s.squad.id).then(({ data }) => {
            for (const d of data ?? []) s.submitted[d.type as SubmissionType] = true;
          })
        : Promise.resolve(),
    );
    if (classic && RESCUE.includes(p)) {
      reads.push(sb.from("fees").select("version, cash_cents, shares, product_confirmed_at, consulting_confirmed_at, executed_at").maybeSingle().then(({ data }) => {
        s.fee = data ?? null;
      }));
    }
  }
  if (classic && RESCUE.includes(p)) {
    reads.push(sb.from("deals").select("version, amount_cents, price_cents, signed_product_at, signed_consulting_at, signed_finance_at, executed_at").maybeSingle().then(({ data }) => {
      s.deal = data ?? null;
    }));
  }
  if (team.track === "PRODUCT" && p === "ROUNDS_13_21") {
    reads.push(
      sb.from("bulletins").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("kind", "FLASH").not("published_at", "is", null)
        .then(({ count }) => void (s.flashPublished = (count ?? 0) > 0)),
    );
  }
  if (team.track === "CONSULTING" && classic) {
    reads.push(sb.from("calls").select("company_id, call_no, direction").then(({ data }) => void (s.calls = (data ?? []) as Snapshot["calls"])));
  }
  // PRIMUS Rounds 2 and 3: the offers to answer, the firms to hire, the draft's statements, the clients' drafts.
  const P = s.primus;
  if (!classic && P) {
    if (team.track === "PRODUCT" && s.squad) {
      const hiring = P.k !== null && P.hiring_k === P.k && !P.engagement;
      if (hiring) {
        reads.push(companiesRead.then(async () => {
          if (!s.companyId) return;
          const { data } = await sb.from("offers").select("id").eq("company_id", s.companyId).eq("status", "OPEN").eq("turn", "COMPANY");
          s.offersToAnswer = data ?? [];
        }));
      }
      // The firm list (every firm's value and asking fee) only when this company is about to make an offer.
      if (hiring && (P.offers_waiting ?? 0) === 0 && (P.offers_my_turn ?? 0) === 0) {
        reads.push(
          Promise.all([sb.rpc("firm_values", { p_event: eventId }), sb.from("firm_profiles").select("team_id, asking_cents").eq("event_id", eventId)]).then(([fv, prof]) => {
            const asking = new Map(((prof.data ?? []) as { team_id: string; asking_cents: number }[]).map((x) => [x.team_id, Number(x.asking_cents)]));
            s.firms = ((fv.data ?? []) as { team_id: string }[]).map((f) => ({ id: f.team_id, asking: asking.get(f.team_id) ?? 0 }));
          }),
        );
      }
      // The draft's statements only on this company's turn to pick.
      if (p === "SATURATION" && P.draft?.my_turn) {
        reads.push(
          (async () => {
            const [st, picks, card] = await Promise.all([
              sb.from("problem_statements").select("id, cap, sector").eq("event_id", eventId),
              sb.from("draft_picks").select("statement_id").eq("event_id", eventId),
              s.squad?.chosen_card_id ? sb.from("problem_cards").select("sector").eq("id", s.squad.chosen_card_id).maybeSingle() : Promise.resolve({ data: null }),
            ]);
            const norm = (x: string | null | undefined) => (x ?? "").trim().toLowerCase();
            const mySector = norm((card.data as { sector?: string } | null)?.sector);
            const rows = (st.data ?? []) as { id: string; cap: number; sector: string | null }[];
            const sectored = rows.some((x) => x.sector);
            const taken = new Map<string, number>();
            for (const pk of (picks.data ?? []) as { statement_id: string | null }[]) if (pk.statement_id) taken.set(pk.statement_id, (taken.get(pk.statement_id) ?? 0) + 1);
            s.statements = rows.filter((x) => !sectored || norm(x.sector) === mySector).map((x) => ({ id: x.id, cap: x.cap, taken: taken.get(x.id) ?? 0 }));
          })(),
        );
      }
    }
    if (team.track === "CONSULTING") {
      reads.push(sb.from("offers").select("id").eq("firm_team_id", team.id).eq("status", "OPEN").eq("turn", "FIRM").then(({ data }) => void (s.offersToAnswer = data ?? [])));
      const clients = (P.clients ?? []).map((c) => c.company_id);
      if (clients.length && P.k !== null && P.work_open) {
        const type = P.k === 5 ? "ADVICE_5" : `ADVICE_${P.k}`;
        reads.push(
          sb.from("submission_drafts").select("company_id, version").in("company_id", clients).eq("type", type).then(({ data }) => {
            s.clientDrafts = Object.fromEntries(((data ?? []) as { company_id: string; version: number }[]).map((d) => [d.company_id, d.version]));
          }),
        );
      }
    }
  }
  if (team.track === "FINANCE") {
    if (MARKET_PHASES.has(p) || RESCUE.includes(p)) {
      reads.push(
        sb.from("holdings").select("company_id, lot, qty").eq("team_id", team.id).then(({ data }) => void (s.holdings = (data ?? []) as Snapshot["holdings"])),
        sb.from("orders").select("company_id, type, qty").eq("team_id", team.id).eq("status", "PENDING").then(({ data }) => void (s.pendingOrders = data ?? [])),
      );
    }
    if (p === "IPO") {
      reads.push(sb.from("ipo_bids").select("id", { count: "exact", head: true }).eq("team_id", team.id).then(({ count }) => void (s.ipoBids = count ?? 0)));
    }
    // PRIMUS Round 1: the practice market, once it is prepared (its simulated companies are read once and kept).
    if (!classic && p === "BUILD") reads.push(practiceView(sb, eventId, team.id, cache).then((v) => void (s.practice = v)));
  }
  await Promise.all(reads);
  return s;
}

async function practiceView(sb: SupabaseClient, eventId: string, teamId: string, cache: SnapshotCache): Promise<Snapshot["practice"]> {
  const [market, positions] = await Promise.all([
    sb.from("practice_markets").select("settled_at").eq("event_id", eventId).maybeSingle(),
    sb.from("practice_positions").select("ticker_team_id, qty").eq("team_id", teamId),
  ]);
  if (!market.data) return null;
  if (!cache.practiceTickers?.length) {
    const { data } = await sb.from("practice_ticks").select("ticker_team_id").eq("event_id", eventId).eq("step", 0);
    cache.practiceTickers = ((data ?? []) as { ticker_team_id: string }[]).map((t) => t.ticker_team_id);
  }
  return {
    open: !(market.data as { settled_at: string | null }).settled_at,
    tickers: cache.practiceTickers,
    positions: Object.fromEntries(((positions.data ?? []) as { ticker_team_id: string; qty: number }[]).map((x) => [x.ticker_team_id, x.qty])),
  };
}

export interface FnStats {
  calls: number;
  ok: number;
  refused: number;
  errors: number;
}

export interface BotStats {
  turns: number;
  calls: number;
  ok: number;
  refused: Record<string, number>;
  errors: number;
  /** The last few error messages, for the progress line. */
  lastErrors: string[];
  /** Each game call's time (ms), and each turn's reads. */
  callMs: number[];
  readMs: number[];
  /** Per game function. */
  byFn: Record<string, FnStats>;
  /** Bots that signed in again after their session lapsed. */
  resignIns: number;
}

/** One bot: a team that keeps playing. */
export class Bot {
  readonly memory: Memory = newMemory();
  /** The phase this bot saw on its last turn. */
  phase: PhaseCode | null = null;
  private readonly random: () => number;
  private readonly cache: SnapshotCache = {};
  constructor(
    public sb: SupabaseClient,
    readonly eventId: string,
    readonly team: TeamLogin,
    readonly stats: BotStats,
    /** Signs the team in again (a fresh client) when its session has lapsed. */
    private readonly signInAgain?: () => Promise<SupabaseClient>,
  ) {
    this.random = rng(team.code);
  }

  async turn(now = Date.now()): Promise<void> {
    this.stats.turns++;
    let s: Snapshot;
    const t0 = Date.now();
    try {
      s = await snapshot(this.sb, this.eventId, this.team, this.cache);
      this.stats.readMs.push(Date.now() - t0);
      this.phase = s.phase;
    } catch (e) {
      await this.failed(e instanceof Error ? e.message : String(e));
      return;
    }
    for (const a of decide(s, this.memory, this.random, now, PHASE_CODES)) await this.act(a, s, now);
  }

  private async failed(message: string) {
    this.stats.errors++;
    this.stats.lastErrors = [...this.stats.lastErrors.slice(-2), `${this.team.code}: ${message}`];
    if (this.signInAgain && authLapsed(message)) {
      try {
        this.sb = await this.signInAgain();
        this.stats.resignIns++;
      } catch {
        // Tried; the next turn reports the same error and tries again.
      }
    }
  }

  private async act(a: Action, s: Snapshot, now: number) {
    this.stats.calls++;
    const f = (this.stats.byFn[a.fn] ??= { calls: 0, ok: 0, refused: 0, errors: 0 });
    f.calls++;
    const t0 = Date.now();
    const r = await call(this.sb, a.fn, a.args as Record<string, unknown>);
    this.stats.callMs.push(Date.now() - t0);
    if (r.ok) {
      this.stats.ok++;
      f.ok++;
    } else if (r.code === "ERROR") {
      f.errors++;
      await this.failed(`${a.fn}: ${r.message}`);
    } else {
      f.refused++;
      this.stats.refused[r.code ?? "?"] = (this.stats.refused[r.code ?? "?"] ?? 0) + 1;
    }
    remember(this.memory, a, r, now, s);
  }
}

export const emptyStats = (): BotStats => ({ turns: 0, calls: 0, ok: 0, refused: {}, errors: 0, lastErrors: [], callMs: [], readMs: [], byFn: {}, resignIns: 0 });
