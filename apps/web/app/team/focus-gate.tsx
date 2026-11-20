"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PhaseCode, Track } from "@msim/engine";
import { inFocus, opensIn, stageInfo, type EventFormat } from "@/lib/team/focus";
import { Glyph } from "@/components/ui/matrix/glyph";

// Only this round's pages: a page from another round shows a friendly "not now" card instead (an old link, a
// bookmark or a typed address). The top bar's reference pages (News, How judging works) are always open, as in the
// demo. The game functions still decide every action on the server.
const ALWAYS = ["/team/bulletins", "/team/judging"];
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
  if (ALWAYS.some((p) => path === p || path.startsWith(`${p}/`)) || inFocus(track, phase, path, taskHref)) return <>{children}</>;
  const later = opensIn(track, phase, path);
  const when = later ? stageInfo(later, format) : null;
  return (
    <section className="guide-panel mx-auto max-w-md" data-testid="not-now">
      <div className="guide-panel-head">
        <h2>
          <Glyph e="🔒" /> Not right now
        </h2>
        <span>ACCESS LOCKED</span>
      </div>
      <div className="guide-panel-body">
        <p className="guide-alert guide-warning">
          {when ? (when.round ? `This opens in Round ${when.round}: ${when.title}.` : `This opens at the ${when.title.toLowerCase()}.`) : "This part is not used any more tonight."}{" "}
          Focus on this round for now!
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
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
    </section>
  );
}
