import type { Metadata } from "next";
import type { PhaseCode } from "@msim/engine";
import { currentViewer } from "@/lib/auth/viewer";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { buildRunSheet, phaseName, type SheetDeadline, type SheetPhase, type SheetSubround, type Step } from "@/lib/admin/run-sheet";
import { supabaseServer } from "@/lib/supabase/server";
import { clock } from "@/lib/format";
import { Badge, Notice, Panel, Table, Td } from "@/app/admin/guide-ui";
import { ActionButton } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { RefreshAt } from "@/lib/live/refresh-at";
import { pauseEvent, resumeEvent } from "../actions";
import { closeRound } from "../rounds/actions";
import { delayStep, openRoundNow, resetRehearsal, setHoldSteps, setManual, startNextPhase, startStepNow } from "./actions";
import { SwitchesPanel } from "./switches";
import { PracticeMarketPanel } from "./practice-market";

export const metadata: Metadata = { title: "Run the event" };

interface LogRow {
  id: number;
  at: string;
  kind: string;
  what: string;
  by_organiser: boolean;
  by_name: string | null;
}
interface RoundRow {
  number: number;
  phase: PhaseCode;
  status: string;
  opens_at: string;
  closes_at: string;
}

const STATE_BADGE: Record<Step["state"], { tone: "green" | "amber" | "slate" | "blue"; text: string }> = {
  DONE: { tone: "slate", text: "Done" },
  NOW: { tone: "green", text: "Now" },
  NEXT: { tone: "amber", text: "Next" },
  LATER: { tone: "slate", text: "Planned" },
};

