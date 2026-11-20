// Realtime delivery bookkeeping for pnpm load-test (docs/LOAD-TEST.md). Pure: the script feeds it what each screen
// heard and when (on the server's clock). A broadcast is known by its event name and payload (app.broadcast stamps
// every payload with "at", the sending transaction's time, so two broadcasts are never the same message). The screens
// expected to hear one are those connected at least a second before the first screen heard it and still connected
// 10 s after; delivery is how many of them did.

import { spread, type Spread } from "./load-summary";

const JOIN_GRACE_MS = 1000;
const STAY_MS = 10_000;

/** A payload as one stable string (keys sorted at every level). */
export function stableKey(event: string, payload: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    return v;
  };
  return `${event}|${JSON.stringify(norm(payload))}`;
}

interface Message {
  event: string;
  first: number;
  /** The payload's "at" (server time the broadcast was made), if it has one. */
  sentAt: number | null;
  heard: Map<number, number>;
}

export interface DeliveryResult {
  messages: number;
  expected: number;
  delivered: number;
  /** Receipt minus the payload's "at". */
  sinceSent: Spread;
  /** Receipt minus the first screen's receipt. */
  spread: Spread;
  /** The most deliveries in one second, over the whole run. */
  peakPerSecond: number;
  /** Messages per event name, most first. */
  byEvent: [string, number][];
}

export class Deliveries {
  private readonly messages = new Map<string, Message>();
  private readonly connectedAt = new Map<number, number>();
  private readonly droppedAt = new Map<number, number>();
  private readonly perSecond = new Map<number, number>();
  private from = 0;

  connected(screen: number, at: number) {
    this.connectedAt.set(screen, at);
  }

  dropped(screen: number, at: number) {
    if (!this.droppedAt.has(screen)) this.droppedAt.set(screen, at);
  }

  /** Only broadcasts first heard from this time on are counted (once every connection has joined). */
  measureFrom(at: number) {
    this.from = at;
  }

  heard(screen: number, event: string, payload: Record<string, unknown>, at: number) {
    const key = stableKey(event, payload);
    let m = this.messages.get(key);
    if (!m) {
      const sent = typeof payload.at === "string" ? Date.parse(payload.at) : NaN;
      m = { event, first: at, sentAt: Number.isNaN(sent) ? null : sent, heard: new Map() };
      this.messages.set(key, m);
    }
    if (m.heard.has(screen)) return;
    m.heard.set(screen, at);
    m.first = Math.min(m.first, at);
    const s = Math.floor(at / 1000);
    this.perSecond.set(s, (this.perSecond.get(s) ?? 0) + 1);
  }

  /** Counts the broadcasts first heard between measureFrom and `until` (leave the last ones time to arrive). */
  result(until: number): DeliveryResult {
    let expected = 0;
    let delivered = 0;
    const sinceSent: number[] = [];
    const after: number[] = [];
    const byEvent = new Map<string, number>();
    for (const m of this.messages.values()) {
      if (m.first < this.from || m.first > until) continue;
      byEvent.set(m.event, (byEvent.get(m.event) ?? 0) + 1);
      for (const [screen, joinedAt] of this.connectedAt) {
        if (joinedAt > m.first - JOIN_GRACE_MS) continue;
        const gone = this.droppedAt.get(screen);
        if (gone !== undefined && gone < m.first + STAY_MS) continue;
        expected++;
        const t = m.heard.get(screen);
        if (t === undefined) continue;
        delivered++;
        after.push(t - m.first);
        if (m.sentAt !== null) sinceSent.push(Math.max(0, t - m.sentAt));
      }
    }
    return {
      messages: [...byEvent.values()].reduce((a, b) => a + b, 0),
      expected,
      delivered,
      sinceSent: spread(sinceSent),
      spread: spread(after),
      peakPerSecond: Math.max(0, ...this.perSecond.values()),
      byEvent: [...byEvent].sort((a, b) => b[1] - a[1]),
    };
  }
}
