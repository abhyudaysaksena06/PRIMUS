// The top of the big screen: the event clock, the phase, the round with its countdown to the close, and a badge
// reading OPEN, HALTED or PAUSED. Everything is from event_status (the server's view), counted down against the
// server clock; during a pause the countdowns stand still (the schedule moves later by the pause on resume).
// Drawn with the /demo projector's own parts (app/demo/display): its page head (eyebrow, title, line) on the left and
// its row of .guide-metric tiles (the round, trading and the clock) on the right.

import { PHASE_LABELS } from "@msim/engine";
import type { EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";
import { clock } from "@/lib/format";
import { Countdown, ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { PhaseTimer } from "./phase-timer";

export function DisplayHeader({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  return (
    <header className="guide-stage-head flex h-[150px] shrink-0 items-center gap-6 px-10" data-testid="display-header">
      <div className="guide-page-head min-w-0 flex-1">
        <small className="flex min-w-0 items-center gap-4">
          <span className="shrink-0" aria-hidden>
            PUBLIC STAGE OUTPUT /
          </span>
          <span className="truncate">{event.name.toUpperCase()}</span>
          {event.is_rehearsal ? <b className="guide-phase shrink-0">REHEARSAL ×{event.clock_speed}</b> : null}
        </small>
        <p className="guide-page-title truncate" data-testid="display-phase">
          {PHASE_LABELS[status.phase]}
        </p>
      </div>

      <div className="guide-metric guide-stage-metric min-w-[440px]" data-testid="display-round">
        {status.open_round ? (
          <>
            <small>{status.paused ? `Round ${status.open_round.number} is paused with` : `Round ${status.open_round.number} closes in`}</small>
            {/* While paused the countdown stands still at the time the round had left when the pause began. */}
            <b className={status.paused ? "guide-warn" : undefined}>
              <Countdown to={status.open_round.closes_at} passed={status.paused ? "0:00" : "clearing…"} />
            </b>
          </>
        ) : status.next_round ? (
          <>
            <small>Round {status.next_round.number} opens</small>
            {status.paused ? <b className="guide-warn">after the pause</b> : <b>at {clock(status.next_round.opens_at)}</b>}
          </>
        ) : (
          <div className="guide-phase-timer">
            <PhaseTimer endsAt={status.phase_ends_at} phase={status.phase} gate={status.gate} next={status.next_phase} paused={status.paused} />
          </div>
        )}
      </div>

      <div className="guide-metric guide-stage-metric">
        <small aria-hidden>Trading</small>
        <b className="guide-trading-state" data-state={status.trading} data-testid="display-trading">
          {status.trading}
        </b>
      </div>

      <div className="guide-metric guide-stage-metric">
        <small aria-hidden>IST</small>
        <b>
          <ServerClock />
        </b>
        <span className="guide-stage-live">
          <RealtimeDot />
        </span>
      </div>
    </header>
  );
}
