"use client";

// The crisis pop-ups (decisions in lib/team/crisis-popup.ts). Switch crisis_popup off: the company's card full-screen
// in the first two minutes after the reveal, as before. On: the reveal for every team (the crisis, the 5% fall, the
// trading halt and when the cards open), then the card the first time the team can read it (hiring has closed).
// Each once per team per crisis on this browser.

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Track } from "@msim/engine";
import { useServerNow } from "@/lib/live/clock";
import { cardKey, cardLine, popupNow, revealKey, revealLines, type CrisisPopups, type RevealNotice, type SplashCard } from "@/lib/team/crisis-popup";
import { Glyph } from "@/components/ui/matrix/glyph";
import { crisisParts } from "./crisis-focus-card";

export type { CrisisPopups, RevealNotice, SplashCard };

// "Seen" lives in localStorage (an outside store): read on the client; the server renders it as seen (nothing).
const subscribe = (on: () => void) => {
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
};
function readSeen(k: string): boolean {
  if (!k) return true;
  try {
    return window.localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
}

export function CrisisSplash({ card, own, popups = null }: { card: SplashCard | null; own: boolean; popups?: CrisisPopups | null }) {
  const now = useServerNow(1000);
  const reveal = popups?.reveal ?? null;
  const keys = [card ? cardKey(card) : "", reveal ? revealKey(reveal) : ""];
  // Both keys' "seen" flags as one string, so the snapshot is stable between renders.
  const stored = useSyncExternalStore(
    subscribe,
    () => keys.map((k) => (readSeen(k) ? "1" : "0")).join(""),
    () => "11",
  );
  const [closed, setClosed] = useState<string[]>([]);
  const seen = (k: string) => closed.includes(k) || stored[keys.indexOf(k)] !== "0";
  const show = popupNow({ card, reveal, popups: popups !== null }, now, seen);
  if (!show) return null;
  const key = show.kind === "card" ? cardKey(show.card) : revealKey(show.reveal);
  const close = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* private window: it simply closes */
    }
    setClosed((c) => [...c, key]);
  };
  const k = show.kind === "card" ? show.card.k : show.reveal.k;
  // The demo's pop-up (app/demo/rescue): a dimmed backdrop and one of the demo's panels, the crisis in its alerts and
  // the demo's buttons.
  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={k === 5 ? "Round 3" : `Crisis ${k}`}
      data-testid="crisis-splash"
      data-kind={show.kind}
    >
      {/* A long card (one with a twist) scrolls on a small phone instead of being cut off. */}
      <div className="flex min-h-full items-center justify-center">
        <section className="guide-panel guide-popup">
          <div className="guide-panel-head">
            <h2>
              <Glyph e="🚨" /> {show.kind === "card" ? (show.card.k === 5 ? "Round 3" : `Crisis ${show.card.k} of 4`) : "New crisis"}
            </h2>
            <span>{show.kind === "card" ? show.card.category.toUpperCase() : "LIVE · ALL TRACKS"}</span>
          </div>
          <div className="guide-panel-body">
            {show.kind === "card" ? <CardBody card={show.card} line={cardLine(own, popups)} /> : <RevealBody reveal={show.reveal} track={popups!.track} />}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/team/crisis" onClick={close} className="guide-btn">
                Open the crisis room →
              </Link>
              <button type="button" onClick={close} className="guide-btn secondary">
                Got it
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CardBody({ card, line }: { card: SplashCard; line: string }) {
  const parts = crisisParts(card.body);
  return (
    <>
      <p className="guide-popup-title">{card.title}</p>
      <p className="guide-muted mt-2 whitespace-pre-wrap text-[12px]">{parts.situation}</p>
      {parts.twist ? (
        <div className="guide-alert guide-warning mt-3" data-testid="crisis-twist">
          <b>THE TWIST</b>
          <br />
          <span className="whitespace-pre-wrap">{parts.twist}</span>
        </div>
      ) : null}
      {parts.decide ? (
        <div className="guide-alert guide-danger mt-3" data-testid="crisis-decide">
          <b>YOUR PLAN MUST DECIDE</b>
          <br />
          <span className="whitespace-pre-wrap">{parts.decide}</span>
        </div>
      ) : null}
      <p className="guide-alert guide-danger mt-3 font-semibold">{line}</p>
    </>
  );
}

function RevealBody({ reveal, track }: { reveal: RevealNotice; track: Track }) {
  const { title, lines } = revealLines(reveal, track);
  return (
    <>
      <p className="guide-popup-title">{title}</p>
      <div className="guide-alert guide-danger mt-3">
        {lines.map((l, i) => (
          <p key={l} className={i ? "mt-1.5" : undefined}>
            {l}
          </p>
        ))}
      </div>
    </>
  );
}
