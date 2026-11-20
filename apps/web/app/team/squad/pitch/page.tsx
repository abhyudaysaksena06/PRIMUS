import type { Metadata } from "next";
import Link from "next/link";
import { RULES } from "@msim/engine";
import { money } from "@/lib/format";
import { loadTeamContext } from "@/lib/team/context";
import { currentSubmission, pickState, submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Chip, GuidePanel } from "../../crisis/guide";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";
import { DoThis, HowItWorks } from "@/components/ui/how-it-works";

export const metadata: Metadata = { title: "Pitch" };

// The PRD: the Product team writes it (with the company name and the ticker it claims), the Consulting team
// reads it. It hard-closes at the pitch deadline; its score sets the IPO price. Laid out as the demo's Round 1
// Product page (/demo/build): the sector and the company identity side by side, then the editor, then the rules.
export default async function PitchPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const squad = ctx.squad!;
  const ws = await loadSquadWorkspace(ctx);
  const w = windowInput(ctx, ws);
  const pause = pauseOf(ctx);
  const win = submissionWindow("PITCH", ctx.team.track, w);
  const pick = pickState({
    ...pause,
    track: ctx.team.track,
    nowMs: w.nowMs,
    deadline: ws.deadlines.PROBLEM_PICK ?? null,
    dealt: squad.dealt_card_ids,
    chosenId: squad.chosen_card_id,
    byDefault: squad.chosen_by_default,
  });
  const chosen = ws.cards.find((c) => c.id === pick.chosenId) ?? null;
  const sent = currentSubmission(ws.submissions, "PITCH");
  const draft = ws.drafts.PITCH?.content ?? {};
  const draftName = typeof draft.company_name === "string" ? draft.company_name.trim() : "";
  const draftTicker = typeof draft.ticker === "string" ? draft.ticker.trim().toUpperCase() : "";
  const name = ctx.company?.name ?? (draftName || "Your Product");
  const ticker = ctx.company?.ticker ?? (draftTicker || "TICK");
  const squadNo = String(squad.number).padStart(2, "0");

  return (
    <div className="guide-stack">
      <div className="guide-grid two">
        <GuidePanel
          title={pick.oneCase ? "Your case (every squad)" : "Your assigned sector"}
          tag="SECTOR ALLOCATION"
          actions={<Link href="/team/squad/problem">{pick.canPick ? "Pick a card" : "See the cards"}</Link>}
        >
          {chosen ? (
            <>
              <Chip tone="active">
                SQUAD {squadNo} · {chosen.sector}
              </Chip>
              <h2 className="mt-3 text-xl font-semibold">{chosen.title}</h2>
              <p className="guide-muted mt-2 whitespace-pre-wrap">{chosen.body}</p>
            </>
          ) : (
            <h2 className="text-xl font-semibold">Not picked yet.</h2>
          )}
          <div className="guide-alert mt-3">
            {pick.oneCase ? (
              <b>{pick.note}</b>
            ) : (
              <>
                <b>Pick closes:</b> <Due at={ws.deadlines.PROBLEM_PICK ?? null} {...pause} /> · {pick.note}
              </>
            )}
          </div>
        </GuidePanel>

        <GuidePanel title="Pitch your idea & company identity" tag={`TEAM ${ctx.team.code} · ${ctx.team.track} TRACK`}>
          <label className="guide-label !mt-0">COMPANY / PRODUCT NAME</label>
          <p className="text-xl font-semibold" data-testid="pitch-identity">
            {ctx.company?.ticker ? (
              <>
                {ctx.company.name ?? "—"} <span className="font-mono text-[#39ff88]">({ctx.company.ticker})</span>
              </>
            ) : draftName || draftTicker ? (
              <>
                {draftName || "—"} {draftTicker ? <span className="font-mono text-[#39ff88]">({draftTicker})</span> : null}
              </>
            ) : (
              "Not named yet"
            )}
          </p>
          <p className="guide-muted mt-1">
            {ctx.company?.ticker
              ? "Claimed when the PRD was submitted."
              : "Type the name and the 3- or 4-letter ticker in the editor below: they are claimed when the PRD is submitted."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="guide-metric">
              <small>SHARE STRUCTURE</small>
              <b className="text-base">{ctx.company?.ipo_price ? `${money(ctx.company.ipo_price)}/sh` : "SET BY THE PRD"}</b>
              <span>{ctx.company?.ipo_price ? "IPO PRICE" : "A BETTER PRD, A HIGHER IPO PRICE"}</span>
            </div>
            <div className="guide-metric">
              <small>PRD STATUS</small>
              <b className="text-base">{sent ? "SUBMITTED" : win.stage === "OPEN" ? "IN PROGRESS" : win.stage === "BEFORE" ? "NOT OPEN" : "CLOSED"}</b>
              <span>
                DUE <Due at={win.deadline} {...pause} testId="pitch-due" />
              </span>
            </div>
          </div>
        </GuidePanel>
      </div>

      <GuidePanel title={`Idea & MVP editor — ${name} (${ticker})`} tag={`7 SECTIONS · ${RULES.WORD_LIMIT.PITCH} WORDS TOTAL`}>
        <SubmissionEditor ctx={ctx} ws={ws} type="PITCH" win={win} />
      </GuidePanel>

      <div className="guide-alert">
        <DoThis testId="pitch-todo">Write your company&apos;s plan in seven short parts (up to {RULES.WORD_LIMIT.PITCH} words), then press Submit.</DoThis>
        <HowItWorks label="How it is scored" testId="pitch-rules">
          <p>
            This is your Product Requirements Document (PRD). The AI judge scores the problem (20), the solution and MVP (20), success metrics (15), business
            model (15), feasibility and risks (15) and clarity (15).
          </p>
          <p>The score sets your company&apos;s IPO price: a better PRD means a higher starting share price.</p>
        </HowItWorks>
      </div>
    </div>
  );
}
