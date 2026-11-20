import { describe, expect, test } from "vitest";
import { eventToast } from "./alerts";
import {
  aboutText,
  assignedToCompany,
  assignedToFirm,
  byDraw,
  clientsIn,
  minBidText,
  openFirms,
  pitchableCompanies,
  rateShares,
  rateText,
} from "./hire-lists";

const firm = (id: string) => ({ team_id: id, code: id });
const eng = (k: number, company: string, firmId: string) => ({ k, company_id: company, firm_team_id: firmId });

describe("base rate and minimum bid in words", () => {
  test("a rate in basis points reads as a percentage of the company's 100,000 shares", () => {
    expect(rateText(200)).toBe("2%");
    expect(rateText(240)).toBe("2.4%");
    expect(rateText(244)).toBe("2.44%");
    expect(rateText(100)).toBe("1%");
    expect(rateText(400)).toBe("4%");
    expect(rateShares(244)).toBe(2440);
    expect(rateShares(100)).toBe(1000);
  });

  test("the minimum in dollars is rounded up to the next $100, as the exchange's refusal says it", () => {
    expect(aboutText(3_088_800)).toBe("about $30,900"); // $30,888.00
    expect(aboutText(3_090_000)).toBe("about $30,900");
    expect(aboutText(3_090_001)).toBe("about $31,000");
    expect(minBidText(240, 1287)).toBe("2.4% (2,400 shares), about $30,900");
    expect(minBidText(200, null)).toBe("2% (2,000 shares)");
  });
});

describe("hire lists: locked = gone", () => {
  const firms = [firm("C01"), firm("C02"), firm("C03")];
  const engagements = [eng(1, "A", "C01"), eng(1, "B", "C01"), eng(1, "C", "C02"), eng(2, "D", "C03"), eng(2, "E", "C03")];

  test("a firm with two clients in the sub-round is not listed; other sub-rounds do not count", () => {
    expect(clientsIn(engagements, 1)).toEqual(new Map([["C01", 2], ["C02", 1]]));
    expect(openFirms(firms, engagements, 1).map((f) => f.code)).toEqual(["C02", "C03"]);
    expect(openFirms(firms, engagements, 2).map((f) => f.code)).toEqual(["C01", "C02"]);
    expect(openFirms(firms, engagements, null).map((f) => f.code)).toEqual(["C01", "C02", "C03"]);
  });

  test("a firm can pitch only companies that have not hired and that it has no open offer with", () => {
    const companies = ["A", "B", "C", "F", "G", "H"].map((id) => ({ id }));
    const offers = [
      { company_id: "F", firm_team_id: "C03", k: 1, status: "OPEN" },
      { company_id: "G", firm_team_id: "C03", k: 1, status: "DECLINED" },
      { company_id: "H", firm_team_id: "C02", k: 1, status: "OPEN" },
    ];
    expect(pitchableCompanies(companies, engagements, offers, 1, "C03").map((c) => c.id)).toEqual(["G", "H"]);
    expect(pitchableCompanies(companies, engagements, offers, 2, "C03").map((c) => c.id)).toEqual(["A", "B", "C", "F", "G", "H"]);
  });
});

describe("assigned by the draw", () => {
  const shares = { assigned: true, cash_cents: 0, shares: 2400 };
  const cash = { assigned: true, cash_cents: 3_088_800, shares: 0 };
  const old = { assigned: true, cash_cents: 2_250_000, shares: 0 };
  const hired = { assigned: false, cash_cents: 50_000, shares: 0 };

  test("the company reads which firm the draw gave it and at what rate; a hire it made itself says nothing", () => {
    expect(byDraw(shares, false)).toBe(true); // only the draw pays in shares
    expect(assignedToCompany(shares, "C07", "$0.00", 300, true)).toBe("Assigned by the draw: C07 at 2.4% (its base rate).");
    expect(assignedToCompany(cash, "C07", "$30,888.00", 240, true)).toBe(
      "Assigned by the draw: C07 at 2.4% (its base rate). Paid in cash, $30,888.00, because your company is at its 40,000-share floor.",
    );
    expect(assignedToCompany(old, "C07", "$22,500.00", 240, false)).toBe("Assigned by the exchange: C07 for $22,500.00, because you had not hired when hiring closed.");
    expect(assignedToCompany(hired, "C07", "$500.00", 240, true)).toBeNull();
  });

  test("the firm reads which company it was given (not that a company sent it an offer)", () => {
    expect(assignedToFirm(shares, "HAA", 300, true)).toBe("You were assigned HAA by the draw, at your base rate (2.4%).");
    expect(assignedToFirm(old, "HAA", 240, false)).toBe("You were assigned HAA when hiring closed.");
    expect(assignedToFirm(hired, "HAA", 240, true)).toBeNull();
  });

  test("toasts: the firm hears 'You were assigned … by the draw', the company which firm at which rate", () => {
    const draw = { assigned: true, draw: true, k: 1, ticker: "HAA", firm_code: "C07", base_rate_bp: 240 };
    expect(eventToast("offers", draw, "CONSULTING")).toMatchObject({ text: "You were assigned HAA by the draw: write its memo.", href: "/team/crisis", loud: true });
    expect(eventToast("offers", draw, "PRODUCT")).toMatchObject({ text: "Assigned by the draw: C07 at 2.4% (its base rate).", href: "/team/crisis" });
    // Switch off (the exchange's least-busy rule): the message carries no names.
    expect(eventToast("offers", { assigned: true }, "CONSULTING")).toMatchObject({ text: "You were assigned a client: write its memo." });
    expect(eventToast("offers", { assigned: true }, "PRODUCT")).toMatchObject({ text: "Hiring closed: you were given a firm." });
    expect(eventToast("offers", draw, "FINANCE")).toBeNull();
    // A real offer still reads as one.
    expect(eventToast("offers", {}, "CONSULTING")).toMatchObject({ text: "A company sent you an offer." });
    // hire_locked only makes screens re-read: no toast.
    expect(eventToast("hire_locked", { k: 1, company: "x", firm: "y", firm_full: true }, "PRODUCT")).toBeNull();
  });
});
