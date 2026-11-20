import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadHomeData } from "@/lib/team/home-data";
import { holdingsView, homePlan, teamTimeline, type HomeTask, type TaskState } from "@/lib/team/home";
import { featureOn } from "@/lib/event-status";
import { withAssigned } from "@/lib/team/assigned-data";
import { loadPastRounds } from "@/lib/team/past-rounds-data";
import { MyTimeline } from "./my-timeline";
import { PastRounds } from "./past-rounds";
import { QrCard } from "./qr-card";
import { clock, count, money } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Countdown } from "@/components/ui/countdown";
import { BulletinItem } from "./bulletins/bulletin";
import { inThisRound } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";
import { scoreNow } from "@/lib/team/badges";
import { loadBadges } from "@/lib/team/badges-data";
import { BadgesCard } from "./badges-card";
import { loadPulse } from "@/lib/team/pulse-data";
import { PulseCard } from "./pulse-card";
import { Celebrations } from "./celebrations";
import { BIG_MOVE_BP } from "@/lib/team/pulse";
import { BentoGrid } from "@/components/ui/terminal-bento-grid";
import { GuideMetric, GuidePageTitle, GuidePanel } from "@/components/guide/guide";
import { loadCrisisReport } from "@/lib/team/report-data";
import { CrisisReportCard } from "./crisis-report";
import { HowToPlayCard } from "./how-to-play";
import { stageOf } from "@/lib/team/focus";

export const metadata: Metadata = { title: "Home" };

const STATE: Record<TaskState, { icon: string; label: string; chip: string } | null> = {
  todo: { icon: "📝", label: "To do", chip: "text-warn" },
  waiting: { icon: "⏳", label: "Waiting for partners", chip: "text-phosphor-mid" },
  done: { icon: "✅", label: "Done", chip: "text-phosphor" },
  info: null,
};

