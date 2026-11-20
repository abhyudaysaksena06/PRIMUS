import { describe, expect, test } from "vitest";
import { adminSectionOf, areaOf, can, canAccess, canOpenSection, homeFor, landingFor, ROLE_LABELS, safeNext, type Role } from "./routes";

describe("route access by role", () => {
  test("each role has a home", () => {
    expect(homeFor("TEAM")).toBe("/team");
    expect(homeFor("ORGANISER")).toBe("/admin");
    expect(homeFor("FAIRNESS")).toBe("/admin");
    expect(homeFor("DISPLAY")).toBe("/display");
    expect(homeFor("REGISTRATION")).toBe("/admin");
    expect(homeFor("JUDGE")).toBe("/admin");
    expect(homeFor("CRISIS")).toBe("/admin");
  });

  test("teams cannot open the control panel or the projector view", () => {
    expect(canAccess("/team/orders", "TEAM")).toBe(true);
    expect(canAccess("/admin", "TEAM")).toBe(false);
    expect(canAccess("/admin/judge", "TEAM")).toBe(false);
    expect(canAccess("/display", "TEAM")).toBe(false);
  });

  test("the display account sees only the display", () => {
    expect(canAccess("/display", "DISPLAY")).toBe(true);
    expect(canAccess("/admin", "DISPLAY")).toBe(false);
    expect(canAccess("/team", "DISPLAY")).toBe(false);
  });

  test("organisers and the fairness officer use the control panel and may open the display, not the team portal", () => {
    for (const role of ["ORGANISER", "FAIRNESS"] as const) {
      expect(canAccess("/admin/fairness", role)).toBe(true);
      expect(canAccess("/admin/night/ledger", role)).toBe(true);
      expect(canAccess("/display", role)).toBe(true);
      expect(canAccess("/team", role)).toBe(false);
    }
  });

  test("area matching is by path segment", () => {
    expect(areaOf("/teams")).toBeNull();
    expect(areaOf("/administrator")).toBeNull();
    expect(areaOf("/team")).toBe("/team");
  });

  test("next= after login: same-site paths of the role's own area only", () => {
    expect(safeNext("/team/orders", "TEAM")).toBe("/team/orders");
    expect(safeNext("/admin", "TEAM")).toBe("/team");
    expect(safeNext("//evil.example.com", "TEAM")).toBe("/team");
    expect(safeNext("https://evil.example.com/team", "TEAM")).toBe("/team");
    expect(safeNext("/\\evil.example.com", "TEAM")).toBe("/team");
    expect(safeNext(undefined, "ORGANISER")).toBe("/admin");
  });
});

describe("desk roles in the control panel", () => {
  const SECTIONS = ["", "/run", "/schedule", "/product", "/consulting", "/finance", "/desk", "/lottery", "/rounds", "/judge",
    "/judge/calibration", "/bulletins", "/content", "/ledger", "/ledger/corrections", "/fairness", "/chats", "/exports",
    "/health", "/leaderboard", "/backups"];
  const opens = (role: Role) => SECTIONS.filter((s) => canOpenSection(role, s));

  test("each desk opens only its own sections (and nothing added later)", () => {
    expect(opens("REGISTRATION")).toEqual(["", "/desk"]);
    expect(opens("JUDGE")).toEqual(["/judge", "/judge/calibration"]);
    expect(opens("CRISIS")).toEqual(["/content"]);
    expect(opens("ORGANISER")).toEqual(SECTIONS);
    expect(opens("FAIRNESS")).toEqual(SECTIONS);
    expect(opens("DISPLAY")).toEqual([]);
    expect(opens("TEAM")).toEqual([]);
  });

  test("section matching is by path segment", () => {
    expect(canOpenSection("JUDGE", "/judges")).toBe(false);
    expect(canOpenSection("CRISIS", "/contentious")).toBe(false);
    expect(canOpenSection("REGISTRATION", "/desk/anything")).toBe(true);
  });

  test("paths: the event list, an event's sections, and the projector", () => {
    for (const role of ["REGISTRATION", "JUDGE", "CRISIS"] as const) {
      expect(canAccess("/admin", role)).toBe(true); // the list of events
      expect(canAccess("/display", role)).toBe(false);
      expect(canAccess("/team", role)).toBe(false);
      expect(canAccess("/admin/night/run", role)).toBe(false);
      expect(canAccess("/admin/night/ledger?tab=x", role)).toBe(false);
    }
    expect(canAccess("/admin/night/desk", "REGISTRATION")).toBe(true);
    expect(canAccess("/admin/night", "REGISTRATION")).toBe(true);
    expect(canAccess("/admin/night/", "REGISTRATION")).toBe(true);
    expect(canAccess("/admin/night/judge/calibration?batch=2", "JUDGE")).toBe(true);
    expect(canAccess("/admin/night", "JUDGE")).toBe(false);
    expect(canAccess("/admin/night/content", "CRISIS")).toBe(true);
    expect(adminSectionOf("/admin/night/judge/calibration?batch=2")).toEqual({ slug: "night", section: "/judge/calibration" });
    expect(adminSectionOf("/admin")).toBeNull();
  });

  test("each desk lands on its own page; next= may not send it elsewhere", () => {
    expect(landingFor("REGISTRATION", "night")).toBe("/admin/night/desk");
    expect(landingFor("JUDGE", "night")).toBe("/admin/night/judge");
    expect(landingFor("CRISIS", "night")).toBe("/admin/night/content");
    expect(landingFor("JUDGE", null)).toBe("/admin");
    expect(landingFor("ORGANISER", "night")).toBe("/admin");
    expect(landingFor("DISPLAY", "night")).toBe("/display");
    expect(safeNext("/admin/night/judge?type=plan", "JUDGE")).toBe("/admin/night/judge?type=plan");
    expect(safeNext("/admin/night/run", "JUDGE")).toBe("/admin");
    expect(safeNext("/display", "CRISIS")).toBe("/admin");
  });

  test("what each role may do on its page", () => {
    expect(can("REGISTRATION", "desk")).toBe(true);
    expect(can("REGISTRATION", "judge")).toBe(false);
    expect(can("JUDGE", "judge")).toBe(true);
    expect(can("JUDGE", "organiser")).toBe(false);
    expect(can("CRISIS", "content")).toBe(true);
    expect(can("CRISIS", "desk")).toBe(false);
    for (const c of ["desk", "judge", "content", "organiser"] as const) {
      expect(can("ORGANISER", c)).toBe(true);
      expect(can("FAIRNESS", c)).toBe(false);
      expect(can("TEAM", c)).toBe(false);
      expect(can(null, c)).toBe(false);
    }
    expect(ROLE_LABELS.JUDGE).toBe("Judging desk");
  });
});
