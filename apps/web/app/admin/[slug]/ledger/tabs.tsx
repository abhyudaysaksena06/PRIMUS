import Link from "next/link";
import { Badge } from "@/app/admin/guide-ui";

// The two views of the Ledger section: the ledger itself and the corrections (with the number waiting for a decision).
export function LedgerTabs({ slug, current, pending }: { slug: string; current: "ledger" | "corrections"; pending: number }) {
  const tab = (href: string, active: boolean, label: React.ReactNode) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 ${active ? "active" : ""}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="guide-tabs" aria-label="Ledger views">
      {tab(`/admin/${slug}/ledger`, current === "ledger", "Ledger")}
      {tab(
        `/admin/${slug}/ledger/corrections`,
        current === "corrections",
        <>
          Corrections
          {pending > 0 ? <Badge tone="amber">{pending} pending</Badge> : null}
        </>,
      )}
    </nav>
  );
}