// Run the event: the whole night as a list of rounds and steps, each with its time, what is happening now and what is
// next, and the organiser's buttons: start the next phase now, do the next step now, add time, pause, and manual mode
// (nothing starts by itself). Below, the trading windows and the event log.
export default async function RunPage({ params }: PageProps<"/admin/[slug]/run">) {
  const { slug } = await params;
  const [viewer, event] = await Promise.all([currentViewer(), loadAdminEvent(slug)]);
  const status = await loadEventStatus(event.id);
  const organiser = viewer!.role === "ORGANISER";
  const sb = await supabaseServer();
  const [ev, phases, deadlines, subrounds, rounds, log] = await Promise.all([
    sb.from("events").select("manual_starts, hold_steps").eq("id", event.id).maybeSingle<{ manual_starts: boolean; hold_steps: boolean }>(),
    sb.from("phases").select("code, seq, starts_at, ends_at, started_at, ended_at").eq("event_id", event.id).order("seq"),
    sb.from("deadlines").select("code, at").eq("event_id", event.id).order("at"),
    sb.from("subrounds").select("k, revealed_at, hiring_closed_at, due_closed_at, rated_at").eq("event_id", event.id).order("k"),
    sb.from("rounds").select("number, phase, status, opens_at, closes_at").eq("event_id", event.id).order("number"),
    sb.from("event_log").select("id, at, kind, what, by_organiser, by_name").eq("event_id", event.id).order("id", { ascending: false }).limit(200),
  ]);
  const manual = ev.data?.manual_starts ?? false;
  const holdSteps = manual && (ev.data?.hold_steps ?? false);
  const now = new Date(status.server_time).getTime();
  const { stages, next } = buildRunSheet({
    now,
    current: status.phase,
    phases: (phases.data ?? []) as SheetPhase[],
    deadlines: (deadlines.data ?? []) as SheetDeadline[],
    subrounds: (subrounds.data ?? []) as SheetSubround[],
  });
  const roundRows = (rounds.data ?? []) as RoundRow[];
  const logRows = (log.data ?? []) as LogRow[];
  const open = roundRows.find((r) => r.status === "OPEN") ?? null;
  const nextRound = roundRows.find((r) => r.status === "SCHEDULED") ?? null;
  const nextPhase = status.next_phase;
  const blocked = status.gate ?? (status.paused ? "Resume the event first." : null);
  const phaseEnd = (phases.data ?? []).find((p) => p.code === status.phase)?.ends_at ?? null;
  // A held step: in manual mode a Round 2 crisis that has not been started, or, when every step waits, any next step
  // whose time has come (the clock keeps it two minutes away until the organiser starts it).
  const holding =
    !!next && ((manual && status.phase === "PRESSURE" && next.key.startsWith("REVEAL_")) || (holdSteps && new Date(next.at).getTime() - now <= 150_000));
  const nextRoundHere = nextRound && nextRound.phase === status.phase ? nextRound : null;
  const tradingButton =
    organiser && open ? (
      <ActionButton action={closeRound.bind(null, event.id, open.number)} confirm={`Click again to close window ${open.number} now`}>
        Close window {open.number} now
      </ActionButton>
    ) : organiser && nextRoundHere ? (
      <ActionButton
        action={openRoundNow.bind(null, event.id, nextRoundHere.number)}
        confirm={`Click again to open window ${nextRoundHere.number} now`}
        disabled={status.paused}
        title="Opens the next trading window now, for its planned length"
      >
        Open window {nextRoundHere.number} now
      </ActionButton>
    ) : null;

  const stepButtons = (s: Step) =>
    organiser && s.movable ? (
      <div className="flex flex-wrap gap-2">
        <ActionButton
          action={startStepNow.bind(null, event.id, s.at, s.label)}
          confirm={`Click again: ${s.label.toLowerCase()} now`}
          variant="primary"
          disabled={status.paused}
          title={s.action}
        >
          {s.key.startsWith("REVEAL_") ? `Start ${s.label.replace(" revealed", "")} now` : "Do it now"}
        </ActionButton>
        {[5, 10].map((m) => (
          <ActionButton key={m} action={delayStep.bind(null, event.id, s.at, m, s.label)} confirm={`Click again: +${m} min`} title="This step and everything after it move later">
            +{m} min
          </ActionButton>
        ))}
      </div>
    ) : null;

  return (
    <div className="space-y-6" data-testid="run-page">
      <RefreshAt at={next?.at ?? null} />
      <RefreshAt at={open?.closes_at ?? nextRound?.opens_at ?? null} />

      {/* ── Now: where the night is and the main buttons ── */}
      <Panel title="Now">
        <div className="guide-grid three">
          <div className="guide-metric">
            <small>Current phase</small>
            <b data-testid="run-phase">{phaseName(status.phase)}</b>
            <div className="guide-status">
              {status.paused ? (
                <Badge tone="amber">Paused since {clock(status.paused_at)}</Badge>
              ) : manual ? (
                <>Ends when you start the next phase.</>
              ) : phaseEnd ? (
                <>
                  Planned end {clock(phaseEnd)} (<Countdown to={phaseEnd} passed="due" />)
                </>
              ) : null}
            </div>
          </div>
          <div className="guide-metric">
            <small>Next step</small>
            {next ? (
              <>
                <b data-testid="run-next">{next.label}</b>
                <div className="guide-status">
                  {holding ? (
                    <Badge tone="amber">Waiting for you</Badge>
                  ) : (
                    <>
                      At {clock(next.at)} · in <Countdown to={next.at} passed="now" />
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="guide-status">Nothing more in this phase. Start the next phase when you are ready.</div>
            )}
          </div>
          <div className="guide-metric">
            <small>Trading</small>
            <b>{open ? `Window ${open.number} open` : status.paused ? "Paused" : "Closed"}</b>
            <div className="guide-status">
              {open ? (
                <>
                  Closes in <Countdown to={open.closes_at} />
                </>
              ) : nextRound ? (
                <>Window {nextRound.number} opens {clock(nextRound.opens_at)}</>
              ) : (
                <>No more trading windows.</>
              )}
            </div>
          </div>
        </div>

        {organiser ? (
          <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-[#292e38] pt-4">
            {nextPhase ? (
              <ActionButton
                action={startNextPhase.bind(null, event.id, status.phase, phaseName(nextPhase))}
                confirm={`Click again to end ${phaseName(status.phase)} and start ${phaseName(nextPhase)} now`}
                variant="primary"
                disabled={!!blocked}
                title={blocked ?? undefined}
              >
                End {phaseName(status.phase)} · start {phaseName(nextPhase)}
              </ActionButton>
            ) : null}
            {next && next.movable ? stepButtons(next) : null}
            {tradingButton}
            {status.paused ? (
              <ActionButton action={resumeEvent.bind(null, event.id)} confirm="Click again to resume" variant="primary">
                Resume
              </ActionButton>
            ) : (
              <ActionButton action={pauseEvent.bind(null, event.id)} confirm="Click again to pause everything">
                Pause everything
              </ActionButton>
            )}
          </div>
        ) : null}
        {blocked ? (
          <div className="mt-3">
            <Notice tone="amber">
              <strong>Before the next phase:</strong> {blocked}
            </Notice>
          </div>
        ) : null}
      </Panel>

      {/* ── Tonight's switches (migration 070) ── */}
      <SwitchesPanel eventId={event.id} organiser={organiser} />
      <PracticeMarketPanel eventId={event.id} organiser={organiser} />

      {/* ── Manual mode ── */}
      <Panel title="Who starts things">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm text-paper">
            {manual ? (
              <>
                <Badge tone="green">Manual</Badge> Nothing moves to the next phase by itself, and in Round 2 the clock waits before each crisis until you
                press <strong>Start crisis</strong>.{" "}
                {holdSteps ? (
                  <>
                    <Badge tone="green">Every step waits</Badge> Every step inside a round (hiring, plans due, ratings, the draft, IPO bids) also waits:
                    when its time comes, the clock holds until you press <strong>Do it now</strong>. An open trading window stays open meanwhile.
                  </>
                ) : (
                  <>
                    Steps inside a round (hiring, plans due, ratings) still run on their timers; use <strong>Do it now</strong> or{" "}
                    <strong>+5 min</strong> to change them, or make every step wait for you.
                  </>
                )}
              </>
            ) : (
              <>
                <Badge tone="blue">Automatic</Badge> The clock runs the plan below by itself. You can still do any next step now or add time. Turn on
                manual mode to start every phase and crisis yourself.
              </>
            )}
          </p>
          {organiser ? (
            <ActionButton
              action={setManual.bind(null, event.id, !manual)}
              confirm={manual ? "Click again: let the clock run the plan" : "Click again: I will start every phase and crisis myself"}
              variant={manual ? "secondary" : "primary"}
            >
              {manual ? "Switch to automatic" : "Switch to manual"}
            </ActionButton>
          ) : null}
          {organiser && manual ? (
            <ActionButton
              action={setHoldSteps.bind(null, event.id, !holdSteps)}
              confirm={holdSteps ? "Click again: steps run on their timers" : "Click again: every step waits for me"}
              variant={holdSteps ? "secondary" : "primary"}
            >
              {holdSteps ? "Let steps run on their timers" : "Make every step wait for me"}
            </ActionButton>
          ) : null}
        </div>
      </Panel>

      {/* ── The plan ── */}
      {stages.map((st) => (
        <Panel
          key={st.key}
          title={
            <span className="flex items-center gap-2">
              {st.title}
              {st.state === "NOW" ? <Badge tone="green">Now</Badge> : st.state === "DONE" ? <Badge tone="slate">Done</Badge> : null}
            </span>
          }
        >
          <p className="mb-3 text-sm text-paper">{st.blurb}</p>
          <div className={st.groups.length > 2 ? "grid gap-3 md:grid-cols-2" : "space-y-3"}>
            {st.groups.map((g) => (
              <div
                key={g.key}
                className={g.title ? "guide-group p-3" : st.groups.length > 2 ? "md:col-span-2" : ""}
                data-testid={g.title ? `group-${g.key}` : undefined}
              >
                {g.title ? <h3 className="mb-2">{g.title}</h3> : null}
                <ol className="space-y-2">
                  {g.steps.map((s) => (
                    <li
                      key={s.key}
                      className={`guide-row flex-wrap justify-between ${s.state === "NOW" ? "current" : s.state === "DONE" ? "done" : ""}`}
                      data-state={s.state}
                      data-testid={`step-${s.key}`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge tone={STATE_BADGE[s.state].tone}>{STATE_BADGE[s.state].text}</Badge>
                        <span className={`text-sm ${s.state === "DONE" ? "text-[#8f96a2]" : "text-[#e6e8ed]"}`}>{s.label}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="guide-time w-auto">
                          {s.doneAt ? clock(s.doneAt) : clock(s.at)}
                          {s.state === "NEXT" && holding ? (
                            <span className="ml-2 text-warn">waiting for you</span>
                          ) : s.state === "NEXT" ? (
                            <span className="ml-2 text-warn">
                              in <Countdown to={s.at} passed="now" />
                            </span>
                          ) : null}
                        </span>
                        {s.movable && organiser ? <span className="text-xs text-warn">Use the buttons under Now, at the top</span> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Panel>
      ))}

      {/* ── Trading windows ── */}
      {roundRows.length ? (
        <Panel title="Trading windows">
          <p className="mb-3 text-sm text-paper">
            Short market windows inside Rounds 2 and 3 (prices clear at the end of each). They open and close on their times and move with the steps
            above when you start something early, add time or the clock holds. You can close the open window now, or open the next one now.
          </p>
          {tradingButton ? <div className="mb-3">{tradingButton}</div> : null}
          <details>
            <summary className="cursor-pointer text-sm text-phosphor">Show all {roundRows.length} windows</summary>
            <Table head={["Window", "Round", "Opens", "Closes", "Status"]} label="Trading windows" className="mt-2">
              {roundRows.map((r) => (
                <tr key={r.number}>
                  <Td mono>{r.number}</Td>
                  <Td>{phaseName(r.phase)}</Td>
                  <Td mono>{clock(r.opens_at)}</Td>
                  <Td mono>{clock(r.closes_at)}</Td>
                  <Td>
                    <Badge tone={r.status === "OPEN" ? "green" : "slate"}>{r.status === "SCHEDULED" ? "Planned" : r.status === "OPEN" ? "Open" : "Closed"}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </details>
        </Panel>
      ) : null}

      {/* ── The log ── */}
      <Panel
        title="Event log"
        actions={
          <a
            href={`/admin/${slug}/exports/timeline`}
            download={`${slug}-timeline.csv`}
            className="rounded-md bg-panel px-3 py-1.5 text-sm font-semibold text-phosphor ring-1 ring-inset ring-line hover:bg-raised"
          >
            Download CSV
          </a>
        }
      >
        <p className="mb-3 text-sm text-paper">When every phase, crisis step and trading window started and ended, newest first, and who did it.</p>
        <Table head={["Time", "What happened", "By"]} label="Event log" empty="Nothing has happened yet.">
          {logRows.map((r) => (
            <tr key={r.id}>
              <Td mono>{clock(r.at, true)}</Td>
              <Td className="whitespace-normal">{r.what}</Td>
              <Td>{r.by_organiser ? <Badge tone="blue">{r.by_name ?? "Organiser"}</Badge> : <span className="text-muted">Clock</span>}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      {/* ── Reset (rehearsals only) ── */}
      {organiser && event.is_rehearsal ? (
        <Panel title="Reset this demo">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-3xl text-sm text-paper">
              <Badge tone="amber">Rehearsal</Badge> Puts this demo back to the start: Setup, no draw, no submissions, trades, chats or scores. The same
              teams, logins, passwords and cards stay, and the plan starts again 5 minutes from now. Manual mode stays as it is. The live event can never
              be reset.
            </p>
            <ActionButton action={resetRehearsal.bind(null, event.id, slug)} confirm="Click again: wipe this demo and start over">
              Reset demo
            </ActionButton>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
