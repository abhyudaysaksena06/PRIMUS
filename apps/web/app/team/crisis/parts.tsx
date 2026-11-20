// Pieces shared by the three tracks' crisis rooms: a numbered step (what to do, in order), the sub-round's timeline,
// the crisis cards, the firm league table, the engagements (who hired whom) and an offer with the moves open to
// this side.

import type { ReactNode } from "react";

import type { DeadlineCode } from "@msim/engine";

import { clock, money } from "@/lib/format";
import type { CrisisRoomData, RoomCompany } from "@/lib/team/crisis-data";
import {
  OFFER_STATUS_TONE,
  countersLeft,
  crisisSealed,
  draftHeads,
  draftState,
  sameSector,
  offerMoves,
  shareText,
  statementGroups,
  type StatementGroup,
  subroundTitle,
  termsText,
  type EngagementRow,
  type OfferRow,
  type OfferSide,
  type TimelineStep,
} from "@/lib/team/crisis";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Table, Td } from "@/components/ui/ui";
import { Chip, GuidePanel } from "./guide";
import { EquityFields } from "./equity-fields";
import { Countdown } from "@/components/ui/countdown";
import { CrisisCard } from "../market/crisis-card";
import { CrisisFocusCard } from "../crisis-focus-card";
import { answerOffer, counterOffer } from "./actions";

export const companyLabel = (c: RoomCompany | undefined) => (c ? `${c.ticker ?? "—"}${c.name ? ` · ${c.name}` : ""}` : "—");

/** now: this team should do it; done; later: not open yet; closed: its time has passed; read: nothing to press. */
export type StepState = "now" | "done" | "later" | "closed" | "read";

const STEP_CHIP: Record<StepState, { text: string; cls: string } | null> = {
  now: { text: "Do this now", cls: "active" },
  done: { text: "Done", cls: "good" },
  later: { text: "Later", cls: "" },
  closed: { text: "Closed", cls: "" },
  read: null,
};

/**
 * One numbered step of the crisis room: its number (a tick once done), a title, one plain line about where it
 * stands, and its content.
 */
