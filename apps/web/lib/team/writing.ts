// The writing editors' two guards for tonight (migration 072's switches), as pure decisions the editor applies.
//
// paste_block: the editor cancels every way text arrives without being typed, at the browser's own events, so it holds
// on Windows, macOS, Linux and phones alike: the paste event (keyboard, context menu, the phone's callout), the drop
// event, `beforeinput` of a paste, drop or yank, and the paste shortcuts themselves (Ctrl/Cmd+V, Ctrl+Shift+V,
// Shift+Insert). It does not touch `insertReplacementText`: iOS autocorrect and spell-check suggestions use it.
//
// submit_last_5: Submit opens 5 minutes before the deadline (the database refuses earlier submissions with
// SUBMIT_NOT_YET); the clock stands still while the event is paused, as every deadline does.

export const PASTE_BLOCKED_TEXT = "Pasting is turned off: type your answer here.";

/** `beforeinput` types that put text in without typing it. */
export const BLOCKED_INPUT_TYPES: ReadonlySet<string> = new Set(["insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "insertFromYank"]);

/** A `beforeinput` event's type that the editor cancels. */
export function blockedInputType(inputType: string | null | undefined): boolean {
  return !!inputType && BLOCKED_INPUT_TYPES.has(inputType);
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * A paste shortcut: Ctrl+V or Cmd+V (with or without Shift: "paste as plain text"), by the letter or by the key's
 * place (a Cyrillic layout still pastes with the V key), and Shift+Insert. Alt is left alone: AltGr (Ctrl+Alt on
 * Windows) types letters on many layouts.
 */
export function pasteShortcut(e: KeyLike): boolean {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === "v" || e.code === "KeyV")) return true;
  return e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Insert";
}

/** The browser event types the editor listens to, and whether one of them is to be cancelled. */
export const GUARDED_EVENTS = ["paste", "drop", "beforeinput", "keydown"] as const;

export type GuardedEvent =
  | { type: "paste" | "drop" }
  | { type: "beforeinput"; inputType?: string | null }
  | ({ type: "keydown" } & KeyLike);

export function blocksEvent(e: GuardedEvent): boolean {
  switch (e.type) {
    case "paste":
    case "drop":
      return true;
    case "beforeinput":
      return blockedInputType(e.inputType);
    case "keydown":
      return pasteShortcut(e);
  }
}

export const SUBMIT_OPENS_BEFORE_MS = 5 * 60_000;

/** When Submit opens: 5 minutes before the deadline, with the switch on; null when it is open all the window. */
export function submitOpensAt(deadline: string | null | undefined, on: boolean): string | null {
  if (!on || !deadline) return null;
  const t = Date.parse(deadline);
  return Number.isFinite(t) ? new Date(t - SUBMIT_OPENS_BEFORE_MS).toISOString() : null;
}

/**
 * How long until Submit opens (ms; 0 when it is open). While the event is paused the clock stands still at the
 * moment the pause began, as in app.submit_too_early.
 */
export function submitWaitMs(opensAt: string | null, now: number, pause: { paused: boolean; pausedAt: string | null } = { paused: false, pausedAt: null }): number {
  if (!opensAt) return 0;
  const clock = pause.paused && pause.pausedAt ? Date.parse(pause.pausedAt) : now;
  return Math.max(0, Date.parse(opensAt) - clock);
}
