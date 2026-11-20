// The control panel's building blocks in the /demo organiser console's own markup (app/demo/ui.tsx, demo.css): a
// panel is .guide-panel with a .guide-panel-head (h2 + tag) and a .guide-panel-body, a stat is a .guide-metric, a
// table is a .guide-table, a badge is a .guide-chip, a notice is a .guide-alert, a key is a .guide-btn and a field
// is a .guide-input. Same props as components/ui/ui.tsx, so a page swaps its import and keeps its data and actions.

import type { ReactNode } from "react";

export type Tone = "slate" | "green" | "amber" | "red" | "blue" | "violet";

export function Panel({
  title,
  tag,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  tag?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`guide-panel ${className}`}>
      {title || tag || actions ? (
        <div className="guide-panel-head flex-wrap">
          {title ? <h2>{title}</h2> : <i />}
          {tag ? <span>{tag}</span> : null}
          {actions ? <div className="guide-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="guide-panel-body [overflow-wrap:anywhere]">{children}</div>
    </section>
  );
}

/** A badge: the demo's chip, coloured by tone (the text is unchanged). */
export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="guide-chip" data-tone={tone}>
      {children}
    </span>
  );
}

/**
 * The demo's .guide-table, scrolling sideways inside its panel on a narrow screen. The scroller can take keyboard
 * focus and is named after `label`.
 */
export function Table({
  head,
  children,
  empty,
  className = "",
  label,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty?: ReactNode;
  className?: string;
  label?: string;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(rows) && rows.length === 0;
  return (
    <div role="region" aria-label={label ?? "Table"} tabIndex={0} className={`overflow-x-auto ${className}`}>
      <table className="guide-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      {isEmpty ? <p className="guide-muted px-2 py-4">{empty ?? "Nothing yet."}</p> : null}
    </div>
  );
}

export function Td({ children, className = "", mono = false }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return <td className={`whitespace-nowrap ${mono ? "font-mono tabular-nums" : ""} ${className}`}>{children}</td>;
}

/** The demo's Metric: a small label, a big figure and an accent line under it. */
export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="guide-metric">
      <small>{label}</small>
      <b>{value}</b>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

/** The demo's alert box; amber is its .guide-warning. A red notice keeps bg-red-50 (a test hook). */
export function Notice({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  const cls = tone === "amber" ? "guide-alert guide-warning" : tone === "red" ? "guide-alert guide-danger bg-red-50" : "guide-alert";
  return (
    <div className={cls} data-tone={tone}>
      {children}
    </div>
  );
}

export const buttonClass = {
  primary: "guide-btn",
  secondary: "guide-btn secondary",
  danger: "guide-btn secondary guide-btn-danger",
} as const;

export const inputClass = "guide-input";
