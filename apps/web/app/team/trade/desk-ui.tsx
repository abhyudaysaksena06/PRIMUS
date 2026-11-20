// The Finance desk's building blocks, drawn like the /demo finance terminal: a panel with a title rule, a KPI tile and
// the mono caps label the desk puts over every figure. Server-safe (no state); the pages pass the real data.

import type { ReactNode } from "react";

export const deskLabel = "font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]";

/** A desk panel: a titled card with a hairline under its header (the title is a level-2 heading). */
export function DeskPanel({
  title,
  sub,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
  testId,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-lg border border-white/[0.07] bg-[#171610] ${className}`} data-testid={testId}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[#2d2a1d] px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-[#F2F5F3] [overflow-wrap:anywhere]">{title}</h2> : null}
            {sub ? <p className="mt-0.5 font-mono text-[11px] text-[#87948D]">{sub}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 text-xs">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`min-w-0 [overflow-wrap:anywhere] ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** A KPI tile: a caps label (with an optional tag on the right), the figure, and a line under it. */
export function DeskKpi({
  label,
  tag,
  value,
  foot,
  tone = "plain",
}: {
  label: ReactNode;
  tag?: ReactNode;
  value: ReactNode;
  foot?: ReactNode;
  tone?: "plain" | "up" | "down" | "accent";
}) {
  const color = { plain: "text-[#F2F5F3]", up: "text-[#00D68F]", down: "text-[#FF5364]", accent: "text-[color:var(--desk-accent)]" }[tone];
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border border-white/[0.07] bg-[#171610] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={deskLabel}>{label}</span>
        {tag ? <span className="font-mono text-[10px] text-[#87948D]">{tag}</span> : null}
      </div>
      <div className={`break-words font-mono text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {foot ? <div className="font-mono text-xs text-[#BACBB9]">{foot}</div> : null}
    </div>
  );
}

/** A figure inside a panel: label over a mono value, on the desk's dark well. */
export function DeskFact({ label, value, hint, testId, tone = "plain" }: { label: ReactNode; value: ReactNode; hint?: ReactNode; testId?: string; tone?: "plain" | "accent" }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-[#11110d] p-2.5">
      <dt className="text-xs text-[#BACBB9]">{label}</dt>
      <dd className={`mt-1 break-words font-mono text-sm font-semibold tabular-nums ${tone === "accent" ? "text-[color:var(--desk-accent)]" : "text-[#F2F5F3]"}`} data-testid={testId}>
        {value}
      </dd>
      {hint ? <dd className="mt-0.5 text-[11px] text-[#87948D]">{hint}</dd> : null}
    </div>
  );
}

/** The thin status line under the desk's navigation ("Live trading · round 3 · 2 open orders"). */
export function DeskStatus({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[#2d2a1d] bg-[#11110d] px-3 py-2 font-mono text-xs text-[#BACBB9]">
      {live ? <span className="fin-live-dot inline-block size-1.5 rounded-full bg-[#00D68F]" aria-hidden /> : null}
      {children}
    </p>
  );
}
