import type { ReactNode } from "react";
import { PHASE_LABELS, type PhaseCode, type Track } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { STEPS, jobFor, stageInfo, stageOf, type EventFormat, type Stage } from "@/lib/team/focus";
import { crisisHeadline, type CrisisStep } from "@/lib/team/crisis-steps";
import { PhaseEnd } from "./phase-end";
import { BannerFrame } from "./banner-frame";
import { CrisisSteps } from "./crisis-steps";
import { CrisisWhat } from "./crisis-what";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { ThermalScan } from "@/components/ui/matrix/thermal-scan";
import { Glyph } from "@/components/ui/matrix/glyph";

const ROUND_STAGES: Stage[] = ["ROUND_1", "ROUND_2", "ROUND_3"];

/** A PRIMUS event's crisis under way (Round 2: 1–4; Round 3: 5) and its steps for this track. */
export interface CrisisNow {
  k: number | null;
  steps: CrisisStep[];
}

// The banner at the top of every team screen: which round it is (1, 2 or 3), the step of the night in plain words,
// the time left, the team's own job in one line, and the trading round when one is open. In a PRIMUS event's Rounds 2
// and 3 it also shows the steps of the crisis under way, with the one that is on now. Home shows it big; every other
// page shows one line (and the steps), so the page's own work starts near the top.
export function RoundBanner({
  track,
  phase,
  endsAt,
  gate,
  next,
  openRound,
  format = "CLASSIC",
  crisis = null,
}: {
  track: Track;
  phase: PhaseCode;
  endsAt: string | null;
  gate: string | null;
  next: PhaseCode | null;
  openRound: { number: number; closes_at: string } | null;
  format?: EventFormat;
  crisis?: CrisisNow | null;
}) {
  const stage = stageOf(phase);
  const info = stageInfo(stage, format);
  const primusRound = format === "PRIMUS" && (phase === "PRESSURE" || phase === "SATURATION");
  const step = primusRound ? crisisHeadline(phase, crisis?.k ?? null, null) : STEPS[phase];
  const steps = primusRound ? (crisis?.steps ?? []) : [];
  const at = ROUND_STAGES.indexOf(stage);
  const danger = stage === "ROUND_2";
  const done = (i: number) => i < at || stage === "RESULTS";
  const label = info.round ? `Round ${info.round} of 3 · ${info.title}` : info.title;
  const what: ReactNode = primusRound ? <CrisisWhat phase={phase} k={crisis?.k ?? null} steps={steps} /> : step.what;
  const stepsLabel = primusRound && crisis?.k ? (crisis.k === 5 ? "Steps of Round 3" : `Steps of crisis ${crisis.k}`) : "Steps";
  const trading = openRound ? (
    <p className="guide-alert guide-round-trading" data-testid="open-round">
      <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
    </p>
  ) : null;

  // Home: the demo's panel (.guide-panel): the round in the head with the three round chips, then the step of the
  // night, the time left, the crisis steps and the team's job as the demo's amber alert.
  const full = (
    <section aria-label="Where we are" className={`guide-panel guide-round-card ${danger ? "is-danger" : ""}`} data-testid="round-banner">
      <div className="guide-panel-head">
        <p className="guide-round-label" data-testid="round-label">
          {label}
        </p>
        <ol className="guide-round-chips" aria-label="Rounds">
          {ROUND_STAGES.map((r, i) => (
            <li key={r} aria-current={i === at ? "step" : undefined} className={i === at ? "is-now" : done(i) ? "is-done" : ""}>
              {done(i) ? "✓" : i + 1}
            </li>
          ))}
        </ol>
      </div>
      {/* The scan runs once when the round changes (the key), as the crisis reveal does. */}
      <ThermalScan key={stage} active={danger} className="guide-panel-body">
        <div className="flex items-start gap-3 sm:gap-4">
          <span className="guide-round-icon" aria-hidden>
            <Glyph e={info.emoji} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="guide-round-title">
              <CipherText text={step.name} duration={800} />
            </h2>
            <p className="guide-muted mt-1.5 text-[13px]">{what}</p>
            <p className="guide-round-phase mt-2" data-testid="team-phase">
              <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
              <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1" />
            </p>
          </div>
        </div>
        {steps.length ? (
          <div className="mt-3">
            <CrisisSteps steps={steps} label={stepsLabel} danger={danger} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <p className="guide-alert guide-warning flex-1 text-[13px] font-semibold" data-testid="your-job">
            <span className="mr-1" aria-hidden>
              <Glyph e="🎯" />
            </span>
            Your job: {jobFor(track, stage, format)}
          </p>
          {trading}
        </div>
      </ThermalScan>
    </section>
  );

  // Every other page: one line under the task strip, in the demo's thin strip style (round chip, step, time left).
  const compact = (
    <section aria-label="Where we are" className={`guide-roundbar ${danger ? "is-danger" : ""}`} data-testid="round-banner">
      <div className="guide-roundbar-row">
        <p className="guide-phase" data-testid="round-label">
          {label}
        </p>
        <h2>{step.name}</h2>
        <p className="guide-round-phase" data-testid="team-phase">
          <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
          <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1" />
        </p>
        {openRound ? (
          <p className="guide-roundbar-trading" data-testid="open-round">
            <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
          </p>
        ) : null}
      </div>
      {steps.length ? <CrisisSteps steps={steps} label={stepsLabel} danger={danger} /> : null}
    </section>
  );

  return <BannerFrame full={full} compact={compact} />;
}
