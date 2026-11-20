import { describe, expect, test } from "vitest";
import { PASSWORD_ALPHABET } from "@msim/engine";
import { derivePassword } from "../lib/credentials";
import { parseCsv } from "../lib/csv";
import { MAX_TEAMS_PER_TRACK, buildSeedPlan, staffFromCsv, teamRowsFromCsv, toSeedPayload } from "../lib/seed-plan";

const SECRET = "test-secret-0123456789";
const base = {
  slug: "live-2026",
  name: "Market Simulation 2026",
  rehearsal: false,
  clockSpeed: 1,
  startsAt: new Date("2026-11-14T14:30:00Z"),
  teamsPerTrack: 50,
  cardSecret: SECRET,
  emailDomain: "teams.example.org",
};

describe("csv", () => {
  test("quotes, escaped quotes, embedded commas and newlines", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n"multi\nline",z\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["multi\nline", "z"],
    ]);
  });
  test("skips blank lines and a BOM", () => {
    expect(parseCsv("﻿a\n\n b \n")).toEqual([["a"], [" b "]]);
  });
});

describe("derived passwords", () => {
  test("are stable, formatted and use the unambiguous alphabet", () => {
    const p = derivePassword(SECRET, "live-2026", "P01");
    expect(p).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(p).toBe(derivePassword(SECRET, "live-2026", "P01"));
    for (const ch of p.replace(/-/g, "")) expect(PASSWORD_ALPHABET).toContain(ch);
  });
  test("differ by team, event and secret", () => {
    const p = derivePassword(SECRET, "live-2026", "P01");
    expect(derivePassword(SECRET, "live-2026", "P02")).not.toBe(p);
    expect(derivePassword(SECRET, "rehearsal", "P01")).not.toBe(p);
    expect(derivePassword(`${SECRET}x`, "live-2026", "P01")).not.toBe(p);
  });
  test("refuse a short secret", () => {
    expect(() => derivePassword("short", "e", "P01")).toThrow(/at least 16/);
  });
});

