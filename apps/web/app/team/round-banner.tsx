import type { ReactNode } from "react";
import { PHASE_LABELS, type PhaseCode, type Track } from "@msim/engine";
import { Countdown } from "@/components/ui/countdown";
import { STEPS, jobFor, stageInfo, stageOf, type EventFormat, type Stage } from "@/lib/team/focus";
import { crisisHeadline, type CrisisStep } from "@/lib/team/crisis-steps";
import { PhaseEnd } from "./phase-end";
import { BannerFrame } from "./banner-frame";
import { CrisisSteps } from "./crisis-steps";
import { CrisisWhat } from "./crisis-what";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { DitherLayer } from "@/components/ui/matrix/dither-layer";
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
    <p className="rounded-lg border border-phosphor bg-phosphor/10 px-3 py-2 font-mono text-sm font-bold text-phosphor" data-testid="open-round">
      <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
    </p>
  ) : null;

  // Home: the demo's page head (an eyebrow, a big headline, a line under it) inside an opaque card, with the rain
  // and a dithered fade behind it as decoration.
  const full = (
    <section aria-label="Where we are" className="relative overflow-hidden border-b border-line" data-testid="round-banner">
      {/* Backdrop only: the rain and a dithered fade. Everything to read is in the opaque card above them. */}
      <MatrixRain opacity={0.22} size={14} />
      <DitherLayer from="bottom" tone={danger ? "red" : "green"} opacity={0.18} />
      <div className="relative mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        {/* The scan runs once when the round changes (the key), as the crisis reveal does. */}
        <ThermalScan key={stage} active={danger} className={`mx-panel rounded-2xl px-4 py-4 sm:px-6 sm:py-5 ${danger ? "border-danger/70 glow-danger" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`font-mono text-xs font-bold uppercase tracking-[0.18em] ${danger ? "text-danger-soft" : "text-phosphor"}`} data-testid="round-label">
              {label}
            </p>
            <ol className="flex items-center gap-1.5 font-mono" aria-label="Rounds">
              {ROUND_STAGES.map((r, i) => (
                <li
                  key={r}
                  aria-current={i === at ? "step" : undefined}
                  className={`grid h-7 min-w-7 place-items-center rounded-md border px-2 text-xs font-extrabold ${
                    i === at ? "border-phosphor bg-phosphor text-[var(--mx-on-accent)]" : done(i) ? "border-phosphor-dim bg-phosphor/10 text-phosphor" : "border-line text-muted"
                  }`}
                >
                  {done(i) ? "✓" : i + 1}
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-3 flex items-start gap-3 sm:gap-4">
            <span className={`text-3xl leading-none sm:text-4xl ${danger ? "text-danger" : "text-phosphor"}`} aria-hidden>
              <Glyph e={info.emoji} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className={`text-[1.7rem] font-extrabold leading-[1.08] tracking-tight sm:text-4xl ${danger ? "text-danger-soft [--mx-cipher-color:var(--mx-red)]" : "text-[var(--mx-heading)]"}`}>
                <CipherText text={step.name} duration={800} />
              </h2>
              <p className="mt-1.5 text-base leading-relaxed text-muted">{what}</p>
              <p className="mt-2 font-mono text-sm font-semibold text-phosphor" data-testid="team-phase">
                <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
                <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1 font-semibold text-phosphor" />
              </p>
            </div>
          </div>
          {steps.length ? (
            <div className="mt-3">
              <CrisisSteps steps={steps} label={stepsLabel} danger={danger} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <p className="flex-1 rounded-lg border border-line border-l-[3px] border-l-phosphor bg-phosphor/[0.07] px-3.5 py-2.5 text-base font-semibold text-paper" data-testid="your-job">
              <span className="mr-1 text-phosphor" aria-hidden>
                <Glyph e="🎯" />
              </span>
              Your job: {jobFor(track, stage, format)}
            </p>
            {trading}
          </div>
        </ThermalScan>
      </div>
    </section>
  );

  // Every other page: one line, as the demo's top bar (round pill, step, time left).
  const compact = (
    <section aria-label="Where we are" className={`border-b ${danger ? "border-danger/50 bg-danger/[0.06]" : "border-line bg-[var(--mx-black)]/60"}`} data-testid="round-banner">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p
            className={`rounded-md border px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.12em] ${danger ? "border-danger/60 text-danger-soft" : "border-phosphor/40 bg-phosphor/10 text-phosphor"}`}
            data-testid="round-label"
          >
            {label}
          </p>
          <h2 className={`text-base font-extrabold ${danger ? "text-danger-soft" : "text-[var(--mx-heading)]"}`}>{step.name}</h2>
          <p className="font-mono text-sm font-semibold text-paper" data-testid="team-phase">
            <Glyph e="⏱" spoken /> {PHASE_LABELS[phase]}
            <PhaseEnd endsAt={endsAt} phase={phase} gate={gate} next={next} className="ml-1 font-semibold text-warn" />
          </p>
          {openRound ? (
            <p className="ml-auto whitespace-nowrap font-mono text-sm font-bold text-phosphor" data-testid="open-round">
              <Glyph e="📈" spoken /> Trading round {openRound.number} · <Countdown to={openRound.closes_at} passed="clearing" className="tabular-nums" /> left
            </p>
          ) : null}
        </div>
        {steps.length ? <CrisisSteps steps={steps} label={stepsLabel} danger={danger} /> : null}
      </div>
    </section>
  );

  return <BannerFrame full={full} compact={compact} />;
}
