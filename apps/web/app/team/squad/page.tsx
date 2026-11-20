import { submissionsFor } from "@/lib/team/focus";
import type { Metadata } from "next";
import Link from "next/link";
import { SUBMISSION_TYPES, TRACKS, TRACK_LABELS, type Track } from "@msim/engine";
import { clock } from "@/lib/format";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { loadTeamContext } from "@/lib/team/context";
import { SUBMISSION_PATHS, pickState, submissionStatus, submissionWindow, whoLabel, type SubmissionStatus } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { Chip, GuidePanel } from "../crisis/guide";
import { Due } from "./due";
import { squadGate } from "./parts";
import { HowItWorks } from "@/components/ui/how-it-works";

export const metadata: Metadata = { title: "Squad" };

const ROLE_WORK: Record<Track, string> = {
  PRODUCT: "Picks the problem card, writes the PRD, co-writes the rescue plan and the flash answer, agrees the fee and signs the deal.",
  CONSULTING: "Writes the crisis memo, co-writes the rescue plan and the flash answer, agrees the fee, proposes the deal price and signs the deal.",
  FINANCE: "Sets the deal amount and signs the deal.",
};

// The squad at a glance: its number, its company, the three teams, the problem card, and where each submission
// stands (draft saved when and by whom, submitted when, word count, the version judged) with its deadline.
export default async function SquadOverview() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const squad = ctx.squad!;
  const ws = await loadSquadWorkspace(ctx);
  const w = windowInput(ctx, ws);
  const pause = pauseOf(ctx);
  const thisRound: string[] = submissionsFor(ctx.status.phase);
  const pick = pickState({ ...pause, track: ctx.team.track, nowMs: w.nowMs, deadline: ws.deadlines.PROBLEM_PICK ?? null, dealt: squad.dealt_card_ids, chosenId: squad.chosen_card_id, byDefault: squad.chosen_by_default });
  const windows = SUBMISSION_TYPES.map((t) => submissionWindow(t, ctx.team.track, w));
  const statuses = SUBMISSION_TYPES.map((t, i) => submissionStatus(t, ws.drafts[t], ws.submissions, windows[i]!, pause));
  const chosen = ws.cards.find((c) => c.id === pick.chosenId) ?? null;
  const ids: Record<Track, string> = { PRODUCT: squad.product_team_id, CONSULTING: squad.consulting_team_id, FINANCE: squad.finance_team_id };
  const pitchDraft = ws.drafts.PITCH?.content ?? {};
  const draftName = typeof pitchDraft.company_name === "string" ? pitchDraft.company_name.trim() : "";
  const draftTicker = typeof pitchDraft.ticker === "string" ? pitchDraft.ticker.trim().toUpperCase() : "";

  const squadNo = String(squad.number).padStart(2, "0");
  return (
    <div className="guide-stack">
      {/* Drafts saved by the partner team send no realtime message: re-read while something can still change. */}
      <AutoRefresh everyMs={15_000} active={pick.open || pick.defaultPending || windows.some((x) => x.stage === "OPEN")} />

      <div className="guide-grid two">
        <GuidePanel
          title={pick.oneCase ? "The case" : "Your problem card"}
          tag={pick.oneCase ? "EVERY SQUAD" : "PROBLEM CARD"}
          actions={
            <Link href="/team/squad/problem">
              {pick.oneCase ? "Read the case" : pick.canPick ? (pick.chosenId ? "Change the pick" : "Pick a card") : "See the cards"}
            </Link>
          }
        >
          <div data-testid="squad-problem">
            {chosen ? (
              <>
                <Chip tone="active">
                  SQUAD {squadNo} · {chosen.sector}
                </Chip>{" "}
                {pick.oneCase ? <Chip tone="green">Every squad</Chip> : pick.byDefault ? <Chip tone="amber">Chosen by default</Chip> : <Chip tone="green">Picked</Chip>}
                <p className="mt-3 text-xl font-semibold text-paper">{chosen.title}</p>
              </>
            ) : (
              <p className="text-xl font-semibold text-paper">Not picked yet.</p>
            )}
            <p className="guide-muted mt-2">{pick.note}</p>
            {pick.oneCase ? null : (
              <div className="guide-alert mt-3">
                <b>Pick closes:</b> <Due at={ws.deadlines.PROBLEM_PICK ?? null} {...pause} />
              </div>
            )}
          </div>
        </GuidePanel>

        <GuidePanel title={`Squad ${squadNo}`} tag={`TEAM ${ctx.team.code} · ${TRACK_LABELS[ctx.team.track].toUpperCase()} TRACK`}>
          <label className="guide-label !mt-0">COMPANY / PRODUCT NAME</label>
          {ctx.company?.ticker ? (
            <p className="text-2xl font-bold tracking-tight text-paper" data-testid="squad-company">
              {ctx.company.name ?? "—"} <span className="font-mono text-[#39ff88]">({ctx.company.ticker})</span>
            </p>
          ) : (
            <p className="text-sm text-paper" data-testid="squad-company">
              No name or ticker claimed yet: they are claimed when the PRD is submitted.
              {draftName || draftTicker ? (
                <span className="guide-muted block">
                  In the draft: {draftName || "—"}
                  {draftTicker ? <span className="font-mono"> ({draftTicker})</span> : null}
                </span>
              ) : null}
            </p>
          )}
          <label className="guide-label">TEAMS</label>
          <ul className="space-y-2" aria-label="Squad teams">
            {TRACKS.map((t) => {
              const mine = ids[t] === ctx.team.id;
              return (
                <li key={t} className="border border-[#294832] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b className="text-xs text-paper">{TRACK_LABELS[t]}</b>
                    {mine ? <Chip tone="active">Your team · {ctx.team.code}</Chip> : <span className="guide-status">PARTNER TEAM</span>}
                  </div>
                  <span className="guide-muted mt-1 block">{ROLE_WORK[t]}</span>
                </li>
              );
            })}
          </ul>
        </GuidePanel>
      </div>

      <GuidePanel title={thisRound.length < 3 ? "This round" : "Submissions"} tag={`${thisRound.length} ${thisRound.length === 1 ? "SUBMISSION" : "SUBMISSIONS"}`}>
        <ul className="guide-grid three">
          {statuses.map((s, i) =>
            thisRound.includes(s.type) ? (
              <StatusCard key={s.type} s={s} who={(id) => whoLabel(squad, ctx.team.id, id)} due={windows[i]!.deadline} pause={pause} />
            ) : null,
          )}
        </ul>
        <HowItWorks testId="squad-rules">
          <p>Only the last version submitted on time is judged; a saved draft that is not submitted is not judged.</p>
          {ws.deadlines.DEAL ? <p>The deal must be fully signed by {clock(ws.deadlines.DEAL)}, or the plan score is capped at 50.</p> : null}
        </HowItWorks>
      </GuidePanel>
    </div>
  );
}