// Home, kept simple: one big card with the thing to do now (or "all done"), a short checklist of the rest, three
// tiles (cash, shares, squad), what comes next, and the latest news. Deadlines count down against the server clock;
// the page re-reads itself when one passes, and while a squad window is open (a partner's confirmation or
// submission sends no broadcast).
export default async function TeamHome() {
  const ctx = await loadTeamContext();
  const { team, squad, company, status } = ctx;
  const data = await loadHomeData(ctx);
  // Tonight's switches that change the plan's words: Submit in the last 5 minutes; a firm assigned by the draw.
  const facts = await withAssigned({ ...data.facts, submitLast5: featureOn(status, "submit_last_5") }, company?.id ?? null);
  const plan = homePlan(facts);
  // Every deadline of the night for this team, and the rounds already over (with what the team sent in them).
  const timeline = teamTimeline(facts);
  const closed = new Set(timeline.filter((i) => i.state === "past").map((i) => i.key));
  const past = await loadPastRounds(ctx, (code) => closed.has(code));
  const holdings = holdingsView(data.holdings, data.companies);
  // The team's own score now, and its badges (both only about this team: the rankings stay hidden until the awards).
  const score = scoreNow(team.track, team.cash, holdings.total, company?.ipo_price ?? null);
  const badges = await loadBadges(score.value);
  const nowMs = data.facts.nowMs;
  const times = [...plan.now.map((t) => t.due), ...plan.next.map((n) => n.at)]
    .filter((t): t is string => !!t && new Date(t).getTime() > nowMs)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const squadWork = plan.now.some((t) => ["PROBLEM_PICK", "PITCH", "FEE", "DEAL", "PLAN", "FLASH", "HIRE", "OFFERS", "DRAFT"].includes(t.key) && t.state !== "done");
  const marketOpen = phaseReached(status.phase, "READING");
  // The last trading round's headline (public prices only), once the market is open.
  const pulse = marketOpen ? await loadPulse(ctx.event.id) : null;
  // The big card: the first task still to do (they come in the order they close); the rest form the checklist.
  const main = plan.now.find((t) => t.state === "todo") ?? null;
  // Coming up: only this round's deadlines (later rounds stay out of sight until they start).
  const comingUp = plan.next.filter((n) => inThisRound(status.phase, n.key));
  const rest = plan.now.filter((t) => t !== main);
  // A PRIMUS event from Round 2: the team's own line per crisis (its scores, price moves, firm and stars).
  const primusOn = ctx.event.format === "PRIMUS" && phaseReached(status.phase, "PRESSURE") && team.track !== "FINANCE";
  const report = primusOn
    ? await loadCrisisReport(ctx, data.facts.primus?.k ?? (phaseReached(status.phase, "CLOSE") ? 5 : null), data.facts.primus?.draft?.statement?.title ?? null)
    : null;

  const trackWord = team.track === "PRODUCT" ? "Product" : team.track === "CONSULTING" ? "Consulting" : "Finance";
  const ownLine = company?.ticker
    ? `${company.name ?? company.ticker} (${company.ticker} · ${money(company.market_price)})`
    : company
      ? "your squad's company (named, with its ticker, on the PRD)"
      : null;

  // The demo's dashboard (app/demo/dashboard): the greeting, three metric cards, then "Do this now" beside the live
  // feed, then the night at a glance beside the latest news.
  return (
    <div>
      <RefreshAt at={times[0] ?? null} />
      <AutoRefresh everyMs={15_000} active={squadWork} />

      {/* The greeting is a line, not a heading: the page's headings stay as they were (the team code is the h1). */}
      <GuidePageTitle
        as="p"
        eyebrow={`TEAM HOME / ${team.track} TRACK · ${team.code}`}
        title={`Good evening, ${team.name || `Team ${team.code}`}.`}
        sub={
          ownLine
            ? `Live ${trackWord.toLowerCase()} workspace for ${ownLine}. Everything here is the live event: your tasks, your money and the news as it is published.`
            : `Live ${trackWord.toLowerCase()} workspace. Everything here is the live event: your tasks, your money and the news as it is published.`
        }
      />

      <HowToPlayCard track={team.track} format={ctx.event.format} open={stageOf(status.phase) === "BEFORE"} sector={ctx.sector} />

      <ScoreNow track={team.track} score={score} />

      <div className="guide-grid three mt-4">
        <GuideMetric
          label="CASH"
          value={<span data-testid="home-cash">{money(team.cash)}</span>}
          delta={team.track === "FINANCE" ? `COLLATERAL LOCKED ${money(team.collateral)}` : "AVAILABLE NOW"}
        />
        <GuideMetric
          label={holdings.closing ? "SHARES (CLOSING PRICES)" : "SHARES WORTH"}
          value={<span data-testid="home-holdings-value">{money(holdings.total)}</span>}
          delta={
            holdings.unpriced
              ? `${count(holdings.unpriced)} ${holdings.unpriced === 1 ? "LINE" : "LINES"} WITHOUT A PRICE UNTIL THE IPO`
              : `${count(holdings.lines.length)} ${holdings.lines.length === 1 ? "LINE" : "LINES"} HELD`
          }
        />
        <div className="guide-metric">
          <small>YOUR SQUAD</small>
          {squad ? (
            <>
              <b data-testid="home-squad">Squad {String(squad.number).padStart(2, "0")}</b>
              <span data-testid="home-company">
                {company?.ticker ? (
                  <>
                    {company.name ?? company.ticker} ({company.ticker})
                    {marketOpen ? (
                      <>
                        {" · "}
                        <Link href={`/team/market/${company.ticker}`} className="underline underline-offset-2">
                          in the market
                        </Link>
                      </>
                    ) : null}
                  </>
                ) : (
                  "Named, with its ticker, on the PRD (by the pitch deadline)."
                )}
              </span>
            </>
          ) : (
            <>
              <b>NOT DRAWN</b>
              <span data-testid="home-squad">
                Not drawn yet.
                {data.facts.phaseStarts.SQUAD_DRAW ? ` Squads are drawn at ${clock(data.facts.phaseStarts.SQUAD_DRAW)}.` : ""}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="guide-grid two mt-4">
        <GuidePanel title="Do this now" tag={main ? "LIVE TASK" : "ALL CLEAR"}>
          {main ? (
            <ul aria-label="What to do now">
              <BigTask t={main} />
              {rest.map((t) => (
                <SmallTask key={t.key} t={t} />
              ))}
            </ul>
          ) : (
            <>
              <div className="guide-alert guide-warning">
                <h3 className="text-[13px] font-bold">{plan.now.length ? "Nothing to press right now" : "Nothing to do yet"}</h3>
                <p className="mt-1" data-testid="home-idle">
                  {plan.idle}
                </p>
              </div>
              {plan.now.length ? (
                <ul aria-label="What to do now" className="mt-3">
                  {plan.now.map((t) => (
                    <SmallTask key={t.key} t={t} />
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </GuidePanel>

        <GuidePanel
          title="Latest news"
          tag={
            <Link href="/team/bulletins" className="underline underline-offset-2">
              All bulletins
            </Link>
          }
          aria-label="Latest news"
        >
          {data.bulletins.length === 0 ? (
            <p className="guide-muted">No bulletins yet.</p>
          ) : (
            <ul className="guide-scroll-box compact" aria-label="Latest bulletins">
              {data.bulletins.map((b) => (
                <li key={b.id}>
                  <BulletinItem b={b} clamp />
                </li>
              ))}
            </ul>
          )}
        </GuidePanel>
      </div>

      {report ? (
        <div className="mt-4">
          <BentoGrid>
            <CrisisReportCard report={report} />
          </BentoGrid>
        </div>
      ) : null}

      {past && past.length > 0 ? (
        <div className="mt-4">
          <PastRounds rounds={past} />
        </div>
      ) : null}

      <div className="guide-grid two mt-4">
        <MyTimeline items={timeline} />
        <GuidePanel title="Coming up this round" tag="IST" aria-label="Coming up this round">
          {comingUp.length === 0 ? (
            <p className="guide-muted">Nothing else this round.</p>
          ) : (
            <ul aria-label="Coming up">
              {comingUp.map((n) => (
                <li key={n.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--line-neutral)] py-2.5 text-[12px] last:border-0">
                  <span className="min-w-0">
                    {n.href ? (
                      <Link href={n.href} className="font-semibold underline-offset-2 hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      <span className="font-semibold">{n.title}</span>
                    )}
                  </span>
                  <span className="guide-task-due">
                    {clock(n.at)} · in <Countdown to={n.at} passed="now" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GuidePanel>
      </div>

      {pulse ? (
        <div className="mt-4">
          <PulseCard pulse={pulse} mine={company?.ticker ?? null} />
        </div>
      ) : null}
      <Celebrations
        teamId={team.id}
        badges={(badges ?? []).filter((b) => b.earned).map((b) => ({ key: b.key, icon: b.icon, name: b.name }))}
        move={(() => {
          const own = pulse && company?.ticker ? pulse.moves.find((m) => m.ticker === company.ticker) : null;
          return own && Math.abs(own.changeBp) >= BIG_MOVE_BP ? { round: pulse!.round, ticker: own.ticker, changeBp: own.changeBp } : null;
        })()}
      />

      <div className="guide-grid two mt-4">
        <GuidePanel title="Your shares" tag={`${count(holdings.lines.length)} LINES`} aria-label="Your shares">
          {holdings.lines.length === 0 ? (
            <p className="guide-muted">{squad ? "No shares." : "Shares are issued at the squad draw."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="guide-table" aria-label="Your holdings">
                <thead>
                  <tr>
                    {["Company", "Lot", "Shares", "Price", "Value"].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.lines.map((l) => (
                    <tr key={l.key}>
                      <td className="font-mono font-semibold">{l.ticker ?? <span className="font-sans font-normal">{l.name}</span>}</td>
                      <td>{l.lotLabel}</td>
                      <td className="text-right font-mono">{count(l.qty)}</td>
                      <td className="text-right font-mono">{money(l.price)}</td>
                      <td className={`text-right font-mono ${l.value !== null && l.value < 0 ? "text-danger-soft" : ""}`}>{money(l.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {holdings.lines.some((l) => l.lot === "SHORT") ? (
            <p className="guide-muted mt-2">A short is shares owed: its value is what covering it would cost now.</p>
          ) : null}
        </GuidePanel>
        <QrCard track={team.track} />
      </div>

      {badges ? (
        <div className="mt-4">
          <BadgesCard badges={badges} />
        </div>
      ) : null}

      {status.paused ? (
        <p className="guide-alert guide-warning mt-4">While the event is paused, countdowns keep running but no deadline passes; each moves later on resume.</p>
      ) : null}
    </div>
  );
}

/** The team's own value now and how it has moved since its start (a consultancy shows what it has earned): the
 *  demo's metric card, full width. */
function ScoreNow({ track, score }: { track: string; score: ReturnType<typeof scoreNow> }) {
  if (score.value === null) return null;
  const up = score.changeBp !== null && score.changeBp >= 0;
  return (
    <section className="guide-metric guide-score-now mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Your score now" data-testid="score-now">
      <div>
        <small>{track === "CONSULTING" ? "EARNED SO FAR" : "YOUR SCORE NOW"}</small>
        <b data-testid="score-now-value">{money(score.value)}</b>
      </div>
      {score.changeBp !== null ? (
        <p className={`guide-chip ${up ? "" : "guide-chip-down"}`} data-testid="score-now-change">
          {up ? "▲ +" : "▼ "}
          {(score.changeBp / 100).toFixed(2)}% <span className="ml-1 opacity-70">since the start</span>
        </p>
      ) : (
        <p className="guide-muted">Only your own score: who is winning stays a secret until the awards!</p>
      )}
    </section>
  );
}

function Due({ t }: { t: HomeTask }) {
  if (!t.due) return null;
  return (
    <p className="guide-task-due">
      {t.dueLabel} · {clock(t.due)}
      <b>
        <Countdown to={t.due} passed="closed" />
      </b>
    </p>
  );
}

/** The one thing to do now: the demo's amber alert, with the time left and the demo's button. */
function BigTask({ t }: { t: HomeTask }) {
  return (
    <li className="guide-alert guide-warning guide-task-big mb-3" data-testid={`task-${t.key}`} data-state={t.state}>
      <p className="mx-taskbar-pill">
        <Glyph e="📝" spoken /> Do this now
      </p>
      {/* On a phone the countdown sits under the text, so the text keeps the full width. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3>{t.title}</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed opacity-90">{t.detail}</p>
        </div>
        <Due t={t} />
      </div>
      {t.href ? (
        <Link href={t.href} className="guide-btn mt-4">
          {t.linkLabel}
          <span aria-hidden> →</span>
        </Link>
      ) : null}
    </li>
  );
}

/** Everything else for now, as the demo's feed rows: a state chip, the title and a line, the time and a button. */
function SmallTask({ t }: { t: HomeTask }) {
  const st = STATE[t.state];
  return (
    <li className="guide-task-row" data-testid={`task-${t.key}`} data-state={t.state}>
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {st ? (
            <span className="guide-chip">
              <Glyph e={st.icon} /> {t.stateLabel ?? st.label}
            </span>
          ) : null}
          <h3>{t.title}</h3>
        </div>
        <p className="guide-muted mt-1">{t.detail}</p>
      </div>
      <div className="flex items-center gap-3">
        <Due t={t} />
        {t.href ? (
          <Link href={t.href} className={`guide-btn ${t.state === "todo" ? "" : "secondary"}`}>
            {t.linkLabel}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
