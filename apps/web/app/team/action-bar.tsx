"use client";

// "Do this now": the one open task of this team that closes first, on every team page but Home (its big card), with its
// deadline and a button to the place that does it. Nothing to do: no bar. The demo's task strip (.guide-taskbar):
// DO THIS NOW · the task · DEADLINE 10:35 IST · 0:55 · OPEN TASK →.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Countdown } from "@/components/ui/countdown";
import { clock } from "@/lib/format";

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
    <div className="guide-taskbar" role="region" aria-label="Do this now" data-testid="action-bar">
      <span>DO THIS NOW</span>
      <b data-testid="action-bar-title">{task.title}</b>
      {task.due ? (
        <small>
          DEADLINE {clock(task.due)} IST · <Countdown to={task.due} passed="now" className="guide-taskbar-left" /> LEFT
        </small>
      ) : null}
      {here ? (
        <em className="guide-taskbar-here">YOU&apos;RE ON IT</em>
      ) : (
        <Link href={task.href}>{task.linkLabel ?? "Open"} →</Link>
      )}
    </div>
  );
}
