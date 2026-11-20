// Server-side checks for the control panel by role (migration 074): a desk role (registration, judging, crisis) may
// open only its own sections; a section it may not open sends it to its own desk. The database refuses the same
// calls (see lib/auth/routes.ts for the split).

import "server-only";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentViewer, type Viewer } from "./viewer";
import { canAccess, canOpenSection, homeFor, landingFor, type Role } from "./routes";

export type StaffViewer = Omit<Viewer, "role"> & { role: Role };

/** The signed-in account, or a redirect: to the login when signed out, home when the control panel is not theirs. */
export async function requireStaff(from: string): Promise<StaffViewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(from)}`);
  const role = viewer.role as Role;
  if (!canAccess("/admin", role)) redirect(homeFor(role));
  return { ...viewer, role };
}

/** Checks one section of an event's control panel (section: the path under /admin/<slug>, "" for the overview). */
export async function requireSection(slug: string, section: string): Promise<StaffViewer> {
  const viewer = await requireStaff(`/admin/${slug}${section}`);
  if (!canOpenSection(viewer.role, section)) redirect(landingFor(viewer.role, slug));
  return viewer;
}

/** A section's layout.tsx is one line: `export default sectionGate("/desk");` */
export function sectionGate(section: string) {
  return async function SectionGate({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    await requireSection(slug, section);
    return children;
  };
}
