// Tonight's hire lists (migration 071): which firms and companies are still open to hire in a sub-round, and how a
// firm's base rate, its minimum bid and an assignment by the draw read. Pure: the pages are rendered on the server, so
// when a hire is locked (the event-wide hire_locked message makes every screen re-read) a hired company or a full
// firm is gone from every list within seconds. The database checks every rule again.

import { FIRM_CLIENTS_PER_SUBROUND, termsText } from "./crisis";
import { SHARES_PER_PCT, equityText } from "./equity";

/** A base rate in basis points as a percentage: 240 → "2.4%", 200 → "2%", 244 → "2.44%". */
export function rateText(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

/** The shares a base rate is of a company's 100,000 (1% = 1,000 shares). */
export const rateShares = (bp: number) => Math.round((bp * SHARES_PER_PCT) / 100);

/** "about $30,900": a minimum in cents, rounded up to the next $100, as the exchange says it when it refuses an offer. */
export function aboutText(cents: number): string {
  return `about $${(Math.ceil(cents / 10_000) * 100).toLocaleString("en-US")}`;
}

/** "2.4% (2,400 shares), about $30,900": a firm's minimum bid for a company at its price (no dollars without a price). */
export function minBidText(bp: number, priceCents: number | null | undefined): string {
  const shares = rateShares(bp);
  return priceCents ? `${equityText(shares)}, ${aboutText(shares * priceCents)}` : equityText(shares);
}

/** How many clients each firm has in sub-round k. */
export function clientsIn(engagements: readonly { firm_team_id: string; k: number }[], k: number): Map<string, number> {
  const n = new Map<string, number>();
  for (const e of engagements) if (e.k === k) n.set(e.firm_team_id, (n.get(e.firm_team_id) ?? 0) + 1);
  return n;
}

/**
 * The firms a company can still choose from in sub-round k: a full firm (2 clients) is left out, not shown with a
 * badge. Outside a sub-round every firm is listed.
 */
export function openFirms<F extends { team_id: string }>(firms: readonly F[], engagements: readonly { firm_team_id: string; k: number }[], k: number | null): F[] {
  if (k === null) return [...firms];
  const taken = clientsIn(engagements, k);
  return firms.filter((f) => (taken.get(f.team_id) ?? 0) < FIRM_CLIENTS_PER_SUBROUND);
}

/** The companies a firm can still pitch in sub-round k: not hired yet, and no open offer of its own with them already. */
export function pitchableCompanies<C extends { id: string }>(
  companies: readonly C[],
  engagements: readonly { company_id: string; k: number }[],
  offers: readonly { company_id: string; firm_team_id: string; k: number; status: string }[],
  k: number,
  firmId: string,
): C[] {
  const hired = new Set(engagements.filter((e) => e.k === k).map((e) => e.company_id));
  const open = new Set(offers.filter((o) => o.k === k && o.firm_team_id === firmId && o.status === "OPEN").map((o) => o.company_id));
  return companies.filter((c) => !hired.has(c.id) && !open.has(c.id));
}

export interface AssignedEngagement {
  assigned: boolean;
  cash_cents: number;
  shares: number;
}

/**
 * Was this engagement placed by the draw (switch hire_base_rate)? Only the draw pays a fee in shares; a draw fee paid
 * in cash (the company was at its floor) is told apart by the switch being on.
 */
export const byDraw = (e: AssignedEngagement, drawOn: boolean) => e.assigned && (e.shares > 0 || drawOn);

/** The rate an assignment by the draw was made at: exact from the fee shares, else the firm's rate now. */
export const drawRate = (e: AssignedEngagement, firmRate: number | null) => (e.shares > 0 ? e.shares / (SHARES_PER_PCT / 100) : firmRate);

/** What the company reads about a firm it did not choose (null for a hire it made itself). */
export function assignedToCompany(e: AssignedEngagement, firmCode: string, fee: string, firmRate: number | null, drawOn: boolean): string | null {
  if (!e.assigned) return null;
  if (!byDraw(e, drawOn)) return `Assigned by the exchange: ${firmCode} for ${termsText(fee, e.shares)}, because you had not hired when hiring closed.`;
  const bp = drawRate(e, firmRate);
  const base = `Assigned by the draw: ${firmCode}${bp === null ? "" : ` at ${rateText(bp)} (its base rate)`}.`;
  return e.shares > 0 ? base : `${base} Paid in cash, ${fee}, because your company is at its 40,000-share floor.`;
}

/** What the firm reads about a client it did not win in the market (null for a client it won). */
export function assignedToFirm(e: AssignedEngagement, ticker: string, myRate: number | null, drawOn: boolean): string | null {
  if (!e.assigned) return null;
  if (!byDraw(e, drawOn)) return `You were assigned ${ticker} when hiring closed.`;
  const bp = drawRate(e, myRate);
  return `You were assigned ${ticker} by the draw${bp === null ? "" : `, at your base rate (${rateText(bp)})`}.`;
}
