import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
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
import { Notice, Table, Td } from "@/components/ui/ui";
import { Countdown } from "@/components/ui/countdown";
import { BulletinItem } from "./bulletins/bulletin";
import { inThisRound } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { scoreNow } from "@/lib/team/badges";
import { loadBadges } from "@/lib/team/badges-data";
import { BadgesCard } from "./badges-card";
import { loadPulse } from "@/lib/team/pulse-data";
import { PulseCard } from "./pulse-card";
import { Celebrations } from "./celebrations";
import { BIG_MOVE_BP } from "@/lib/team/pulse";
import { BentoGrid, BentoItem, BentoTitle } from "@/components/ui/terminal-bento-grid";
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

  return (
    <div className="space-y-5">
      <RefreshAt at={times[0] ?? null} />
      <AutoRefresh everyMs={15_000} active={squadWork} />

      {/* The demo's page head: where you are, and a greeting (a line, not a heading: the page's headings stay as they were). */}
      <div className="mx-page-head">
        <p className="mx-eyebrow mx-eyebrow-accent text-xs">
          Team home / {team.track.toLowerCase()} track · {team.code}
        </p>
        <p className="mx-page-title">Good evening, {team.name || `Team ${team.code}`}.</p>
      </div>

      <HowToPlayCard track={team.track} format={ctx.event.format} open={stageOf(status.phase) === "BEFORE"} sector={ctx.sector} />

      <section className="space-y-3">
        {main ? (
          <ul aria-label="What to do now">
            <BigTask t={main} />
            {rest.map((t) => (
              <SmallTask key={t.key} t={t} />
            ))}
          </ul>
        ) : (
          <>
            <div className="mx-panel flex items-center gap-4 rounded-2xl p-5">
              <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-line bg-raised text-3xl text-phosphor" aria-hidden>
                <Glyph e={plan.now.length ? "👍" : "☕"} />
              </span>
              <div>
                <h2 className="text-xl font-extrabold text-[var(--mx-heading)]">{plan.now.length ? "Nothing to press right now" : "Nothing to do yet"}</h2>
                <p className="mt-0.5 text-base text-paper" data-testid="home-idle">
                  {plan.idle}
                </p>
              </div>
            </div>
            {plan.now.length ? (
              <ul aria-label="What to do now">
                {plan.now.map((t) => (
                  <SmallTask key={t.key} t={t} />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      {/* The terminal dashboard: the score across the top, then cash, shares and squad as three windows. */}
      <BentoGrid>
      <ScoreNow track={team.track} score={score} />

        <Tile icon="💵" label="Cash" hot>
          <span data-testid="home-cash">{money(team.cash)}</span>
          {team.track === "FINANCE" ? (
            <span className="mt-1 block font-sans text-xs font-normal text-paper">
              Collateral locked: <span className="font-mono">{money(team.collateral)}</span>
            </span>
          ) : null}
        </Tile>
        <Tile icon="📊" label={holdings.closing ? "Shares (closing prices)" : "Shares worth"}>
          <span data-testid="home-holdings-value">{money(holdings.total)}</span>
          {holdings.unpriced ? (
            <span className="mt-1 block font-sans text-xs font-normal text-paper">
              {`${count(holdings.unpriced)} ${holdings.unpriced === 1 ? "line" : "lines"} without a price until the IPO`}
            </span>
          ) : null}
        </Tile>
        <Tile icon="👥" label="Your squad">
          {squad ? (
            <>
              <span data-testid="home-squad">Squad {String(squad.number).padStart(2, "0")}</span>
              <span className="mt-1 block font-sans text-sm font-normal text-paper" data-testid="home-company">
                {company?.ticker ? (
                  <>
                    <span className="font-semibold">{company.name ?? company.ticker}</span>{" "}
                    <span className="font-mono text-paper">({company.ticker})</span>
                    {marketOpen ? (
                      <>
                        {" "}
                        <Link href={`/team/market/${company.ticker}`} className="text-paper underline underline-offset-2">
                          in the market
                        </Link>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className="text-paper">Named, with its ticker, on the PRD (by the pitch deadline).</span>
                )}
              </span>
            </>
          ) : (
            <span className="block font-sans text-sm font-normal text-paper" data-testid="home-squad">
              Not drawn yet.
              {data.facts.phaseStarts.SQUAD_DRAW ? ` Squads are drawn at ${clock(data.facts.phaseStarts.SQUAD_DRAW)}.` : ""}
            </span>
          )}
        </Tile>
      </BentoGrid>

      {report ? (
        <BentoGrid>
          <CrisisReportCard report={report} />
        </BentoGrid>
      ) : null}

      {past && past.length > 0 ? <PastRounds rounds={past} /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <MyTimeline items={timeline} />
        <QrCard track={team.track} />
      </div>

      {pulse ? <PulseCard pulse={pulse} mine={company?.ticker ?? null} /> : null}
      <Celebrations
        teamId={team.id}
        badges={(badges ?? []).filter((b) => b.earned).map((b) => ({ key: b.key, icon: b.icon, name: b.name }))}
        move={(() => {
          const own = pulse && company?.ticker ? pulse.moves.find((m) => m.ticker === company.ticker) : null;
          return own && Math.abs(own.changeBp) >= BIG_MOVE_BP ? { round: pulse!.round, ticker: own.ticker, changeBp: own.changeBp } : null;
        })()}
      />

      {badges ? <BadgesCard badges={badges} /> : null}

      <BentoGrid>
      <Card icon="⏭️" title="Coming up this round">
        {comingUp.length === 0 ? (
          <p className="text-sm text-muted">Nothing else this round.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Coming up">
            {comingUp.map((n) => (
              <li key={n.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0">
                  {n.href ? (
                    <Link href={n.href} className="font-semibold text-phosphor underline-offset-2 hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-semibold text-phosphor">{n.title}</span>
                  )}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums text-paper">
                  {clock(n.at)} · in <Countdown to={n.at} passed="now" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        icon="📣"
        title="Latest news"
        span={2}
        action={
          <Link href="/team/bulletins" className="text-sm font-semibold text-paper underline underline-offset-2">
            All bulletins
          </Link>
        }
      >
        {data.bulletins.length === 0 ? (
          <p className="text-sm text-muted">No bulletins yet.</p>
        ) : (
          <ul className="space-y-3" aria-label="Latest bulletins">
            {data.bulletins.map((b) => (
              <li key={b.id}>
                <BulletinItem b={b} clamp />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card icon="🧾" title="Your shares" span={3}>
        {holdings.lines.length === 0 ? (
          <p className="text-sm text-muted">{squad ? "No shares." : "Shares are issued at the squad draw."}</p>
        ) : (
          <Table head={["Company", "Lot", "Shares", "Price", "Value"]} label="Your holdings">
            {holdings.lines.map((l) => (
              <tr key={l.key}>
                <Td mono className="font-semibold">
                  {l.ticker ?? <span className="font-sans font-normal text-paper">{l.name}</span>}
                </Td>
                <Td>{l.lotLabel}</Td>
                <Td mono className="text-right">
                  {count(l.qty)}
                </Td>
                <Td mono className="text-right">
                  {money(l.price)}
                </Td>
                <Td mono className={`text-right ${l.value !== null && l.value < 0 ? "text-danger-soft" : ""}`}>
                  {money(l.value)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {holdings.lines.some((l) => l.lot === "SHORT") ? (
          <p className="mt-2 text-xs text-muted">A short is shares owed: its value is what covering it would cost now.</p>
        ) : null}
      </Card>
      </BentoGrid>

      {status.paused ? <Notice tone="amber">While the event is paused, countdowns keep running but no deadline passes; each moves later on resume.</Notice> : null}
    </div>
  );
}

/** The team's own value now and how it has moved since its start (a consultancy shows what it has earned). */
function ScoreNow({ track, score }: { track: string; score: ReturnType<typeof scoreNow> }) {
  if (score.value === null) return null;
  const up = score.changeBp !== null && score.changeBp >= 0;
  return (
    <BentoItem as="section" span={3} className="bento-item-hot flex flex-wrap items-center justify-between gap-3" aria-label="Your score now" data-testid="score-now">
      <div>
        <p className="mx-eyebrow flex items-center gap-1.5 text-xs">
          <span className="text-sm text-phosphor" aria-hidden>
            <Glyph e="📈" />
          </span>
          {track === "CONSULTING" ? "Earned so far" : "Your score now"}
        </p>
        <p className="mt-2 font-mono text-3xl font-extrabold tabular-nums tracking-tight text-[var(--mx-heading)] sm:text-4xl" data-testid="score-now-value">
          {money(score.value)}
        </p>
      </div>
      {score.changeBp !== null ? (
        <p
          className={`rounded-lg border px-3 py-2 font-mono text-lg font-extrabold tabular-nums ${up ? "border-[var(--term-green)]/50 bg-[var(--term-green)]/10 text-[var(--term-green)]" : "border-danger/60 bg-danger/10 text-danger-soft"}`}
          data-testid="score-now-change"
        >
          {up ? "▲ +" : "▼ "}
          {(score.changeBp / 100).toFixed(2)}% <span className="text-xs font-normal text-muted">since the start</span>
        </p>
      ) : (
        <p className="text-sm text-muted">Only your own score: who is winning stays a secret until the awards!</p>
      )}
    </BentoItem>
  );
}

/** A metric card, as the demo's: a small capital label, a big figure, a line under it. */
function Tile({ icon, label, hot = false, children }: { icon: string; label: string; hot?: boolean; children: ReactNode }) {
  return (
    <BentoItem className={hot ? "bento-item-hot" : ""}>
      <p className="mx-eyebrow flex items-center gap-1.5 text-xs">
        <span className="text-sm text-phosphor" aria-hidden>
          <Glyph e={icon} />
        </span>
        {label}
      </p>
      <div className="mt-2.5 font-mono text-2xl font-extrabold tabular-nums tracking-tight text-[var(--mx-heading)]">{children}</div>
    </BentoItem>
  );
}

/** A titled card in the bento grid, as the demo's panels: a title row over a hairline, its action on the right. */
function Card({ icon, title, action, span = 1, children }: { icon: string; title: string; action?: ReactNode; span?: 1 | 2 | 3; children: ReactNode }) {
  return (
    <BentoItem as="section" span={span} aria-label={title}>
      <div className="-mx-[1.15rem] -mt-[1.1rem] mb-3 flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line bg-gradient-to-r from-phosphor/10 to-transparent px-[1.15rem] py-2">
        <BentoTitle>
          <span aria-hidden>
            <Glyph e={icon} />
          </span>
          <CipherText text={title} duration={450} />
        </BentoTitle>
        {action}
      </div>
      {children}
    </BentoItem>
  );
}

function Due({ t, big = false }: { t: HomeTask; big?: boolean }) {
  if (!t.due) return null;
  return (
    <p className={`whitespace-nowrap ${big ? "sm:text-right" : "text-right"}`}>
      <span className={`block font-mono text-xs tracking-wide ${big ? "text-paper" : "text-muted"}`}>
        {t.dueLabel} · {clock(t.due)}
      </span>
      <Countdown to={t.due} passed="closed" className={big ? "font-mono text-3xl font-extrabold text-warn" : "font-mono font-bold text-warn"} />
    </p>
  );
}

/** The one thing to do now: big, with the time left and a big button (the demo's "Do this now" panel). */
function BigTask({ t }: { t: HomeTask }) {
  return (
    <li className="mx-panel relative mb-3 overflow-hidden rounded-2xl" data-testid={`task-${t.key}`} data-state={t.state}>
      <div className="mx-panel-head flex min-h-11 items-center justify-between gap-2 px-5 py-2">
        <p className="mx-taskbar-pill">
          <Glyph e="📝" spoken /> Do this now
        </p>
        <span aria-hidden className="hidden font-mono text-[0.7rem] font-bold tracking-[0.14em] text-muted sm:inline">
          LIVE TASK
        </span>
      </div>
      <div className="p-5">
        {/* On a phone the countdown sits under the text, so the text keeps the full width. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-2xl font-extrabold leading-tight tracking-tight text-[var(--mx-heading)] sm:text-[1.75rem]">{t.title}</h3>
            <p className="mt-1.5 text-base leading-relaxed text-muted">{t.detail}</p>
          </div>
          <Due t={t} big />
        </div>
        {t.href ? (
          <Link href={t.href} className="mx-key mx-key-solid mt-4 rounded-lg px-5 py-3 text-base font-extrabold">
            {t.linkLabel}
            <span aria-hidden> →</span>
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/** Everything else for now, as a short checklist. */
function SmallTask({ t }: { t: HomeTask }) {
  const st = STATE[t.state];
  return (
    <li className="mx-panel mb-2 flex flex-wrap items-center gap-3 rounded-xl p-3.5" data-testid={`task-${t.key}`} data-state={t.state}>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-raised text-xl text-phosphor" aria-hidden>
        <Glyph e={st?.icon ?? "ℹ️"} />
      </span>
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-[var(--mx-heading)]">{t.title}</h3>
          {st ? <span className={`mx-tag text-xs ${st.chip}`}>{t.stateLabel ?? st.label}</span> : null}
        </div>
        <p className="text-sm text-muted">{t.detail}</p>
      </div>
      {/* On a phone the countdown and the button go on their own row, under the text. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto">
        <Due t={t} />
        {t.href ? (
          <Link
            href={t.href}
            className={`mx-key shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${t.state === "todo" ? "" : "mx-key-quiet"}`}
          >
            {t.linkLabel}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