export function Step({
  n,
  title,
  state,
  summary,
  open,
  id,
  testId,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  summary?: ReactNode;
  /** Open by default? (Otherwise: the steps to do now and the ones to read.) */
  open?: boolean;
  id?: string;
  testId?: string;
  children: ReactNode;
}) {
  const chip = STEP_CHIP[state];
  // Drawn as the demo's numbered panels ("1. Offer shares…", "4. Consulting teams…"): the step's state is the panel's
  // tag, its line about where it stands opens the body. Every step is open, as every demo panel is.
  void open;
  return (
    <section id={id} className="guide-panel min-w-0 scroll-mt-32" aria-label={`Step ${n}: ${title}`} data-testid={testId} data-state={state}>
      <div className="guide-panel-head">
        <h2>
          <span aria-hidden>{state === "done" ? "✓ " : `${n}. `}</span>
          {title}
        </h2>
        {chip ? <span className="uppercase">{chip.text}</span> : null}
      </div>
      <div className="guide-panel-body">
        {summary ? <p className="guide-muted mb-3">{summary}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function Timeline({ k, steps }: { k: number; steps: TimelineStep[] }) {
  const next = steps.find((s) => !s.passed && s.at);
  // The demo's metric row under the page head: one tile per step of the sub-round, the next one lit.
  return (
    <ol className="guide-grid guide-timeline" data-testid="subround-timeline" aria-label={subroundTitle(k)}>
      {steps.map((s) => (
        <li key={s.code} className={`guide-metric ${s.passed ? "opacity-55" : ""} ${s === next ? "is-next" : ""}`}>
          <small>{s.label.toUpperCase()}</small>
          <b>{s.at ? clock(s.at) : "—"}</b>
          <span>
            {s.passed ? (
              "PASSED"
            ) : s === next && s.at ? (
              <>
                NEXT · <Countdown to={s.at} /> LEFT
              </>
            ) : (
              "LATER"
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function CardsOf({ data, k, only }: { data: CrisisRoomData; k: number; only?: readonly string[] }) {
  const rows = data.cards.filter((c) => c.k === k && (!only || only.includes(c.company_id)));
  if (rows.length === 0 && crisisSealed(data.subrounds, k)) {
    // The cards are dealt, but nobody may read one until hiring closes, so the hire is made blind.
    const at = data.deadlines[`HIRE_${k}` as DeadlineCode];
    return (
      <p className="text-sm text-muted" data-testid={`crisis-sealed-${k}`}>
        The crisis is sealed until hiring closes{at ? ` at ${clock(at)}` : ""}. Hire on the firm&rsquo;s record, not on
        what you are facing.
      </p>
    );
  }
  if (rows.length === 0) return <p className="text-sm text-muted">No crisis card has been dealt for this sub-round yet.</p>;
  const byId = new Map(data.companies.map((c) => [c.id, c]));
  const single = !!only && only.length === 1;
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Crisis cards">
      {rows.map((r) => (
        <li key={r.company_id} className={single ? "sm:col-span-2" : undefined}>
          {single ? null : <p className="guide-chip active mb-2">{companyLabel(byId.get(r.company_id))}</p>}
          {/* The one card a team must answer is shown in focus; a list of every company's card stays compact. */}
          {single ? <CrisisFocusCard card={r.card} /> : <CrisisCard card={r.card} />}
        </li>
      ))}
    </ul>
  );
}

/** The companies on one statement as chips (this team's own marked), and how its price moves are shared. */
export function StatementCrowd({ group }: { group: StatementGroup }) {
  return (
    <div className="mt-2" data-testid={`crowd-${group.number}`}>
      {group.companies.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Companies on statement ${group.number}`}>
          {group.companies.map((c) => (
            <li
              key={c.id}
              className={`guide-chip ${c.mine ? "active" : ""}`}
            >
              {c.label}
              {c.mine ? " (you)" : ""} <span className={c.mine ? "" : "text-muted"}>· {c.scoreAvg.toFixed(0)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-xs text-muted">{shareText(group.companies.length)}</p>
    </div>
  );
}

/**
 * Whose pick it is in the draft, with its 20 seconds counting down; nothing once the draft is over. A draft run by
 * sector has one company on the clock per sector (`mySector` first).
 */
export function OnTheClock({ data }: { data: CrisisRoomData }) {
  const d = draftState(data.picks, null);
  if (d.done || (!d.current && !d.bySector)) return data.picks.length ? <p className="text-sm font-semibold text-phosphor" data-testid="on-the-clock">The draft is over: every company has its statement.</p> : null;
  if (d.bySector) {
    const name = (q: string) => data.statements.find((s) => sameSector(s.sector, q))?.sector ?? (q || "No sector");
    const heads = draftHeads(data.picks).sort((a, b) => Number(sameSector(b.queue, data.mySector)) - Number(sameSector(a.queue, data.mySector)));
    return (
      <ul className="space-y-1 text-sm font-semibold text-paper" data-testid="on-the-clock" aria-label="On the clock in each sector">
        {heads.map((h) => (
          <li key={h.queue}>
            <span className="guide-chip active mr-2">{name(h.queue)}</span>
            <span className="font-mono text-[#39ff88]">{companyLabel(data.companies.find((x) => x.id === h.pick.company_id))}</span> · pick {h.place} of {h.size} ·{" "}
            <Countdown to={h.pick.closes_at} passed="time is up" className="font-mono text-[#39ff88]" /> · {h.left} still to pick
          </li>
        ))}
      </ul>
    );
  }
  if (!d.current) return null;
  const c = data.companies.find((x) => x.id === d.current!.company_id);
  const left = data.picks.filter((p) => p.statement_id === null).length;
  return (
    <p className="text-sm font-semibold text-paper" data-testid="on-the-clock">
      <span className="guide-chip active mr-2">On the clock</span>
      <span className="font-mono text-[#39ff88]">{companyLabel(c)}</span> · pick {d.current.pick_no} of {data.picks.length} ·{" "}
      <Countdown to={d.current.closes_at} passed="time is up" className="font-mono text-[#39ff88]" /> · {left} still to pick
    </p>
  );
}

/** Round 3 for those who watch: every statement with the companies competing on it (score so far beside each). */
export function StatementBoard({ data, title = "Round 3 · who competes with whom" }: { data: CrisisRoomData; title?: string }) {
  if (data.statements.length === 0) return null;
  const label = new Map(data.companies.map((c) => [c.id, c.ticker ?? "—"]));
  const groups = statementGroups(data.statements, data.picks, (id) => label.get(id) ?? "—");
  const sectorOf = new Map(data.statements.map((s) => [s.id, s.sector]));
  return (
    <GuidePanel title={title} tag={`${data.statements.length} STATEMENTS`}>
      <OnTheClock data={data} />
      {draftState(data.picks, null).bySector && !draftState(data.picks, null).done ? (
        // Picks are not broadcast to every screen while the sectors draft: this board catches up when the draft ends.
        <p className="mt-1 text-xs text-muted">The sectors pick at the same time. This board updates when the draft ends; reload the page to see the latest picks.</p>
      ) : null}
      <p className="guide-muted mb-3 mt-1">
        Each company is judged on its own solution; sharing a statement does not change anyone&apos;s price move. A rise is scaled by the score so far across
        the event: ×1.25 for the weakest company down to ×0.25 for the strongest; a fall applies in full. The number beside each company is its score so far.
      </p>
      <ul className="grid gap-3 md:grid-cols-2" aria-label="Statements and their companies">
        {groups.map((g) => (
          <li key={g.id} className="border border-[#294832] p-3.5" data-testid={`board-${g.number}`}>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[#39ff88]">#{g.number}</span>
              <span className="guide-label !mb-1.5 !mt-0 uppercase">{g.title}</span>
              {sectorOf.get(g.id) ? <Chip tone="blue">{sectorOf.get(g.id)}</Chip> : null}
              <Chip tone={g.companies.length >= g.cap ? "red" : "slate"}>
                {g.companies.length}/{g.cap}
              </Chip>
            </p>
            <StatementCrowd group={g} />
          </li>
        ))}
      </ul>
    </GuidePanel>
  );
}

export function FirmLeague({ data, me }: { data: CrisisRoomData; me?: string }) {
  return (
    <GuidePanel title="Firm values" tag={`${data.firms.length} FIRMS`}>
      <Table
        head={["Firm", "Cash", "Fee shares", "Value", "Clients", "Avg rating"]}
        empty={data.firms.length === 0 ? "No Consulting firm in this event." : undefined}
      >
        {data.firms.map((f, i) => (
          <tr key={f.team_id} className={f.team_id === me ? "bg-raised" : ""} data-testid={`firm-value-${f.code}`}>
            <Td>
              <span className="mr-2 text-muted">{i + 1}.</span>
              <span className="font-mono font-semibold text-[#39ff88]">{f.code}</span> {f.name}
              {f.team_id === me ? <span className="ml-2"><Chip tone="active">You</Chip></span> : null}
            </Td>
            <Td mono>{money(f.cash_cents)}</Td>
            <Td mono>{money(f.fee_share_value_cents)}</Td>
            <Td mono className="font-semibold text-[var(--term-green)]">
              {money(f.value_cents)}
            </Td>
            <Td mono>{f.clients}</Td>
            <Td mono>{f.avg_rating === null ? "—" : f.avg_rating.toFixed(2)}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-muted">Value = cash + fee shares at the market price. The final ranking ties on the average client rating.</p>
    </GuidePanel>
  );
}

const ESCROW_TONE = { HELD: "amber", RELEASED: "green", REFUNDED: "slate" } as const;

export function EngagementTable({ data, rows, title = "Who hired whom" }: { data: CrisisRoomData; rows: EngagementRow[]; title?: string }) {
  const company = new Map(data.companies.map((c) => [c.id, c]));
  const firm = new Map(data.firms.map((f) => [f.team_id, f]));
  return (
    <GuidePanel title={title} tag={`${rows.length} HIRES`}>
      <Table head={["Sub-round", "Company", "Firm", "Fee", "Escrow", "Rating", "Bonus"]} empty={rows.length === 0 ? "No firm hired yet." : undefined}>
        {rows.map((e) => (
          <tr key={e.id}>
            <Td>{subroundTitle(e.k).replace(/^Round 2 · /, "")}</Td>
            <Td mono>{companyLabel(company.get(e.company_id))}</Td>
            <Td mono>{firm.get(e.firm_team_id)?.code ?? "—"}</Td>
            <Td mono>{termsText(money(e.cash_cents), e.shares)}</Td>
            <Td>
              <Chip tone={ESCROW_TONE[e.escrow]}>{e.escrow}</Chip>
            </Td>
            <Td mono>{e.rating === null ? "—" : `${e.rating}/5${e.rating_default ? " (default)" : ""}`}</Td>
            <Td mono>{e.bonus_cents === null ? "—" : money(e.bonus_cents)}</Td>
          </tr>
        ))}
      </Table>
    </GuidePanel>
  );
}

/** One offer, with the moves this side may make now (accept, decline, counter, withdraw). */
export function OfferCard({ offer, side, hiring, counterpart, priceCents = null }: { offer: OfferRow; side: OfferSide; hiring: boolean; counterpart: string; priceCents?: number | null }) {
  const moves = offerMoves(offer, side, hiring);
  const waiting = offer.status === "OPEN" && offer.turn !== side;
  return (
    <li className="border border-[#294832] p-3.5" data-testid="offer">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold text-[#39ff88]">{counterpart}</span>
        <span className="font-mono text-paper">{termsText(money(offer.cash_cents), offer.shares)}</span>
        {offer.shares > 0 && priceCents ? (
          <span className="font-mono text-xs text-[var(--term-cyan)]">worth {money(offer.cash_cents + offer.shares * priceCents)} now</span>
        ) : null}
        <Chip tone={OFFER_STATUS_TONE[offer.status]}>{offer.status}</Chip>
        {offer.status === "OPEN" ? (
          <span className="guide-status">{waiting ? "Waiting for the other side" : "Your turn to answer"}</span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-muted">{clock(offer.updated_at)}</span>
      </div>
      {offer.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-paper">“{offer.note}”</p> : null}
      {moves.length ? (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {moves.includes("ACCEPT") ? (
            <ActionButton variant="primary" confirm="Click again to accept these terms" action={answerOffer.bind(null, offer.id, "ACCEPT")}>
              Accept
            </ActionButton>
          ) : null}
          {moves.includes("DECLINE") ? <ActionButton action={answerOffer.bind(null, offer.id, "DECLINE")}>Decline</ActionButton> : null}
          {moves.includes("WITHDRAW") ? <ActionButton action={answerOffer.bind(null, offer.id, "WITHDRAW")}>Withdraw</ActionButton> : null}
        </div>
      ) : null}
      {moves.includes("COUNTER") ? (
        <details className="mt-2">
          <summary className="guide-btn secondary cursor-pointer list-none">Counter ({countersLeft(offer, side)} left)</summary>
          <ActionForm action={counterOffer.bind(null, offer.id)} submit="Send counter" className="mt-2">
            <TermsFields cash={offer.cash_cents} shares={offer.shares} priceCents={priceCents} />
          </ActionForm>
        </details>
      ) : null}
    </li>
  );
}

/**
 * The terms of an offer or a counter: equity first (a % of the company, with its shares and value at the current
 * price shown as it is typed), cash optional. The organisers' rule is that a company pays its firm in equity.
 */
export function TermsFields({ cash = 0, shares = 0, hint, priceCents = null }: { cash?: number; shares?: number; hint?: string; priceCents?: number | null }) {
  return <EquityFields shares={shares} cash={cash} priceCents={priceCents} hint={hint} />;
}
