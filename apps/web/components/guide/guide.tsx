// The PRIMUS demo's building blocks (app/demo/ui.tsx), with the demo's exact markup and class names, for the real
// screens: a page head, a panel, a metric card and a grid. Server-safe (no hooks), so any page can use them. The
// styles are the demo's own (app/demo/demo.css), loaded by the team shell (app/team/layout.tsx).

import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** The demo's page head: a small eyebrow, the big title, a line under it. `as` keeps a page's own heading level. */
export function GuidePageTitle({
  eyebrow,
  title,
  sub,
  as: H = "h1",
  titleProps,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  as?: "h1" | "h2" | "p";
  titleProps?: ComponentPropsWithoutRef<"h1">;
}) {
  return (
    <div className="guide-page-head">
      <small>{eyebrow}</small>
      <H className="guide-page-title" {...titleProps}>
        {title}
      </H>
      {sub ? <p>{sub}</p> : null}
    </div>
  );
}

/** The demo's panel: a title row (title left, a small tag or action right) over a hairline, then the body. */
export function GuidePanel({
  title,
  tag,
  children,
  className = "",
  bodyClassName = "",
  headingLevel = 2,
  ...rest
}: {
  title: ReactNode;
  tag?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headingLevel?: 2 | 3;
} & Omit<ComponentPropsWithoutRef<"section">, "title">) {
  const H = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={`guide-panel ${className}`} {...rest}>
      <div className="guide-panel-head">
        <H>{title}</H>
        {tag ? <span>{tag}</span> : null}
      </div>
      <div className={`guide-panel-body ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** The demo's metric card: a small capital label, a big figure, a coloured line under it. */
export function GuideMetric({
  label,
  value,
  delta,
  valueTestId,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  valueTestId?: string;
  className?: string;
}) {
  return (
    <div className={`guide-metric ${className}`}>
      <small>{label}</small>
      <b data-testid={valueTestId}>{value}</b>
      {delta ? <span>{delta}</span> : null}
    </div>
  );
}

/** The demo's grid: two or three equal columns (one on a phone). */
export function GuideGrid({ cols, className = "", children }: { cols: "two" | "three"; className?: string; children: ReactNode }) {
  return <div className={`guide-grid ${cols} ${className}`}>{children}</div>;
}
