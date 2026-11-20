import type { Metadata } from "next";
import { PHASE_LABELS } from "@msim/engine";
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
import { Countdown } from "@/components/ui/countdown";
import { PORTAL_TITLES, portalAdmits, portalUrl, teamPortal, wrongPortalMessage } from "@/lib/portal/portal";
import { HeaderLinks, MenuButton, MobileNav, TeamNav } from "./nav";
import { NewsTicker, type TickerStory } from "@/components/guide/news-ticker";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { ActionBar } from "./action-bar";
import { Alerts, SoundToggle } from "./alerts";
import { loadPlanFacts } from "@/lib/team/home-data";
import { homePlan, nextDeadline } from "@/lib/team/home";
import { crisisHeadline } from "@/lib/team/crisis-steps";
import { alertTasks, nextAction } from "@/lib/team/alerts";
import { PhaseEnd } from "./phase-end";
import { FocusGate } from "./focus-gate";
import { focusSections, stageInfo, stageOf, withLeaderboard } from "@/lib/team/focus";
import { featureOn } from "@/lib/event-status";
import { TeamFeatures } from "@/lib/team/features";
import { loadCrisisPopups } from "@/lib/team/crisis-popup-data";
import { withAssigned } from "@/lib/team/assigned-data";
import { BootSequence } from "@/components/ui/matrix/boot-sequence";
import "@/app/demo/demo.css";
import "@/app/demo/header-links.css";
import "./team.css";
import { CrisisSplash, type CrisisPopups, type SplashCard } from "./crisis-splash";
import { DraftWatch } from "./crisis/draft-watch";


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
      <main className="guide-app flex min-h-dvh items-center justify-center px-4" data-track={team.track}>
        <div className="guide-atmosphere" />
        <section className="guide-panel relative w-full max-w-md" data-testid="wrong-portal">
          <div className="guide-panel-head">
            <h2>PRIMUS ’26</h2>
            <span>WRONG PORTAL</span>
          </div>
          <div className="guide-panel-body space-y-4">
            <p className="guide-alert guide-warning">{wrongPortalMessage(portal, team.track, portalUrl(team.track))}</p>
            <SignOutButton />
          </div>
        </section>
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
  // A PRIMUS event's Rounds 2 and 3: the crisis under way, for the phase chip.
  const k = facts?.primus?.k ?? null;
  const sb = await supabaseServer();
  // The newest bulletins, for the bottom news ticker (the demo's EventNewsTicker); the first is the latest.
  const { data: recent } = await sb
    .from("bulletins")
    .select("id, kind, title, published_at")
    .eq("event_id", event.id)
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(8)
    .returns<{ id: string; kind: string; title: string; published_at: string }[]>();
  const latest = recent?.[0] ?? null;
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
  // Product and Consulting teams do not trade, but the halt after a crisis reveal concerns them too.
  const halted = event.format === "PRIMUS" && team.track !== "FINANCE" && (status.phase === "PRESSURE" || status.phase === "SATURATION") && status.trading !== "OPEN";
  // The demo's top bar: the round chip ("ROUND 2 · CRISIS 1 OF 4") and the time left in it.
  const stageNow = stageInfo(stageOf(status.phase), event.format);
  const stepName =
    event.format === "PRIMUS" && (status.phase === "PRESSURE" || status.phase === "SATURATION") ? crisisHeadline(status.phase, k, null).name : stageNow.title;
  const phaseChip = (stageNow.round ? `Round ${stageNow.round} · ${stepName}` : stageNow.title).toUpperCase();
  // The round as words (the old banner's label) and the step of the night, for screen readers and the tests.
  const roundLabel = stageNow.round ? `Round ${stageNow.round} of 3 · ${stageNow.title}` : stageNow.title;
  const navRound = status.phase === "SATURATION" || status.phase === "CLOSE" ? 3 : status.phase === "PRESSURE" ? 2 : stageNow.round;
  const deskLabel = team.track === "FINANCE" ? "FINANCE DESK" : team.track === "CONSULTING" ? "CONSULTING DESK" : "PRODUCT DESK";
  const rainTone = team.track === "CONSULTING" ? "blue" : team.track === "PRODUCT" ? "amber" : "green";
  // The bottom ticker: the crisis notices first, then the newest bulletins.
  const stories: TickerStory[] = [
    ...(popups?.reveal
      ? [{ id: `reveal-${popups.reveal.k}`, time: clock(popups.reveal.revealedAt), type: "CRISIS", title: `Crisis ${popups.reveal.k} is here${popups.reveal.category ? ` · ${popups.reveal.category}` : ""}` }]
      : []),
    ...(splash ? [{ id: `card-${splash.k}`, time: clock(splash.revealedAt), type: "CRISIS", title: splash.title }] : []),
    ...(recent ?? []).map((b) => ({ id: b.id, time: clock(b.published_at), type: b.kind.toUpperCase(), title: b.title })),
  ];
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
        {/* "Your pick!" on every page during a by-sector Round 3 draft (it stops by itself when the draft ends). */}
        <DraftWatch eventId={event.id} companyId={ctx.company?.id ?? null} active={event.format === "PRIMUS" && team.track === "PRODUCT" && status.phase === "SATURATION" && featureOn(status, "draft_by_sector", true)} />
        {/* The demo's shell (app/demo/layout.tsx): the sidebar, the top bar, the DO THIS NOW strip, the page, the
            footer and the news ticker, over the track's rain. */}
        <div className="guide-app terminal-theme-scope term" data-track={team.track} data-menu="closed">
          <div className="guide-atmosphere" />
          <CrisisSplash card={splash} own={team.track === "PRODUCT"} popups={popups} />
          <MatrixRain opacity={0.28} size={15} tone={rainTone} className="demo-matrix-rain-fixed" />
          <TeamNav team={{ code: team.code, name: team.name, track: team.track }} round={navRound} />
          <div className="guide-main guide-participant-main">
            <header className="guide-top">
              <div className="guide-top-left">
                <MenuButton />
                <h1 className="guide-team-code">{team.code}</h1>
                <span className="guide-top-name">{team.name}</span>
                {/* The demo's phase chip; the round in words and the step (a heading) for screen readers. */}
                <b className="guide-phase" data-testid="round-banner">
                  <span className="sr-only" data-testid="round-label">
                    {roundLabel}
                  </span>
                  <span aria-hidden>{phaseChip}</span>
                  <span className="sr-only" role="heading" aria-level={2}>
                    {stepName}
                  </span>
                </b>
                {status.phase_ends_at ? (
                  <span className="guide-countdown" data-testid="team-phase">
                    <span className="sr-only">{PHASE_LABELS[status.phase]} </span>
                    <PhaseEnd endsAt={status.phase_ends_at} phase={status.phase} gate={status.gate} next={status.next_phase} variant="left" className="" />
                  </span>
                ) : (
                  <span className="sr-only" data-testid="team-phase">
                    {PHASE_LABELS[status.phase]}
                  </span>
                )}
              </div>
              <HeaderLinks leaderboard={sections.some((x) => x.path === "/leaderboard")} />
              <div className="guide-top-right">
                <span className="guide-trading">
                  <i /> {portal ? PORTAL_TITLES[portal].toUpperCase() : deskLabel}
                </span>
                <span className="guide-cash">
                  CASH
                  <b data-testid="team-cash">
                    {money(team.cash)}
                    {finance && team.collateral > 0 ? <small className="guide-top-sub"> locked {money(team.collateral)}</small> : null}
                  </b>
                </span>
                {finance ? (
                  <span className="guide-ticker">
                    TRADING
                    <b>
                      {status.trading}
                      {status.trading === "OPEN" && status.open_round ? (
                        <>
                          {" "}
                          · R{status.open_round.number} · <Countdown to={status.open_round.closes_at} passed="clearing" />
                        </>
                      ) : status.next_round ? (
                        <>
                          {" "}
                          · R{status.next_round.number} AT {clock(status.next_round.opens_at)}
                        </>
                      ) : null}
                    </b>
                  </span>
                ) : (
                  <span className="guide-ticker">
                    {team.track === "PRODUCT" ? "COMPANY" : "SQUAD'S COMPANY"}
                    <b data-testid="team-company">
                      {ctx.company?.ticker
                        ? `${ctx.company.ticker} · ${money(ctx.company.market_price)}`
                        : ctx.company
                          ? "Named on the PRD"
                          : "After the squad draw"}
                      {halted ? (
                        <small className="guide-top-sub guide-top-warn" data-testid="trading-halted">
                          {" "}
                          Trading halted
                          {status.next_round ? (
                            <>
                              {" "}
                              · round {status.next_round.number} opens {clock(status.next_round.opens_at)} (<Countdown to={status.next_round.opens_at} passed="now" />)
                            </>
                          ) : null}
                        </small>
                      ) : null}
                    </b>
                  </span>
                )}
                {upNext ? (
                  // The team's own next deadline, on every page (the demo's last chip).
                  <span className="guide-ticker" data-testid="next-deadline">
                    NEXT{" "}
                    <b>
                      {upNext.title} {clock(upNext.at)} · <Countdown to={upNext.at} passed="now" />
                    </b>
                  </span>
                ) : null}
                <SoundToggle />
              </div>
            </header>
            <ActionBar task={next && next.href ? { title: next.title, href: next.href, linkLabel: next.linkLabel, due: next.due } : null} />
            <Alerts tasks={plan ? alertTasks(plan) : []} track={team.track} teamId={team.id} />
            {status.paused ? (
              <p className="guide-alert guide-warning guide-shell-notice">The event is paused. Deadlines move later by the length of the pause.</p>
            ) : null}
            {team.disqualified ? (
              <p className="guide-alert guide-shell-notice guide-shell-danger">
                Your team has been disqualified by the fairness officer{team.disqualified_reason ? `: ${team.disqualified_reason}` : "."}
              </p>
            ) : null}
            <main className="guide-content">
              <FeedbackBar className="mb-4" />
              <FocusGate track={team.track} phase={status.phase} taskHref={taskHref} format={event.format}>
                {children}
              </FocusGate>
            </main>
            <div className="guide-footer" aria-hidden>
              <span>PRIMUS ’26 · WHERE EVERY DECISION CONNECTS</span>
              <span>TEAM {team.code} · {team.track} · IST</span>
            </div>
            <footer className="guide-desk-footer">
              <NewsTicker stories={stories} href="/team/bulletins" testId={latest ? "latest-bulletin" : undefined} />
              <MobileNav track={team.track} round={navRound} />
            </footer>
          </div>
        </div>
      </FeedbackProvider>
        </SquadChannel>
      </EventChannel>
      </TeamFeatures>
    </ClockProvider>
  );
}
