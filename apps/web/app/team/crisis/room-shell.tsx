// The frame of every Product and Consulting page in the /demo design: the track's palette (room-design.css), the
// demo's page parts (guide.css) and the demo's page head (guide-page-head:
// eyebrow, title, one line about the page). The title is not a heading: the layout's h1 stays the page's only one.

import type { ReactNode } from "react";
import "./room-design.css";
import "./guide.css";

const TRACK_WORD: Record<string, string> = { PRODUCT: "Product", CONSULTING: "Consulting", FINANCE: "Finance" };

export function RoomShell({
  track,
  eyebrow,
  title,
  lede,
  children,
  className = "space-y-5",
}: {
  track: string | null | undefined;
  eyebrow?: ReactNode;
  title?: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`pd-root ${className}`} data-track={track ?? undefined}>
      {title ? (
        <div className="guide-page-head">
          <small>
            {track ? `${TRACK_WORD[track] ?? track} desk` : "PRIMUS"}
            {eyebrow ? <> / {eyebrow}</> : null}
          </small>
          <p className="guide-title">{title}</p>
          {lede ? <p>{lede}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
