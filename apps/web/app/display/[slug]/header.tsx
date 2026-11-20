// The top of the big screen: the event clock, the phase, the round with its countdown to the close, and a badge
// reading OPEN, HALTED or PAUSED. Everything is from event_status (the server's view), counted down against the
// server clock; during a pause the countdowns stand still (the schedule moves later by the pause on resume).
// Drawn in the /demo projector's look (display.css): a green monospace eyebrow over the phase, and the countdown and
// the clock in metric tiles.

import { PHASE_LABELS } from "@msim/engine";
import type { EventStatus } from "@/lib/event-status";
import type { DisplayEvent } from "@/lib/display/frame";
import { clock } from "@/lib/format";
import { Countdown, ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { PhaseTimer } from "./phase-timer";

const BADGE: Record<EventStatus["trading"], string> = {
  OPEN: "bg-[#39ff88] text-ink",
  HALTED: "border-2 border-[rgba(91,139,100,.5)] bg-[rgba(57,255,136,.08)] text-[#9fc6a8]",
  PAUSED: "bg-warn text-ink",
};

export function DisplayHeader({ event, status }: { event: DisplayEvent; status: EventStatus }) {
  return (
    <header className="dsp-header flex h-[150px] shrink-0 items-center justify-between gap-8 px-12" data-testid="display-header">
      <div className="min-w-0 flex-[1.6]">
        <p className="flex min-w-0 items-center gap-4 truncate text-[26px] font-medium text-[#9db1a1]">
          <span className="dsp-eyebrow shrink-0 !tracking-[0.14em]" aria-hidden>
            PRIMUS ’26 ·
          </span>
          <span className="truncate">{event.name}</span>
          {event.is_rehearsal ? <span className="dsp-chip shrink-0 px-3 py-1">Rehearsal ×{event.clock_speed}</span> : null}
        </p>
        <p className="dsp-phase mt-1 truncate text-[58px] leading-tight font-black" data-testid="display-phase">
          {PHASE_LABELS[status.phase]}
        </p>
      </div>

      <div className="dsp-metric flex h-[118px] min-w-[440px] flex-col items-center justify-center px-8 text-center" data-testid="display-round">
        {status.open_round ? (
          <>
            <p className="dsp-label text-[26px] font-semibold">
              {status.paused ? `Round ${status.open_round.number} is paused with` : `Round ${status.open_round.number} closes in`}
            </p>
            {/* While paused the countdown stands still at the time the round had left when the pause began. */}
            <p className={`font-mono text-[68px] leading-none font-black tabular-nums ${status.paused ? "text-warn" : "dsp-figure"}`}>
              <Countdown to={status.open_round.closes_at} passed={status.paused ? "0:00" : "clearing…"} />
            </p>
          </>
        ) : status.next_round ? (
          <>
            <p className="dsp-label text-[26px] font-semibold">Round {status.next_round.number} opens</p>
            {status.paused ? (
              <p className="text-[52px] leading-none font-black text-warn">after the pause</p>
            ) : (
              <p className="dsp-figure text-[68px] leading-none font-black">at {clock(status.next_round.opens_at)}</p>
            )}
          </>
        ) : (
          <div className="font-mono">
            <PhaseTimer endsAt={status.phase_ends_at} phase={status.phase} gate={status.gate} next={status.next_phase} paused={status.paused} />
          </div>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-6">
        <span className={`px-6 py-2 font-mono text-[42px] font-black tracking-wider ${BADGE[status.trading]}`} data-testid="display-trading">
          {status.trading}
        </span>
        <div className="dsp-metric flex h-[118px] flex-col items-end justify-center px-6 text-right">
          <ServerClock className="dsp-figure text-[56px] leading-none font-bold" />
          <div className="mt-2 flex items-center justify-end gap-3 [&_span]:text-[18px]">
            <span className="dsp-label" aria-hidden>
              IST
            </span>
            <RealtimeDot />
          </div>
        </div>
      </div>
    </header>
  );
}
