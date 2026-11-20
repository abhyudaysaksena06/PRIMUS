// The Finance desk's building blocks, copied from the /demo finance terminal (apps/web/app/demo/finance/_desk): its
// panel with a title rule, its KPI tile, its mono caps label, its status strip, its tables (mono caps head on the well,
// zebra rows) and its depth-style figure rows. Server-safe (no state); the pages pass the real data.

import type { ReactNode } from "react";

export const deskLabel = "font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]";

/** The demo's segmented-control pill (the Positions / Watchlist and Open / All switches): on or off. */
export const deskPill = (on: boolean) =>
  `px-3 py-1.5 rounded-sm font-mono text-xs font-medium transition-colors whitespace-nowrap ${
    on ? "bg-[#201e14] text-[color:var(--desk-accent)] border border-[color:var(--desk-accent-line)]" : "text-[#87948D] hover:text-[#F2F5F3]"
  }`;

/** A desk panel: the demo's `bg-[#171610]` section with its header rule (the title is a level-2 heading). */
export function DeskPanel({
  title,
  sub,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
  testId,
  label,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  label?: string;
}) {
  return (
    <section
      className={`min-w-0 bg-[#171610] border border-white/[0.07] rounded-lg overflow-hidden flex flex-col ${className}`}
      data-testid={testId}
      aria-label={label}
    >
      {title || actions ? (
        <div className="px-4 py-3 border-b border-[#2d2a1d] flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-[#F2F5F3] [overflow-wrap:anywhere]">{title}</h2> : null}
            {sub ? <span className="font-mono text-[11px] text-[#87948D]">{sub}</span> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 text-xs">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`min-w-0 [overflow-wrap:anywhere] ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** The demo's KPI tile: a caps label with a tag on the right, the figure, and a line under it (with an optional
 * sparkline or meter on its right, as in the demo's top strip). */
export function DeskKpi({
  label,
  tag,
  value,
  foot,
  aside,
  tone = "plain",
}: {
  label: ReactNode;
  tag?: ReactNode;
  value: ReactNode;
  foot?: ReactNode;
  aside?: ReactNode;
  tone?: "plain" | "up" | "down" | "accent";
}) {
  const color = { plain: "text-[#F2F5F3]", up: "text-[#00D68F]", down: "text-[#FF5364]", accent: "text-[color:var(--desk-accent)]" }[tone];
  return (
    <div className="min-w-0 bg-[#171610] border border-white/[0.07] rounded-lg p-4 flex flex-col justify-between gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className={deskLabel}>{label}</span>
        {tag ? <span className="font-mono text-[10px] text-[#87948D]">{tag}</span> : null}
      </div>
      <div className={`break-words font-mono text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {foot || aside ? (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 font-mono text-xs text-[#87948D] tabular-nums">{foot}</span>
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/** A figure inside a panel: the demo quote dialog's cell (label over a mono value on the well). */
export function DeskFact({ label, value, hint, testId, tone = "plain" }: { label: ReactNode; value: ReactNode; hint?: ReactNode; testId?: string; tone?: "plain" | "accent" | "up" | "down" | "muted" }) {
  const color = { plain: "text-[#F2F5F3]", accent: "text-[color:var(--desk-accent)]", up: "text-[#00D68F]", down: "text-[#FF5364]", muted: "text-[#87948D]" }[tone];
  return (
    <div className="min-w-0 rounded border border-white/10 bg-[#11110d] p-2">
      <dt className="text-xs text-[#BACBB9]">{label}</dt>
      <dd className={`mt-1 break-words font-mono text-xs font-semibold tabular-nums ${color}`} data-testid={testId}>
        {value}
      </dd>
      {hint ? <dd className="mt-0.5 text-[11px] text-[#87948D]">{hint}</dd> : null}
    </div>
  );
}

/** A row of the demo's depth ladder (Price · Size · Total), used for a label and its figure, with an optional bar
 * behind it showing a share of a limit. */
export function DeskRow({ label, value, testId, tone = "plain", bar, barTone = "up" }: { label: ReactNode; value: ReactNode; testId?: string; tone?: "plain" | "accent" | "up" | "down"; bar?: number; barTone?: "up" | "down" | "accent" }) {
  const color = { plain: "text-[#F2F5F3]", accent: "text-[color:var(--desk-accent)]", up: "text-[#00D68F]", down: "text-[#FF5364]" }[tone];
  const barColor = { up: "bg-[#00D68F]/12", down: "bg-[#FF5364]/12", accent: "bg-[var(--desk-accent-soft)]" }[barTone];
  return (
    <div className="relative flex items-baseline justify-between gap-3 py-1 px-1.5 rounded-sm overflow-hidden">
      {bar !== undefined ? <div className={`absolute inset-y-0 right-0 pointer-events-none ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} /> : null}
      <dt className="relative text-[#87948D]">{label}</dt>
      <dd className={`relative text-right font-semibold ${color}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** The thin status strip under the desk's navigation ("Live trading · round 3 · 2 open orders"), full width of the
 * desk as in the demo (it bleeds over the content padding). */
export function DeskStatus({ children }: { children: ReactNode; live?: boolean }) {
  return (
    <p className="-mx-3 -mt-3 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#2d2a1d] bg-[#11110d] px-4 py-2 font-mono text-xs text-[#BACBB9] sm:-mx-4 sm:-mt-4 lg:px-6">
      {children}
    </p>
  );
}

/** The demo's table: mono caps head on the well, hairline zebra rows with a warm hover. A named, scrollable region. */
export function DeskTable({ head, label, children, right = [] }: { head: ReactNode[]; label: string; children: ReactNode; right?: number[] }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--desk-accent)]">
      <table className="fin-table w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#2d2a1d] bg-[#11110d]">
            {head.map((h, i) => (
              <th
                key={i}
                className={`py-2.5 ${i === 0 ? "px-4" : i === head.length - 1 ? "px-4" : "px-3"} font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] whitespace-nowrap ${right.includes(i) ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** The demo table's row: zebra on the well and the panel, a warm hover. */
export const deskTr = "border-b border-[#2d2a1d]/70 transition-colors odd:bg-[#11110d] even:bg-[#171610] hover:bg-[#201e14]/70";

/** The demo table's cell: mono 13 px figures (first and last cells get the wider edge). */
export function DeskTd({ children, className = "", edge = false, right = false }: { children?: ReactNode; className?: string; edge?: boolean; right?: boolean }) {
  return (
    <td className={`py-2.5 ${edge ? "px-4" : "px-3"} font-mono text-[13px] text-[#F2F5F3] tabular-nums whitespace-nowrap ${right ? "text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}

/** The demo's sparkline (Sparkline.tsx): a small area-and-line of a series, green when it ends up, red when down. */
export function Sparkline({ values, positive = true, width = 88, height = 24 }: { values: number[]; positive?: boolean; width?: number; height?: number }) {
  if (values.length < 2) return <span className="inline-block w-20 h-6 bg-[#0C1110]" aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = positive ? "#00D68F" : "#FF5364";
  const fill = positive ? "rgba(0, 214, 143, 0.12)" : "rgba(255, 83, 100, 0.12)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible shrink-0" aria-hidden="true">
      <polygon points={`${pad},${height} ${points.join(" ")} ${width - pad},${height}`} fill={fill} />
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points.join(" ")} />
    </svg>
  );
}
