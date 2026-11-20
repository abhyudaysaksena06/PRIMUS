import type { Metadata } from "next";
import { loadTeamContext } from "@/lib/team/context";
import { loadCrisisRoom } from "@/lib/team/crisis-data";
import { currentSubround, subroundTimeline, subroundTitle, withDraftEnd } from "@/lib/team/crisis";
import { sectionAllowed } from "@/lib/team/sections";
import { pauseOf } from "@/lib/team/squad-data";
import { RefreshAt } from "@/lib/live/refresh-at";

import { ProductRoom } from "./product";
import { ConsultingRoom } from "./consulting";
import { FinanceRoom } from "./finance";
import { Timeline } from "./parts";
import { RoomShell } from "./room-shell";
import { GuideAlert } from "./guide";

export const metadata: Metadata = { title: "Crisis room" };

// PRIMUS Rounds 2 and 3 for each track: Product teams hire firms, write response plans, rate their firm and draft a
// statement; Consulting firms sell their advice and write memos (and the solution with their Round 3 client); funds
// read the cards, the hires and the draft. The page re-reads at each step of the sub-round's timeline.
export default async function CrisisRoomPage() {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/crisis")) return <GuideAlert>This section is not part of your team&apos;s portal.</GuideAlert>;
  const data = await loadCrisisRoom(ctx);
  if (data.format !== "PRIMUS") return <GuideAlert>Tonight&apos;s event plays the classic format: there is no crisis room. See Squad and Rescue.</GuideAlert>;
  const k = currentSubround(ctx.status.phase, data.subrounds);
  const nowMs = new Date(ctx.status.server_time).getTime();
  data.deadlines = withDraftEnd(data.deadlines, data.picks, nowMs);
  const steps = k === null ? [] : subroundTimeline(k, data.deadlines, nowMs, pauseOf(ctx));
  const nextAt = steps.find((s) => !s.passed && s.at)?.at ?? null;
  const track = ctx.team.track;
  const r3 = k === 5;
  // The demo's page heads: /demo/rescue (Round 2) and /demo/trade (Round 3) for the team's track.
  const round = k === null ? "ROUNDS 2 AND 3" : `${r3 ? "ROUND 3" : "ROUND 2"} / ${subroundTitle(k)}`;
  const head =
    track === "PRODUCT"
      ? {
          eyebrow: `${round} · ${r3 ? "DRAFT, CONSULTANT & NEW MVP" : "CRISIS, CONSULTANT & RESPONSE"} · ${ctx.team.code}`,
          title: r3 ? "Draft your problem statement, hire a consultant and build a new MVP." : "Read the crisis and hire a consultant for equity.",
          lede: r3
            ? "Pick your problem statement in the draft (lowest score so far picks first), hire a consulting firm for a stake in your company, then write your solution with it."
            : "Read the crisis, hire a consulting firm for a stake in your company, write your response plan and rate your firm, step by step.",
        }
      : track === "CONSULTING"
        ? {
            eyebrow: `${round} · ${r3 ? "EQUITY & CLIENT SOLUTION" : "EQUITY ENGAGEMENTS & ADVICE MEMOS"} · ${ctx.team.code}`,
            title: r3 ? "Win a Round 3 client for equity and write its solution." : "Sell your advice for equity, then write each client's memo.",
            lede: "Sell your advice for equity, answer offers from companies, write the memo for each client and watch your firm's value.",
          }
        : {
            eyebrow: `${round} · ${ctx.team.code}`,
            title: "Crisis room",
            lede: "Read every company's crisis, who hired whom and the Round 3 draft before you trade.",
          };
  return (
    <RoomShell track={track} eyebrow={head.eyebrow} title={head.title} lede={head.lede}>
      <RefreshAt at={nextAt} />
      {k === null ? (
        <GuideAlert>
          {ctx.status.phase === "PRESSURE"
            ? "Round 2 is under way: the first crisis card is revealed soon. This page updates by itself."
            : "The crisis room opens in Round 2, after the IPO."}
        </GuideAlert>
      ) : (
        <Timeline k={k} steps={steps} />
      )}
      {ctx.team.track === "PRODUCT" ? (
        <ProductRoom ctx={ctx} data={data} k={k} nowMs={nowMs} />
      ) : ctx.team.track === "CONSULTING" ? (
        <ConsultingRoom ctx={ctx} data={data} k={k} nowMs={nowMs} />
      ) : (
        <FinanceRoom ctx={ctx} data={data} k={k} />
      )}
    </RoomShell>
  );
}