describe("seed plan", () => {
  test("150 teams: 50 per track, codes P01–P50, C01–C50, F01–F50, unique logins", () => {
    const plan = buildSeedPlan(base);
    expect(plan.teams).toHaveLength(150);
    for (const track of ["PRODUCT", "CONSULTING", "FINANCE"] as const) {
      expect(plan.teams.filter((t) => t.track === track)).toHaveLength(50);
    }
    expect(plan.teams[0]!.code).toBe("P01");
    expect(plan.teams[149]!.code).toBe("F50");
    expect(new Set(plan.teams.map((t) => t.email)).size).toBe(150);
    expect(new Set(plan.teams.map((t) => t.password)).size).toBe(150);
    expect(plan.teams.find((t) => t.code === "C07")!.email).toBe("c07@teams.example.org");
  });

  test("starting cash: Finance $500,000, others $0", () => {
    const plan = buildSeedPlan(base);
    expect(plan.starting_cash_cents).toEqual({ PRODUCT: 0, CONSULTING: 0, FINANCE: 50_000_000 });
  });

  test("3 to 200 teams per track, live or rehearsal; a rehearsal is prefixed X", () => {
    expect(buildSeedPlan({ ...base, teamsPerTrack: 10 }).teams).toHaveLength(30);
    for (const bad of [2, 201, 50.5]) expect(() => buildSeedPlan({ ...base, teamsPerTrack: bad })).toThrow(/between 3 and 200/);
    const plan = buildSeedPlan({ ...base, slug: "rehearsal-1", rehearsal: true, clockSpeed: 10, teamsPerTrack: 4 });
    expect(plan.teams.map((t) => t.code).slice(0, 4)).toEqual(["XP01", "XP02", "XP03", "XP04"]);
    expect(plan.event.clock_speed).toBe(10);
  });

  test("200 per track: 600 teams, codes P01–P200 with unique logins and passwords", () => {
    const plan = buildSeedPlan({ ...base, teamsPerTrack: MAX_TEAMS_PER_TRACK });
    expect(MAX_TEAMS_PER_TRACK).toBe(200);
    expect(plan.teams).toHaveLength(600);
    const product = plan.teams.filter((t) => t.track === "PRODUCT").map((t) => t.code);
    expect([product[0], product[8], product[9], product[98], product[99], product[199]]).toEqual(["P01", "P09", "P10", "P99", "P100", "P200"]);
    expect(plan.teams.find((t) => t.code === "F150")!.email).toBe("f150@teams.example.org");
    expect(new Set(plan.teams.map((t) => t.email)).size).toBe(600);
    expect(new Set(plan.teams.map((t) => t.password)).size).toBe(600);
  });

  test("team names and members come from the CSV in order; the rest get placeholders", () => {
    const rows = teamRowsFromCsv(
      "track,team_name,member1_name,member1_roll,member2_name,member2_roll\n" +
        "finance,Delta Capital,Asha Rao,R100,Ben Ali,R101\n" +
        "Product,AquaSense team,Chen Li,R102,,\n",
    );
    const plan = buildSeedPlan({ ...base, teamRows: rows });
    const f01 = plan.teams.find((t) => t.code === "F01")!;
    expect(f01.name).toBe("Delta Capital");
    expect(f01.members).toEqual([
      { full_name: "Asha Rao", roll_number: "R100" },
      { full_name: "Ben Ali", roll_number: "R101" },
    ]);
    expect(plan.teams.find((t) => t.code === "P01")!.name).toBe("AquaSense team");
    expect(plan.teams.find((t) => t.code === "F02")!.name).toBe("Finance Team F02");
  });

  test("an organiser cannot also be a team member", () => {
    const rows = teamRowsFromCsv("track,team_name,member1_name,member1_roll\nfinance,Delta,Asha Rao,R100\n");
    const staff = staffFromCsv("email,role,name,roll_number\nasha@college.edu,ORGANISER,Asha Rao,R100\n");
    expect(() => buildSeedPlan({ ...base, teamRows: rows, staff })).toThrow(/organisers cannot belong to a team/);
  });

  test("a roll number cannot be in two teams", () => {
    const rows = teamRowsFromCsv("track,team_name,member1_name,member1_roll\nfinance,A,X,R1\nproduct,B,Y,R1\n");
    expect(() => buildSeedPlan({ ...base, teamRows: rows })).toThrow(/more than one team/);
  });

  test("bad CSV values are rejected with the row number", () => {
    expect(() => teamRowsFromCsv("track,team_name\nmarketing,X\n")).toThrow(/row 2/);
    expect(() => staffFromCsv("email,role,name\na@b.co,BOSS,A\n")).toThrow(/row 2/);
  });

  test("payload needs an auth user for every login", () => {
    const plan = buildSeedPlan({ ...base, slug: "rh", rehearsal: true, teamsPerTrack: 3 });
    expect(() => toSeedPayload(plan, new Map())).toThrow(/no auth user/);
    const ids = new Map(plan.teams.map((t, i) => [t.email, `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`]));
    const payload = toSeedPayload(plan, ids);
    expect(payload.teams).toHaveLength(9);
    expect(payload.teams[0]).not.toHaveProperty("password");
  });
});

describe("command-line options", () => {
  test("a live event defaults to 200 cards per track, a rehearsal to 50; --teams-per-track overrides", async () => {
    process.env.CARD_SECRET ??= SECRET;
    process.env.TEAM_EMAIL_DOMAIN ??= "teams.example.org";
    const { optionsFromArgs } = await import("../lib/event-options");
    expect(optionsFromArgs({ slug: "live-2026", date: "2026-11-20" }).teamsPerTrack).toBe(200);
    expect(optionsFromArgs({ slug: "rh-1", "starts-at": "2026-11-20T10:00:00Z", rehearsal: true }).teamsPerTrack).toBe(50);
    const o = optionsFromArgs({ slug: "live-2026", date: "2026-11-20", "teams-per-track": "167" });
    expect(o.teamsPerTrack).toBe(167);
    expect(buildSeedPlan(o).teams).toHaveLength(501);
  });
});
