// The crisis pop-ups' decisions (app/team/crisis-splash.tsx draws them). Pure, so the server (which reads the data) and
// the tests share them.
//
// Switch crisis_popup off: the card full-screen in the first two minutes after the reveal, as before (since the
// cards are sealed until hiring closes, migration 063, it then shows only if hiring closes that quickly). On, two
// pop-ups, each once per team per crisis on a browser:
//  1. the reveal, for every team in the first two minutes: the crisis, its category, the 5% fall, the 5-minute
//     trading halt and when the cards open (hiring closes);
//  2. the card, the first time the team can read it (hiring has closed), while that crisis is the current one.

import type { Track } from "@msim/engine";
import { clock } from "@/lib/format";

export interface SplashCard {
  eventId: string;
  /** Remembered per team: several teams may share a laptop. */
  teamId: string;
  k: number;
  category: string;
  title: string;
  body: string;
  revealedAt: string;
}

/** The reveal of crisis k (1–4): what every team is told before any card can be read. */
export interface RevealNotice {
  eventId: string;
  teamId: string;
  k: number;
  revealedAt: string;
  /** The category every company shares in this crisis (the sector deck), or null when they differ. */
  category: string | null;
  /** HIRE_k: when hiring closes and the cards open. */
  cardsOpenAt: string | null;
  /** When trading opens again after the halt (the next round), if known. */
  tradingAt: string | null;
}

/** Switch crisis_popup on: the reveal to announce and the team's track (the card itself comes separately). */
export interface CrisisPopups {
  reveal: RevealNotice | null;
  track: Track;
  /** DUE_k of the current crisis, for "your response plan is due at". */
  dueAt: string | null;
}

/** A pop-up shows in the first two minutes after the reveal. */
export const SHOW_FOR_MS = 120_000;

/** localStorage keys: the card's is the one used before the switch, so a card seen then is not shown again. */
export const cardKey = (c: { eventId: string; teamId: string; k: number }) => `msim:crisis-splash:${c.eventId}:${c.teamId}:${c.k}`;
export const revealKey = (r: { eventId: string; teamId: string; k: number }) => `msim:crisis-reveal:${r.eventId}:${r.teamId}:${r.k}`;

export type Popup = { kind: "reveal"; reveal: RevealNotice } | { kind: "card"; card: SplashCard };

/** Which pop-up to show now, if any. `seen` says whether a key was closed on this browser. */
export function popupNow(input: { card: SplashCard | null; reveal: RevealNotice | null; popups: boolean }, now: number, seen: (key: string) => boolean): Popup | null {
  const { card, reveal, popups } = input;
  if (!popups) {
    // Before the switch: the card, in the first two minutes after the reveal.
    if (!card || seen(cardKey(card))) return null;
    const age = now - Date.parse(card.revealedAt);
    return age < 0 || age > SHOW_FOR_MS ? null : { kind: "card", card };
  }
  // The card first: once it can be read, the reveal ("your card opens at …") is old news.
  if (card) return seen(cardKey(card)) ? null : { kind: "card", card };
  if (reveal && !seen(revealKey(reveal))) {
    const age = now - Date.parse(reveal.revealedAt);
    if (age >= 0 && age <= SHOW_FOR_MS) return { kind: "reveal", reveal };
  }
  return null;
}

/** The words of the reveal pop-up for a track. */
export function revealLines(r: Pick<RevealNotice, "k" | "category" | "cardsOpenAt" | "tradingAt">, track: Track): { title: string; lines: string[] } {
  const title = `Crisis ${r.k} of 4${r.category ? `: ${r.category}` : ""}`;
  const halt = `Every price fell 5% and trading is halted for 5 minutes${r.tradingAt ? `, until ${clock(r.tradingAt)}` : ""}.`;
  const at = r.cardsOpenAt ? ` at ${clock(r.cardsOpenAt)}` : "";
  const cards =
    track === "PRODUCT"
      ? `Your company's card opens when hiring closes${at}. Hire your firm before then.`
      : track === "CONSULTING"
        ? `The companies' cards open when hiring closes${at}. Win your clients before then.`
        : `Every company's card opens when hiring closes${at}.`;
  return { title, lines: [halt, cards] };
}

/** The line under the card: whose card it is and, with the switch on, what comes next. */
export function cardLine(own: boolean, popups: Pick<CrisisPopups, "dueAt"> | null): string {
  if (!popups) return `${own ? "This is your company's card." : "This is your squad's company's card."} Every share price just fell 5%.`;
  return own
    ? `This is your company's card. Hiring has closed${popups.dueAt ? `: your response plan is due at ${clock(popups.dueAt)}` : ""}.`
    : "This is your squad's company's card. Every company's card is open now in the crisis room.";
}
