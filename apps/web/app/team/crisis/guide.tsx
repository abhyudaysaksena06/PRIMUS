// The /demo design's page parts (app/demo/ui.tsx: PageTitle, Panel, Metric) for the real Product and Consulting
// pages, with the same markup and class names (styled by guide.css inside RoomShell). Server-safe: no hooks.

import type { ReactNode } from "react";

/** A demo panel: a head (title, a small tag, optional links) over a body. */
export function GuidePanel({
  title,
  tag,
  actions,
  children,
  className = "",
  testId,
  label,
}: {
  title?: ReactNode;
  tag?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  label?: string;
}) {
  return (
    <section className={`guide-panel ${className}`} data-testid={testId} aria-label={label}>
      {title || tag || actions ? (
        <div className="guide-panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {tag || actions ? (
            <div className="guide-panel-actions">
              {tag ? <span>{tag}</span> : null}
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="guide-panel-body">{children}</div>
    </section>
  );
}

/** A demo metric tile: a small label, a big value and an accent line. */
export function GuideMetric({ label, value, delta, testId }: { label: ReactNode; value: ReactNode; delta?: ReactNode; testId?: string }) {
  return (
    <div className="guide-metric" data-testid={testId}>
      <small>{label}</small>
      <b>{value}</b>
      {delta ? <span>{delta}</span> : null}
    </div>
  );
}

export type ChipTone = "slate" | "green" | "amber" | "red" | "blue" | "violet" | "active";
const CHIP: Record<ChipTone, string> = { slate: "", green: "good", amber: "warn", red: "bad", blue: "active", violet: "active", active: "active" };

/** A demo chip; the tones follow the app's Badge tones (blue and active are the track's accent). */
export function Chip({ tone = "slate", children, className = "" }: { tone?: ChipTone; children: ReactNode; className?: string }) {
  return <span className={`guide-chip ${CHIP[tone]} ${className}`}>{children}</span>;
}

/** The demo's alert strip (purple), warning strip (amber) and a red one for errors. */
export function GuideAlert({ tone = "info", children, className = "" }: { tone?: "info" | "warn" | "bad"; children: ReactNode; className?: string }) {
  const t = tone === "warn" ? "guide-warning" : tone === "bad" ? "bad" : "";
  return <div className={`guide-alert ${t} ${className}`}>{children}</div>;
}

/** The demo's buttons: a solid key in the track's colour, an outlined key, and a red outlined key. */
export const guideBtn = {
  primary: "guide-btn",
  secondary: "guide-btn secondary",
  danger: "guide-btn secondary danger",
} as const;

/** A card inside a panel, as the demo lists teams and offers (a thin bordered box the track recolours). */
export const guideCard = "border border-[#294832] p-3.5";
/** A small stat cell inside a card. */
export const guideCell = "border border-[#294832] p-2";
