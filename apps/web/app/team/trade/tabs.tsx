"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/team/trade", label: "Orders", title: "Markets & Execution" },
  { href: "/team/trade/practice", label: "Practice", title: "Practice Market" },
  { href: "/team/trade/positions", label: "Positions", title: "Portfolio & Risk" },
  { href: "/team/trade/history", label: "History", title: "Order History" },
  { href: "/team/trade/ipo", label: "IPO", title: "IPO Book" },
] as const;

// The desk's bar (where you are on the desk) and its views. On a phone the views wrap onto a second line (never wider
// than the screen).
export function TradeTabs({ fund }: { fund?: string }) {
  const pathname = usePathname();
  const current = TABS.find((t) => t.href === pathname);
  return (
    <>
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-t-lg border-b border-[#2d2a1d] bg-[#11110d] px-4 py-2 lg:px-6">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <span className="hidden whitespace-nowrap font-mono text-xs text-[#87948D] sm:inline">Finance desk</span>
          <span className="hidden text-[#3B4A3D] sm:inline" aria-hidden="true">
            /
          </span>
          <span className="truncate font-semibold text-[#F2F5F3]">{current?.title ?? "Trading"}</span>
        </p>
        {fund ? (
          <span className="shrink-0 rounded border border-[color:var(--desk-accent-line)] bg-[var(--desk-accent-soft)] px-2.5 py-1 font-mono text-xs font-semibold text-[color:var(--desk-accent)]">
            Fund {fund}
          </span>
        ) : null}
      </div>
      <nav className="flex flex-wrap gap-2 border-b border-white/10 p-3" aria-label="Trading views">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-[color:var(--desk-accent)] bg-[var(--desk-accent-soft)] text-[color:var(--desk-accent)]"
                  : "border-white/15 text-[#BACBB9] hover:border-[color:var(--desk-accent-line)] hover:text-[#F2F5F3]"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
