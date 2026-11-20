// The Consulting firm's crisis room, as numbered steps: its profile in the directory, the offers made to it (accept,
// decline, counter), then each client (the crisis card, the client's plan as it stands, and the advice memo the firm
// writes for it; in Round 3 also the solution it can edit with the client), and its results: engagements and the league.

import Link from "next/link";
import { RULES, adviceOf, planOf, type SubmissionType } from "@msim/engine";
import { featureOn } from "@/lib/event-status";
import { clock, money } from "@/lib/format";
import type { TeamContext } from "@/lib/team/context";
import { draftOf, type CrisisRoomData } from "@/lib/team/crisis-data";
import { FIRM_CLIENTS_PER_SUBROUND, hiringOpen, stepAt, termsText } from "@/lib/team/crisis";
import { backupKey, toSnapshot } from "@/lib/team/editor";
import { assignedToFirm, minBidText, pitchableCompanies, rateShares, rateText } from "@/lib/team/hire-lists";
import { submissionWindow } from "@/lib/team/squad";
import { pauseOf } from "@/lib/team/squad-data";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { ActionForm } from "@/components/ui/action";
import { DoThis, HowItWorks } from "@/components/ui/how-it-works";

import { ContentView } from "../squad/parts";
import { DraftEditor } from "../squad/draft-editor";
import { makeOfferTo, saveFirmProfile } from "./actions";
import { CardsOf, EngagementTable, FirmLeague, OfferCard, StatementBoard, Step, TermsFields, companyLabel, type StepState } from "./parts";
import { Chip, GuideAlert } from "./guide";

const EMPTY = { version: 0, content: {}, updatedAt: null, updatedBy: null };

