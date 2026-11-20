"use client";

// The frame of every full-screen takeover, drawn as the /demo projector page: its page head (the PUBLIC STAGE OUTPUT
// eyebrow over the takeover's name) with the event clock in a .guide-metric beside it, a bar in the takeover's colour
// (`tone`) showing how long it stays up, and the content under it (about 1824×860 inside the padding).

import type { ReactNode } from "react";
import { ServerClock } from "@/components/ui/countdown";
import { RealtimeDot } from "@/components/ui/realtime-dot";
import { useServerNow } from "@/lib/live/clock";

export function TakeoverFrame({
  title,
  at,
  until,
  tone = "bg-phosphor text-ink",
  children,
}: {
  title: string;
  at: string;
  until: string | null;
  /** Colours of the bar (and of the takeover's mark). */
  tone?: string;
  children: ReactNode;
}) {
  const now = useServerNow(500);
  const start = Date.parse(at);
  const end = until ? Date.parse(until) : null;
  const left = end === null ? null : Math.max(0, Math.min(1, (end - now) / (end - start)));
  return (
    <section className="flex h-full flex-col" data-testid="takeover" aria-label={title}>
      <div className="guide-stage-head relative flex h-[130px] shrink-0 items-center justify-between gap-10 px-12">
        <div className="guide-page-head min-w-0">
          <small className="flex items-center gap-4">
            <i className={`inline-block h-[18px] w-[18px] ${tone}`} aria-hidden />
            PUBLIC STAGE OUTPUT / PROJECTOR MODE
          </small>
          <h1 className="truncate uppercase">{title}</h1>
        </div>
        <div className="guide-metric guide-stage-metric shrink-0 text-right">
          <small aria-hidden>IST</small>
          <b>
            <ServerClock />
          </b>
          {/* The realtime status, as in the header, so the operator can see the projector is live during a takeover. */}
          <span className="guide-stage-live">
            <RealtimeDot />
          </span>
        </div>
        {left !== null ? (
          <div className={`absolute bottom-0 left-0 h-2 ${tone}`} style={{ width: `${left * 100}%` }} suppressHydrationWarning />
        ) : null}
      </div>
      <div className="guide-stage-body min-h-0 flex-1 px-12 py-8">{children}</div>
    </section>
  );
}
