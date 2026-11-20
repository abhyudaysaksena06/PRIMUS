import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached, type Track } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadHomeData } from "@/lib/team/home-data";
import { holdingsView, homePlan, teamTimeline, type HomeTask, type TaskState } from "@/lib/team/home";
import { featureOn } from "@/lib/event-status";
import { withAssigned } from "@/lib/team/assigned-data";
import { loadPastRounds } from "@/lib/team/past-rounds-data";
import type { PastRound } from "@/lib/team/past-rounds";
import { MyTimeline } from "./my-timeline";
import { bp, clock, count, money } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Countdown } from "@/components/ui/countdown";
import { jobFor, stageInfo, stageOf, STEPS, type Stage } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";
import { scoreNow } from "@/lib/team/badges";
import { loadBadges } from "@/lib/team/badges-data";
import { loadPulse } from "@/lib/team/pulse-data";
import { Celebrations } from "./celebrations";
import { BIG_MOVE_BP } from "@/lib/team/pulse";
import { GuideMetric, GuidePageTitle, GuidePanel } from "@/components/guide/guide";
import { loadCrisisReport } from "@/lib/team/report-data";
import { CrisisReportLine } from "./crisis-report";
import { crisisHeadline, crisisSteps } from "@/lib/team/crisis-steps";
import { CrisisSteps } from "./crisis-steps";
import { PhaseEnd } from "./phase-end";
import { BULLETIN_KIND_LABELS, type BulletinKind } from "@/lib/admin/content-bulletins";

export const metadata: Metadata = { title: "Home" };

const STATE: Record<TaskState, { icon: string; label: string } | null> = {
  todo: { icon: "📝", label: "To do" },
  waiting: { icon: "⏳", label: "Waiting for partners" },
  done: { icon: "✅", label: "Done" },
  info: null,
};

const TRACK_WORD: Record<Track, string> = { PRODUCT: "Product", CONSULTING: "Consulting", FINANCE: "Finance" };
const ROUNDS: Stage[] = ["ROUND_1", "ROUND_2", "ROUND_3"];
/** The demo's workspace buttons (app/demo/dashboard), each to the real page for that round. */
const WORKSPACE: Record<Track, { label: string; href: string; quiet?: boolean }[]> = {
  PRODUCT: [
    { label: "ROUND 1: IDEA & MVP →", href: "/team/squad" },
    { label: "ROUND 2: CRISIS & HIRE →", href: "/team/crisis" },
    { label: "ROUND 3: DRAFT & NEW MVP →", href: "/team/crisis#round-3" },
  ],
  CONSULTING: [
    { label: "ROUND 1 CRISIS →", href: "/team/squad" },
    { label: "ROUND 2 RESCUE →", href: "/team/crisis" },
    { label: "ROUND 3 AUCTION & CRISIS →", href: "/team/crisis#round-3" },
  ],
  FINANCE: [
    { label: "R1: CAPITAL →", href: "/team/trade/ipo", quiet: true },
    { label: "R2: MVP DEALS →", href: "/team/crisis" },
  ],
};
/** The demo's intro line under the greeting, per track, with the real company where there is one. */
const INTRO: Record<Track, (own: string | null) => string> = {
  PRODUCT: (own) =>
    `Live workspace for ${own ?? "your squad's company"}. Build and pitch your MVP in Round 1, hire a consulting firm through each crisis in Round 2, and draft your final problem in Round 3.`,
  CONSULTING: (own) =>
    `Live consulting workspace for PRIMUS ’26${own ? `, in the squad of ${own}` : ""}. Solve your crisis case in Round 1, win clients and write their advice memos through each crisis in Round 2, and take on a final client in Round 3.`,
  FINANCE: () =>
    "Your Finance team starts with its fund's capital. Bid in the IPO in Round 1, read each crisis and the companies' answers in Round 2, and trade your portfolio on the Finance Desk through Round 3.",
};