function StatusCard({
  s,
  who,
  due,
  pause,
}: {
  s: SubmissionStatus;
  who: (teamId: string | null) => string;
  due: string | null;
  pause: { paused: boolean; pausedAt: string | null };
}) {
  return (
    <li className="guide-metric min-w-0" aria-label={s.label} data-testid={`status-${s.type}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <small>{s.label.toUpperCase()}</small>
        <Chip tone={s.state.tone}>{s.state.text}</Chip>
      </div>
      <h3 className="mt-2 text-base font-bold text-paper">{s.label}</h3>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-paper">
        <dt className="guide-muted">Due</dt>
        <dd>
          <Due at={due} {...pause} />
        </dd>
        <dt className="guide-muted">Draft</dt>
        <dd data-testid={`draft-${s.type}`}>
          {s.draft ? (
            <>
              Version {s.draft.version} · {s.draft.words} words · saved by {who(s.draft.by)} at <span className="font-mono">{clock(s.draft.savedAt, true)}</span>
            </>
          ) : (
            "Not saved yet"
          )}
        </dd>
        <dt className="guide-muted">Submitted</dt>
        <dd data-testid={`submitted-${s.type}`}>
          {s.current ? (
            <>
              <span className="font-mono">{clock(s.current.submittedAt, true)}</span> by {who(s.current.by)} · {s.current.words} words ·{" "}
              {s.current.late ? <Chip tone="red">late</Chip> : "on time"} · current (judged)
            </>
          ) : (
            "Not submitted"
          )}
        </dd>
        {s.superseded > 0 ? (
          <>
            <dt className="guide-muted">Earlier</dt>
            <dd>
              {s.superseded} superseded {s.superseded === 1 ? "version" : "versions"}
            </dd>
          </>
        ) : null}
      </dl>
      {s.changedSinceSubmit ? <p className="guide-alert guide-warning mt-2">The saved draft differs from the submitted version.</p> : null}
      <Link href={SUBMISSION_PATHS[s.type]} className="guide-btn secondary mt-3">
        Open the {s.label.toLowerCase()}
      </Link>
    </li>
  );
}
