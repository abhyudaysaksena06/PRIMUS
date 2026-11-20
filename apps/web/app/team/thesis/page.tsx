import type { Metadata } from "next";
import { RULES, TEMPLATES, thesisBonus } from "@msim/engine";
import { featureOn } from "@/lib/event-status";
import { money } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { loadTeamContext } from "@/lib/team/context";
import { verdict, type ScoreRow } from "@/lib/team/market";
import { sectionAllowed } from "@/lib/team/sections";
import { currentSubmission, submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { VerdictDetail } from "../market/verdict-detail";
import { GuideAlert, GuidePanel } from "../crisis/guide";
import { RoomShell } from "../crisis/room-shell";
import { Due } from "../squad/due";
import { SubmissionEditor } from "../squad/submission";

export const metadata: Metadata = { title: "Investment thesis" };

// PRIMUS Round 3 (migration 089, switch finance_thesis): each Finance team writes one investment thesis for the
// close, 150 to 500 words in four sections, due with the solutions (DUE_5). It is the squad's own submission (kept
// with the squad's company, like the firm's memo), written with the same editor as every other piece: autosave, word
// count, Submit in the last 5 minutes, paste blocked. The judge scores it; once an organiser releases the scores the
// fund is paid $500 × (score − 50) in cash, and the score shows here.
export default async function ThesisPage() {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/thesis")) {
    return <GuideAlert>The investment thesis is written by the Finance teams.</GuideAlert>;
  }
  if (ctx.event.format !== "PRIMUS" || !featureOn(ctx.status, "finance_thesis")) {
    return <GuideAlert>There is no investment thesis tonight.</GuideAlert>;
  }
  if (!ctx.squad) {
    return <GuideAlert>The squads are formed at the squad draw. Your investment thesis opens in Round 3.</GuideAlert>;
  }
  const ws = await loadSquadWorkspace(ctx);
  const pause = pauseOf(ctx);
  const win = submissionWindow("THESIS", ctx.team.track, windowInput(ctx, ws));
  const sent = currentSubmission(ws.submissions, "THESIS");
  // RLS shows a score once it is released.
  const sb = await supabaseServer();
  const { data: scoreRow } = ctx.company
    ? await sb
        .from("scores")
        .select("company_id, type, final_score, median, tier_bp, capped, late, missing, penalty, breakdown, rationale")
        .eq("company_id", ctx.company.id)
        .eq("type", "THESIS")
        .eq("status", "RELEASED")
        .maybeSingle<ScoreRow>()
    : { data: null };
  const v = scoreRow ? verdict(scoreRow) : null;
  const sections = TEMPLATES.THESIS.length;
  return (
    <RoomShell
      track={ctx.team.track}
      eyebrow={`ROUND 3 / INVESTMENT THESIS · ${ctx.team.code}`}
      title="Write your fund's investment thesis."
      lede="Which sectors and companies does your fund back for the close, and why? Use the Round 3 statements, the companies' solutions and what the market shows."
    >
      <div className="guide-grid two">
        <GuidePanel title="The brief" tag="ROUND 3 · EVERY FUND">
          <div className="guide-muted space-y-2">
            <p>
              Write one thesis for your fund: the sector or sectors and the companies you back for the close, and why, using the Round 3 problem
              statements, the companies&apos; solutions and the market evidence (prices, released scores, the draft).
            </p>
            <p>
              {RULES.THESIS_MIN_WORDS} to {RULES.WORD_LIMIT.THESIS} words across the {sections} sections below. The AI judge scores the thesis (25), the
              evidence (30), the portfolio logic (20), the risks (15) and clarity (10). It moves no price: your fund is paid $500 × (score − 50) in cash
              when the scores are released, from −$25,000 to +$25,000. No thesis on time scores 0, which costs $25,000.
            </p>
          </div>
        </GuidePanel>
        <GuidePanel title="Your thesis" tag="FINANCE · ONE PER FUND">
          <div className="grid grid-cols-2 gap-3">
            <div className="guide-metric">
              <small>STATUS</small>
              <b className="text-base" data-testid="thesis-status">
                {v ? "SCORED" : sent ? "SUBMITTED" : win.stage === "OPEN" ? "IN PROGRESS" : win.stage === "BEFORE" ? "NOT OPEN" : "CLOSED"}
              </b>
              <span>
                DUE <Due at={win.deadline} {...pause} testId="thesis-due" />
              </span>
            </div>
            <div className="guide-metric">
              <small>SCORE</small>
              <b className="text-base" data-testid="thesis-score">
                {v ? v.score : "—"}
              </b>
              <span>{scoreRow && scoreRow.final_score !== null ? `BONUS ${money(thesisBonus(scoreRow.final_score))}` : "RELEASED BY THE ORGANISERS"}</span>
            </div>
          </div>
          {v ? (
            <div className="mt-3">
              {v.notes.map((n) => (
                <p key={n} className="guide-muted">
                  {n}
                </p>
              ))}
              <VerdictDetail v={v} />
            </div>
          ) : (
            <p className="guide-muted mt-3">
              Press <b>Submit</b> when it is ready: you can submit again until the deadline, and only the last version submitted on time is judged. A saved
              draft is submitted for you at the deadline.
            </p>
          )}
        </GuidePanel>
      </div>

      <GuidePanel title="Investment thesis editor" tag={`${sections} PARTS · ${RULES.THESIS_MIN_WORDS}–${RULES.WORD_LIMIT.THESIS} WORDS`}>
        <SubmissionEditor ctx={ctx} ws={ws} type="THESIS" win={win} />
      </GuidePanel>
    </RoomShell>
  );
}
