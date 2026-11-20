"use client";

// "Do this now": the one open task of this team that closes first, on every team page but Home (its big card), with its countdown and a
// button to the place that does it. Nothing to do: no bar. Drawn as the demo's task band (team.css, .mx-taskbar).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Countdown } from "@/components/ui/countdown";

export interface BarTask {
  title: string;
  href: string;
  linkLabel: string | null;
  due: string | null;
}

export function ActionBar({ task }: { task: BarTask | null }) {
  const path = usePathname();
  // Home shows the same task as its big card, so the bar would only repeat it there.
  if (!task || path === "/team") return null;
  const here = path === task.href;
  return (
    <div className="mx-taskbar" role="region" aria-label="Do this now" data-testid="action-bar">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm sm:px-6">
        <span className="mx-taskbar-pill">Do this now</span>
        {/* The title keeps at least 10rem: on a phone the countdown and the button wrap to a second line instead
            of squeezing it. */}
        <span className="min-w-[10rem] flex-1 font-semibold [overflow-wrap:anywhere]" data-testid="action-bar-title">
          {task.title}
        </span>
        {/* On a phone the countdown and the button may wrap onto two lines rather than run past the screen edge. */}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {task.due ? (
            <span className="whitespace-nowrap font-mono text-xs tracking-wide text-muted">
              closes in <Countdown to={task.due} passed="now" className="text-sm font-bold text-paper" />
            </span>
          ) : null}
          {here ? (
            <span className="mx-tag text-xs text-phosphor-mid">You&apos;re on it</span>
          ) : (
            <Link href={task.href} className="mx-key mx-key-solid whitespace-nowrap rounded-md px-3 py-1.5 text-xs">
              {task.linkLabel ?? "Open"} →
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
