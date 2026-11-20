"use client";

// Home shows the big round banner; every other page shows its one-line form, so the page's own work starts near the
// top of the screen. Both are rendered on the server; only the one for this page is mounted. The layout places the
// banner twice: the one-line strip under the task band ("top") and the big card in the page column ("content", Home
// only, after the greeting as in the demo's dashboard); each slot mounts only its own form.

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export function BannerFrame({ full, compact, slot }: { full: ReactNode; compact: ReactNode; slot?: "top" | "content" }) {
  const path = usePathname();
  const home = path === "/team";
  if (slot === "top") return <>{home ? null : compact}</>;
  if (slot === "content") return <>{home ? full : null}</>;
  return <>{home ? full : compact}</>;
}
