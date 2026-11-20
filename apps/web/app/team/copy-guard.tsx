"use client";

// paste_block, the other way (organisers, 20 Nov): on every team page nothing can be copied OUT of the site either, so
// case cards, statements, crisis cards and other teams' documents cannot be lifted into another tool. While the switch
// is on: copy and cut are cancelled (keyboard, menu, phone callout) and the clipboard is left empty, the context menu
// and dragging text out are off, and paste or drop anywhere on the page is cancelled (the writing boxes also guard
// themselves, see lib/team/writing.ts). Text cannot be selected outside fields (team.css: .copy-guard); typing,
// selecting and editing inside a field still work.

import { useEffect } from "react";

export function CopyGuard({ on }: { on: boolean }) {
  useEffect(() => {
    if (!on) return;
    document.documentElement.classList.add("copy-guard");
    const block = (e: Event) => {
      e.preventDefault();
      if (e instanceof ClipboardEvent && (e.type === "copy" || e.type === "cut")) e.clipboardData?.setData("text/plain", "");
    };
    const types = ["copy", "cut", "paste", "drop", "dragstart", "contextmenu"] as const;
    for (const t of types) document.addEventListener(t, block, true);
    return () => {
      document.documentElement.classList.remove("copy-guard");
      for (const t of types) document.removeEventListener(t, block, true);
    };
  }, [on]);
  return null;
}
