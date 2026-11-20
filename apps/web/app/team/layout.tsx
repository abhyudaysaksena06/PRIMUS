import type { Metadata } from "next";
import Link from "next/link";
import { TRACK_LABELS, type Track } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { clock, money } from "@/lib/format";
import { ClockProvider } from "@/lib/live/clock";
import { EventChannel } from "@/lib/live/channel";
import { SquadChannel } from "@/lib/live/squad-channel";
import { Heartbeat } from "@/lib/live/heartbeat";
import { FallbackRefresh } from "@/app/display/[slug]/fallback-refresh";
import { FeedbackBar, FeedbackProvider } from "@/lib/live/feedback";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/ui";
import { Countdown, ServerClock } from "@/components/ui/countdown";
import { PORTAL_TITLES, portalAdmits, portalUrl, teamPortal, wrongPortalMessage } from "@/lib/portal/portal";
import { MarketStrip } from "./market-strip";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { TeamNav } from "./nav";
import { ActionBar } from "./action-bar";
import { Alerts, SoundToggle } from "./alerts";
import { loadPlanFacts } from "@/lib/team/home-data";
import { homePlan, nextDeadline } from "@/lib/team/home";
import { crisisSteps } from "@/lib/team/crisis-steps";
import { alertTasks, nextAction } from "@/lib/team/alerts";
import { RoundBanner } from "./round-banner";
import { FocusGate } from "./focus-gate";
import { focusSections, withLeaderboard } from "@/lib/team/focus";
import { featureOn } from "@/lib/event-status";
import { TeamFeatures } from "@/lib/team/features";
import { loadCrisisPopups } from "@/lib/team/crisis-popup-data";
import { withAssigned } from "@/lib/team/assigned-data";
import { badgeText, leaderboardOpen, loadLeaderboard } from "@/lib/team/leaderboard";
import { BootSequence } from "@/components/ui/matrix/boot-sequence";
import { Glyph } from "@/components/ui/matrix/glyph";
import "./team.css";
import { sectorStyle } from "@/lib/team/sectors";
import { CrisisSplash, type CrisisPopups, type SplashCard } from "./crisis-splash";
import { DraftWatch } from "./crisis/draft-watch";

const TRACK_EMOJI: Record<Track, string> = { PRODUCT: "🏢", CONSULTING: "🧠", FINANCE: "💼" };

export const metadata: Metadata = { title: { template: "%s · Team", default: "Team" } };

