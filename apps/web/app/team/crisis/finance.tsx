// The fund's crisis room: what moves prices in Rounds 2 and 3, read like a news terminal. The Round 3 capital
// injection, every company's crisis card of the sub-round, who hired whom (and on what terms), the Round 3 draft
// board and the firm league. Trading itself is on the Trade page.

import Link from "next/link";
import { money } from "@/lib/format";
import type { TeamContext } from "@/lib/team/context";
import type { CrisisRoomData } from "@/lib/team/crisis-data";
import { pastSubrounds, statementCounts, subroundTitle } from "@/lib/team/crisis";
import { DoThis } from "@/components/ui/how-it-works";
import { Table, Td, buttonClass } from "@/components/ui/ui";
import { FinanceRaisePanel } from "./raises";
import { CardsOf, EngagementTable, FirmLeague, StatementBoard, companyLabel } from "./parts";
import { Chip, GuideAlert, GuidePanel } from "./guide";

export function FinanceRoom({ ctx, data, k }: { ctx: TeamContext; data: CrisisRoomData; k: number | null }) {
  const company = new Map(data.companies.map((c) => [c.id, c]));
  const counts = statementCounts(data.picks);
  const statement = new Map(data.statements.map((s) => [s.id, s]));
  return (
    <div className="space-y-6">
      <DoThis testId="fund-todo">
        {k === 5
          ? "Round 3: watch which problem statement each company picks, then invest your fresh capital."
          : k !== null
            ? "Read each company's crisis card and see who hired a firm. Then trade: plan scores move prices after the due time."
            : "The first crisis card arrives soon. Until then, keep trading."}
      </DoThis>
      {data.injectionCents !== null ? (
        <GuideAlert>
          Round 3 capital injection received: <strong className="font-mono">{money(data.injectionCents)}</strong> (half your starting capital). Your return is
          measured on everything you were given, so put it to work.
        </GuideAlert>
      ) : ctx.status.phase === "PRESSURE" ? (
        <GuideAlert>At the start of Round 3 every fund receives half its starting capital again.</GuideAlert>
      ) : null}
      <div>
        <Link href="/team/trade" className={buttonClass.primary}>
          Open the trading desk →
        </Link>
      </div>

      {k !== null && k < 5 ? (
        <FinanceRaisePanel
          data={data}
          ownCompanyId={data.companies.find((c) => c.product_team_id === ctx.squad?.product_team_id)?.id ?? null}
          open={ctx.status.phase === "PRESSURE"}
        />
      ) : null}

      {k !== null && k < 5 ? (
        <GuidePanel title={`Crisis cards · ${subroundTitle(k)}`}>
          <p className="mb-3 text-sm text-paper">
            Each reveal knocked 5% off every price. After the due time each company&apos;s response plan is judged and its tier moves the price.
          </p>
          <CardsOf data={data} k={k} />
        </GuidePanel>
      ) : null}

      {k === 5 || data.picks.length ? <StatementBoard data={data} /> : null}

      {k === 5 || data.picks.length ? (
        <GuidePanel title="Round 3 · draft order">
          <Table head={["Pick", "Company", "Score so far", "Statement"]} empty={data.picks.length === 0 ? "The draft has not started." : undefined}>
            {data.picks.map((p) => {
              const s = p.statement_id ? statement.get(p.statement_id) : undefined;
              return (
                <tr key={p.company_id}>
                  <Td mono>{p.pick_no}</Td>
                  <Td mono>{companyLabel(company.get(p.company_id))}</Td>
                  <Td mono>{p.score_avg.toFixed(1)}</Td>
                  <Td>
                    {s ? (
                      <>
                        #{s.number} {s.title} {p.by_default ? <Chip tone="slate">default</Chip> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
          {data.statements.length ? (
            <p className="mt-2 text-xs text-muted">
              {data.statements.map((s) => `#${s.number}: ${counts.get(s.id) ?? 0}/${s.cap}`).join(" · ")}. A solution&apos;s price rise is scaled by the
              company&apos;s standing going into Round 3: ×1.25 for the weakest down to ×0.25 for the strongest (a fall applies in full).
            </p>
          ) : null}
        </GuidePanel>
      ) : null}

      <EngagementTable data={data} rows={[...data.engagements].reverse()} />
      <FirmLeague data={data} />

      {pastSubrounds(k, data.subrounds).map((pk) => (
        <GuidePanel key={pk} title={`Earlier · ${subroundTitle(pk)}`}>
          <CardsOf data={data} k={pk} />
        </GuidePanel>
      ))}
    </div>
  );
}
