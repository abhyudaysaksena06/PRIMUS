// Which role may open which area and, in the control panel, which section. Pure, so it is unit-tested; the server
// layouts and pages enforce it, and the database enforces the same split (migration 074).

import type { AccountRole } from "@msim/engine";

/** The desk roles added for the 20 Nov night (migration 074): each opens only its own part of the control panel. */
export const DESK_ROLES = ["REGISTRATION", "JUDGE", "CRISIS"] as const;
export type DeskRole = (typeof DESK_ROLES)[number];
/** Every account role, the desk roles included. */
export type Role = AccountRole | DeskRole;

export const AREAS = {
  "/team": ["TEAM"],
  "/admin": ["ORGANISER", "FAIRNESS", ...DESK_ROLES],
  "/display": ["DISPLAY", "ORGANISER", "FAIRNESS"],
} as const satisfies Record<string, readonly Role[]>;

export type Area = keyof typeof AREAS;

/**
 * The control-panel sections (paths under /admin/<slug>) each desk role may open, its own desk first: that is where
 * it lands. A section opens its sub-pages too (/judge covers /judge/calibration). Every section not listed here,
 * including any added later, is for organisers and the fairness officer only.
 */
export const DESK_SECTIONS: Record<DeskRole, readonly string[]> = {
  REGISTRATION: ["/desk", ""],
  JUDGE: ["/judge"],
  CRISIS: ["/content"],
};

export const ROLE_LABELS: Record<Role, string> = {
  TEAM: "Team",
  ORGANISER: "Organiser",
  FAIRNESS: "Fairness officer",
  DISPLAY: "Projector",
  REGISTRATION: "Registration desk",
  JUDGE: "Judging desk",
  CRISIS: "Crisis desk",
};

export function isDeskRole(role: Role): role is DeskRole {
  return (DESK_ROLES as readonly string[]).includes(role);
}

/** What a page may let this role do (the database checks the same; migration 074). */
export type Capability = "desk" | "judge" | "content" | "organiser";
const CAN: Record<Capability, readonly Role[]> = {
  /** Check-in and check-out, the roster, the desk and registration switches. */
  desk: ["ORGANISER", "REGISTRATION"],
  /** Start judging, retry, seal missing scores, the model slot, re-runs, calibration, running the judge worker. */
  judge: ["ORGANISER", "JUDGE"],
  /** The problem and crisis decks and the Round 3 statements. */
  content: ["ORGANISER", "CRISIS"],
  /** Release scores, pause and resume, the schedule, resets, corrections, switches: everything else. */
  organiser: ["ORGANISER"],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  return role != null && CAN[capability].includes(role);
}

export function areaOf(path: string): Area | null {
  for (const area of Object.keys(AREAS) as Area[]) {
    if (path === area || path.startsWith(`${area}/`)) return area;
  }
  return null;
}

/** "/admin/night/judge/calibration?x=1" → { slug: "night", section: "/judge/calibration" }; null outside an event. */
export function adminSectionOf(path: string): { slug: string; section: string } | null {
  const m = /^\/admin\/([^/?#]+)([^?#]*)/.exec(path);
  if (!m) return null;
  return { slug: m[1]!, section: m[2]!.replace(/\/+$/, "") };
}

/** May this role open this control-panel section (a path under /admin/<slug>, "" for the overview)? */
export function canOpenSection(role: Role, section: string): boolean {
  if (role === "ORGANISER" || role === "FAIRNESS") return true;
  if (!isDeskRole(role)) return false;
  return DESK_SECTIONS[role].some((s) => (s === "" ? section === "" : section === s || section.startsWith(`${s}/`)));
}

export function canAccess(path: string, role: Role): boolean {
  const area = areaOf(path);
  if (area === null) return true;
  if (!(AREAS[area] as readonly Role[]).includes(role)) return false;
  const inEvent = area === "/admin" ? adminSectionOf(path) : null;
  return inEvent === null || canOpenSection(role, inEvent.section);
}

export function homeFor(role: Role): Area {
  if (role === "TEAM") return "/team";
  if (role === "DISPLAY") return "/display";
  return "/admin";
}

/** Where a role starts: a desk role on its own desk of the event (when one is known), everyone else at home. */
export function landingFor(role: Role, slug: string | null | undefined): string {
  if (slug && isDeskRole(role)) return `/admin/${slug}${DESK_SECTIONS[role][0]}`;
  return homeFor(role);
}

/** Where to go after login: the requested page if it is a same-site path this role may open. */
export function safeNext(next: unknown, role: Role): string {
  if (typeof next === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) && areaOf(next) && canAccess(next, role)) {
    return next;
  }
  return homeFor(role);
}
