import { loadTeamContext } from "@/lib/team/context";
import { sectionAllowed } from "@/lib/team/sections";
import { squadTabsFor } from "@/lib/team/focus";
import { SquadTabs } from "./tabs";
import { RoomShell } from "../crisis/room-shell";

// The squad workspace (Product and Consulting): the overview, the problem card, and the pitch, plan and flash
// editors. A Finance team's pages show where its squad work is instead.
export default async function SquadLayout({ children }: LayoutProps<"/team/squad">) {
  const { team, status, squad } = await loadTeamContext();
  if (!sectionAllowed(team.track, "/squad")) return <>{children}</>;
  const oneCase = (squad?.dealt_card_ids.length ?? 0) === 1;
  const product = team.track !== "CONSULTING";
  return (
    <RoomShell
      track={team.track}
      eyebrow={product ? `ROUND 1 / PRODUCT IDEA & MVP · ${team.code}` : `ROUND 1 / CONSULTING CRISIS · ${team.code}`}
      title={product ? "Pitch your idea and build your MVP." : "Solve the crisis."}
      lede={
        product
          ? "Pick the problem card, claim your company name and ticker, and write your PRD (the idea and MVP) with your Consulting partner. Your PRD score sets your IPO share price."
          : "Read the Round 1 crisis case, write your six-part crisis memo and submit it. Your memo score sets your firm's reputation, which Product teams see when they hire in Round 2."
      }
    >
      <SquadTabs show={squadTabsFor(status.phase)} oneCase={oneCase} />
      {children}
    </RoomShell>
  );
}
