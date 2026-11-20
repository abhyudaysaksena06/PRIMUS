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
import FocusFrameBorder from "@/components/ui/shine-border-06";
import { CrisisCallouts, crisisParts } from "./crisis-focus-card";

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
  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/85 p-4 motion-safe:animate-[fadein_.25s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label={k === 5 ? "Round 3" : `Crisis ${k}`}
      data-testid="crisis-splash"
      data-kind={show.kind}
    >
      {/* A long card (one with a twist) scrolls on a small phone instead of being cut off. */}
      <div className="flex min-h-full items-center justify-center">
        {/* The card in the pulsing focus frame (components/ui/shine-border-06), in danger red. */}
        <FocusFrameBorder
          color="var(--color-danger)"
          duration={2.4}
          className="w-full max-w-xl motion-safe:animate-[cardflip_.6s_ease-out]"
          contentClassName="border-2 border-danger bg-ink shadow-[0_0_60px_rgba(255,59,59,.35)]"
        >
          <div className="p-6 text-center">
            {show.kind === "card" ? <CardBody card={show.card} line={cardLine(own, popups)} /> : <RevealBody reveal={show.reveal} track={popups!.track} />}
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link href="/team/crisis" onClick={close} className="mx-key mx-key-solid rounded-xl px-5 py-3 text-base font-extrabold">
                Open the crisis room →
              </Link>
              <button type="button" onClick={close} className="mx-key mx-key-quiet rounded-xl px-5 py-3 text-base">
                Got it
              </button>
            </div>
          </div>
        </FocusFrameBorder>
      </div>
    </div>
  );
}

function CardBody({ card, line }: { card: SplashCard; line: string }) {
  const parts = crisisParts(card.body);
  return (
    <>
      <p className="font-mono text-sm font-bold uppercase tracking-[0.3em] text-danger-soft">{card.k === 5 ? "Round 3" : `Crisis ${card.k} of 4`}</p>
      <p className="mt-3 text-6xl text-danger" aria-hidden>
        <Glyph e="🚨" />
      </p>
      <p className="mt-3 text-xs font-bold uppercase tracking-widest text-danger-soft">{card.category}</p>
      <h2 className="mt-1 text-3xl font-extrabold leading-tight text-[var(--term-amber)]">{card.title}</h2>
      <p className={`mt-3 whitespace-pre-wrap text-base text-paper ${parts.situation.length > 220 ? "text-left" : ""}`}>{parts.situation}</p>
      {parts.twist || parts.decide ? (
        <div className="mt-4 flex flex-col gap-3">
          <CrisisCallouts twist={parts.twist} decide={parts.decide} />
        </div>
      ) : null}
      <p className="mt-4 rounded-lg border border-danger/60 px-3 py-2 text-sm font-semibold text-danger-soft">{line}</p>
    </>
  );
}

function RevealBody({ reveal, track }: { reveal: RevealNotice; track: Track }) {
  const { title, lines } = revealLines(reveal, track);
  return (
    <>
      <p className="font-mono text-sm font-bold uppercase tracking-[0.3em] text-danger-soft">New crisis</p>
      <p className="mt-3 text-6xl text-danger" aria-hidden>
        <Glyph e="🚨" />
      </p>
      <h2 className="mt-3 text-3xl font-extrabold uppercase leading-tight text-[var(--term-amber)]">{title}</h2>
      {lines.map((l) => (
        <p key={l} className="mt-3 text-base text-paper">
          {l}
        </p>
      ))}
    </>
  );
}
