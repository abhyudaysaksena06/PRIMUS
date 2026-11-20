// The projector admin's manual timer (the hidden corner panel on the big screen): a label and a target time, counted
// down against the server clock; kept per screen in the browser, never in the database. While none is set the screen
// shows the schedule's own countdown (the header). Pure.

export interface TimerOverride {
  label: string;
  /** Target, server time in ms. */
  at: number;
}

/** The browser storage key of the override (per screen). */
export const TIMER_STORAGE_KEY = "primus.display.timer";
/** The hall's offset from UTC: IST, +5:30. */
export const IST_OFFSET_MS = 330 * 60_000;
/** The step buttons of the panel, in minutes. */
export const TIMER_STEPS_MIN = [-1, 1, 5] as const;

const cleanLabel = (s: string) => s.trim().slice(0, 60) || "Timer";

/** A target `minutes` from now (whole or fractional minutes, > 0). Null for anything else. */
export function overrideFromMinutes(nowMs: number, minutes: number, label: string): TimerOverride | null {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) return null;
  return { label: cleanLabel(label), at: nowMs + Math.round(minutes * 60_000) };
}

/** A target at HH:MM in IST: today's, or tomorrow's when that time has passed. Null for an unreadable time. */
export function overrideFromClock(nowMs: number, hhmm: string, label: string): TimerOverride | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const istNow = nowMs + IST_OFFSET_MS;
  const dayStart = Math.floor(istNow / 86_400_000) * 86_400_000;
  let at = dayStart + (h * 60 + min) * 60_000 - IST_OFFSET_MS;
  if (at <= nowMs) at += 86_400_000;
  return { label: cleanLabel(label), at };
}

/** The override moved by `minutes` (a step button); never earlier than now. */
export function adjustOverride(o: TimerOverride, minutes: number, nowMs: number): TimerOverride {
  return { ...o, at: Math.max(nowMs, o.at + minutes * 60_000) };
}

/** The time left as MM:SS (H:MM:SS from an hour), "00:00" once reached. */
export function remainingText(o: TimerOverride, nowMs: number): string {
  const s = Math.max(0, Math.ceil((o.at - nowMs) / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

export const overrideReached = (o: TimerOverride, nowMs: number) => nowMs >= o.at;

/** A stored override read back (null for nothing or anything unreadable). */
export function parseOverride(stored: string | null | undefined): TimerOverride | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as unknown;
    if (v && typeof v === "object" && typeof (v as TimerOverride).label === "string" && Number.isFinite((v as TimerOverride).at)) {
      return { label: cleanLabel((v as TimerOverride).label), at: (v as TimerOverride).at };
    }
  } catch {
    // unreadable: no override
  }
  return null;
}