export function ConsultingRoom({ ctx, data, k, nowMs }: { ctx: TeamContext; data: CrisisRoomData; k: number | null; nowMs: number }) {
  const pause = pauseOf(ctx);
  const me = ctx.team.id;
  const profile = data.profiles.get(me);
  const hiring = hiringOpen(k, ctx.status.phase, data.deadlines, nowMs, pause);
  const company = new Map(data.companies.map((c) => [c.id, c]));
  const offers = k === null ? [] : data.offers.filter((o) => o.firm_team_id === me && o.k === k);
  const clients = k === null ? [] : data.engagements.filter((e) => e.firm_team_id === me && e.k === k);
  // Tonight's hiring rules (migration 071): this firm's base rate is its minimum bid and what a drawn client pays.
  // Round 3 keeps its 5–20%-of-cash band: no minimum bid there (migration 081).
  const minBidOn = featureOn(ctx.status, "hire_min_bid") && k !== 5;
  const drawOn = featureOn(ctx.status, "hire_base_rate");
  const myRate = data.firms.find((f) => f.team_id === me)?.base_rate_bp ?? null;
  // Locked = gone: a company that has hired is not listed to pitch (hire_locked makes this page re-read at once).
  const pitchable = k === null ? [] : pitchableCompanies(data.companies, data.engagements, data.offers, k, me);
  const winInput = {
    ...pause,
    phase: ctx.status.phase,
    drawn: ctx.status.drawn,
    nowMs,
    deadlines: data.deadlines,
    flashPublishedAt: null,
    flashReleased: false,
  };

  const r3 = k === 5;
  const myTurn = offers.filter((o) => o.status === "OPEN" && o.turn === "FIRM").length;
  const profileDone = !!profile?.headline;
  const hireAt = k === null ? "" : clock(stepAt(data.deadlines, "HIRE", k));
  const dueAt = k === null ? "" : clock(stepAt(data.deadlines, "DUE", k));
  const full = clients.length >= FIRM_CLIENTS_PER_SUBROUND;
  const offersState: StepState = k === null ? "later" : myTurn ? "now" : hiring ? (full ? "done" : "read") : clients.length ? "done" : "closed";
  const offersSummary =
    k === null
      ? "Offers arrive when the first crisis card is revealed."
      : myTurn
        ? `${myTurn === 1 ? "1 offer is" : `${myTurn} offers are`} waiting for your answer. Hiring closes at ${hireAt}.`
        : hiring
          ? full
            ? `You have ${FIRM_CLIENTS_PER_SUBROUND} clients: you are full for this ${r3 ? "round" : "crisis"}.`
            : `No offer to answer right now. Companies can send offers until ${hireAt} (${clients.length} of ${FIRM_CLIENTS_PER_SUBROUND} clients so far).`
          : clients.length
            ? `Hiring is closed. You have ${clients.length === 1 ? "1 client" : `${clients.length} clients`}.`
            : `Hiring is closed. No client this ${r3 ? "round" : "crisis"}.`;
  const memoType: SubmissionType | null = k === null ? null : adviceOf(k);
  const memoWin = memoType ? submissionWindow(memoType, "CONSULTING", winInput) : null;
  const memoSent = (companyId: string) => (memoType ? data.clientSubmissions.find((s) => s.company_id === companyId && s.type === memoType && s.superseded_at === null) : undefined);
  const allSent = clients.length > 0 && clients.every((e) => memoSent(e.company_id));
  const clientsState: StepState = k === null || clients.length === 0 ? (hiring || k === null ? "later" : "closed") : allSent ? "done" : memoWin?.stage === "OPEN" ? "now" : "closed";
  const clientsSummary =
    k === null || clients.length === 0
      ? hiring || k === null
        ? "A client appears here when you accept an offer."
        : "No client, so nothing to write. The next crisis brings new offers."
      : allSent
        ? `Memo sent for every client.${memoWin?.stage === "OPEN" ? ` You can send better versions until ${dueAt}.` : ""}`
        : memoWin?.stage === "OPEN"
          ? `Write a memo of up to ${RULES.WORD_LIMIT[memoType!]} words for each client by ${dueAt}. No memo: no fee.`
          : `Writing closed at ${dueAt}.`;

  return (
    <div className="guide-stack">
      <Step
        n={1}
        title="Your firm's profile"
        state={profileDone ? "done" : "now"}
        testId="step-profile"
        summary={profileDone ? `“${profile!.headline}” · asking ${profile!.asking_cents > 0 ? money(profile!.asking_cents) : "—"}. Tap to edit.` : "Companies read it to choose a firm. Fill it in first."}
      >
        <DoThis testId="profile-todo">Say what your firm is good at and what it asks for, then press Save profile.</DoThis>
        {myRate !== null && (minBidOn || (drawOn && !r3)) ? (
          <p className="mt-2 text-sm text-paper" data-testid="my-base-rate">
            Your base rate: <strong className="text-[#39ff88]">{rateText(myRate)}</strong> of a company ({rateShares(myRate).toLocaleString("en-US")}{" "}
            shares), set by your Round 1 memo score.
            {minBidOn ? " It is your minimum bid: no offer for less can be made or accepted." : ""}
            {drawOn && !r3 ? " A company the draw gives you pays it." : ""}
          </p>
        ) : null}
        <p className="mb-3 mt-1 text-sm text-paper">
          Every Product team sees this in the firm directory.{" "}
          <Link href={`/team/firms/${encodeURIComponent(ctx.team.code)}`} className="text-[#39ff88] hover:underline">
            See your public profile →
          </Link>
        </p>
        <ActionForm action={saveFirmProfile} submit="Save profile">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="font-semibold text-paper">Headline</span>
              <input name="headline" maxLength={140} defaultValue={profile?.headline ?? ""} placeholder="Turnarounds for hardware start-ups" className={`guide-input mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-paper">Specialities (comma-separated, up to 8)</span>
              <input name="specialities" defaultValue={profile?.specialities.join(", ") ?? ""} placeholder="supply chain, pricing, PR" className={`guide-input mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-paper">Asking fee ($)</span>
              <input name="asking" inputMode="decimal" defaultValue={profile ? (profile.asking_cents / 100).toFixed(2) : ""} className={`guide-input mt-1 font-mono`} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-semibold text-paper">Rate card</span>
              <textarea name="rate_card" maxLength={600} rows={3} defaultValue={profile?.rate_card ?? ""} className={`guide-input mt-1`} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-semibold text-paper">About the firm (who you are, how you work, past wins)</span>
              <textarea name="about" maxLength={1000} rows={4} defaultValue={profile?.about ?? ""} className={`guide-input mt-1`} />
            </label>
          </div>
        </ActionForm>
      </Step>

      <Step n={2} title="Answer offers from companies" state={offersState} summary={offersSummary} testId="step-offers" open={offers.length > 0 && (hiring || myTurn > 0)}>
        {offers.length === 0 ? (
          <p className="guide-muted">No offer yet. A complete profile helps.</p>
        ) : (
          <ul className="space-y-2">
            {offers.map((o) => (
              <OfferCard key={o.id} offer={o} side="FIRM" hiring={hiring} counterpart={companyLabel(company.get(o.company_id))} priceCents={company.get(o.company_id)?.market_price ?? null} />
            ))}
          </ul>
        )}
        {hiring && clients.length < FIRM_CLIENTS_PER_SUBROUND ? (
          <details className="border border-[#294832] p-3.5 mt-3" data-testid="pitch-a-company">
            <summary className="guide-btn secondary cursor-pointer list-none">Pitch a company yourself</summary>
            <p className="mt-2 text-sm text-paper">
              You do not have to wait to be asked. Write to a company to talk terms, or send it an offer and it answers first.
            </p>
            {pitchable.length === 0 ? <p className="mt-2 text-sm text-muted">Every company has a firm or an offer from you.</p> : null}
            <ul className="mt-2 max-h-72 space-y-3 overflow-y-auto">
              {pitchable.map((co) => (
                <li key={co.id} className="border-b border-line pb-3 last:border-b-0">
                  <div className="flex items-baseline gap-2">
                    <span className="pd-code">{companyLabel(co)}</span>
                    <Link href={`/team/messages?c=${co.id}&f=${me}`} className="ml-auto text-sm text-[#39ff88] hover:underline">
                      Talk to them →
                    </Link>
                  </div>
                  {minBidOn && myRate !== null ? (
                    <p className="mt-1 text-xs text-[#39ff88]" data-testid={`pitch-min-bid-${co.ticker ?? co.id}`}>
                      Your minimum bid: {minBidText(myRate, co.market_price)}.
                    </p>
                  ) : null}
                  <ActionForm action={makeOfferTo.bind(null, co.id, companyLabel(co))} submit="Send pitch" resetOnSuccess className="mt-2">
                    <TermsFields
                      cash={0}
                      shares={minBidOn && myRate !== null ? rateShares(myRate) : 0}
                      priceCents={co.market_price}
                      hint="Ask for a stake in the company (equity %): its value is shares × the company's share price."
                    />
                    <label className="mt-2 block text-sm">
                      <span className="font-semibold text-paper">Note (optional)</span>
                      <input name="note" maxLength={300} placeholder="Why you are the right firm" className={`guide-input mt-1`} />
                    </label>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <HowItWorks testId="offers-rules">
          <p>A company offers you cash, shares or both, and you can offer first. Accept, decline, or send a counter-offer; each side can counter three times.</p>
          <p>
            You take at most {FIRM_CLIENTS_PER_SUBROUND} clients per {r3 ? "round" : "crisis"}. Accepting is final.
          </p>
          <p>The cash is kept safe (in escrow) and paid to you at the due time, but only if your memo for that client is submitted.</p>
          {minBidOn ? <p>Your minimum bid is your base rate: neither side can propose or accept less.</p> : null}
          {drawOn ? <p>When hiring closes, each company with no firm is drawn at random to a firm with room, and pays {r3 ? "10% of its cash" : <>that firm&apos;s base rate</>}.</p> : null}
        </HowItWorks>
      </Step>

      <Step n={3} title={clients.length > 1 ? "Write a memo for each client" : "Write your advice memo"} state={clientsState} summary={clientsSummary} testId="step-clients" open={clients.length > 0}>
        {k !== null && clients.length > 0 ? (
          <div className="space-y-6">
            <AutoRefresh everyMs={10_000} active />
            <RefreshAt at={stepAt(data.deadlines, "DUE", k)} />
            {clients.map((e) => {
              const c = company.get(e.company_id);
              const label = companyLabel(c);
              const plan = planOf(k);
              const memo = adviceOf(k);
              const win = submissionWindow(memo, "CONSULTING", winInput);
              const draftRow = draftOf(data.clientDrafts, e.company_id, memo);
              const planDraft = draftOf(data.clientDrafts, e.company_id, plan);
              const planSub = data.clientSubmissions.find((s) => s.company_id === e.company_id && s.type === plan && s.superseded_at === null);
              const cur = memoSent(e.company_id);
              const squadOf = { product_team_id: c?.product_team_id ?? "", consulting_team_id: me, finance_team_id: "" };
              return (
                <section key={e.id} id={`client-${e.company_id}`} className="border border-[#294832] p-3.5 scroll-mt-32" aria-label={`Client ${label}`} data-testid="client">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="pd-code text-base">Client {label}</h3>
                    <span className="font-mono text-sm text-paper">fee {termsText(money(e.cash_cents), e.shares)}</span>
                    {cur ? <Chip tone="green">Memo sent {clock(cur.submitted_at)}</Chip> : <Chip tone="amber">Memo not sent</Chip>}
                    <Link href={`/team/messages?c=${e.company_id}&f=${me}`} className="ml-auto text-sm font-semibold text-[#39ff88] hover:underline">
                      Chat with this client →
                    </Link>
                  </div>
                  {e.assigned ? (
                    <p className="mt-1 text-sm text-[var(--term-cyan)]" data-testid="client-assigned">
                      {assignedToFirm(e, c?.ticker ?? label, myRate, drawOn && !r3)} Write its memo like any client&apos;s: the fee is paid only if it is in by {dueAt}.
                    </p>
                  ) : null}
                  {r3 ? null : (
                    <div className="mt-3">
                      <CardsOf data={data} k={k} only={[e.company_id]} />
                    </div>
                  )}
                  {r3 ? null : (
                    <details className="border border-[#294832] p-3.5 mt-3" open={!!(planSub ?? planDraft)}>
                      <summary className="guide-btn secondary cursor-pointer list-none">
                        The client&apos;s response plan {planSub ? <Chip tone="green">Submitted {clock(planSub.submitted_at)}</Chip> : planDraft ? <Chip tone="amber">Draft v{planDraft.version}</Chip> : <Chip tone="slate">Not started</Chip>}
                      </summary>
                      <div className="mt-2">
                        {planSub ?? planDraft ? <ContentView type={plan} content={(planSub ?? planDraft)!.content} /> : <p className="guide-muted">Nothing written yet.</p>}
                      </div>
                    </details>
                  )}
                  <h4 className="guide-label uppercase mb-2 mt-5">Your advice memo · up to {RULES.WORD_LIMIT[memo]} words</h4>
                  <DraftEditor
                    type={memo}
                    draft={toSnapshot(draftRow) ?? EMPTY}
                    editable={win.editable}
                    closedNote={win.note}
                    deadline={win.deadline}
                    paused={ctx.status.paused}
                    pausedAt={ctx.status.paused_at}
                    squad={squadOf}
                    me={me}
                    storageKey={backupKey(e.company_id, me, memo)}
                    submitted={cur ? { content: cur.content, submittedAt: cur.submitted_at } : null}
                    companyId={e.company_id}
                  />
                  {cur ? (
                    <p className="mt-2 text-xs text-muted">
                      Submitted at {clock(cur.submitted_at, true)} ({cur.word_count} words). You can submit again until the due time.
                    </p>
                  ) : null}
                  {r3 ? (
                    <details className="border border-[#294832] p-3.5 mt-4" data-testid="solution-coedit">
                      <summary className="guide-btn secondary cursor-pointer list-none">
                        The solution, written with your client · up to {RULES.WORD_LIMIT.SOLUTION} words
                      </summary>
                      <p className="my-2 text-sm text-paper">You can edit it with your client: each save shows for both. Your client submits it.</p>
                      <DraftEditor
                        type="SOLUTION"
                        draft={toSnapshot(draftOf(data.clientDrafts, e.company_id, "SOLUTION")) ?? EMPTY}
                        editable={submissionWindow("SOLUTION", "CONSULTING", winInput).editable}
                        closedNote={submissionWindow("SOLUTION", "CONSULTING", winInput).note}
                        deadline={submissionWindow("SOLUTION", "CONSULTING", winInput).deadline}
                        paused={ctx.status.paused}
                        pausedAt={ctx.status.paused_at}
                        squad={squadOf}
                        me={me}
                        storageKey={backupKey(e.company_id, me, "SOLUTION")}
                        submitted={(() => {
                          const sol = data.clientSubmissions.find((s) => s.company_id === e.company_id && s.type === "SOLUTION" && s.superseded_at === null);
                          return sol ? { content: sol.content, submittedAt: sol.submitted_at } : null;
                        })()}
                        companyId={e.company_id}
                      />
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <GuideAlert>No client this {r3 ? "round" : "crisis"} yet. Clients appear here once you accept an offer (or a company accepts your counter).</GuideAlert>
        )}
        <HowItWorks label="How you earn" testId="memo-rules">
          <p>Your fee is paid at the due time if your memo for that client is submitted; otherwise the client gets it back.</p>
          <p>After the due time the client rates you 1 to 5 stars, and the judge scores your memo. A good memo and a good rating add a bonus; poor ones take money away.</p>
        </HowItWorks>
      </Step>

      {r3 ? <StatementBoard data={data} /> : null}

      <details className="guide-panel guide-fold" data-testid="firm-results">
        <summary>Your results: clients, ratings and the firm league</summary>
        <div className="space-y-4 p-4 sm:p-5">
          <EngagementTable data={data} rows={data.engagements.filter((e) => e.firm_team_id === me)} title="Your engagements" />
          <FirmLeague data={data} me={me} />
        </div>
      </details>
    </div>
  );
}