/** The finished round's line: what was sent, its score and its price move, in a few words. */
function pastLine(rounds: PastRound[], round: 1 | 2 | 3): string | null {
  const mine = rounds.filter((r) => (r.title.startsWith("Crisis") ? 2 : r.title.startsWith("Round 3") ? 3 : 1) === round);
  const bits = mine.flatMap((r) =>
    r.entries.map((e) =>
      [
        e.label,
        e.submission ? `${e.submission.auto_submitted ? "submitted for you" : "submitted"} ${clock(e.submission.submitted_at)}` : "nothing submitted",
        e.score === null ? "score not released yet" : `score ${e.score}/100`,
        e.moveBp !== null ? `${e.moveOf ?? "price"} ${bp(e.moveBp)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  return bits.length ? bits.join("; ") : null;
}

// Home is the demo's dashboard (app/demo/dashboard), slot for slot, with the real figures: the greeting and its line,
// three metric cards, then "Do this now" (the three rounds as numbered steps, the step on now with its time left,
// the open tasks, the workspace buttons and three tiles) beside the live feed of bulletins, then the night at a
// glance beside the latest news. Deadlines count down against the server clock; the page re-reads itself when one
// passes, and while a squad window is open (a partner's confirmation or submission sends no broadcast).
export default async function TeamHome() {
  const ctx = await loadTeamContext();
  const { team, squad, company, status } = ctx;
  const format = ctx.event.format;
  const data = await loadHomeData(ctx);
  // Tonight's switches that change the plan's words: Submit in the last 5 minutes; a firm assigned by the draw.
  const facts = await withAssigned({ ...data.facts, submitLast5: featureOn(status, "submit_last_5") }, company?.id ?? null);
  const plan = homePlan(facts);
  // Every deadline of the night for this team, and the rounds already over (with what the team sent in them).
  const timeline = teamTimeline(facts);
  const closed = new Set(timeline.filter((i) => i.state === "past").map((i) => i.key));
  const past = (await loadPastRounds(ctx, (code) => closed.has(code))) ?? [];
  const holdings = holdingsView(data.holdings, data.companies);
  // The team's own score now (only about this team: the rankings stay hidden until the awards); its badges are
  // announced by the pop-ups.
  const score = scoreNow(team.track, team.cash, holdings.total, company?.ipo_price ?? null);
  const badges = await loadBadges(score.value);
  const nowMs = data.facts.nowMs;
  const times = [...plan.now.map((t) => t.due), ...plan.next.map((n) => n.at)]
    .filter((t): t is string => !!t && new Date(t).getTime() > nowMs)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const squadWork = plan.now.some((t) => ["PROBLEM_PICK", "PITCH", "FEE", "DEAL", "PLAN", "FLASH", "HIRE", "OFFERS", "DRAFT"].includes(t.key) && t.state !== "done");
  const marketOpen = phaseReached(status.phase, "READING");
  // The last trading round's move of the team's own company, for the pop-up.
  const pulse = marketOpen ? await loadPulse(ctx.event.id) : null;
  // The first task still to do (they come in the order they close) leads the list.
  const main = plan.now.find((t) => t.state === "todo") ?? null;
  const rest = plan.now.filter((t) => t !== main);
  // A PRIMUS event from Round 2: the team's own line per crisis (its scores, price moves, firm and stars).
  const primusOn = format === "PRIMUS" && phaseReached(status.phase, "PRESSURE") && team.track !== "FINANCE";
  const report = primusOn
    ? await loadCrisisReport(ctx, data.facts.primus?.k ?? (phaseReached(status.phase, "CLOSE") ? 5 : null), data.facts.primus?.draft?.statement?.title ?? null)
    : null;

  // Where the night is: the round on now, the step of the night, and (PRIMUS Rounds 2 and 3) the crisis steps.
  const stage = stageOf(status.phase);
  const info = stageInfo(stage, format);
  const primusRound = format === "PRIMUS" && (status.phase === "PRESSURE" || status.phase === "SATURATION");
  const k = data.facts.primus?.k ?? null;
  const step = primusRound ? crisisHeadline(status.phase, k, null) : STEPS[status.phase];
  const steps =
    primusRound && k !== null
      ? crisisSteps(
          team.track,
          k,
          Object.fromEntries(data.facts.deadlines.map((d) => [d.code, d.at])),
          k === 5 && (data.facts.primus?.workOpen === true || data.facts.primus?.hiringK === 5),
        )
      : [];
  const at = ROUNDS.indexOf(stage);

  const trackWord = TRACK_WORD[team.track];
  const ownLine = company?.ticker
    ? `${company.name ?? company.ticker} (${company.ticker} · ${money(company.market_price)}/sh)`
    : company
      ? (company.name ?? null)
      : null;
  const squadLabel = squad ? `Squad ${String(squad.number).padStart(2, "0")}` : null;
  const kindOf = (kd: string): string => BULLETIN_KIND_LABELS[(kd in BULLETIN_KIND_LABELS ? kd : "GENERAL") as BulletinKind].toUpperCase();

  const squadValue = squad ? (
    <span data-testid="home-squad">{squadLabel}</span>
  ) : (
    <span data-testid="home-squad">NOT DRAWN</span>
  );
  const squadDelta = squad ? (
    <span data-testid="home-company">
      {company?.ticker ? (
        <>
          {company.name ?? company.ticker} ({company.ticker})
          {marketOpen ? (
            <>
              {" · "}
              <Link href={`/team/market/${company.ticker}`} className="underline underline-offset-2">
                IN THE MARKET
              </Link>
            </>
          ) : null}
        </>
      ) : (
        "NAMED, WITH ITS TICKER, ON THE PRD"
      )}
    </span>
  ) : (
    <>Not drawn yet.{data.facts.phaseStarts.SQUAD_DRAW ? ` Squads are drawn at ${clock(data.facts.phaseStarts.SQUAD_DRAW)}.` : ""}</>
  );
  const scoreCard = (
    <GuideMetric
      label={team.track === "CONSULTING" ? "EARNED SO FAR" : "YOUR SCORE NOW"}
      value={score.value === null ? "—" : money(score.value)}
      valueTestId="score-now-value"
      delta={
        score.changeBp !== null ? (
          <span data-testid="score-now-change">
            {score.changeBp >= 0 ? "▲ +" : "▼ "}
            {(score.changeBp / 100).toFixed(2)}% SINCE THE START
          </span>
        ) : (
          "ONLY YOUR OWN SCORE: RANKINGS ARE REVEALED AT THE AWARDS"
        )
      }
    />
  );
  const holdingsWords = holdings.unpriced
    ? `${count(holdings.unpriced)} ${holdings.unpriced === 1 ? "LINE" : "LINES"} WITHOUT A PRICE UNTIL THE IPO`
    : `${count(holdings.lines.length)} ${holdings.lines.length === 1 ? "LINE" : "LINES"} HELD`;

  // The three tiles under the workspace buttons (the demo's guide-metric tiles).
  const tiles: [string, string][] =
    team.track === "PRODUCT"
      ? [
          ["SHARE PRICE", company?.ticker ? money(company.market_price) : "—"],
          ["CASH", money(team.cash)],
          ["SHARES WORTH", money(holdings.total)],
        ]
      : team.track === "CONSULTING"
        ? [
            ["TEAM", team.code],
            ["EARNED", score.value === null ? "—" : money(score.value)],
            ["SQUAD", squad ? (company?.ticker ?? squadLabel ?? "—") : "—"],
          ]
        : [
            ["CASH", money(team.cash)],
            ["SHARES WORTH", money(holdings.total)],
            ["LINES", count(holdings.lines.length)],
          ];

  return (
    <div className="guide-home">
      <RefreshAt at={times[0] ?? null} />
      <AutoRefresh everyMs={15_000} active={squadWork} />

      {/* The greeting is the demo's page head; it is a line, not a heading (the team code is the page's h1). */}
      <GuidePageTitle
        as="p"
        eyebrow={`TEAM HOME / ${team.track} TRACK · ${team.code}`}
        title={`Good evening, ${team.name || `Team ${team.code}`}.`}
        sub={INTRO[team.track](ownLine)}
      />

      {team.track === "FINANCE" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="guide-btn" href="/team/crisis">
            OPEN ROUND 2: PRODUCT MVPs &amp; SHARE DEALS →
          </Link>
          <Link className="guide-btn secondary" href="/team/trade">
            OPEN FINANCE DESK →
          </Link>
          <Link className="guide-chip" href="/team/market">
            Round 3 trading desk
          </Link>
        </div>
      ) : null}

      <div className={`guide-grid three ${team.track === "FINANCE" ? "mt-4" : ""}`}>
        {team.track === "FINANCE" ? (
          <>
            <GuideMetric
              label="AVAILABLE CASH"
              value={money(team.cash)}
              valueTestId="home-cash"
              delta={`COLLATERAL LOCKED ${money(team.collateral)}`}
            />
            {scoreCard}
            <GuideMetric
              label={holdings.closing ? "SHARES (CLOSING PRICES)" : "SHARES & PORTFOLIO"}
              value={money(holdings.total)}
              valueTestId="home-holdings-value"
              delta={
                <>
                  {holdingsWords} · {squadValue}
                </>
              }
            />
          </>
        ) : (
          <>
            <GuideMetric
              label={team.track === "PRODUCT" ? "CASH & SHARES" : "CASH & FEE SHARES"}
              value={money(team.cash)}
              valueTestId="home-cash"
              delta={
                <>
                  {holdings.closing ? "SHARES AT CLOSING PRICES " : "SHARES WORTH "}
                  <span data-testid="home-holdings-value">{money(holdings.total)}</span> · {holdingsWords}
                </>
              }
            />
            {scoreCard}
            <GuideMetric label="YOUR SQUAD" value={squad ? squadLabel : "NOT DRAWN"} valueTestId="home-squad" delta={squadDelta} />
          </>
        )}
      </div>

      <div className="guide-grid two mt-4">
        <GuidePanel title="Do this now" tag={main ? "LIVE TASK" : "LIVE END-TO-END WORKFLOW"}>
          <section className="guide-alert guide-warning" aria-label="Where we are">
            <b>
              {trackWord} three-round workflow · {info.round ? `Round ${info.round} of 3 · ${info.title}` : info.title}
            </b>
            <br />
            {ROUNDS.map((r, i) => {
              const n = (i + 1) as 1 | 2 | 3;
              const done = i < at || stage === "RESULTS";
              const now = i === at;
              const pastWords = pastLine(past, n);
              return (
                <div key={r} className={`mt-1.5 ${now ? "font-semibold" : done ? "" : "opacity-75"}`} data-state={done ? "done" : now ? "now" : "later"}>
                  {n}. <b>Round {n}:</b>{" "}
                  {now ? (
                    <>
                      {step.name}
                      {status.phase_ends_at ? (
                        <>
                          {" · "}
                          <PhaseEnd endsAt={status.phase_ends_at} phase={status.phase} gate={status.gate} next={status.next_phase} variant="left" className="" />
                        </>
                      ) : null}
                      <span className="block font-normal opacity-90">{step.what}</span>
                      {steps.length ? <CrisisSteps steps={steps} label={k === 5 ? "Steps of Round 3" : `Steps of crisis ${k}`} /> : null}
                    </>
                  ) : done ? (
                    <>✓ {pastWords ?? "Done."}</>
                  ) : (
                    jobFor(team.track, r, format)
                  )}
                  {n === 2 && report && (now || done) ? <CrisisReportLine report={report} /> : null}
                  {n === 3 && report && now && !steps.length ? <CrisisReportLine report={report} /> : null}
                </div>
              );
            })}
            <p className="mt-2 border-t border-current/20 pt-2" data-testid="your-job">
              <Glyph e="🎯" /> Your job: {jobFor(team.track, stage, format)}
            </p>
          </section>

          {main ? null : (
            <p className="guide-muted mt-3" data-testid="home-idle">
              {plan.idle}
            </p>
          )}
          {plan.now.length ? (
            <ul aria-label="What to do now" className="mt-3 space-y-2">
              {main ? <TaskRow t={main} big /> : null}
              {rest.map((t) => (
                <TaskRow key={t.key} t={t} />
              ))}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <b className="text-sm">
                {trackWord} Workspace ({team.code})
              </b>
              <p className="guide-muted mt-1">
                {team.track === "FINANCE" ? "Jump directly to Round 1 Capital, Round 2 MVP Share Deals, or the Finance Desk." : "Jump directly to Round 1, Round 2, Round 3 or Live Q&A."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {WORKSPACE[team.track].map((w) => (
                <Link key={w.label} className={`guide-btn ${w.quiet ? "secondary" : ""}`} href={w.href}>
                  {w.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {tiles.map(([label, value]) => (
              <div className="guide-metric" key={label}>
                <small>{label}</small>
                <b className="guide-tile-value">{value}</b>
              </div>
            ))}
          </div>
        </GuidePanel>

        <GuidePanel title="Live 3-track event feed" tag="BULLETINS · REAL-TIME" aria-label="Latest news">
          {data.bulletins.length === 0 ? (
            <p className="guide-muted">No bulletins yet.</p>
          ) : (
            <ul className="guide-scroll-box compact space-y-2" aria-label="Latest bulletins">
              {data.bulletins.map((b) => (
                <li key={b.id} className="guide-feed-item">
                  <div className="flex items-center justify-between gap-2">
                    <span className="guide-chip">{kindOf(b.kind)}</span>
                    <time dateTime={b.published_at} className="guide-feed-time">
                      {clock(b.published_at, true)} IST
                    </time>
                  </div>
                  <p className="mt-1.5 text-[11px] font-bold">{b.title}</p>
                  {b.body ? <p className="guide-muted mt-1 line-clamp-3 whitespace-pre-wrap">{b.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </GuidePanel>
      </div>

      <div className="guide-grid two mt-4">
        <MyTimeline items={timeline} tag={`${team.track} IST TIMETABLE`} />
        <GuidePanel title="Latest news" tag="EVENT-WIDE">
          {data.bulletins.length === 0 ? (
            <div className="guide-alert">Announcements appear here as they are published.</div>
          ) : (
            <div className="space-y-3">
              {data.bulletins.slice(0, 2).map((b, i) => (
                <div key={b.id} className={`guide-alert ${i === 0 ? "guide-warning" : ""}`}>
                  <b>
                    {b.title.toUpperCase()} · {clock(b.published_at)} IST
                  </b>
                  {b.body ? (
                    <>
                      <br />
                      <span className="line-clamp-3">{b.body}</span>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <Link href="/team/bulletins" className="guide-accent-link mt-4 inline-block text-xs">
            Open all news →
          </Link>
        </GuidePanel>
      </div>

      <Celebrations
        teamId={team.id}
        badges={(badges ?? []).filter((b) => b.earned).map((b) => ({ key: b.key, icon: b.icon, name: b.name }))}
        move={(() => {
          const own = pulse && company?.ticker ? pulse.moves.find((m) => m.ticker === company.ticker) : null;
          return own && Math.abs(own.changeBp) >= BIG_MOVE_BP ? { round: pulse!.round, ticker: own.ticker, changeBp: own.changeBp } : null;
        })()}
      />

      {status.paused ? (
        <p className="guide-alert guide-warning mt-4">While the event is paused, countdowns keep running but no deadline passes; each moves later on resume.</p>
      ) : null}
    </div>
  );
}

/** A task as the demo's feed row: a state chip, the title and a line, the time left and the demo's button. The first
 *  one to do is lit in the track's colour. */
function TaskRow({ t, big = false }: { t: HomeTask; big?: boolean }) {
  const st = STATE[t.state];
  return (
    <li className={`guide-feed-item ${big ? "is-now" : ""}`} data-testid={`task-${t.key}`} data-state={t.state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {big ? (
              <span className="guide-chip active">
                <Glyph e="📝" spoken /> Do this now
              </span>
            ) : st ? (
              <span className="guide-chip">
                <Glyph e={st.icon} /> {t.stateLabel ?? st.label}
              </span>
            ) : null}
            <h3 className="text-[12px] font-bold">{t.title}</h3>
          </div>
          <p className="guide-muted mt-1">{t.detail}</p>
        </div>
        {t.due ? (
          <p className="guide-task-due">
            {t.dueLabel} · {clock(t.due)}
            <b>
              <Countdown to={t.due} passed="closed" />
            </b>
          </p>
        ) : null}
      </div>
      {t.href ? (
        <Link href={t.href} className={`guide-btn mt-2.5 ${big || t.state === "todo" ? "" : "secondary"}`}>
          {t.linkLabel}
          {big ? <span aria-hidden> →</span> : null}
        </Link>
      ) : null}
    </li>
  );
}
