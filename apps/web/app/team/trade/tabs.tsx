"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command, Plus } from "lucide-react";

const TABS = [
  { href: "/team/trade", label: "Orders", title: "Markets & Execution" },
  { href: "/team/trade/practice", label: "Practice", title: "Practice Market" },
  { href: "/team/trade/positions", label: "Positions", title: "Desk Overview" },
  { href: "/team/trade/history", label: "History", title: "Order History" },
  { href: "/team/trade/ipo", label: "IPO", title: "IPO Book" },
] as const;

// The desk's top bar and its views, as the demo's TopBar and workspace nav (demo/finance/_desk/App.tsx): a breadcrumb
// ("Finance desk / Markets & Execution"), the fund's chip where the demo has its command button, the solid New Order key
// (it jumps to the real order ticket), then one pill per view. On a phone the pills wrap (never wider than the screen).
export function TradeTabs({ fund }: { fund?: string }) {
  const pathname = usePathname();
  const current = TABS.find((t) => t.href === pathname);
  return (
    <>
      <header className="h-14 bg-[#11110d] border-b border-[#2d2a1d] px-4 lg:px-6 flex items-center justify-between gap-4 shrink-0 rounded-t-lg">
        <div className="flex items-center gap-3 min-w-0">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
            <span className="hidden sm:inline font-mono text-xs text-[#87948D] whitespace-nowrap">Matrix Command</span>
            <span className="hidden sm:inline text-[#3B4A3D]" aria-hidden="true">
              /
            </span>
            <span className="font-display font-semibold text-sm text-[#F2F5F3] truncate">{current?.title ?? "Markets & Execution"}</span>
          </nav>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {fund ? (
            <span className="hidden sm:flex items-center gap-2 h-9 px-3 bg-[#070909] border border-[#2d2a1d] rounded text-xs font-mono text-[#87948D] whitespace-nowrap shrink-0">
              <Command className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Fund</span>
              <kbd className="ml-1 px-1.5 py-0.5 text-[10px] bg-[#171610] border border-[#2d2a1d] rounded-sm text-[#BACBB9]">{fund}</kbd>
            </span>
          ) : null}
          <Link
            href="/team/trade#order-ticket"
            className="h-9 px-4 bg-[var(--desk-accent)] hover:bg-[var(--desk-accent-hover)] text-[#070909] font-mono text-xs font-semibold uppercase tracking-wide rounded transition-all hover:shadow-[0_0_12px_var(--desk-accent-soft)] flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>New Order</span>
          </Link>
        </div>
      </header>
      <nav aria-label="Trading views" className="flex flex-wrap gap-2 border-b border-white/10 p-3">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={pathname === t.href ? "page" : undefined}
            className="rounded border border-white/15 px-3 py-1.5 text-xs text-[#BACBB9] aria-[current=page]:border-[color:var(--desk-accent)] aria-[current=page]:text-[color:var(--desk-accent)]"
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
