// The head of every Product and Consulting page, in the /demo page's own markup (app/demo/ui.tsx PageTitle:
// guide-page-head with an eyebrow, the title and one line about the page), styled by the demo's demo.css that the team
// layout loads. The title is not a heading: the layout's h1 (the team code) stays the page's only one.

import type { ReactNode } from "react";
import "./exact.css";

export function RoomShell({
  eyebrow,
  title,
  lede,
  children,
  className = "guide-stack",
}: {
  /** Kept for the callers; the track's palette comes from the layout's .guide-app[data-track]. */
  track?: string | null;
  eyebrow?: ReactNode;
  title?: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {title ? <PageHead eyebrow={eyebrow} title={title} lede={lede} /> : null}
      {children}
    </div>
  );
}

/** The demo's PageTitle (eyebrow, title, sub). */
export function PageHead({ eyebrow, title, lede }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="guide-page-head">
      {eyebrow ? <small>{eyebrow}</small> : null}
      <p className="guide-title">{title}</p>
      {lede ? <p>{lede}</p> : null}
    </div>
  );
}
