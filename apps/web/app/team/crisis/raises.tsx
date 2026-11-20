// Round 2 equity raises (migration 067), as the organisers put it: "I am giving 5% equity to the Finance team, that
// means I am taking Rs 5,000 from them." A Product company posts a stake (1–10% of itself); any Finance team (not its
// own squad's) can fund it, at the company's share price at that moment. The database checks every rule again.

import { clock, money } from "@/lib/format";
import type { CrisisRoomData, RaiseRow, RoomCompany } from "@/lib/team/crisis-data";
import { equityText, stakeValue } from "@/lib/team/equity";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Table, Td, type Tone } from "@/components/ui/ui";
import { cancelRaise, fundRaise, postRaise } from "./actions";
import { EquityFields } from "./equity-fields";
import { companyLabel } from "./parts";
import { Chip, GuideAlert, GuidePanel } from "./guide";

const STATUS_TONE: Record<RaiseRow["status"], Tone> = { OPEN: "amber", FUNDED: "green", CANCELLED: "slate", LAPSED: "slate" };

/** The crisis a raise belongs to now: the latest revealed (0 before Crisis 1). */
export function raiseK(data: CrisisRoomData): number {
  return data.subrounds.filter((s) => s.k >= 1 && s.k <= 4 && s.revealed_at).reduce((m, s) => Math.max(m, s.k), 0);
}

export function ProductRaisePanel({ data, mine, open }: { data: CrisisRoomData; mine: RoomCompany; open: boolean }) {
  const k = raiseK(data);
  const mineRaises = data.raises.filter((r) => r.company_id === mine.id);
  const live = mineRaises.find((r) => r.status === "OPEN" && r.k === k);
  const doneThisCrisis = mineRaises.some((r) => r.status === "FUNDED" && r.k === k);
  return (
    <GuidePanel title="Raise money from Finance (sell equity)">
      <div data-testid="raise-product" className="space-y-3">
        <p className="guide-muted">
          Sell a stake in your company to a Finance fund for cash. Choose how much equity (1% to 10%); the fund pays shares × your share price at
          the moment it accepts{mine.market_price ? `, now ${money(mine.market_price)} a share` : ""}. Once per crisis; you always keep at least 40% of your
          company.
        </p>
        {!open ? (
          <GuideAlert>Raising from Finance is open during Round 2.</GuideAlert>
        ) : live ? (
          <GuideAlert tone="warn">
            Your raise of {equityText(live.shares)} is open to every fund
            {mine.market_price ? ` (worth ${money(stakeValue(live.shares, mine.market_price))} at today's price)` : ""}.{" "}
            <span className="inline-block align-middle">
              <ActionButton action={cancelRaise.bind(null, live.id)} confirm="Click again to cancel this raise">
                Cancel raise
              </ActionButton>
            </span>
          </GuideAlert>
        ) : doneThisCrisis ? (
          <GuideAlert>You have raised from Finance in this crisis. You can raise again in the next one.</GuideAlert>
        ) : (
          <ActionForm action={postRaise} submit="Post the raise" confirm="Click again to offer this stake to every fund" resetOnSuccess>
            <EquityFields priceCents={mine.market_price} label="Equity to sell (% of your company)" testId="raise-fields" />
            <label className="mt-2 block text-sm">
              <span className="guide-label !mb-1.5 !mt-0 uppercase">Pitch to the funds (optional)</span>
              <input name="note" maxLength={300} placeholder="What the money is for" className={`guide-input mt-1`} />
            </label>
          </ActionForm>
        )}
        <RaiseHistory data={data} rows={mineRaises} />
      </div>
    </GuidePanel>
  );
}

export function FinanceRaisePanel({ data, ownCompanyId, open }: { data: CrisisRoomData; ownCompanyId: string | null; open: boolean }) {
  const k = raiseK(data);
  const company = new Map(data.companies.map((c) => [c.id, c]));
  const live = data.raises.filter((r) => r.status === "OPEN" && r.k === k);
  return (
    <GuidePanel title="Companies raising money (buy equity)">
      <div data-testid="raise-finance" className="space-y-3">
        <p className="guide-muted">
          A company sells a stake for cash. The price is its share price at the moment you fund it, so you pay shares × that price. The shares are held
          to the close and count in your portfolio value; they are not sold on the exchange. You cannot fund your own squad&apos;s company.
        </p>
        {!open ? <GuideAlert>Raises are open during Round 2.</GuideAlert> : null}
        <Table head={["Company", "Stake", "Price now", "You pay", "Pitch", ""]} empty={live.length === 0 ? "No company is raising right now." : undefined}>
          {live.map((r) => {
            const c = company.get(r.company_id);
            const value = stakeValue(r.shares, c?.market_price);
            const own = r.company_id === ownCompanyId;
            const label = `${equityText(r.shares)} of ${companyLabel(c)}`;
            return (
              <tr key={r.id} data-testid="raise-row">
                <Td mono>{companyLabel(c)}</Td>
                <Td mono>{equityText(r.shares)}</Td>
                <Td mono>{money(c?.market_price ?? null)}</Td>
                <Td mono>{money(value)}</Td>
                <Td>{r.note || "—"}</Td>
                <Td>
                  {own ? (
                    <Chip tone="slate">your squad</Chip>
                  ) : open ? (
                    <ActionButton variant="primary" action={fundRaise.bind(null, r.id, label)} confirm={`Click again to pay about ${money(value)}`}>
                      Fund
                    </ActionButton>
                  ) : null}
                </Td>
              </tr>
            );
          })}
        </Table>
        <RaiseHistory data={data} rows={data.raises.filter((r) => r.status === "FUNDED")} title="Funded so far" />
      </div>
    </GuidePanel>
  );
}

function RaiseHistory({ data, rows, title = "Your raises" }: { data: CrisisRoomData; rows: readonly RaiseRow[]; title?: string }) {
  if (rows.length === 0) return null;
  const company = new Map(data.companies.map((c) => [c.id, c]));
  return (
    <div>
      <h3 className="guide-label uppercase mb-2">{title}</h3>
      <Table head={["Crisis", "Company", "Stake", "Status", "Fund", "Price", "Cash", "When"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td mono>{r.k || "—"}</Td>
            <Td mono>{companyLabel(company.get(r.company_id))}</Td>
            <Td mono>{equityText(r.shares)}</Td>
            <Td>
              <Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip>
            </Td>
            <Td mono>{r.funded_by ? (data.fundCodes.get(r.funded_by) ?? "a fund") : "—"}</Td>
            <Td mono>{r.price_cents ? money(r.price_cents) : "—"}</Td>
            <Td mono>{r.cash_cents ? money(r.cash_cents) : "—"}</Td>
            <Td mono>{clock(r.decided_at ?? r.created_at)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
