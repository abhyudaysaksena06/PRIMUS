import type { Metadata } from "next";
import TeamBulletinsPage from "../bulletins/page";

export const metadata: Metadata = { title: "Newsroom" };

// The newsroom is the demo's newsroom page filled with the event's real bulletins (the same page as Bulletins; the
// sample feed it showed before was made-up activity).
export default TeamBulletinsPage;
