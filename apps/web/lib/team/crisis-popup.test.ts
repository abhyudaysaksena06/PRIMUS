import { describe, expect, test } from "vitest";
import { SHOW_FOR_MS, cardKey, cardLine, popupNow, revealKey, revealLines, type RevealNotice, type SplashCard } from "./crisis-popup";

const revealedAt = "2026-11-20T17:15:00.000Z"; // 22:45 IST
const t0 = Date.parse(revealedAt);
const card: SplashCard = { eventId: "e", teamId: "t", k: 2, category: "Market", title: "Demand halves", body: "Sales fall.", revealedAt };
const reveal: RevealNotice = {
  eventId: "e",
  teamId: "t",
  k: 2,
  revealedAt,
  category: "Market",
  cardsOpenAt: "2026-11-20T17:35:00.000Z", // 23:05
  tradingAt: "2026-11-20T17:20:00.000Z", // 22:50
};
const never = () => false;

describe("crisis_popup off: as before", () => {
  test("the card in the first two minutes after the reveal, once", () => {
    expect(popupNow({ card, reveal: null, popups: false }, t0 + 1000, never)).toEqual({ kind: "card", card });
    expect(popupNow({ card, reveal: null, popups: false }, t0 + SHOW_FOR_MS + 1, never)).toBeNull();
    expect(popupNow({ card, reveal: null, popups: false }, t0 - 1, never)).toBeNull();
    expect(popupNow({ card, reveal: null, popups: false }, t0 + 1000, (k) => k === cardKey(card))).toBeNull();
    // Sealed cards: no card yet, nothing (the reveal is not shown without the switch).
    expect(popupNow({ card: null, reveal, popups: false }, t0 + 1000, never)).toBeNull();
    expect(cardLine(true, null)).toBe("This is your company's card. Every share price just fell 5%.");
  });
});

describe("crisis_popup on", () => {
  test("the reveal for every team in its first two minutes, once", () => {
    expect(popupNow({ card: null, reveal, popups: true }, t0 + 5_000, never)).toEqual({ kind: "reveal", reveal });
    expect(popupNow({ card: null, reveal, popups: true }, t0 + SHOW_FOR_MS + 1, never)).toBeNull();
    expect(popupNow({ card: null, reveal, popups: true }, t0 + 5_000, (k) => k === revealKey(reveal))).toBeNull();
    expect(revealKey(reveal)).not.toBe(cardKey(card));
  });

  test("the card the first time it can be read, at any time while its crisis is current; then the reveal is old news", () => {
    expect(popupNow({ card, reveal: null, popups: true }, t0 + 30 * 60_000, never)).toEqual({ kind: "card", card });
    expect(popupNow({ card, reveal, popups: true }, t0 + 5_000, never)).toEqual({ kind: "card", card });
    expect(popupNow({ card, reveal: null, popups: true }, t0 + 30 * 60_000, (k) => k === cardKey(card))).toBeNull();
  });

  test("the words: the crisis and its category, the 5% fall and the halt, when the cards open (per track)", () => {
    expect(revealLines(reveal, "PRODUCT")).toEqual({
      title: "Crisis 2 of 4: Market",
      lines: ["Every price fell 5% and trading is halted for 5 minutes, until 22:50.", "Your company's card opens when hiring closes at 23:05. Hire your firm before then."],
    });
    expect(revealLines(reveal, "CONSULTING").lines[1]).toBe("The companies' cards open when hiring closes at 23:05. Win your clients before then.");
    expect(revealLines(reveal, "FINANCE").lines[1]).toBe("Every company's card opens when hiring closes at 23:05.");
    const bare = revealLines({ k: 3, category: null, cardsOpenAt: null, tradingAt: null }, "PRODUCT");
    expect(bare).toEqual({ title: "Crisis 3 of 4", lines: ["Every price fell 5% and trading is halted for 5 minutes.", "Your company's card opens when hiring closes. Hire your firm before then."] });
    expect(cardLine(true, { dueAt: "2026-11-20T18:20:00.000Z" })).toBe("This is your company's card. Hiring has closed: your response plan is due at 23:50.");
    expect(cardLine(false, { dueAt: null })).toBe("This is your squad's company's card. Every company's card is open now in the crisis room.");
  });
});
