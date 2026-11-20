import type { Metadata } from "next";
import { RULES, mul } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadTradeData } from "@/lib/team/trade-data";
import { ipoBook, ipoResults, ipoView, ipoWindow, type IpoResultLine } from "@/lib/team/trade";
import { clock, count, money } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { Notice } from "@/components/ui/ui";
import { DeskKpi, DeskPanel, DeskStatus, DeskTable, DeskTd, deskTr } from "../desk-ui";
import { Countdown } from "@/components/ui/countdown";
import { tradeGate } from "../gate";
import { IpoBids } from "../ipo-bids";
import { placeIpoBid } from "../actions";

export const metadata: Metadata = { title: "IPO" };

const RULES_TEXT =
  "Each fund may request 0 to 4,000 shares of each company except its own squad's, and all its requests together may not cost more than its cash at IPO prices. A company whose 35,000 IPO shares are oversubscribed is scaled down: each allocation is request × 35,000 ÷ total requested, rounded down to the nearest 10 shares. The money goes to the exchange; IPO shares count towards the 4,000-share long limit.";

// The IPO: during the IPO phase, every company the fund may bid for with its IPO price and the fund's saved bids
// (each saved on its own, checked as it is typed); after the allocation, the shares received and the cash paid. Bids
// send no broadcast, so while bids are open the page re-reads itself every 10 s (a bid saved on the fund's other
// device) and at the deadline; the allocation broadcasts.
export default async function IpoPage() {
  const ctx = await loadTeamContext();
  const gate = tradeGate(ctx);
  if (gate) return gate;
  const { status, team, company: own } = ctx;
  const data = await loadTradeData(ctx, { orders: "pending", ipo: true });
  const nowMs = new Date(status.server_time).getTime();
  const win = ipoWindow({ phase: status.phase, paused: status.paused, allocatedAt: data.ipoAllocatedAt, deadline: data.ipoDeadline, nowMs });
  const view = ipoView(team.cash, own?.id ?? null, data.bids, data.companies);
  const results = ipoResults(data.bids, data.companies);
  const deadline = data.ipoDeadline;

  if (win === "NOT_YET") {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <DeskPanel title="IPO" sub="IPO book · opens with the IPO" className="xl:col-span-7">
          <p className="text-sm text-[#BACBB9]" data-testid="ipo-state">
            IPO bids open with the IPO{data.phaseStarts.IPO ? ` at ${clock(data.phaseStarts.IPO)}` : ""}
            {deadline ? ` and close at ${clock(deadline)}` : ""}, once the pitch scores have set every company&apos;s IPO price ($10.00 × (1 + pitch tier)).
          </p>
        </DeskPanel>
        <IpoRules className="xl:col-span-5" cash={team.cash} ownTicker={own?.ticker ?? null} />
      </div>
    );
  }

  if (win === "ALLOCATED") {
    const books = new Map(data.ipoBooks.map((b) => [b.company_id, b.details]));
    return (
      <div className="space-y-4">
        <DeskStatus>
          IPO book <span aria-hidden>·</span> allocated {clock(data.ipoAllocatedAt)} <span aria-hidden>·</span> {results.lines.length}{" "}
          {results.lines.length === 1 ? "bid" : "bids"}
        </DeskStatus>
        {results.lines.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <DeskKpi label="Shares requested" tag="BOOK" value={count(results.requested)} foot="Across every company you bid for" />
            <DeskKpi label="Shares received" tag={<span className="text-[#00D68F]">FILLED</span>} tone="up" value={<span data-testid="ipo-received">{count(results.allocated)}</span>} foot="Your squad lot" />
            <DeskKpi label="Cash paid" tag="IPO PRICES" value={<span data-testid="ipo-paid">{money(results.paid)}</span>} foot={`Cash now ${money(team.cash)}`} />
          </div>
        ) : null}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <DeskPanel title="IPO allocation" sub="Shares received at each IPO price" bodyClassName="p-0" className="xl:col-span-7">
          <p className="px-4 pt-3 text-sm text-[#BACBB9]" data-testid="ipo-state">
            The IPO was allocated at {clock(data.ipoAllocatedAt)}. Unallocated shares stay with the exchange.
          </p>
          {results.lines.length === 0 ? (
            <p className="p-8 text-center font-mono text-xs text-[#87948D]">You placed no IPO bids.</p>
          ) : (
            <div className="mt-3 border-t border-[#2d2a1d]">
              <DeskTable head={["Company", "Received", "Paid", "Requested", "IPO price", "Book"]} label="IPO allocation" right={[1, 2, 3, 4]}>
                {results.lines.map((l) => (
                  <AllocationRow key={l.companyId} l={l} book={books.get(l.companyId) ?? null} />
                ))}
              </DeskTable>
            </div>
          )}
        </DeskPanel>
        <IpoRules className="xl:col-span-5" cash={team.cash} ownTicker={own?.ticker ?? null} />
        </div>
      </div>
    );
  }

  const book = ipoBook(view);
  const items = data.companies
    .filter((c) => c.ipo_price !== null && c.id !== own?.id)
    .map((c) => ({ id: c.id, ticker: c.ticker!, name: c.name, ipoPrice: c.ipo_price!, action: placeIpoBid.bind(null, c.id) }));

  return (
    <div className="space-y-4">
      <RefreshAt at={win === "OPEN" ? deadline : null} />
      <AutoRefresh everyMs={10_000} active={win === "OPEN"} />
      {win === "OPEN" ? (
        <p className="-mx-3 -mt-3 mb-4 border-b border-[#2d2a1d] bg-[#11110d] px-4 py-2 font-mono text-xs text-[#BACBB9] sm:-mx-4 sm:-mt-4 lg:px-6" data-testid="ipo-state">
          IPO bids are open until {clock(deadline)}
          {deadline ? (
            <>
              {" "}
              (in <Countdown to={deadline} passed="now" className="font-semibold text-[color:var(--desk-accent)]" />)
            </>
          ) : null}
          . Shares are allocated when round 1 starts.
        </p>
      ) : win === "PAUSED" ? (
        <Notice tone="amber">
          <span data-testid="ipo-state">The event is paused: IPO bids are refused until it resumes. The deadline moves later by the length of the pause.</span>
        </Notice>
      ) : (
        <Notice tone="amber">
          <span data-testid="ipo-state">
            IPO bids closed{deadline ? ` at ${clock(deadline)}` : ""}. Shares are allocated when round 1 starts; the bids below are final.
          </span>
        </Notice>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DeskKpi label="Cash" tag={win === "OPEN" ? <span className="text-[#00D68F]">LIVE</span> : "FINAL"} value={money(team.cash)} foot={`${items.length} ${items.length === 1 ? "company" : "companies"} offered`} />
        <DeskKpi label="Your bids at IPO prices" tag="BOOK" tone="accent" value={<span data-testid="ipo-committed">{money(book.committed)}</span>} foot="0 to 4,000 shares per company" />
        <DeskKpi
          label="Cash left at IPO prices"
          value={<span data-testid="ipo-remaining">{money(book.remaining)}</span>}
          foot="If every bid fills"
          aside={
            <div className="w-24 h-1.5 bg-[#070909] rounded-sm overflow-hidden">
              <div className="h-full bg-[var(--desk-accent)]" style={{ width: `${team.cash > 0 ? Math.min(100, Math.round((book.committed / team.cash) * 100)) : 0}%` }} />
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <DeskPanel
        title="Companies"
        sub="IPO book · one bid per company"
        bodyClassName="px-4 pb-4"
        className="xl:col-span-7"
        actions={<span className="font-mono text-xs text-[#00D68F] whitespace-nowrap">{items.length} {items.length === 1 ? "Company" : "Companies"} Offered</span>}
      >
        {items.length === 0 ? (
          <p className="p-8 text-center font-mono text-xs text-[#87948D]">No company has an IPO price yet.</p>
        ) : win === "OPEN" ? (
          <IpoBids view={view} items={items} deadline={deadline} />
        ) : (
          <div className="-mx-4">
          <DeskTable head={["Company", "IPO price", "Your bid", "Cost"]} label="Your IPO bids" right={[1, 2, 3]}>
            {items.map((c) => {
              const q = view.bids[c.id] ?? 0;
              return (
                <tr key={c.id} className={deskTr}>
                  <DeskTd edge className="font-semibold">
                    {c.ticker}
                  </DeskTd>
                  <DeskTd right>{money(c.ipoPrice)}</DeskTd>
                  <DeskTd right>{q > 0 ? count(q) : "—"}</DeskTd>
                  <DeskTd edge right>
                    {q > 0 ? money(mul(q, c.ipoPrice)) : "—"}
                  </DeskTd>
                </tr>
              );
            })}
          </DeskTable>
          </div>
        )}
      </DeskPanel>
      <IpoRules className="xl:col-span-5" cash={team.cash} ownTicker={own?.ticker ?? null} />
      </div>
    </div>
  );
}

/** The arena's detail column (the demo's PitchArenaScreen): how the IPO works, in its captioned sections. */
function IpoRules({ className = "", cash, ownTicker }: { className?: string; cash: number; ownTicker: string | null }) {
  const caption = "font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#87948D] mb-1";
  return (
    <section className={`min-w-0 bg-[#171610] border border-white/[0.07] rounded-lg p-5 flex flex-col gap-4 ${className}`}>
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#2d2a1d]">
        <div>
          <div className="font-mono text-[11px] text-[#87948D]">IPO · {count(RULES.IPO_SHARES)} shares per company</div>
          <h2 className="text-lg font-semibold text-[#F2F5F3] mt-1">How the IPO allocates</h2>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#87948D]">Cash</div>
          <div className="font-mono text-lg font-semibold text-[color:var(--desk-accent)] tabular-nums">{money(cash)}</div>
        </div>
      </div>
      <div className="space-y-3 text-[13px] leading-relaxed">
        <div>
          <h3 className={caption}>The rules</h3>
          <p className="text-[#F2F5F3]">{RULES_TEXT}</p>
        </div>
        {ownTicker ? (
          <div className="pt-2 border-t border-[#2d2a1d]">
            <h3 className={caption}>Your squad&apos;s company</h3>
            <p className="text-[#FF5364]">Your squad&apos;s company, {ownTicker}, is not offered to you: a fund never bids for or trades its own squad&apos;s company.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AllocationRow({ l, book }: { l: IpoResultLine; book: { requested?: number; available?: number } | null }) {
  const requested = book?.requested ?? null;
  const available = book?.available ?? RULES.IPO_SHARES;
  return (
    <tr className={deskTr} data-testid={`allocation-${l.ticker}`}>
      <DeskTd edge className="font-semibold">
        {l.ticker}
      </DeskTd>
      <DeskTd right className="text-[#00D68F]">
        {count(l.allocated)}
      </DeskTd>
      <DeskTd right>{money(l.paid)}</DeskTd>
      <DeskTd right>{count(l.requested)}</DeskTd>
      <DeskTd right>{money(l.price)}</DeskTd>
      <DeskTd edge>
        {l.scaledDown ? (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-sm border bg-[var(--desk-accent-soft)] border-[color:var(--desk-accent-line)] text-[color:var(--desk-accent)]">
            {requested !== null ? `Scaled down: ${count(requested)} requested for ${count(available)}` : "Scaled down"}
          </span>
        ) : (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-sm border bg-[#00D68F]/10 border-[color:var(--desk-accent-line)] text-[#00D68F]">In full</span>
        )}
      </DeskTd>
    </tr>
  );
}
