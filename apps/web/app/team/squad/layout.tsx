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
  return (
    <RoomShell
      track={team.track}
      eyebrow="Squad workspace"
      title={team.track === "CONSULTING" ? "Your squad's briefs" : "Build your product"}
      lede={
        team.track === "CONSULTING"
          ? "The problem card, your crisis memo and the squad's plans, written with your Product partner."
          : "Pick the problem card, write the PRD and the squad's plans with your Consulting partner."
      }
      className="space-y-4"
    >
      <SquadTabs show={squadTabsFor(status.phase)} oneCase={oneCase} />
      {children}
    </RoomShell>
  );
}