// Every team screen (laptop or phone): the team and its cash, a big banner with the round (1–3), the step of the night
// in plain words, the time left and the team's job, then only this round's sections (focus mode: pages of other
// rounds show a "not now" card), the "do this now" bar and the latest bulletin. The event's realtime channel refreshes the page on
// every broadcast, the squad's channel announces chat messages, and the heartbeat tells the control panel the screen
// is connected.
export default async function TeamLayout({ children }: LayoutProps<"/team">) {
  const ctx = await loadTeamContext();
  const { team, event, status } = ctx;
  // A track's portal shows only that track's pages: a team of another track (an old session) is sent to its own.
  const portal = await teamPortal();
  if (portal && !portalAdmits(portal, team.track)) {
    return (
      <main className="term flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md space-y-4 border border-line bg-panel p-6" data-testid="wrong-portal">
          <p className="bg-[var(--term-amber)] px-1.5 text-xs font-black tracking-widest text-black">PRIMUS</p>
          <p className="text-paper">{wrongPortalMessage(portal, team.track, portalUrl(team.track))}</p>
          <SignOutButton />
        </div>
      </main>
    );
  }
  // The bar and the alerts are guidance: if the plan cannot be read (say, the database is older than the app), every
  // page still works, without them.
  const loaded = await loadPlanFacts(ctx).catch((err: unknown) => {
    console.error("team layout: no plan for the bar and alerts:", err);
    return null;
  });
  // Tonight's switches that change the plan's words: Submit in the last 5 minutes; a firm assigned by the draw.
  const facts = loaded ? await withAssigned({ ...loaded, submitLast5: featureOn(status, "submit_last_5") }, ctx.company?.id ?? null) : null;
  const upNext = facts ? nextDeadline(facts) : null;
  const plan = facts ? homePlan(facts) : null;
  const next = plan ? nextAction(plan) : null;
  // A PRIMUS event's Rounds 2 and 3: the crisis under way and its steps, for the banner's "you are here" row.
  const k = facts?.primus?.k ?? null;
  const crisis =
    event.format === "PRIMUS" && facts && (status.phase === "PRESSURE" || status.phase === "SATURATION")
      ? {
          k,
          steps:
            k === null
              ? []
              : crisisSteps(team.track, k, Object.fromEntries(facts.deadlines.map((d) => [d.code, d.at])), k === 5 && (facts.primus?.workOpen === true || facts.primus?.hiringK === 5)),
        }
      : null;
  const sb = await supabaseServer();
  const { data: latest } = await sb
    .from("bulletins")
    .select("id, kind, title, published_at")
    .eq("event_id", event.id)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; kind: string; title: string; published_at: string }>();
  const finance = team.track === "FINANCE";
  // PRIMUS Round 2: the crisis pop-ups (switch crisis_popup: the reveal for everyone, then the card once hiring has
  // closed), or, with the switch off, the latest crisis card dealt to the squad's company, for the reveal moment.
  let splash: SplashCard | null = null;
  let popups: CrisisPopups | null = null;
  if (event.format === "PRIMUS" && status.phase === "PRESSURE" && featureOn(status, "crisis_popup")) {
    const p = await loadCrisisPopups(ctx, facts?.deadlines ?? null).catch((err: unknown) => {
      console.error("team layout: no crisis pop-ups:", err);
      return null;
    });
    splash = p?.card ?? null;
    popups = p?.popups ?? null;
  } else if (event.format === "PRIMUS" && status.phase === "PRESSURE" && ctx.company) {
    const { data: dealt } = await sb
      .from("subround_crises")
      .select("k, crisis_cards(category, title, body)")
      .eq("company_id", ctx.company.id)
      .order("k", { ascending: false })
      .limit(1)
      .maybeSingle<{ k: number; crisis_cards: { category: string; title: string; body: string } | { category: string; title: string; body: string }[] | null }>();
    const c = dealt ? (Array.isArray(dealt.crisis_cards) ? dealt.crisis_cards[0] : dealt.crisis_cards) : null;
    if (dealt && c) {
      const { data: sr } = await sb.from("subrounds").select("revealed_at").eq("event_id", event.id).eq("k", dealt.k).maybeSingle<{ revealed_at: string | null }>();
      if (sr?.revealed_at) splash = { eventId: event.id, teamId: team.id, k: dealt.k, category: c.category, title: c.title, body: c.body, revealedAt: sr.revealed_at };
    }
  }
  const taskHref = next?.href ?? null;
  // The live leaderboard (switch leaderboard): a tab for every track, and the Product team's own badge in the header.
  const leaderboardOn = featureOn(status, "leaderboard");
  const sections = withLeaderboard(focusSections(team.track, status.phase, taskHref), leaderboardOn);
  const myRow =
    leaderboardOn && team.track === "PRODUCT" && ctx.company
      ? await loadLeaderboard(sb, event.id).then((rows) => (rows && leaderboardOpen(rows) ? (rows.find((r) => r.company_id === ctx.company!.id) ?? null) : null))
      : null;
  // Product and Consulting teams do not trade, but the halt after a crisis reveal concerns them too.
  const halted = event.format === "PRIMUS" && team.track !== "FINANCE" && (status.phase === "PRESSURE" || status.phase === "SATURATION") && status.trading !== "OPEN";
  return (
    <ClockProvider serverTime={status.server_time} pausedAt={status.paused ? status.paused_at : null}>
      <TeamFeatures features={status.features}>
      <EventChannel eventId={event.id} teamId={team.id} spreadMs={4000}>
        <SquadChannel squadId={ctx.squad?.id ?? null}>
        <FeedbackProvider>
        <Heartbeat eventId={event.id} area="team" />
        {/* Realtime down: re-read every 20 s until it is back. */}
        <FallbackRefresh everyMs={20_000} safetyMs={0} />
        <BootSequence who={team.code} />
        <CrisisSplash card={splash} own={team.track === "PRODUCT"} popups={popups} />
        {/* "Your pick!" on every page during a by-sector Round 3 draft (it stops by itself when the draft ends). */}
        <DraftWatch eventId={event.id} companyId={ctx.company?.id ?? null} active={event.format === "PRIMUS" && team.track === "PRODUCT" && status.phase === "SATURATION" && featureOn(status, "draft_by_sector", true)} />
        <div className="terminal-theme-scope term min-h-screen">
          <header className="border-b border-line bg-ink">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--term-amber-dim)] px-4 py-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="bg-[var(--term-amber)] px-1.5 text-xs font-black tracking-widest text-black">PRIMUS</span>
                <span className="text-lg text-[var(--term-amber)]" aria-hidden>
                  <Glyph e={TRACK_EMOJI[team.track]} />
                </span>
                {/* The cursor sits beside the heading, so the heading reads exactly the team code. */}
                <h1 className="text-lg font-bold text-[var(--term-amber)]">{team.code}</h1>
                <span className="term-cursor -ml-1.5 text-lg text-[var(--term-amber)]" aria-hidden>
                  ▮
                </span>
                <Badge tone="slate">{portal ? PORTAL_TITLES[portal] : TRACK_LABELS[team.track]}</Badge>
                {ctx.sector ? (
                  // The squad's sector, in its own colour on every page.
                  <span className={`rounded px-2 py-0.5 text-xs font-black uppercase tracking-wider ${sectorStyle(ctx.sector).chip}`} data-testid="team-sector">
                    <Glyph e={sectorStyle(ctx.sector).icon} /> {ctx.sector}
                  </span>
                ) : null}
                <span className="hidden truncate text-sm uppercase text-muted sm:inline">{team.name}</span>
                {event.is_rehearsal ? <Badge tone="violet">Rehearsal ×{event.clock_speed}</Badge> : null}
                {myRow ? (
                  <Link href="/team/leaderboard" className="rounded border border-phosphor px-2 py-0.5 font-mono text-xs font-bold text-phosphor" data-testid="rating-badge">
                    {badgeText(myRow)}
                  </Link>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <RealtimeDot />
                <SoundToggle />
                {upNext ? (
                  // The team's own next deadline, on every page.
                  <span className="text-xs text-paper" data-testid="next-deadline">
                    Next: <span className="text-[var(--term-amber)]">{upNext.title}</span> {clock(upNext.at)} ·{" "}
                    <Countdown to={upNext.at} passed="now" className="font-semibold text-[var(--term-amber)]" />
                  </span>
                ) : null}
                <ServerClock className="font-semibold text-[var(--term-amber)]" />
                <span className="text-xs text-muted">IST</span>
                <SignOutButton />
              </div>
            </div>
            {/* Two facts only: the team's cash, and its own thing (a fund: the trading round; the others: their
                company and its share price). The round and the time left are in the banner below. */}
            <dl className="grid grid-cols-2 gap-px bg-line text-sm">
              <div className="bg-ink px-4 py-1.5">
                <dt className="text-xs uppercase tracking-wider text-[var(--term-amber-dim)]">Your cash</dt>
                <dd className="font-mono text-base font-semibold tabular-nums text-[var(--term-green)]" data-testid="team-cash">
                  {money(team.cash)}
                  {finance && team.collateral > 0 ? (
                    <span className="ml-1 text-xs font-normal text-muted">locked {money(team.collateral)}</span>
                  ) : null}
                </dd>
              </div>
              {finance ? (
                <div className="bg-ink px-4 py-1.5">
                  <dt className="text-xs uppercase tracking-wider text-[var(--term-amber-dim)]">Trading</dt>
                  <dd className="text-base">
                    <Badge tone={status.trading === "OPEN" ? "green" : status.trading === "PAUSED" ? "amber" : "slate"}>{status.trading}</Badge>
                    {status.trading === "OPEN" && status.open_round ? (
                      <span className="ml-1 text-muted">
                        Round {status.open_round.number} · <Countdown to={status.open_round.closes_at} passed="clearing" className="text-[var(--term-amber)]" />
                      </span>
                    ) : status.next_round ? (
                      <span className="ml-1 text-muted">
                        Round {status.next_round.number} at {clock(status.next_round.opens_at)}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : (
                <div className="bg-ink px-4 py-1.5">
                  <dt className="text-xs uppercase tracking-wider text-[var(--term-amber-dim)]">{team.track === "PRODUCT" ? "Your company" : "Your squad's company"}</dt>
                  <dd className="font-mono text-base text-[var(--term-cyan)]" data-testid="team-company">
                    {ctx.company?.ticker
                      ? `${ctx.company.ticker} · ${money(ctx.company.market_price)}`
                      : ctx.company
                        ? <span className="font-sans text-sm text-muted">Named on the PRD</span>
                        : <span className="font-sans text-sm text-muted">After the squad draw</span>}
                    {halted ? (
                      <span className="ml-2 font-sans text-xs text-warn" data-testid="trading-halted">
                        Trading halted
                        {status.next_round ? (
                          <>
                            {" "}
                            · round {status.next_round.number} opens {clock(status.next_round.opens_at)} (<Countdown to={status.next_round.opens_at} passed="now" />)
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </dd>
                </div>
              )}
            </dl>
            <MarketStrip eventId={event.id} />
          </header>
          <RoundBanner
            track={team.track}
            phase={status.phase}
            endsAt={status.phase_ends_at}
            gate={status.gate}
            next={status.next_phase}
            openRound={status.trading === "OPEN" ? status.open_round : null}
            format={event.format}
            crisis={crisis}
          />
          <div className="sticky top-0 z-40 border-b border-line bg-ink">
            <TeamNav sections={sections} />
          </div>
          <ActionBar task={next && next.href ? { title: next.title, href: next.href, linkLabel: next.linkLabel, due: next.due } : null} />
          <Alerts tasks={plan ? alertTasks(plan) : []} track={team.track} teamId={team.id} />
          {status.paused ? (
            <p className="border-y border-warn/60 bg-ink px-4 py-2 text-center text-sm font-medium text-warn">
              The event is paused. Deadlines move later by the length of the pause.
            </p>
          ) : null}
          {team.disqualified ? (
            <p className="border-y border-danger/70 bg-ink px-4 py-2 text-center text-sm font-medium text-danger-soft">
              Your team has been disqualified by the fairness officer{team.disqualified_reason ? `: ${team.disqualified_reason}` : "."}
            </p>
          ) : null}
          {latest ? (
            <Link
              href="/team/bulletins"
              className="mx-auto block max-w-5xl px-4 pt-3 text-sm [overflow-wrap:anywhere]"
              data-testid="latest-bulletin"
            >
              <span className="mx-tag text-xs text-phosphor">{latest.kind}</span>{" "}
              <span className="font-mono text-xs text-muted">{clock(latest.published_at)}</span>{" "}
              <span className="font-semibold text-phosphor underline-offset-2 hover:underline">{latest.title}</span>
            </Link>
          ) : null}
          <FeedbackBar className="mx-auto max-w-5xl px-4 pt-3" />
          <main className="mx-auto max-w-5xl px-4 py-4">
            <FocusGate track={team.track} phase={status.phase} taskHref={taskHref} format={event.format}>
              {children}
            </FocusGate>
          </main>
        </div>
      </FeedbackProvider>
        </SquadChannel>
      </EventChannel>
      </TeamFeatures>
    </ClockProvider>
  );
}
