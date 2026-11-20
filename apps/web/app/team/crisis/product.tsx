// The Product team's crisis room, as numbered steps in the order they are done: read the crisis card (Round 3: pick a
// problem statement in the draft), hire a firm (the directory, offers and counters), write the response plan (or the
// Round 3 solution), rate the firm. A step with something to do is open and marked "Do this now"; the rest fold away.

import Link from "next/link";
import { RULES, planOf, type SubmissionType } from "@msim/engine";
import { featureOn } from "@/lib/event-status";
import { clock, money } from "@/lib/format";
import type { TeamContext } from "@/lib/team/context";
import type { CrisisRoomData } from "@/lib/team/crisis-data";
import {
  DRAFT_PICKERS,
  DRAFT_RULE,
  FIRM_CLIENTS_PER_SUBROUND,
  draftState,
  feeBand,
  ordinal,
  hiringOpen,
  pastSubrounds,
  ratingOpen,
  statementCounts,
  draftableStatements,
  statementGroups,
  stepAt,
  withDraftEnd,
  subroundTitle,
  termsText,
} from "@/lib/team/crisis";
import { assignedToCompany, minBidText, openFirms, rateShares, rateText } from "@/lib/team/hire-lists";
import { currentSubmission, submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { ActionButton, ActionForm } from "@/components/ui/action";
import { Countdown } from "@/components/ui/countdown";
import { DoThis, HowItWorks } from "@/components/ui/how-it-works";

import { SubmissionEditor } from "../squad/submission";
import { makeOffer, pickStatement, rateFirm } from "./actions";
import { DraftWatch } from "./draft-watch";
import { ProductRaisePanel } from "./raises";
import { CardsOf, EngagementTable, OfferCard, OnTheClock, StatementCrowd, Step, TermsFields, companyLabel, type StepState } from "./parts";
import { Chip, GuideAlert } from "./guide";

export async function ProductRoom({ ctx, data, k, nowMs }: { ctx: TeamContext; data: CrisisRoomData; k: number | null; nowMs: number }) {
  const pause = pauseOf(ctx);
  const mine = data.companies.find((c) => c.product_team_id === ctx.team.id) ?? null;
  const hiring = hiringOpen(k, ctx.status.phase, data.deadlines, nowMs, pause);
  const engaged = k !== null && mine ? data.engagements.find((e) => e.company_id === mine.id && e.k === k) : undefined;
  const firmById = new Map(data.firms.map((f) => [f.team_id, f]));
  const myOffers = mine && k !== null ? data.offers.filter((o) => o.company_id === mine.id && o.k === k) : [];
  const ws = ctx.squad ? await loadSquadWorkspace(ctx) : null;
  if (ws) ws.deadlines = withDraftEnd(ws.deadlines, data.picks, nowMs);
  const planType: SubmissionType | null = k === null ? null : planOf(k);
  const win = ws && planType ? submissionWindow(planType, "PRODUCT", windowInput(ctx, ws)) : null;
  const sent = ws && planType ? currentSubmission(ws.submissions, planType) : null;
  const rateable = mine ? data.engagements.filter((e) => e.company_id === mine.id && ratingOpen(e.k, data.deadlines, nowMs, pause)) : [];
  const draft = draftState(data.picks, mine?.id ?? null);
  // A missed pick: a random statement no picker has taken yet (by sector, migration 088; switch draft_random_fallback),
  // else the least crowded (by sector: also one nobody has picked).
  const randomDefault = featureOn(ctx.status, "draft_random_fallback");
  const missed = draft.bySector
    ? randomDefault
      ? "a random statement nobody has picked yet"
      : "the lowest-numbered statement nobody has picked yet"
    : randomDefault
      ? "a random statement of your sector that still has room"
      : "the statement with the fewest companies";
  const counts = statementCounts(data.picks);
  const myStatement = draft.mine?.statement_id ? data.statements.find((s) => s.id === draft.mine!.statement_id) : undefined;
  const band = k === 5 ? feeBand(ctx.team.cash) : null;
  // Round 3: start the offer at the smallest stake (in steps of 0.01%) worth at least the band's minimum.
  const r3StartShares =
    band && mine?.market_price ? Math.min(Math.ceil(band.min / mine.market_price / 10) * 10, Math.floor(band.max / mine.market_price)) : 0;
  // Tonight's hiring rules (migration 071): a firm's minimum bid, and the draw for a company with no firm.
  // Round 3 keeps its 5–20%-of-cash band: no minimum bid there (migration 081).
  const minBidOn = featureOn(ctx.status, "hire_min_bid") && k !== 5;
  const drawOn = featureOn(ctx.status, "hire_base_rate");
  // Locked = gone: a full firm is not listed (the hire_locked message makes this page re-read as soon as one fills).
  const listed = openFirms(data.firms, data.engagements, k);
  if (k === null || !mine) return null;
  const tickerOf = new Map(data.companies.map((c) => [c.id, c.ticker ?? "—"]));
  const groups = new Map(statementGroups(data.statements, data.picks, (id) => tickerOf.get(id) ?? "—", mine.id).map((g) => [g.id, g]));

  const r3 = k === 5;
  const hireAt = clock(stepAt(data.deadlines, "HIRE", k));
  const dueAt = clock(stepAt(data.deadlines, "DUE", k));
  const rateAt = clock(stepAt(data.deadlines, "RATE", k));
  const firmCode = engaged ? (firmById.get(engaged.firm_team_id)?.code ?? "a firm") : null;
  // A company that had not hired when hiring closed was given a firm: say so, and by what rule.
  const assignedNote =
    engaged && firmCode ? assignedToCompany(engaged, firmCode, money(engaged.cash_cents), firmById.get(engaged.firm_team_id)?.base_rate_bp ?? null, drawOn && !r3) : null;
  const myTurn = myOffers.filter((o) => o.status === "OPEN" && o.turn === "COMPANY").length;
  const waiting = myOffers.filter((o) => o.status === "OPEN" && o.turn === "FIRM").length;

  // Step 2: hiring.
  const hireState: StepState = engaged ? "done" : hiring ? "now" : r3 && !draft.done ? "later" : "closed";
  const hireSummary = engaged
    ? (assignedNote ?? `You hired ${firmCode} for ${termsText(money(engaged.cash_cents), engaged.shares)}.`)
    : hiring
      ? myTurn
        ? "A firm answered your offer: it is your turn."
        : waiting
          ? `Offer sent. Waiting for the firm to answer (hiring closes at ${hireAt}).`
          : `Offer a firm a stake in your company (equity %). Hiring closes at ${hireAt}.`
      : r3 && !draft.done
        ? "Opens when the draft ends."
        : `Hiring is closed. You have no firm for this ${r3 ? "round" : "crisis"}: write on your own.`;

  // Step 3: the plan (Round 3: the solution).
  const planState: StepState = !win || win.stage === "BEFORE" ? "later" : sent ? "done" : win.stage === "OPEN" ? "now" : "closed";
  const planSummary =
    !win || win.stage === "BEFORE"
      ? r3
        ? "Opens when the draft ends."
        : "Opens with the crisis card."
      : sent
        ? `Submitted at ${clock(sent.submitted_at)}.${win.stage === "OPEN" ? ` You can send a better version until ${dueAt}.` : ""}`
        : win.stage === "OPEN"
          ? `Up to ${RULES.WORD_LIMIT[planType!]} words, due ${dueAt}.${r3 ? "" : " No plan scores 0."}`
          : `Closed at ${dueAt}: nothing was submitted.`;

  // Step 4: the rating (of this crisis's firm).
  const rateNow = rateable.find((e) => e.k === k);
  const rateState: StepState = !engaged ? "closed" : rateNow ? (rateNow.rating === null ? "now" : "done") : engaged.rating !== null ? "done" : "later";
  const rateSummary = !engaged
    ? "You hired no firm, so there is nothing to rate."
    : rateNow
      ? rateNow.rating === null
        ? `Give ${firmCode} 1 to 5 stars by ${rateAt}. No rating counts as 3.`
        : `You gave ${firmCode} ${rateNow.rating} of 5. You can change it until ${rateAt}.`
      : engaged.rating !== null
        ? `${firmCode} got ${engaged.rating} of 5${engaged.rating_default ? " (no rating in time)" : ""}.`
        : `Opens at ${dueAt}, when writing closes.`;

  return (
    <div className="guide-stack">
      {r3 ? (
        <DraftWatch eventId={ctx.event.id} companyId={mine.id} active={draft.bySector && !draft.done && data.picks.length > 0} />
      ) : null}
      {!r3 ? <ProductRaisePanel data={data} mine={mine} open={ctx.status.phase === "PRESSURE"} /> : null}
      <div className="guide-grid two items-start">
      {r3 ? (
        <Step
          n={1}
          title="Pick your problem statement"
          testId="step-draft"
          state={myStatement ? "done" : draft.myTurn ? "now" : draft.mine ? "later" : "later"}
          open
          summary={
            myStatement
              ? `You work on statement ${myStatement.number}: ${myStatement.title}.`
              : draft.myTurn
                ? "It is your pick: choose now."
                : draft.auto
                  ? `You do not pick: you are given a statement at random when your sector's ${DRAFT_PICKERS} pickers are done.`
                  : draft.mine
                    ? `${draft.ahead === 1 ? "1 company picks" : `${draft.ahead} companies pick`} before you. Read the statements while you wait.`
                    : "The draft order appears when Round 3 starts."
          }
        >
          {myStatement ? (
            <GuideAlert>
              Your company works on statement {myStatement.number}: <strong>{myStatement.title}</strong>
              {draft.mine?.auto
                ? " (given at random: only the 10 lowest-scoring companies in each sector pick)"
                : draft.mine?.by_default
                  ? " (given by default: no pick in time)"
                  : ""}
              .
            </GuideAlert>
          ) : draft.myTurn ? (
            <GuideAlert tone="warn">
              It is your pick: choose a statement before <Countdown to={draft.current!.closes_at} className="font-semibold" /> runs out, or you get{" "}
              {missed}.
            </GuideAlert>
          ) : draft.auto ? (
            <GuideAlert>
              Only the {DRAFT_PICKERS} lowest-scoring companies in each sector pick, and your company is not one of them. When your sector&apos;s pickers
              are done ({draft.ahead} still to pick), your company is given a statement at random: always one of the statements with the fewest
              companies so far, so the sector is spread evenly across its statements.
            </GuideAlert>
          ) : draft.mine ? (
            <GuideAlert>
              {draft.bySector
                ? `You pick ${draft.place === 1 ? "first" : ordinal(draft.place ?? 1)} of the ${draft.queueSize} pickers in your sector (lowest score so far picks first; each statement once). `
                : `You pick ${draft.mine.pick_no === 1 ? "first" : `at number ${draft.mine.pick_no}`} (lowest score so far picks first). `}
              {draft.ahead} pick{draft.ahead === 1 ? "" : "s"} before yours.
            </GuideAlert>
          ) : (
            <GuideAlert>The draft order appears when Round 3 starts.</GuideAlert>
          )}
          <div className="mt-2">
            <OnTheClock data={data} />
          </div>
          <HowItWorks testId="draft-rules">
            <p>
              {draft.bySector
                ? `${DRAFT_RULE} All sectors draft at the same time.`
                : "Companies pick one at a time, the lowest score so far first, with 20 seconds each."}{" "}
              A picker with no pick in time gets {missed}.
            </p>
            <p>
              Each company is judged on its own solution; sharing a statement does not change your price move. A rise is scaled by your score so far
              across the event: ×1.25 for the weakest company down to ×0.25 for the strongest. A fall applies in full.
            </p>
          </HowItWorks>
          {data.mySector && data.statements.some((s) => s.sector) ? (
            <p className="mt-2 text-sm font-semibold text-paper" data-testid="my-sector">
              Your sector: <span className="text-[#39ff88]">{data.mySector}</span>. You pick from its statements only.
            </p>
          ) : null}
          <ul className="mt-3 space-y-2" aria-label="Problem statements">
            {draftableStatements(data.statements, data.mySector).map((s) => {
              const n = counts.get(s.id) ?? 0;
              // By sector, each statement can be picked once: taken by a picker, it is closed to the later pickers.
              const taken = draft.bySector && !draft.pickersDone && n >= 1;
              const full = n >= s.cap || taken;
              return (
                <li key={s.id} className="border border-[#294832] p-3.5" data-testid={`statement-${s.number}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="guide-chip">#{s.number}</span>
                    <span className="guide-label !mb-1.5 !mt-0 uppercase">{s.title}</span>
                    <Chip tone={full ? "red" : "slate"}>
                      {taken ? "taken" : `${n}/${s.cap} ${full ? "full" : "companies"}`}
                    </Chip>
                    {draft.myTurn && !full ? (
                      <span className="ml-auto">
                        <ActionButton variant="primary" confirm={`Click again to pick #${s.number}`} action={pickStatement.bind(null, s.id, `statement ${s.number}`)}>
                          Pick
                        </ActionButton>
                      </span>
                    ) : null}
                  </div>
                  <p className="guide-muted mt-1.5 whitespace-pre-wrap">{s.body}</p>
                  {groups.get(s.id) ? <StatementCrowd group={groups.get(s.id)!} /> : null}
                </li>
              );
            })}
          </ul>
          {data.statements.length === 0 ? <p className="guide-muted">The organisers have not published the statements yet.</p> : null}
        </Step>
      ) : (
        <Step n={1} title="Read your crisis card" state="read" testId="step-card" summary="A new problem hit your company, and every share price fell 5%.">
          <CardsOf data={data} k={k} only={[mine.id]} />
          <HowItWorks testId="crisis-rules">
            <p>Every company gets a crisis card at the same moment, and every price falls 5%.</p>
            <p>You answer with a response plan. After the due time the judge scores it: a good plan lifts your share price, a weak or missing one lowers it.</p>
            <p>A consulting firm you hire writes you an advice memo. The judge also looks at how well your plan uses it.</p>
          </HowItWorks>
        </Step>
      )}

      <Step n={2} title="Hire a consulting firm" state={hireState} summary={hireSummary} testId="step-hire" open={hireState === "now" || hireState === "done"}>
        {engaged ? (
          <GuideAlert>
            {assignedNote ? (
              <span data-testid="hire-assigned">{assignedNote}</span>
            ) : (
              <>
                You hired <strong>{firmCode}</strong> for {termsText(money(engaged.cash_cents), engaged.shares)}.
              </>
            )}{" "}
            {engaged.escrow === "HELD"
              ? `The fee is kept safe until ${dueAt}: the firm gets it only if it sends its memo; otherwise you get it back.`
              : engaged.escrow === "RELEASED"
                ? "The firm sent its memo, so the fee was paid."
                : "The firm sent no memo, so you got the fee back."}{" "}
            <Link href={`/team/messages?c=${engaged.company_id}&f=${engaged.firm_team_id}`} className="font-semibold underline">
              Chat with your firm →
            </Link>
          </GuideAlert>
        ) : !hiring ? (
          <GuideAlert>{r3 && !draft.done ? "Hiring opens when the draft ends." : `Hiring for this ${r3 ? "round" : "crisis"} is closed.`}</GuideAlert>
        ) : (
          <>
            <DoThis testId="hire-todo">Choose a firm below, open &quot;Make an offer&quot; and send it. Hiring closes at {hireAt}.</DoThis>
            <HowItWorks testId="hire-rules">
              <p>Offer cash, shares of your company, or both. The firm can accept, decline or send a counter-offer; each side can counter three times.</p>
              <p>
                A firm takes at most {FIRM_CLIENTS_PER_SUBROUND} clients per {r3 ? "round" : "crisis"}, and you hire one firm. Once an offer is accepted it is final.
              </p>
              <p>Your cash fee is kept safe (in escrow) until the due time. The firm is paid only if it sends its memo; otherwise you get it back.</p>
              {minBidOn ? (
                <p>
                  Each firm has a minimum bid: its base rate, 1% to 4% of your company, set by the average of its Round 1 memo and every advice memo score
                  released so far (recalculated after each crisis&apos;s advice scores are released). An offer worth less is refused.
                </p>
              ) : null}
              {drawOn && r3 ? <p>No firm by {hireAt}? The draw gives you a random firm with room, for 10% of your cash.</p> : null}
              {drawOn && !r3 ? (
                <p>
                  No firm by {hireAt}? The draw gives you a random firm with room, at that firm&apos;s base rate in shares (in cash if your company is at its
                  40,000-share floor).
                </p>
              ) : null}
              {band ? (
                <p>
                  In Round 3 the fee must be worth {money(band.min)} to {money(band.max)} (5–20% of your cash).
                </p>
              ) : null}
            </HowItWorks>
            {listed.length === 0 ? (
              <GuideAlert tone="warn">Every firm has {FIRM_CLIENTS_PER_SUBROUND} clients for this {r3 ? "round" : "crisis"}: there is no firm left to offer.</GuideAlert>
            ) : null}
            {data.firms.length > listed.length ? (
              <p className="mt-2 text-xs text-muted" data-testid="full-firms-hidden">
                {data.firms.length - listed.length === 1 ? "1 firm is" : `${data.firms.length - listed.length} firms are`} full for this {r3 ? "round" : "crisis"} and
                not shown.
              </p>
            ) : null}
            <ul className="guide-scroll-box compact mt-3 space-y-2" aria-label="Firm directory">
              {listed.map((f) => {
                const p = data.profiles.get(f.team_id);
                const open = myOffers.some((o) => o.firm_team_id === f.team_id && o.status === "OPEN");
                const minShares = minBidOn && f.base_rate_bp !== null ? rateShares(f.base_rate_bp) : 0;
                return (
                  <li key={f.team_id} className="border border-[#294832] p-3.5" data-testid={`firm-${f.code}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/team/firms/${encodeURIComponent(f.code)}`} className="guide-chip active hover:underline">
                        {f.code}
                      </Link>
                      <span className="guide-label !mb-1.5 !mt-0 uppercase">{f.name}</span>
                      {f.avg_rating !== null ? <Chip tone="slate">★ {f.avg_rating.toFixed(1)}</Chip> : null}
                    </div>
                    {p?.headline ? <p className="mt-1 text-sm font-semibold text-paper">{p.headline}</p> : null}
                    {p?.specialities.length ? <p className="mt-1 text-xs text-[var(--term-cyan)]">{p.specialities.join(" · ")}</p> : null}
                    {p?.rate_card ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{p.rate_card}</p> : null}
                    {f.base_rate_bp !== null && (minBidOn || (drawOn && !r3)) ? (
                      <p className="mt-1 text-xs text-[#39ff88]" data-testid={`firm-rate-${f.code}`}>
                        {minBidOn
                          ? `Minimum bid: ${minBidText(f.base_rate_bp, mine.market_price)}.`
                          : `Base rate: ${rateText(f.base_rate_bp)} (the fee if the draw gives you this firm).`}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">
                      Asks for {p && p.asking_cents > 0 ? money(p.asking_cents) : "—"} ·{" "}
                      <Link href={`/team/firms/${encodeURIComponent(f.code)}`} className="text-[#39ff88] hover:underline">
                        Full profile
                      </Link>
                    </p>
                    {!open ? (
                      <details className="mt-2">
                        <summary className="guide-btn secondary cursor-pointer list-none">Make an offer</summary>
                        <ActionForm action={makeOffer.bind(null, f.team_id, f.code)} submit="Send offer" className="mt-2" resetOnSuccess>
                          {/* In Round 3 the fee must be worth 5–20% of the company's cash: start inside that band. */}
                          <TermsFields
                            cash={0}
                            shares={Math.max(r3StartShares, minShares)}
                            priceCents={mine.market_price}
                            hint={
                              band
                                ? `Round 3: the fee must be worth ${money(band.min)} to ${money(band.max)} (equity at today's price, plus any cash).`
                                : `Pay in equity: the firm's stake is worth shares × your share price.${p && p.asking_cents > 0 ? ` The firm asks for about ${money(p.asking_cents)}.` : ""}`
                            }
                          />
                          <label className="mt-2 block text-sm">
                            <span className="guide-label !mb-1.5 !mt-0 uppercase">Note (optional)</span>
                            <input name="note" maxLength={300} className={`guide-input mt-1`} />
                          </label>
                        </ActionForm>
                      </details>
                    ) : open ? (
                      <p className="mt-2 text-xs text-muted">You have an open offer with this firm (below).</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {myOffers.length ? (
          <>
            <h3 className="guide-label uppercase mb-2 mt-5">Your offers</h3>
            <ul className="space-y-2">
              {myOffers.map((o) => (
                <OfferCard key={o.id} offer={o} side="COMPANY" hiring={hiring} counterpart={firmById.get(o.firm_team_id)?.code ?? "Firm"} priceCents={mine.market_price} />
              ))}
            </ul>
          </>
        ) : null}
      </Step>
      </div>

      {planType && ws && win ? (
        <Step
          n={3}
          id="plan"
          title={r3 ? "Write your solution" : "Write your response plan"}
          state={planState}
          summary={planSummary}
          testId="step-plan"
          open={win.stage === "OPEN" || !!sent}
        >
          <DoThis testId="plan-todo">
            {r3
              ? `Explain how you solve your problem statement, in up to ${RULES.WORD_LIMIT[planType]} words, then press Submit.`
              : `Explain how your company gets through this crisis, in up to ${RULES.WORD_LIMIT[planType]} words, then press Submit.`}
          </DoThis>
          <HowItWorks label="How it is scored" testId="plan-rules">
            {r3 ? (
              <>
                <p>Your hired firm can write the solution with you: each save shows for both of you.</p>
                <p>The score moves your share price. Companies on the same statement are ranked: the best gets the full move, the others less.</p>
              </>
            ) : (
              <>
                <p>The judge scores the plan after the due time. A strong plan lifts your share price; a weak one lowers it; a missing plan scores 0.</p>
                <p>Your hired firm writes its advice memo separately. Use its advice in your plan: that is part of the score.</p>
              </>
            )}
            <p>Only the last version submitted on time is judged. If you never submit, your last saved draft is submitted for you at the deadline.</p>
          </HowItWorks>
          <div className="mt-3">
            <SubmissionEditor ctx={ctx} ws={ws} type={planType} win={win} />
          </div>
        </Step>
      ) : null}

      <Step n={4} title="Rate your firm" state={rateState} summary={rateSummary} testId="step-rate" open={rateState === "now"}>
        {rateable.length ? (
          <ul className="space-y-3">
            {rateable.map((e) => (
              <li key={e.id} className="text-sm" data-testid={`rate-${e.k}`}>
                <p className="text-paper">
                  {subroundTitle(e.k)} · {firmById.get(e.firm_team_id)?.code ?? "your firm"} · your rating:{" "}
                  <strong>{e.rating === null ? "none yet (3 if you do not rate)" : `${e.rating}/5`}</strong>. Ratings close at {clock(stepAt(data.deadlines, "RATE", e.k))}.
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <ActionButton key={r} variant={e.rating === r ? "primary" : "secondary"} action={rateFirm.bind(null, e.k, r)}>
                      {"★".repeat(r)}
                    </ActionButton>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          null
        )}
        <HowItWorks testId="rate-rules">
          <p>Rate how much the firm helped, from 1 to 5 stars. Each star above 3 adds $1,000 to the firm&apos;s bonus; each star below 3 takes $1,000 away.</p>
          <p>The rating is public and stays on the firm&apos;s profile, so other companies see it when they choose a firm.</p>
        </HowItWorks>
      </Step>

      <History data={data} k={k} companyId={mine.id} />
    </div>
  );
}

function History({ data, k, companyId }: { data: CrisisRoomData; k: number | null; companyId: string }) {
  const past = pastSubrounds(k, data.subrounds);
  const mine = data.engagements.filter((e) => e.company_id === companyId);
  if (past.length === 0 && mine.length === 0) return null;
  return (
    <details className="guide-panel guide-fold" data-testid="crisis-history">
      <summary>Earlier crises and your firms</summary>
      <div className="space-y-4 p-4 sm:p-5">
        {past.map((pk) => (
          <section key={pk}>
            <h3 className="guide-label uppercase mb-2">{subroundTitle(pk)}</h3>
            <CardsOf data={data} k={pk} only={[companyId]} />
          </section>
        ))}
        <EngagementTable data={data} rows={mine} title={`Your firms · ${companyLabel(data.companies.find((c) => c.id === companyId))}`} />
      </div>
    </details>
  );
}
