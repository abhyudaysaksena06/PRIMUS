// Home: the demo's "The night at a glance" panel, filled with every deadline of the night for this team
// (lib/team/home.ts teamTimeline) and a live countdown against the server clock (it stands still while the event is
// paused). Passed ones are dimmed; the next is marked.

import Link from "next/link";
import { clock } from "@/lib/format";
import type { TimelineItem } from "@/lib/team/home";
import { Countdown } from "@/components/ui/countdown";
import { GuidePanel } from "@/components/guide/guide";

export function MyTimeline({ items, tag = "PLANNED IST TIMETABLE" }: { items: TimelineItem[]; tag?: string }) {
  return (
    <GuidePanel title="The night at a glance" tag={tag} aria-label="My timeline" data-testid="my-timeline">
      {items.length === 0 ? (
        <p className="guide-muted">The timetable appears once the organisers set the night&apos;s times.</p>
      ) : (
        <ol className="guide-scroll-box compact space-y-0">
          {items.map((i) => (
            <li key={i.key} data-state={i.state} data-testid={`timeline-${i.key}`} className="guide-glance-row">
              <span className="guide-glance-at">{clock(i.at)}</span>
              <div className="min-w-0">
                <b className="text-[11px]">
                  {i.href && i.state !== "past" ? (
                    <Link href={i.href} className="underline-offset-2 hover:underline">
                      {i.title}
                    </Link>
                  ) : (
                    i.title
                  )}
                </b>
                <p className="guide-muted mt-1">{i.state === "past" ? "Passed" : <>In <Countdown to={i.at} passed="now" /></>}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </GuidePanel>
  );
}
