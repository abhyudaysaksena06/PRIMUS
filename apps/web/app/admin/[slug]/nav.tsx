"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { canOpenSection, landingFor, type Role } from "@/lib/auth/routes";

// The control panel's tabs. Organisers and the fairness officer see them all; a desk role (registration, judging,
// crisis) sees only the sections lib/auth/routes.ts (DESK_SECTIONS) gives it, so a line added here is for
// organisers and the fairness officer unless routes.ts says otherwise.
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
] as const;

const RoleContext = createContext<Role | null>(null);

/** The signed-in staff role, set once for the whole control panel by app/admin/layout.tsx. */
export function StaffRoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/**
 * The console's sidebar, in the /demo organiser console's look (admin.css): the brand, the role's sections numbered
 * 01, 02 … (the number and the arrow are decoration hidden from screen readers, so each link is named by its label
 * alone), then who is signed in, the projector link, all events and Sign out.
 */
export function AdminSidebar({
  slug,
  fairness,
  who,
  roleLabel,
  signOut,
}: {
  slug: string;
  fairness: boolean;
  who: string;
  roleLabel: string;
  signOut: ReactNode;
}) {
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
  // Keep the current section in view: on a phone the list scrolls sideways, on a short laptop screen downwards. Only
  // the list scrolls (scrollIntoView would also scroll the page, losing the reader's place on a reload or a #link).
  useEffect(() => {
    const row = nav.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
    if (t.top < r.top || t.bottom > r.bottom) row.scrollTop += t.top - r.top - (r.height - t.height) / 2;
  }, [pathname]);
  const initials =
    who
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "OR";
  return (
    <aside className="adm-sidebar">
      <Link href={base} className="adm-brand" aria-label="PRIMUS control panel">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG, as on /demo */}
        <img src="/primus-logo-light.svg" alt="" />
        <span>
          <b>
            PRIMUS <i>’26</i>
          </b>
          <small>ORGANISER CONSOLE</small>
        </span>
      </Link>
      <div className="adm-nav-label" aria-hidden>
        {role === "ORGANISER" || role === "FAIRNESS" ? "EVENT CONTROL" : "STAFF DESK"} <b>{"///"}</b>
      </div>
      <nav ref={nav} className="adm-nav" aria-label="Sections">
        {tabs.map((s, i) => {
          const href = `${base}${s.path}`;
          const active = s.path === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={s.path}
              href={href}
              aria-current={active ? "page" : undefined}
              title={s.hint}
              className={s.path === "/fairness" && fairness ? "adm-strong" : undefined}
            >
              <small aria-hidden>{String(i + 1).padStart(2, "0")}</small>
              <span>{s.label}</span>
              <i aria-hidden>↗</i>
            </Link>
          );
        })}
      </nav>
      <div className="adm-side-bottom">
        <div className="adm-who">
          <div className="adm-avatar" aria-hidden>
            {initials}
          </div>
          <div className="min-w-0">
            <b>{who}</b>
            <small>{roleLabel.toUpperCase()}</small>
          </div>
        </div>
        <div className="adm-side-links">
          <a href={`/display/${slug}`} target="_blank" rel="noreferrer">
            ↗ Projector display
          </a>
          <Link href="/admin">← All events</Link>
          {signOut}
        </div>
      </div>
    </aside>
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
    <div className="adm-head">
      <small>
        Organiser / {section.label}
        {sub ? ` / ${sub.replace(/-/g, " ")}` : ""}
      </small>
      <p className="adm-title">{section.label}.</p>
      <p>{section.hint}.</p>
    </div>
  );
}
