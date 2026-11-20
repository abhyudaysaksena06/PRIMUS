"use client";

// For data that changes without a realtime message (private orders and IPO bids, judge runs written by the worker,
// screen heartbeats): while `active`, the page re-reads itself, as long as the tab is visible.
//
// Load (21 Nov, live night): hundreds of team screens re-reading every 10–15 s sent ~650 database requests a second
// and slowed every page. Realtime messages already re-read a page on every change that matters (offers, clearings,
// scores, phases), so this fallback re-reads at most once a minute, each screen at its own random moment.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const MIN_AUTO_REFRESH_MS = 60_000;

export function AutoRefresh({ everyMs, active = true }: { everyMs: number; active?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const base = Math.max(everyMs, MIN_AUTO_REFRESH_MS);
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
        next();
      }, base * (0.75 + Math.random() * 0.5));
    };
    next();
    return () => clearTimeout(t);
  }, [router, everyMs, active]);
  return null;
}
