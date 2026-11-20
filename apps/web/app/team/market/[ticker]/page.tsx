import type { Metadata } from "next";
import Link from "next/link";
import { phaseReached, type SubmissionType } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadCompanyView } from "@/lib/team/market-data";
import { BOOK_PUBLIC_FROM, chartCandles, historyLines, SUBMISSION_TITLES, verdict } from "@/lib/team/market";
import { CandleChart } from "@/components/ui/candle-chart";
import { VerdictDetail } from "../verdict-detail";
import { clock, money } from "@/lib/format";
import { Badge, Notice, Table, Td } from "@/components/ui/ui";
import { MarketCard, MarketStat } from "../card";
import type { PublicSubmission } from "@/lib/team/market-data";
import { Submission } from "../submission";
import { CrisisCard } from "../crisis-card";

export const metadata: Metadata = { title: "Market" };

const TONE = { 1: "text-phosphor", 0: "text-paper", [-1]: "text-danger-soft" } as const;
const TIER_TONE = { 1: "green", 0: "slate", [-1]: "red" } as const;

// One company: its prices, and everything public about it so far: the pitch (from Reading), the verdicts (released
// scores), the crisis card (from the crisis), the rescue plan (from Plans published), the flash answer (once the
// flash scores are released) and every price change, round by round.
export default async function CompanyPage({ params }: PageProps<"/team/market/[ticker]">) {
  const { ticker } = await params;
  const { event, status, company: own } = await loadTeamContext();
  const back = (
    <Link href="/team/market" className="market-action inline-flex items-center text-sm font-medium text-paper">
      ← All companies
    </Link>
  );
  if (!phaseReached(status.phase, "READING")) {
    return (
      <div className="market-board market-type space-y-4">
        {back}
        <Notice>The market opens at Reading, when the pitch book goes public.</Notice>
      </div>
    );
  }
  const code = decodeURIComponent(ticker).toUpperCase();
  const view = /^[A-Z]{3,4}$/.test(code) ? await loadCompanyView(event.id, code, status.phase) : null;
  if (!view) {
    return (
      <div className="market-board market-type space-y-4">
        {back}
        <Notice tone="amber">No listed company has the ticker {code.slice(0, 8)}.</Notice>
      </div>
    );
  }
  const { company: c, history, submissions, scores, crisis, types } = view;
  const lines = historyLines(history);
  const latest = lines.at(-1);
  const waiting = (["PITCH", "PLAN", "FLASH"] as const).filter((t) => !types.includes(t));

  return (
    <div className="market-board market-type space-y-6">
      {back}
      <MarketCard
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono">{c.ticker}</span>
            <span>{c.name}</span>
            {own?.id === c.id ? <Badge tone="violet">Your squad</Badge> : null}
          </span>
        }
      >
        <dl className="grid grid-cols-2 gap-4 border-y border-line py-4 sm:grid-cols-4">
          <MarketStat label="Market price" value={money(c.market_price)} />
          <MarketStat label="IPO price" value={money(c.ipo_price)} />
          <MarketStat label="AI price" value={money(c.ai_price)} hint="IPO × 0.85 × plan and flash tiers" />
          {c.closing_price !== null ? (
            <MarketStat label="Closing price" value={money(c.closing_price)} hint="(market + AI) ÷ 2" />
          ) : (
            <MarketStat label="Post-crisis price" value={money(c.post_crisis_price)} />
          )}
        </dl>
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-paper">Price action</h3>
            {latest ? (
              <p className="text-xs text-muted">
                {latest.label} <span className="font-mono text-paper">{money(latest.price)}</span>
                {latest.change !== "—" ? ` · ${latest.change}` : ""}
              </p>
            ) : null}
          </div>
          <div className="rounded border border-white/10 bg-[#0a141a] p-2 sm:p-3">
            <CandleChart candles={chartCandles(lines)} label={`${c.ticker} price by step`} secondName="AI price" testId="price-chart" live average={3} />
          </div>
        </div>
      </MarketCard>

      {scores.length ? (
        <MarketCard title="Verdicts">
          <ul className="space-y-3" aria-label="Verdicts">
            {scores.map((s) => {
              const v = verdict(s);
              return (
                <li key={s.type} className="text-sm" data-testid={`verdict-${s.type}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{v.title}</span>
                    <span className="font-mono text-base font-semibold">{v.score}</span>
                    <Badge tone={TIER_TONE[v.tierSign]}>{v.tier}</Badge>
                  </div>
                  {v.notes.map((n) => (
                    <p key={n} className="mt-1 text-paper">
                      {n}
                    </p>
                  ))}
                  <VerdictDetail v={v} />
                </li>
              );
            })}
          </ul>
        </MarketCard>
      ) : null}

      {types.includes("PITCH") ? <SubmissionPanel type="PITCH" s={submissions.PITCH} /> : null}
      {crisis ? (
        <MarketCard title="Crisis card">
          <CrisisCard card={crisis} />
        </MarketCard>
      ) : null}

      {types.includes("PLAN") ? <SubmissionPanel type="PLAN" s={submissions.PLAN} /> : null}
      {types.includes("FLASH") ? <SubmissionPanel type="FLASH" s={submissions.FLASH} /> : null}
      {waiting.length || !phaseReached(status.phase, "CRISIS") ? (
        <p className="text-sm text-muted">
          {[...(phaseReached(status.phase, "CRISIS") ? [] : [BOOK_PUBLIC_FROM.CRISIS]), ...waiting.map((t) => BOOK_PUBLIC_FROM[t])].join(" ")}
        </p>
      ) : null}

      <MarketCard title="Price history">
        <Table head={["Step", "Time", "Price", "Change", "AI price", "Detail"]} label="Price history" empty="No price yet: prices start at the IPO.">
          {lines.map((l) => (
            <tr key={l.key}>
              <Td className="font-medium">{l.label}</Td>
              <Td mono>{clock(l.at)}</Td>
              <Td mono className="text-right font-semibold">
                {money(l.price)}
              </Td>
              <Td mono className={`text-right ${TONE[l.changeSign]}`}>
                {l.change}
              </Td>
              <Td mono className="text-right">
                {money(l.ai)}
              </Td>
              <Td className="text-paper">{l.detail}</Td>
            </tr>
          ))}
        </Table>
      </MarketCard>
    </div>
  );
}

function SubmissionPanel({ type, s }: { type: SubmissionType; s: PublicSubmission | undefined }) {
  return (
    <MarketCard title={SUBMISSION_TITLES[type]}>
      {s ? <Submission type={type} s={s} /> : <p className="text-sm text-muted">Nothing was submitted on time.</p>}
    </MarketCard>
  );
}
