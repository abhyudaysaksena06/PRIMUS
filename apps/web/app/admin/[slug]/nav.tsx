"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
  { path: "/bulletins", label: "News", hint: "Market news for the teams and the big screen" },
  { path: "/content", label: "Cases & cards", hint: "Problem cards, crises and Round 3 statements" },
  { path: "/ledger", label: "Money", hint: "Every payment, with corrections" },
  { path: "/fairness", label: "Fairness", hint: "Flags and appeals" },
  { path: "/chats", label: "Chats", hint: "Read squad and hire chats" },
  { path: "/exports", label: "Downloads", hint: "CSV files of the ledger, prices, scores, results and the event log" },
  { path: "/backups", label: "Backups", hint: "Backups after every round; download or restore one" },
  { path: "/health", label: "System health", hint: "Connections, errors and the clock" },
] as const;

export function AdminNav({ slug, fairness }: { slug: string; fairness: boolean }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  const nav = useRef<HTMLElement>(null);
  // On a phone the tabs scroll sideways: keep the current one in view. Only the tab row scrolls (scrollIntoView would
  // also scroll the page, losing the reader's place on a reload or a #link).
  useEffect(() => {
    const row = nav.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    const r = row.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < r.left || t.right > r.right) row.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  }, [pathname]);
  return (
    <nav ref={nav} className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4" aria-label="Sections">
      {SECTIONS.map((s) => {
        const href = `${base}${s.path}`;
        const active = s.path === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={s.path}
            href={href}
            aria-current={active ? "page" : undefined}
            title={s.hint}
            className={`whitespace-nowrap border-b-2 px-3 py-2 font-mono text-sm font-medium ${
              active ? "border-phosphor text-phosphor glow" : "border-transparent text-muted hover:text-phosphor"
            } ${s.path === "/fairness" && fairness ? "font-semibold" : ""}`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
