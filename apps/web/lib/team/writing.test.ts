import { describe, expect, test } from "vitest";
import { BLOCKED_INPUT_TYPES, blockedInputType, blocksEvent, pasteShortcut, submitOpensAt, submitWaitMs, type KeyLike } from "./writing";

const key = (k: Partial<KeyLike> & { key: string }): KeyLike => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k });

describe("paste_block", () => {
  test("beforeinput: paste, paste as quotation, drop and yank are cancelled; typing and autocorrect are not", () => {
    for (const t of ["insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "insertFromYank"]) expect(blockedInputType(t), t).toBe(true);
    expect(BLOCKED_INPUT_TYPES.size).toBe(4);
    // iOS autocorrect and spell-check suggestions replace a word with insertReplacementText: never blocked.
    for (const t of ["insertText", "insertReplacementText", "insertCompositionText", "insertLineBreak", "deleteContentBackward", "historyUndo", "", null, undefined]) {
      expect(blockedInputType(t), String(t)).toBe(false);
    }
  });

  test("shortcuts: Ctrl+V, Cmd+V, Ctrl+Shift+V, the V key on another layout, Shift+Insert", () => {
    expect(pasteShortcut(key({ key: "v", ctrlKey: true }))).toBe(true); // Windows, Linux
    expect(pasteShortcut(key({ key: "v", metaKey: true }))).toBe(true); // macOS
    expect(pasteShortcut(key({ key: "V", ctrlKey: true, shiftKey: true }))).toBe(true); // paste as plain text
    expect(pasteShortcut(key({ key: "м", code: "KeyV", ctrlKey: true }))).toBe(true); // a Cyrillic layout
    expect(pasteShortcut(key({ key: "Insert", shiftKey: true }))).toBe(true);
  });

  test("everything else is typing: letters, copy, cut, select all, AltGr letters, Ctrl+Insert", () => {
    expect(pasteShortcut(key({ key: "v" }))).toBe(false);
    expect(pasteShortcut(key({ key: "V", shiftKey: true }))).toBe(false);
    expect(pasteShortcut(key({ key: "c", ctrlKey: true }))).toBe(false);
    expect(pasteShortcut(key({ key: "x", metaKey: true }))).toBe(false);
    expect(pasteShortcut(key({ key: "a", ctrlKey: true }))).toBe(false);
    expect(pasteShortcut(key({ key: "ż", code: "KeyV", ctrlKey: true, altKey: true }))).toBe(false); // AltGr on Windows
    expect(pasteShortcut(key({ key: "Insert", ctrlKey: true }))).toBe(false); // copy
    expect(pasteShortcut(key({ key: "Insert" }))).toBe(false);
  });

  test("which browser events are cancelled", () => {
    expect(blocksEvent({ type: "paste" })).toBe(true);
    expect(blocksEvent({ type: "drop" })).toBe(true);
    expect(blocksEvent({ type: "beforeinput", inputType: "insertFromPaste" })).toBe(true);
    expect(blocksEvent({ type: "beforeinput", inputType: "insertText" })).toBe(false);
    expect(blocksEvent({ type: "keydown", ...key({ key: "v", ctrlKey: true }) })).toBe(true);
    expect(blocksEvent({ type: "keydown", ...key({ key: "a" }) })).toBe(false);
  });
});

describe("submit_last_5", () => {
  const due = "2026-11-20T16:30:00.000Z"; // 22:00 IST
  test("Submit opens 5 minutes before the deadline, only with the switch on", () => {
    expect(submitOpensAt(due, true)).toBe("2026-11-20T16:25:00.000Z");
    expect(submitOpensAt(due, false)).toBeNull();
    expect(submitOpensAt(null, true)).toBeNull();
    expect(submitOpensAt("not a time", true)).toBeNull();
  });

  test("the wait counts down to zero; a paused event's clock stands still", () => {
    const opens = submitOpensAt(due, true);
    expect(submitWaitMs(opens, Date.parse("2026-11-20T16:20:00Z"))).toBe(5 * 60_000);
    expect(submitWaitMs(opens, Date.parse("2026-11-20T16:24:01Z"))).toBe(59_000);
    expect(submitWaitMs(opens, Date.parse("2026-11-20T16:25:00Z"))).toBe(0);
    expect(submitWaitMs(opens, Date.parse("2026-11-20T16:29:00Z"))).toBe(0);
    expect(submitWaitMs(null, 0)).toBe(0);
    // Paused at 21:50 IST: still 5 minutes to wait, whatever the wall clock says.
    expect(submitWaitMs(opens, Date.parse("2026-11-20T16:28:00Z"), { paused: true, pausedAt: "2026-11-20T16:20:00Z" })).toBe(5 * 60_000);
    // Paused inside the last 5 minutes: open.
    expect(submitWaitMs(opens, Date.parse("2026-11-20T16:40:00Z"), { paused: true, pausedAt: "2026-11-20T16:26:00Z" })).toBe(0);
  });
});
