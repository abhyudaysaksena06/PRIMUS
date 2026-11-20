// Home: "My timeline", every deadline of the night for this team (lib/team/home.ts teamTimeline) with a live countdown
// against the server clock (it stands still while the event is paused). Passed ones are dimmed; the next is marked.

import Link from "next/link";
import { clock } from "@/lib/format";
import type { TimelineItem } from "@/lib/team/home";
import { Countdown } from "@/components/ui/countdown";

export function MyTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mx-panel rounded-2xl p-4" aria-label="My timeline" data-testid="my-timeline">
      <h2 className="text-lg font-extrabold text-phosphor">My timeline</h2>
      <ol className="mt-2 max-h-80 divide-y divide-line overflow-y-auto pr-1">
        {items.map((i) => (
          <li
            key={i.key}
            data-state={i.state}
            data-testid={`timeline-${i.key}`}
            className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm ${i.state === "past" ? "text-muted" : i.state === "next" ? "font-semibold text-phosphor" : "text-paper"}`}
          >
            <span className="min-w-0 flex-1">
              <span className="mr-2 font-mono tabular-nums">{clock(i.at)}</span>
              {i.href && i.state !== "past" ? (
                <Link href={i.href} className="underline-offset-2 hover:underline">
                  {i.title}
                </Link>
              ) : (
                i.title
              )}
            </span>
            <span className="whitespace-nowrap font-mono text-xs tabular-nums">
              {i.state === "past" ? "passed" : <Countdown to={i.at} passed="now" className={i.state === "next" ? "text-phosphor" : ""} />}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
