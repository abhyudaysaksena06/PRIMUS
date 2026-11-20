// pnpm staff-sql: which logins it makes, their passwords, and the SQL's safety rules (the database run is in
// supabase/tests/roles.test.ts).

import { describe, expect, test } from "vitest";
import { derivePassword } from "../lib/credentials";
import { DEFAULT_COUNTS, PASSWORD_SCOPE, staffCounts, staffLogins, staffLoginsText, staffSql } from "../lib/staff-sql";

const SECRET = "staff-test-secret-0123456789";

describe("staff logins", () => {
  test("the default night: 10 full admins, 5 projectors, 2 registration, 1 judging and 2 crisis desks, 1 fairness officer", () => {
    const logins = staffLogins({ domain: "Primus.Example.org", secret: SECRET, counts: staffCounts({}) });
    expect(DEFAULT_COUNTS).toEqual({ full: 10, display: 5, registration: 2, judge: 1, crisis: 2, fairness: 1 });
    expect(logins).toHaveLength(21);
    const by = (role: string) => logins.filter((l) => l.role === role).map((l) => l.email);
    expect(by("ORGANISER")).toEqual(Array.from({ length: 10 }, (_, i) => `full${String(i + 1).padStart(2, "0")}@primus.example.org`));
    expect(by("DISPLAY")).toEqual(["display01", "display02", "display03", "display04", "display05"].map((e) => `${e}@primus.example.org`));
    expect(by("REGISTRATION")).toEqual(["registration01@primus.example.org", "registration02@primus.example.org"]);
    expect(by("JUDGE")).toEqual(["judge01@primus.example.org"]);
    expect(by("CRISIS")).toEqual(["crisis01@primus.example.org", "crisis02@primus.example.org"]);
    expect(by("FAIRNESS")).toEqual(["fairness01@primus.example.org"]);
    expect(logins.find((l) => l.role === "JUDGE")!.name).toBe("Judging desk 01");
    expect(new Set(logins.map((l) => l.password)).size).toBe(21);
  });

  test("passwords derive from CARD_SECRET: same secret, same passwords; another secret, others", () => {
    const counts = staffCounts({ full: "1", display: "0", registration: "0", judge: "0", crisis: "0", fairness: "0" });
    const a = staffLogins({ domain: "primus.example.org", secret: SECRET, counts });
    const b = staffLogins({ domain: "primus.example.org", secret: SECRET, counts });
    const c = staffLogins({ domain: "primus.example.org", secret: `${SECRET}-other`, counts });
    expect(a).toEqual(b);
    expect(a[0]!.password).toBe(derivePassword(SECRET, PASSWORD_SCOPE, "full01@primus.example.org"));
    expect(a[0]!.password).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    expect(c[0]!.password).not.toBe(a[0]!.password);
  });

  test("counts come from flags; bad counts and domains are refused", () => {
    expect(staffCounts({ full: "4", judge: "2" })).toEqual({ ...DEFAULT_COUNTS, full: 4, judge: 2 });
    expect(() => staffCounts({ full: "-1" })).toThrow(/whole number from 0 to 99/);
    expect(() => staffCounts({ judge: "100" })).toThrow(/whole number/);
    expect(() => staffCounts({ crisis: true })).toThrow(/got nothing/);
    expect(() => staffLogins({ domain: "not a domain", secret: SECRET, counts: DEFAULT_COUNTS })).toThrow(/--domain/);
    const none = { full: 0, display: 0, registration: 0, judge: 0, crisis: 0, fairness: 0 };
    expect(() => staffLogins({ domain: "primus.example.org", secret: SECRET, counts: none })).toThrow(/at least one/);
    expect(() => staffLogins({ domain: "primus.example.org", secret: "short", counts: DEFAULT_COUNTS })).toThrow(/CARD_SECRET/);
  });
});

describe("staff SQL", () => {
  const logins = staffLogins({ domain: "primus.example.org", secret: SECRET, counts: { full: 1, display: 1, registration: 1, judge: 1, crisis: 1, fairness: 1 } });
  const sql = staffSql(logins, "-- heading");

  test("one transaction, guarded by the schema version, never creating twice, never touching a team", () => {
    expect(sql.startsWith("-- heading\nbegin;")).toBe(true);
    expect(sql).toContain("public.schema_version() < '20261210000074'");
    expect(sql).toContain("where not exists (select 1 from auth.users u where lower(u.email) = s.email)");
    expect(sql).toContain("where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email')");
    expect(sql).toContain("on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name");
    expect(sql).toContain("where public.accounts.team_id is null");
    expect(sql).toContain("is a team login");
    expect(sql).toContain("-- Expect: ORGANISER 1, DISPLAY 1, REGISTRATION 1, JUDGE 1, CRISIS 1, FAIRNESS 1.");
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
  });

  test("quotes survive: the login list is one SQL string literal", () => {
    const odd = staffSql([{ ...logins[0]!, name: "O'Brien desk" }], "--");
    expect(odd).toContain("O''Brien desk");
  });

  test("the logins file lists every email and password by kind", () => {
    const text = staffLoginsText(logins, { domain: "primus.example.org", appUrl: "https://primus.example.org/", secretNote: "note" });
    expect(text).toContain("Sign in at https://primus.example.org/login with Staff");
    expect(text).toContain("Judging desk (JUDGE), 1:");
    for (const l of logins) expect(text).toContain(`${l.email.padEnd(32)} ${l.password}`);
    expect(text.trim().endsWith("note")).toBe(true);
  });
});
