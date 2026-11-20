// Home: "My timeline", every deadline of the night for this team (lib/team/home.ts teamTimeline) with a live countdown
// against the server clock (it stands still while the event is paused). Passed ones are dimmed; the next is marked.

import Link from "next/link";
import { clock } from "@/lib/format";
import type { TimelineItem } from "@/lib/team/home";
import { Countdown } from "@/components/ui/countdown";

export function MyTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="guide-panel" aria-label="My timeline" data-testid="my-timeline">
      <div className="guide-panel-head">
        <h2>My timeline</h2>
        <span>THE NIGHT AT A GLANCE · IST</span>
      </div>
      <ol className="guide-panel-body guide-scroll-box compact guide-timeline">
        {items.map((i) => (
          <li
            key={i.key}
            data-state={i.state}
            data-testid={`timeline-${i.key}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
          >
            <span className="min-w-0 flex-1">
              <span className="guide-timeline-at">{clock(i.at)}</span>
              {i.href && i.state !== "past" ? (
                <Link href={i.href} className="underline-offset-2 hover:underline">
                  {i.title}
                </Link>
              ) : (
                i.title
              )}
            </span>
            <span className="guide-task-due">
              {i.state === "past" ? "passed" : <Countdown to={i.at} passed="now" />}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
