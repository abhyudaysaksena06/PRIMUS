// Equity as the teams talk about it: a company has 100,000 shares, so 1% is 1,000 shares and 0.01% is 10. A stake's
// money value is never typed: it is shares × the company's current price, as the exchange works it out.

export const COMPANY_SHARES = 100_000;
export const SHARES_PER_PCT = COMPANY_SHARES / 100;

/** "5" or "5.25" (percent) → shares, or null if it is not a percentage with at most two decimals. */
export function parsePct(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[%\s]/g, "");
  if (s === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const shares = Math.round(Number(s) * SHARES_PER_PCT);
  return shares <= COMPANY_SHARES ? shares : null;
}

export const pctOf = (shares: number) => shares / SHARES_PER_PCT;

/** "5% (5,000 shares)", "0.25% (250 shares)". */
export function equityText(shares: number): string {
  const pct = pctOf(shares);
  const p = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, "");
  return `${p}% (${shares.toLocaleString("en-US")} ${shares === 1 ? "share" : "shares"})`;
}

/** The value of a stake at a price in cents per share, in cents; null without a price. */
export const stakeValue = (shares: number, priceCents: number | null | undefined): number | null =>
  priceCents === null || priceCents === undefined ? null : shares * priceCents;
