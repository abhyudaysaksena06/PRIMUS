import { loadTeamContext } from "@/lib/team/context";
import { TradeTabs } from "./tabs";
import { tradeGate } from "./gate";
import "./finance-desk.css";

// The fund's trading area: orders (the ticket and the open round's orders), positions, history and the IPO. A
// Product or Consulting team sees a notice instead; every page checks again, because a page renders on its own.
// Drawn as the Finance desk: a terminal frame with its own bar and views, the window's full width on a laptop.
export default async function TradeLayout({ children }: LayoutProps<"/team/trade">) {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  return (
    <div className="fin-desk fin-bleed min-w-0 rounded-lg border border-white/10 bg-[#070909]">
      <TradeTabs fund={ctx.team.code} />
      <div className="space-y-4 p-3 sm:p-4">{children}</div>
    </div>
  );
}
