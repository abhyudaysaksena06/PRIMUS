import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { loadTeamContext } from "@/lib/team/context";
import { loadTradeData } from "@/lib/team/trade-data";
import { STATUS_LABELS, orderHistory, type OrderLine } from "@/lib/team/trade";
import { clock, count, money, signedMoney } from "@/lib/format";
import { DeskPanel, DeskStatus, DeskTable, DeskTd, deskTr } from "../desk-ui";
import { tradeGate } from "../gate";

export const metadata: Metadata = { title: "Order history" };

// Order history: every order of every round (the open round's pending orders are on Orders), newest round first,
// with the price when it was placed, the fill price and the cash the fill moved. Clearings broadcast, so the page
// re-reads itself after every round.
export default async function HistoryPage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const data = await loadTradeData(ctx, { orders: "all" });
  const rounds = orderHistory(data.orders, data.rounds, data.companies);

  const total = rounds.reduce((n, r) => n + r.lines.length, 0);
  const status = (
    <DeskStatus>
      Order history <span aria-hidden>·</span> {rounds.length} {rounds.length === 1 ? "round" : "rounds"} <span aria-hidden>·</span> {total}{" "}
      {total === 1 ? "order" : "orders"} <span aria-hidden>·</span> newest round first
    </DeskStatus>
  );
  const filled = rounds.reduce((n, r) => n + r.lines.filter((l) => l.status === "FILLED").length, 0);
  const cancelled = rounds.reduce((n, r) => n + r.lines.filter((l) => l.status === "CANCELLED").length, 0);
  const cash = rounds.reduce((n, r) => n + (r.status === "CLEARED" ? r.cash : 0), 0);
  // The demo's Risk & Telemetry KPI row, with the fund's own order figures.
  const kpis = (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Kpi label="Rounds traded" value={count(rounds.length)} foot="Newest round first" />
      <Kpi label="Orders placed" value={count(total)} foot={`${count(cancelled)} cancelled`} />
      <Kpi label="Orders filled" value={count(filled)} tone="up" foot={total > 0 ? `${((filled / total) * 100).toFixed(1)}% of orders` : "No orders yet"} />
      <Kpi label="Net cash from fills" value={signedMoney(cash)} tone={cash < 0 ? "down" : cash > 0 ? "up" : "plain"} foot="Cleared rounds" />
    </div>
  );

  if (rounds.length === 0) {
    return (
      <div className="space-y-4">
        {status}
        {kpis}
        <DeskPanel title="Order history">
          <div className="p-4 text-center">
            <p className="font-mono text-xs text-[#87948D]">
              No orders yet. Orders are placed under{" "}
              <Link href="/team/trade" className="text-[color:var(--desk-accent)] underline">
                Orders
              </Link>{" "}
              while a round is open.
            </p>
          </div>
        </DeskPanel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {status}
      {kpis}
      {rounds.map((r) => (
        <DeskPanel
          key={r.number}
          title={`Round ${r.number}`}
          sub={`Order blotter · ${r.lines.length} ${r.lines.length === 1 ? "order" : "orders"}`}
          bodyClassName="p-0"
          actions={
            r.status === "CLEARED" ? (
              <span className="font-mono text-[#BACBB9]">
                Cash from fills <span className={`font-semibold tabular-nums ${r.cash < 0 ? "text-[#FF5364]" : "text-[#00D68F]"}`}>{signedMoney(r.cash)}</span>
              </span>
            ) : r.status === "OPEN" ? (
              <Chip tone="open">Open: pending orders are under Orders</Chip>
            ) : (
              <Chip tone="open">Clearing</Chip>
            )
          }
        >
          <DeskTable head={["Order", "Shares", "Fill price", "Cash", "Status", "Price when placed", "Placed"]} label={`Orders of round ${r.number}`} right={[1, 2, 3, 5]}>
            {r.lines.map((l) => (
              <HistoryRow key={l.id} l={l} clearing={r.status !== "CLEARED" && r.status !== "OPEN"} />
            ))}
          </DeskTable>
        </DeskPanel>
      ))}
    </div>
  );
}

/** A tile of the demo's Risk & Telemetry KPI row. */
function Kpi({ label, value, foot, tone = "plain" }: { label: string; value: string; foot: string; tone?: "plain" | "up" | "down" }) {
  const color = { plain: "text-[#F2F5F3]", up: "text-[#00D68F]", down: "text-[#FF5364]" }[tone];
  return (
    <div className="bg-[#171610] border border-white/[0.07] rounded-lg p-4">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D]">{label}</div>
      <div className={`font-mono text-xl font-semibold tabular-nums mt-2 ${color}`}>{value}</div>
      <div className="font-mono text-xs text-[#87948D] mt-1">{foot}</div>
    </div>
  );
}

/** The demo blotter's status chip: filled green, open in the accent, the rest grey. */
function Chip({ tone, children }: { tone: "filled" | "open" | "off"; children: ReactNode }) {
  const cls = {
    filled: "bg-[#00D68F]/10 border-[color:var(--desk-accent-line)] text-[#00D68F]",
    open: "bg-[var(--desk-accent-soft)] border-[color:var(--desk-accent-line)] text-[color:var(--desk-accent)]",
    off: "bg-[#201e14] border-[#2d2a1d] text-[#87948D]",
  }[tone];
  return <span className={`font-mono text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-sm border ${cls}`}>{children}</span>;
}

function HistoryRow({ l, clearing }: { l: OrderLine; clearing: boolean }) {
  const tone = l.status === "FILLED" ? "filled" : l.status === "CANCELLED" ? "off" : "open";
  return (
    <tr className={deskTr} data-testid="history-order">
      <DeskTd edge className={`font-semibold ${l.type === "BUY" || l.type === "COVER" ? "text-[#00D68F]" : "text-[#FF5364]"}`}>
        {l.type} <span className="text-[#F2F5F3]">{l.ticker}</span>
      </DeskTd>
      <DeskTd right>{count(l.qty)}</DeskTd>
      <DeskTd right>{l.fillPrice === null ? "—" : money(l.fillPrice)}</DeskTd>
      <DeskTd right className={l.cash !== null && l.cash < 0 ? "text-[#FF5364]" : ""}>
        {l.cash === null ? "—" : signedMoney(l.cash)}
      </DeskTd>
      <DeskTd>
        <Chip tone={tone}>{l.status === "PENDING" && clearing ? "Clearing" : STATUS_LABELS[l.status]}</Chip>
      </DeskTd>
      <DeskTd right className="text-[#BACBB9]">
        {money(l.entryPrice)}
      </DeskTd>
      <DeskTd edge className="text-[#87948D] text-[11px]">
        {clock(l.createdAt, true)}
      </DeskTd>
    </tr>
  );
}
