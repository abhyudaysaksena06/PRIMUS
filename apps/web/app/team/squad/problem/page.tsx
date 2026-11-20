import type { Metadata } from "next";
import { AutoRefresh } from "@/lib/live/auto-refresh";
import { RefreshAt } from "@/lib/live/refresh-at";
import { loadTeamContext } from "@/lib/team/context";
import { pickState } from "@/lib/team/squad";
import { loadSquadWorkspace, pauseOf, windowInput } from "@/lib/team/squad-data";
import { ActionButton } from "@/components/ui/action";
import { GuideAlert, GuidePanel, Chip } from "../../crisis/guide";
import { pickProblemCard } from "../actions";
import { Due } from "../due";
import { squadGate } from "../parts";

export const metadata: Metadata = { title: "Problem card" };

// The three problem cards dealt to the squad at the draw. The Product team picks one (two clicks; it can change its
// pick until the pick closes); the Consulting team sees the cards and the pick. If nothing is picked by the
// deadline, the first card dealt is chosen by default.
export default async function ProblemCardPage() {
  const ctx = await loadTeamContext();
  const gate = squadGate(ctx);
  if (gate) return gate;
  const squad = ctx.squad!;
  const ws = await loadSquadWorkspace(ctx);
  const w = windowInput(ctx, ws);
  const deadline = ws.deadlines.PROBLEM_PICK ?? null;
  const pick = pickState({
    ...pauseOf(ctx),
    track: ctx.team.track,
    nowMs: w.nowMs,
    deadline,
    dealt: squad.dealt_card_ids,
    chosenId: squad.chosen_card_id,
    byDefault: squad.chosen_by_default,
  });

  return (
    <div className="guide-stack">
      {/* A pick sends no realtime message: the partner's screens and other devices re-read while it can change. */}
      <AutoRefresh everyMs={10_000} active={pick.open || pick.defaultPending} />
      <RefreshAt at={deadline} />
      <GuidePanel
        title={pick.oneCase ? "The case" : "Problem card"}
        tag={pick.oneCase ? "EVERY SQUAD" : `${ws.cards.length} DEALT · PICK 1`}
        actions={
          pick.oneCase ? null : (
            <span className="guide-status">
              PICK CLOSES <Due at={deadline} {...pauseOf(ctx)} testId="pick-due" />
            </span>
          )
        }
      >
        <GuideAlert tone={pick.canPick && !pick.chosenId ? "warn" : "info"}>{pick.note}</GuideAlert>
        {ws.cards.length === 0 ? (
          <p className="guide-muted">No cards have been dealt to your squad.</p>
        ) : (
          <ol className={`guide-grid ${pick.oneCase ? "" : "three"}`}>
            {ws.cards.map((c, i) => {
              const chosen = c.id === pick.chosenId;
              return (
                <li
                  key={c.id}
                  aria-label={`Card ${i + 1}: ${c.title}`}
                  className={`flex flex-col border p-3.5 ${chosen ? "border-[#39ff88]" : "border-[#294832]"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Chip tone={chosen ? "active" : "slate"}>
                      {pick.oneCase ? "Same case for every squad" : `Card ${i + 1} of 3`} · No. {c.number} · {c.sector}
                    </Chip>
                    {pick.oneCase ? null : chosen ? <Chip tone={pick.byDefault ? "amber" : "green"}>{pick.byDefault ? "Chosen by default" : "Picked"}</Chip> : null}
                  </div>
                  <h3 className="mt-3 text-xl font-semibold leading-snug text-paper">{c.title}</h3>
                  <p className="guide-muted mt-2 flex-1 whitespace-pre-wrap">{c.body}</p>
                  {pick.canPick && !chosen ? (
                    <div className="mt-3">
                      <ActionButton action={pickProblemCard.bind(null, c.id, c.title)} confirm={`Click again to pick “${c.title}”`}>
                        {pick.chosenId ? "Pick this card instead" : "Pick this card"}
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {!pick.mayPick && !pick.oneCase ? <p className="guide-muted">The Product team picks the card; you see its pick here.</p> : null}
      </GuidePanel>
    </div>
  );
}
