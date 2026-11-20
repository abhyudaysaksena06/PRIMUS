"use client";

// Round 3's draft, for a Product team, when the draft runs by sector (migration 077): picks are no longer broadcast to
// every screen, so while the draft runs this asks the database who is on the clock in the team's sector every
// 3 seconds (public.draft_clock, one small read) and re-reads the page only when that changes. When the team's own
// company comes on the clock it says "Your pick!" once (a banner, and the beep and buzz if the team switched sound on).
// Mounted more than once on a page (the layout and the draft screen), only the first one polls.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export const DRAFT_POLL_MS = 3000;

interface Head {
  company_id: string;
  closes_at: string;
  mine: boolean;
}
interface Clock {
  by_sector: boolean;
  left: number;
  heads: Head[];
}

let polling = 0;

function buzz() {
  try {
    if (localStorage.getItem("msim:alert-sound") !== "on") return;
    navigator.vibrate?.([200, 100, 200]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const audio = new Ctx();
    const at = audio.currentTime;
    for (const [i, f] of [880, 1175].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.15, at + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, at + i * 0.18 + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(at + i * 0.18);
      osc.stop(at + i * 0.18 + 0.17);
    }
    setTimeout(() => void audio.close(), 1000);
  } catch {
    // No sound is fine.
  }
}

/** Has this company's "Your pick!" been given on this screen already? (A company picks once a night.) */
function alerted(key: string, mark = false): boolean {
  try {
    if (mark) sessionStorage.setItem(key, "1");
    return sessionStorage.getItem(key) === "1";
  } catch {
    return mark;
  }
}

export function DraftWatch({ eventId, companyId, active }: { eventId: string; companyId: string | null; active: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [myTurn, setMyTurn] = useState(false);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!active || polling > 0) return;
    polling++;
    const sb = supabaseBrowser();
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const { data, error } = await sb.rpc("draft_clock", { p_event: eventId });
      if (stopped || error || !data) return;
      const c = data as Clock;
      const sign = `${c.left === 0}|${c.heads.map((h) => `${h.company_id}@${h.closes_at}`).join(",")}`;
      if (seen.current !== null && seen.current !== sign) router.refresh();
      seen.current = sign;
      const mine = c.heads.some((h) => h.mine);
      setMyTurn(mine);
      const key = `msim:draft-pick:${eventId}:${companyId ?? ""}`;
      if (mine && !alerted(key)) {
        alerted(key, true);
        buzz();
      }
      if (c.left === 0) stopped = true; // the draft is over: the refresh above shows hiring open
    };
    void check();
    const id = setInterval(() => void check(), DRAFT_POLL_MS);
    return () => {
      stopped = true;
      polling--;
      clearInterval(id);
    };
  }, [active, eventId, companyId, router]);

  if (!active || !myTurn) return null;
  return (
    <div
      className="fixed inset-x-4 top-4 z-50 flex items-center gap-3 rounded-lg border border-warn/60 bg-ink px-4 py-3 text-sm font-semibold text-warn shadow-lg sm:left-auto sm:w-96"
      role="alert"
      data-testid="your-pick"
    >
      <span className="flex-1">Your pick! Choose a problem statement now: you have 20 seconds.</span>
      {path !== "/team/crisis" ? (
        <Link href="/team/crisis" className="whitespace-nowrap underline underline-offset-2">
          Pick now
        </Link>
      ) : null}
    </div>
  );
}
