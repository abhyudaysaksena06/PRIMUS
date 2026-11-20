import Link from "next/link";
import { BOOK_KINDS, BOOK_TITLES, type BookKind } from "@/lib/team/market";

const tab = (active: boolean) =>
  `inline-flex min-h-9 items-center whitespace-nowrap rounded-[5px] border px-3 text-sm font-medium transition-colors ${
    active
      ? "border-[color:var(--market-accent)] bg-[color-mix(in_srgb,var(--market-accent)_14%,transparent)] text-paper"
      : "border-[#4a5662] bg-[var(--mx-black)] text-muted hover:bg-raised hover:text-paper"
  }`;

/** The market's views: the prices, then each book that is public now (the row wraps on a phone). */
export function BookTabs({ open, current }: { open: readonly BookKind[]; current: BookKind | "PRICES" }) {
  return (
    <nav aria-label="Market views" className="flex flex-wrap gap-2">
      <Link href="/team/market" aria-current={current === "PRICES" ? "page" : undefined} className={tab(current === "PRICES")}>
        Prices
      </Link>
      {BOOK_KINDS.filter((k) => open.includes(k)).map((k) => (
        <Link key={k} href={`/team/market/book?type=${k}`} aria-current={k === current ? "page" : undefined} className={tab(k === current)}>
          {BOOK_TITLES[k]}
        </Link>
      ))}
    </nav>
  );
}
