"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PhaseCode, Track } from "@msim/engine";
import { inFocus, opensIn, stageInfo, type EventFormat } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";

// Only this round's pages: a page from another round shows a friendly "not now" card instead (an old link, a
// bookmark or a typed address). The game functions still decide every action on the server.
export function FocusGate({
  track,
  phase,
  taskHref,
  format = "CLASSIC",
  children,
}: {
  track: Track;
  phase: PhaseCode;
  taskHref: string | null;
  format?: EventFormat;
  children: ReactNode;
}) {
  const path = usePathname();
  if (inFocus(track, phase, path, taskHref)) return <>{children}</>;
  const later = opensIn(track, phase, path);
  const when = later ? stageInfo(later, format) : null;
  return (
    <div className="guide-panel mx-auto max-w-md p-6 text-center" data-testid="not-now">
      <p className="text-6xl text-phosphor" aria-hidden>
        <Glyph e="🔒" />
      </p>
      <p aria-hidden className="guide-chip mt-2">
        Access locked
      </p>
      <h2 className="guide-round-title mt-2">Not right now</h2>
      <p className="guide-muted mt-2 text-[13px]">
        {when ? (when.round ? `This opens in Round ${when.round}: ${when.title}.` : `This opens at the ${when.title.toLowerCase()}.`) : "This part is not used any more tonight."}{" "}
        Focus on this round for now!
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/team" className="guide-btn secondary">
          <Glyph e="🏠" spoken /> Back to Home
        </Link>
        {taskHref ? (
          <Link href={taskHref} className="guide-btn">
            <Glyph e="🎯" spoken /> Do this now
          </Link>
        ) : null}
      </div>
    </div>
  );
}
