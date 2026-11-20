// Small building blocks shared by every area: panels, badges, tables and the result of an action. They are drawn in
// the PRIMUS demo's look (app/demo): gradient cards with a hairline edge and an accent tick, small capital labels,
// chip badges, solid accent keys. The colours come from the track's tokens (globals.css, [data-track]).

import type { ReactNode } from "react";
import { CipherText } from "./matrix/cipher-text";

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mx-panel min-w-0 rounded-xl ${className}`}>
      {title || actions ? (
        <header className="mx-panel-head flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-t-[inherit] px-4 py-2.5">
          {title ? (
            <h2 className="mx-panel-title min-w-0 text-sm [overflow-wrap:anywhere] sm:text-[0.95rem]">
              {typeof title === "string" ? <CipherText text={title} duration={450} /> : title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {/* Text typed by organisers (a URL in a bulletin, a long reason) wraps instead of widening the page. Table cells
          do not wrap (Td), so tables are unaffected. */}
      <div className="p-4 [overflow-wrap:anywhere]">{children}</div>
    </section>
  );
}

// Tones are text colours on the dark card: the accent for good and neutral news, amber for warnings, red for errors.
const TONES = {
  slate: "text-muted ring-line",
  green: "text-phosphor ring-phosphor-dim",
  amber: "text-warn ring-warn/60",
  red: "text-danger-soft ring-danger/70",
  blue: "text-phosphor-mid ring-phosphor-dim",
  violet: "text-paper ring-phosphor-dim",
} as const;
export type Tone = keyof typeof TONES;

// A notice's coloured left edge and wash, per tone (the demo's alert boxes).
const EDGES = {
  slate: "border-line",
  green: "border-phosphor",
  amber: "border-warn",
  red: "border-danger",
  blue: "border-phosphor-mid",
  violet: "border-phosphor-dim",
} as const;

/** A badge, drawn as a small chip in capitals (the capitals are CSS: the text is unchanged). */
export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`mx-tag text-xs ring-0 ${TONES[tone]}`}>{children}</span>;
}

/**
 * A table that scrolls sideways inside its panel on a narrow screen. The scroller can take keyboard focus (arrow
 * keys scroll it) and is named after `label`.
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
  const name = label ?? "Table";
  return (
    <div
      role="region"
      aria-label={name}
      tabIndex={0}
      className={`overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor ${className}`}
    >
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-xs uppercase tracking-[0.12em] text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2.5 py-2.5 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70 [&>tr]:transition-colors [&>tr:hover]:bg-phosphor/[0.04]">{rows}</tbody>
      </table>
      {isEmpty ? <p className="px-2 py-4 text-sm text-muted">{empty ?? "Nothing yet."}</p> : null}
    </div>
  );
}

export function Td({ children, className = "", mono = false }: { children?: ReactNode; className?: string; mono?: boolean }) {
  return <td className={`whitespace-nowrap px-2.5 py-2 ${mono ? "font-mono tabular-nums" : ""} ${className}`}>{children}</td>;
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-raised px-3.5 py-3">
      <div className="mx-eyebrow text-xs">{label}</div>
      <div className="mt-1.5 font-mono text-xl font-bold tabular-nums text-paper">{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-xs text-phosphor">{hint}</div> : null}
    </div>
  );
}

export function Notice({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  // A red notice keeps bg-red-50 (a test hook, themed in globals.css as a faint red on the dark page).
  return (
    <div
      className={`rounded-md border-l-[3px] ${EDGES[tone]} ${tone === "red" ? "bg-red-50" : "bg-raised/80"} px-3.5 py-2.5 text-sm leading-relaxed ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}

// Buttons are the demo's keys: a solid key in the track's colour (primary), an outlined key (secondary) and a red
// outlined key (danger).
export const buttonClass = {
  primary: "mx-key rounded-md px-3.5 py-2 text-sm",
  secondary: "mx-key mx-key-quiet rounded-md px-3.5 py-2 text-sm",
  danger: "mx-key mx-key-danger rounded-md px-3.5 py-2 text-sm",
} as const;

export const inputClass = "block w-full rounded-md border border-line px-3 py-2 text-sm focus:border-phosphor focus:outline-none";
