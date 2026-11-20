import type { Metadata } from "next";
import { RULES } from "@msim/engine";
import { memoCase } from "@/lib/judge/prompts";
import { loadTeamContext } from "@/lib/team/context";
import { currentSubmission, submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { GuidePanel } from "../../crisis/guide";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";

export const metadata: Metadata = { title: "Crisis memo" };

// Round 1 Consultancy: every Consulting team answers the same standalone crisis case (published in prompts/MEMO.md)
// with a recommendation memo. It closes with the PRD; its score moves no price and sets the firm's reputation bonus.
// Laid out as the demo's Round 1 Consulting page (/demo/build): the case and the team's details side by side, then
// the editor, then the rules.
export default async function MemoPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const ws = await loadSquadWorkspace(ctx);
  const pause = pauseOf(ctx);
  const win = submissionWindow("MEMO", ctx.team.track, windowInput(ctx, ws));
  const sent = currentSubmission(ws.submissions, "MEMO");
  const paragraphs = memoCase();
  return (
    <div className="guide-stack">
      <div className="guide-grid two">
        <GuidePanel title="The crisis to solve" tag="ROUND 1 · CRISIS CASE">
          <span className="guide-chip">CRISIS CASE 01 · EVERY CONSULTING TEAM</span>
          <div className="guide-muted guide-scroll-box mini mt-2 space-y-2 !max-h-[260px]" data-testid="memo-case">
            {paragraphs.length ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p>The case is published here before the event.</p>}
          </div>
        </GuidePanel>
        <GuidePanel title="Assigned team details" tag="PRE-ASSIGNED · CONSULTING">
          <div className="grid grid-cols-2 gap-3">
            <div className="guide-metric">
              <small>TEAM CODE</small>
              <b>{ctx.team.code}</b>
              <span>CONSULTING TRACK</span>
            </div>
            <div className="guide-metric">
              <small>SQUAD</small>
              <b>{ctx.squad ? String(ctx.squad.number).padStart(2, "0") : "—"}</b>
              <span>{ctx.company?.ticker ? `PARTNER ${ctx.company.ticker}` : "PRODUCT PARTNER"}</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="guide-metric">
              <small>ROUND 1 TASK</small>
              <b className="text-base">Crisis memo</b>
              <span>6 SECTIONS · {RULES.WORD_LIMIT.MEMO} WORDS</span>
            </div>
            <div className="guide-metric">
              <small>STATUS</small>
              <b className="text-base">{sent ? "SUBMITTED" : win.stage === "OPEN" ? "IN PROGRESS" : win.stage === "BEFORE" ? "NOT OPEN" : "CLOSED"}</b>
              <span>
                DUE <Due at={win.deadline} {...pause} testId="memo-due" />
              </span>
            </div>
          </div>
          <p className="guide-muted mt-3">
            Your team code (<b>{ctx.team.code}</b>) and team name (<b>{ctx.team.name}</b>) are fixed. Write your memo to the case in the six sections
            below and press <b>Submit</b> when it is ready: you can submit again until the deadline, and only the last version submitted on time is
            judged.
          </p>
        </GuidePanel>
      </div>

      <GuidePanel title="Crisis solution editor" tag={`6 PARTS · ${RULES.WORD_LIMIT.MEMO} WORDS TOTAL`}>
        <SubmissionEditor ctx={ctx} ws={ws} type="MEMO" win={win} />
      </GuidePanel>

      <p className="guide-alert">
        Your recommendation to the founders: up to {RULES.WORD_LIMIT.MEMO} words across the six sections. The AI judge scores the diagnosis (25), options
        and trade-offs (20), the recommendation (20), the numbers (15), risks (10) and next steps (10). The score moves no price: it sets your firm&apos;s
        reputation bonus, $500 × (score − 50), paid at settlement.
      </p>
    </div>
  );
}
