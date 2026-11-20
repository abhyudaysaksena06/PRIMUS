"use client";

// The team's sections as the demo's sidebar (app/demo/layout.tsx, .guide-sidebar): the PRIMUS mark, "PRODUCT
// WORKSPACE ///", the numbered sections, and at the bottom the connection box and the team. The pages linked from the
// top bar (News, Leaderboard, How judging works) are not repeated here. On a phone (760 px and less) the sidebar opens
// as a menu from the top bar's MENU button, and the demo's bottom bar carries the first five sections.

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TeamSection } from "@/lib/team/sections";
import { useEventChannel } from "@/lib/live/channel";
import { SignOutButton } from "@/components/sign-out-button";

/** Sections shown as the top bar's links (the demo's header links), in the demo's order. */
export const HEADER_LINKS: readonly { path: string; label: string }[] = [
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/bulletins", label: "News" },
  { path: "/judging", label: "How judging works" },
];
const IN_HEADER = new Set(HEADER_LINKS.map((l) => l.path));

export interface NavTeam {
  code: string;
  name: string;
  /** The workspace's name in capitals, e.g. "PRODUCT". */
  track: string;
}

const isActive = (pathname: string, s: TeamSection) => (s.path === "" ? pathname === "/team" : pathname.startsWith(`/team${s.path}`));

function setMenu(open: boolean) {
  const app = document.querySelector<HTMLElement>(".guide-app");
  if (app) app.dataset.menu = open ? "open" : "closed";
}

/** The phone's MENU button in the top bar: opens the sidebar over the page. */
export function MenuButton() {
  return (
    <button type="button" className="guide-menu-btn" aria-controls="team-sidebar" onClick={() => setMenu(document.querySelector<HTMLElement>(".guide-app")?.dataset.menu !== "open")}>
      ☰ MENU
    </button>
  );
}

export function TeamNav({ sections, team }: { sections: readonly TeamSection[]; team: NavTeam }) {
  const pathname = usePathname();
  const { status } = useEventChannel();
  // A new page closes the phone's menu.
  useEffect(() => setMenu(false), [pathname]);
  const work = sections.filter((s) => !IN_HEADER.has(s.path));
  const live = status === "SUBSCRIBED";
  return (
    <>
      <div className="guide-menu-scrim" aria-hidden onClick={() => setMenu(false)} />
      <aside className="guide-sidebar" id="team-sidebar">
        <Link href="/team" className="guide-brand">
          <Image src="/primus-logo-light.svg" alt="PRIMUS" width={58} height={22} />
          <span>
            <b>
              PRIMUS <i>’26</i>
            </b>
            <small>MATRIX NETWORK</small>
          </span>
        </Link>
        <div className="guide-nav-label">
          {team.track} WORKSPACE <b>{"///"}</b>
        </div>
        <nav aria-label="Competition workspace">
          {work.map((s, i) => {
            const active = isActive(pathname, s);
            return (
              <Link key={s.path} href={`/team${s.path}`} aria-current={active ? "page" : undefined} className={active ? "active" : ""}>
                <small aria-hidden>{String(i + 1).padStart(2, "0")}</small>
                <span>{s.label}</span>
                <i aria-hidden>↗</i>
              </Link>
            );
          })}
        </nav>
        <div className="guide-sidebar-bottom">
          <div className="guide-online" data-live={live ? "yes" : "no"}>
            <i /> {live ? "CONNECTION LIVE" : status === "CONNECTING" ? "CONNECTING" : "OFFLINE · AUTO-REFRESH"}
          </div>
          <div className="guide-team">
            <div className="guide-avatar">{team.code.slice(0, 2)}</div>
            <div>
              <b>{team.name}</b>
              <small>
                TEAM {team.code} · {team.track}
              </small>
            </div>
          </div>
          <SignOutButton className="guide-signout" />
        </div>
      </aside>
    </>
  );
}

/** The demo's phone bar at the bottom: the first five sections, numbered. */
export function MobileNav({ sections }: { sections: readonly TeamSection[] }) {
  const pathname = usePathname();
  const work = sections.filter((s) => !IN_HEADER.has(s.path)).slice(0, 5);
  return (
    <nav className="guide-mobile-nav" aria-label="Sections">
      {work.map((s, i) => (
        <Link key={s.path} href={`/team${s.path}`} aria-current={isActive(pathname, s) ? "page" : undefined}>
          <small>{String(i + 1).padStart(2, "0")}</small>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/** The demo's header links (Leaderboard / News / How judging works), only those open to the team now. */
export function HeaderLinks({ sections }: { sections: readonly TeamSection[] }) {
  const pathname = usePathname();
  const open = new Set(sections.map((s) => s.path));
  const links = HEADER_LINKS.filter((l) => open.has(l.path));
  if (!links.length) return null;
  return (
    <nav className="guide-header-links" aria-label="Event information">
      {links.map(({ path, label }) => {
        const href = `/team${path}`;
        return (
          <Link key={href} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
