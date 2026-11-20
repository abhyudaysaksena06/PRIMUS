"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { canOpenSection, landingFor, type Role } from "@/lib/auth/routes";

// The control panel's tabs. Organisers and the fairness officer see them all; a desk role (registration, judging,
// crisis) sees only the sections lib/auth/routes.ts (DESK_SECTIONS) gives it, so a line added here is for
// organisers and the fairness officer unless routes.ts says otherwise (ORGANISER_SECTIONS: organisers only).
export const SECTIONS = [
  { path: "/run", label: "Run event", hint: "Start and end each round, crisis and step; timers; event log" },
  { path: "", label: "Overview", hint: "Phase, gates, draft and auto-advance" },
  { path: "/schedule", label: "Schedule", hint: "Every phase, deadline and trading window" },
  { path: "/product", label: "Product", hint: "Every company's PRD, crisis plans, statement, solution and price" },
  { path: "/consulting", label: "Consulting", hint: "Every firm's memo, hires, advice, stars and bonuses" },
  { path: "/finance", label: "Finance", hint: "Practice market standings and every fund's cash, bids and orders" },
  { path: "/desk", label: "Registration desk", hint: "Admit teams and walk-ins, hand out login cards" },
  { path: "/lottery", label: "Squad draw", hint: "The lottery that forms the squads" },
  { path: "/rounds", label: "Trading", hint: "Trading windows, orders and prices" },
  { path: "/judge", label: "Judging", hint: "AI scores, review and release" },
  { path: "/leaderboard", label: "Leaderboard", hint: "PRIMUS Rating: every company's rank and change" },
  { path: "/bulletins", label: "News", hint: "Market news for the teams and the big screen" },
  { path: "/content", label: "Cases & cards", hint: "Problem cards, crises and Round 3 statements" },
  { path: "/ledger", label: "Money", hint: "Every payment, with corrections" },
  { path: "/fairness", label: "Fairness", hint: "Flags and appeals" },
  { path: "/chats", label: "Chats", hint: "Read squad and hire chats" },
  { path: "/exports", label: "Downloads", hint: "CSV files of the ledger, prices, scores, results and the event log" },
  { path: "/backups", label: "Backups", hint: "Backups after every round; download or restore one" },
  { path: "/health", label: "System health", hint: "Connections, errors and the clock" },
  { path: "/activity", label: "Activity", hint: "What every staff account did, when and to what" },
] as const;

const RoleContext = createContext<Role | null>(null);

/** The signed-in staff role, set once for the whole control panel by app/admin/layout.tsx. */
export function StaffRoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/**
 * The console's section tabs, as the /demo organiser console draws them (a .guide-tabs strip of capital tabs, the
 * open one lit): only the role's own sections. Each tab is a link named by its label; its hint is the title.
 */
export function AdminSidebar({ slug, fairness }: { slug: string; fairness: boolean }) {
  const role: Role = useContext(RoleContext) ?? (fairness ? "FAIRNESS" : "ORGANISER");
  const pathname = usePathname();
  const router = useRouter();
  const base = `/admin/${slug}`;
  const tabs = SECTIONS.filter((s) => canOpenSection(role, s.path));
  // A desk role that reaches a section that is not its own (an old link) goes back to its desk. Each section also
  // checks this on the server, and the database refuses the calls.
  const here = pathname === base || pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
  const elsewhere = here !== null && !canOpenSection(role, here);
  useEffect(() => {
    if (elsewhere) router.replace(landingFor(role, slug));
  }, [elsewhere, role, slug, router]);
  const nav = useRef<HTMLElement>(null);
  // Keep the current tab in view when the strip scrolls sideways (a phone). Only the strip scrolls.
  useEffect(() => {
    const row = nav.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  }, [pathname]);
  return (
    <nav ref={nav} className="guide-tabs guide-admin-tabs" aria-label="Sections">
      {tabs.map((s) => {
        const href = `${base}${s.path}`;
        const active = s.path === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            title={s.hint}
            className={[active ? "active" : "", s.path === "/fairness" && fairness ? "strong" : ""].join(" ").trim() || undefined}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The page head of the section open now: an eyebrow, the section's name and what it is for (from SECTIONS). */
export function AdminPageHead({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  const here = pathname === base ? "" : pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
  if (here === null) return null;
  // The longest section path that starts the current path (so /judge/calibration is under Judging).
  const section = SECTIONS.filter((s) => (s.path === "" ? here === "" : here === s.path || here.startsWith(`${s.path}/`))).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
  if (!section) return null;
  const sub = section.path !== "" && here !== section.path ? here.slice(section.path.length + 1).split("/")[0] : null;
  return (
    <div className="guide-page-head">
      <small>
        ORGANISER / {section.label.toUpperCase()}
        {sub ? ` / ${sub.replace(/-/g, " ").toUpperCase()}` : ""}
      </small>
      <p className="guide-page-title">{section.label}.</p>
      <p>{section.hint}.</p>
    </div>
  );
}
