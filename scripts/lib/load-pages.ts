// What the app load test's virtual screens open (pnpm app-load-test, docs/LOAD-TEST.md), and the log of every page
// they loaded. Pure: the script does the fetching.

import type { Track } from "@msim/engine";
import { spread, type Spread } from "./load-summary";

export type ScreenKind = "team" | "projector" | "admin";
export const SCREEN_KINDS: readonly ScreenKind[] = ["team", "projector", "admin"];

/** A team's phone, page after page (its track's sections on the night; Home comes back as people return to it). */
export const TEAM_PAGES: Record<Track, readonly string[]> = {
  PRODUCT: ["/team", "/team/squad", "/team/crisis", "/team/firms", "/team", "/team/market", "/team/messages", "/team/bulletins"],
  CONSULTING: ["/team", "/team/crisis", "/team/firms", "/team/earnings", "/team", "/team/squad", "/team/market", "/team/bulletins"],
  FINANCE: ["/team", "/team/trade", "/team/market", "/team/trade/practice", "/team", "/team/crisis", "/team/trade", "/team/bulletins"],
};

/** An organiser console's pages (each console starts on a different one and moves on now and then). */
export const ADMIN_SECTIONS: readonly string[] = ["/run", "", "/desk", "/rounds", "/judge", "/finance", "/product", "/consulting", "/health", "/schedule"];

export const adminPages = (slug: string): string[] => ADMIN_SECTIONS.map((s) => `/admin/${slug}${s}`);
export const displayPath = (slug: string) => `/display/${slug}`;

/** A page as the report names it: the event's slug replaced, so all consoles' "/run" pages count together. */
export const pageName = (path: string, slug: string) => path.split(`/${slug}`).join("/<slug>");

export interface KindStats extends Spread {
  failed: number;
}

/** Every page load of a run: what came back and how long it took, by kind of screen and by page. */
export class PageLog {
  private readonly ok: { kind: ScreenKind; path: string; ms: number }[] = [];
  private readonly bad: { kind: ScreenKind; path: string; why: string }[] = [];
  /** When the last page came back (ms since the epoch). */
  lastDone = 0;

  constructor(private readonly slug: string) {}

  /** A page served with 200 (anything else, a redirect included, is a failure: a phone would not see its page). */
  served(kind: ScreenKind, path: string, status: number, ms: number, at = Date.now()) {
    this.lastDone = Math.max(this.lastDone, at);
    if (status === 200) this.ok.push({ kind, path: pageName(path, this.slug), ms });
    else this.bad.push({ kind, path: pageName(path, this.slug), why: String(status) });
  }

  /** A page that never came back (a timeout, a refused connection). */
  failed(kind: ScreenKind, path: string, why: string) {
    this.bad.push({ kind, path: pageName(path, this.slug), why });
  }

  get latencies(): number[] {
    return this.ok.map((x) => x.ms);
  }

  get pages(): number {
    return this.ok.length + this.bad.length;
  }

  get failures(): number {
    return this.bad.length;
  }

  byKind(): Record<ScreenKind, KindStats> {
    const out = {} as Record<ScreenKind, KindStats>;
    for (const k of SCREEN_KINDS) {
      out[k] = { ...spread(this.ok.filter((x) => x.kind === k).map((x) => x.ms)), failed: this.bad.filter((x) => x.kind === k).length };
    }
    return out;
  }

  /** Each page's count and p95, slowest first. */
  byPage(): { path: string; n: number; p95: number | null; failed: number }[] {
    const paths = [...new Set([...this.ok.map((x) => x.path), ...this.bad.map((x) => x.path)])];
    return paths
      .map((path) => {
        const s = spread(this.ok.filter((x) => x.path === path).map((x) => x.ms));
        return { path, n: s.n, p95: s.p95, failed: this.bad.filter((x) => x.path === path).length };
      })
      .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
  }

  /** Failures by what came back and where: "500 /team/market" → count. */
  errors(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of this.bad) out[`${b.why} ${b.path}`] = (out[`${b.why} ${b.path}`] ?? 0) + 1;
    return out;
  }
}

/** Re-read on a message, as the app does: each new message restarts the wait, so a burst of messages is one read. */
export function debounced(fn: () => void): { trigger: (delayMs: number) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger(delayMs: number) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
