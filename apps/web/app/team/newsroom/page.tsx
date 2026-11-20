import type { Metadata } from "next";
import { RoomShell } from "../crisis/room-shell";
import { NewsroomView } from "./newsroom-view";

export const metadata: Metadata = { title: "Newsroom" };

// The palette follows the team shell's track (its data-track); this page reads nothing of its own.
export default function TeamNewsroomPage() {
  return (
    <RoomShell track={null} className="">
      <NewsroomView />
    </RoomShell>
  );
}
