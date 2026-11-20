"use client";

// The demo's sidebar (app/demo/layout.tsx, .guide-sidebar), item for item: the PRIMUS mark, "PRODUCT WORKSPACE ///",
// the demo's numbered sections for the track, each mapped to the real page for it, and at the bottom the connection
// box and the team. The pages linked from the top bar (News, Leaderboard, How judging works) are not repeated here. On
// a phone (760 px and less) the sidebar opens as a menu from the top bar's MENU button, and the demo's bottom bar
// carries the first five sections.

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useEventChannel } from "@/lib/live/channel";
import { SignOutButton } from "@/components/sign-out-button";

/** Sections shown as the top bar's links (the demo's header links), in the demo's order. */
export const HEADER_LINKS: readonly { path: string; label: string }[] = [
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/bulletins", label: "News" },
  { path: "/judging", label: "How judging works" },
];

export interface NavTeam {
  code: string;
  name: string;
  /** The workspace's name in capitals, e.g. "PRODUCT". */
  track: string;
}

/** One of the demo's sidebar items: its number, its label, the real page and the paths that light it up. */
interface NavItem {
  n: string;
  label: string;
  href: string;
  active: (path: string, round: number | null) => boolean;
}

const under = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`);
const anyOf = (bases: string[]) => (p: string) => bases.some((b) => under(b)(p));
const home: NavItem = { n: "01", label: "Home", href: "/team", active: (p) => p === "/team" };
const qa: NavItem = { n: "04", label: "Q&A", href: "/team/qa", active: under("/team/qa") };
const market: NavItem = { n: "05", label: "Market", href: "/team/market", active: anyOf(["/team/market", "/team/ledger"]) };
const round1 = anyOf(["/team/squad", "/team/calls", "/team/earnings"]);
const roomPages = anyOf(["/team/crisis", "/team/firms", "/team/messages", "/team/rescue", "/team/chat"]);
// Rounds 2 and 3 of a PRIMUS night both happen in the crisis room (the crises, then the Round 3 draft): the item of
// the round on now lights up there.
const room = (round: 2 | 3) => (p: string, r: number | null) => roomPages(p) && (round === 3 ? r === 3 : r !== 3);
const desk = /^\/team\/trade\/(positions|history)/;

/** The demo's three sidebars (productNav, consultingNav, baseNav), each label mapped to the real page. */
export const NAV: Record<string, readonly NavItem[]> = {
  PRODUCT: [
    home,
    { n: "02", label: "Round 1: Idea & MVP", href: "/team/squad", active: round1 },
    { n: "03", label: "Round 2: Crisis & Hire", href: "/team/crisis", active: room(2) },
    qa,
    market,
    { n: "06", label: "Round 3: Draft & New MVP", href: "/team/crisis#round-3", active: room(3) },
  ],
  CONSULTING: [
    home,
    { n: "02", label: "Round 1: Crisis", href: "/team/squad", active: round1 },
    { n: "03", label: "Round 2: Rescue", href: "/team/crisis", active: room(2) },
    qa,
    market,
    { n: "06", label: "Round 3: Auction & Crisis", href: "/team/crisis#round-3", active: room(3) },
  ],
  FINANCE: [
    home,
    { n: "02", label: "Round 1: Capital", href: "/team/trade/ipo", active: under("/team/trade/ipo") },
    { n: "03", label: "Round 2: MVP Deals", href: "/team/crisis", active: roomPages },
    qa,
    market,
    { n: "06", label: "Trade", href: "/team/trade", active: (p) => under("/team/trade")(p) && !desk.test(p) && !under("/team/trade/ipo")(p) },
    { n: "07", label: "Finance Desk", href: "/team/trade#desk", active: (p) => desk.test(p) },
  ],
};
const navFor = (track: string) => NAV[track] ?? NAV.PRODUCT!;

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

export function TeamNav({ team, round }: { team: NavTeam; round: number | null }) {
  const pathname = usePathname();
  const { status } = useEventChannel();
  // A new page closes the phone's menu.
  useEffect(() => setMenu(false), [pathname]);
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
          {navFor(team.track).map((item) => {
            const active = item.active(pathname, round);
            return (
              <Link key={item.label} href={item.href} aria-current={active ? "page" : undefined} className={active ? "active" : ""}>
                <small aria-hidden>{item.n}</small>
                <span>{item.label}</span>
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

/** The demo's phone bar at the bottom: the first five sections (Finance: and the desk), numbered. */
export function MobileNav({ track, round }: { track: string; round: number | null }) {
  const pathname = usePathname();
  const nav = navFor(track);
  const items = track === "FINANCE" ? [...nav.slice(0, 5), nav[6]!] : nav.slice(0, 5);
  return (
    <nav className="guide-mobile-nav" aria-label="Sections">
      {items.map((item) => (
        <Link key={item.label} href={item.href} aria-current={item.active(pathname, round) ? "page" : undefined}>
          <small>{item.n}</small>
          {item.label.replace("Round ", "R")}
        </Link>
      ))}
    </nav>
  );
}

/** The demo's header links (Leaderboard / News / How judging works), only those open to the team now. */
export function HeaderLinks({ leaderboard }: { leaderboard: boolean }) {
  const pathname = usePathname();

  const links = HEADER_LINKS.filter((l) => leaderboard || l.path !== "/leaderboard");

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
