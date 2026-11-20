import type { Metadata } from "next";
import { RULES } from "@msim/engine";
import { clock } from "@/lib/format";
import { loadTeamContext } from "@/lib/team/context";
import { submissionWindow } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { GuidePanel } from "../../crisis/guide";
import { Due } from "../due";
import { squadGate } from "../parts";
import { SubmissionEditor } from "../submission";

export const metadata: Metadata = { title: "Flash" };

// The flash answer: once the flash bulletin is published, the squad answers it in up to 100 words until the flash
// deadline. The bulletin is shown next to the answer.
export default async function FlashPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const ws = await loadSquadWorkspace(ctx);
  const win = submissionWindow("FLASH", ctx.team.track, windowInput(ctx, ws));
  return (
    <div className="guide-grid two">
      <GuidePanel title="Flash bulletin" tag="NEWS">
        {ws.flash ? (
          <article data-testid="flash-bulletin">
            <p className="guide-chip active">Published at {clock(ws.flash.published_at)}</p>
            <h3 className="mt-3 text-xl font-semibold text-paper">{ws.flash.title}</h3>
            <p className="guide-muted mt-2 whitespace-pre-wrap">{ws.flash.body}</p>
          </article>
        ) : (
          <p className="text-sm text-paper">
            Not published yet{ws.deadlines.FLASH_BULLETIN ? `: it is planned for ${clock(ws.deadlines.FLASH_BULLETIN)}` : ""}. It appears here as soon as it
            is out.
          </p>
        )}
      </GuidePanel>
      <GuidePanel
        title="Flash answer"
        tag={`${RULES.WORD_LIMIT.FLASH} WORDS`}
        actions={
          <span className="guide-status">
            DUE <Due at={win.deadline} {...pauseOf(ctx)} testId="flash-due" />
          </span>
        }
      >
        <p className="guide-alert mb-4">
          Up to {RULES.WORD_LIMIT.FLASH} words, written together by your squad&apos;s Product and Consulting teams. The judge scores how you respond to the
          news (50), how realistic it is (30) and how clear (20).
        </p>
        <SubmissionEditor ctx={ctx} ws={ws} type="FLASH" win={win} />
      </GuidePanel>
    </div>
  );
}
