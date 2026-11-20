// The market board's building blocks, drawn like the /demo market: a bordered card on the board's surface with a
// plain level-2 title, and a figure (a muted label over a large value). Server-safe; the pages pass the real data.

import type { ReactNode } from "react";
import "@/components/ui/market-board.css";

export function MarketCard({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`market-chart min-w-0 [overflow-wrap:anywhere] ${className}`}>
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          {title ? <h2 className="min-w-0 text-xl font-semibold">{title}</h2> : <span />}
          {actions ? <div className="flex flex-wrap items-center gap-2 text-sm">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function MarketStat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums text-paper">{value}</dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

/** The board's header: the page's title, a line under it and what is on the right. */
export function MarketHeader({ title, sub, aside }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
      <div className="min-w-0">
        <h2 className="text-[clamp(1.75rem,4vw,3rem)] leading-none font-semibold tracking-tight">{title}</h2>
        {sub ? <p className="mt-2 text-sm text-muted">{sub}</p> : null}
      </div>
      {aside ? <div className="text-sm text-muted">{aside}</div> : null}
    </header>
  );
}
