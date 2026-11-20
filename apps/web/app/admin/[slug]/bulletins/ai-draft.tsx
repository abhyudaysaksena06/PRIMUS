"use client";

// "Draft with AI": asks Claude for a news bulletin from the market as it stands and fills the composer above with it.
// Nothing is published: the organiser reads, edits and publishes as usual.

import { useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/rpc";
import { buttonClass, inputClass } from "@/app/admin/guide-ui";
import { ResultMessage } from "@/components/ui/result-message";
import { safely } from "@/components/ui/action-helpers";
import { draftNews } from "./actions";

export function AiDraft({ eventId }: { eventId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const draft = () =>
    start(async () => {
      const r = await safely(() => draftNews(eventId, angle));
      setResult(r);
      const form = box.current?.closest("form");
      if (!r.ok || !form || !r.data) return;
      const set = (name: string, value: unknown) => {
        const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (el && typeof value === "string") el.value = value;
      };
      set("kind", r.data.kind);
      set("title", r.data.title);
      set("body", r.data.body);
    });

  return (
    <div ref={box} className="space-y-2 rounded-md border border-line p-3" data-testid="ai-draft">
      <span className="guide-label">Draft with AI (optional): what is the news about?</span>
      <div className="flex flex-wrap gap-2">
        <input
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          maxLength={500}
          placeholder="e.g. Energy stocks after the crisis; or leave blank for the biggest movers"
          aria-label="News angle"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="button" className={buttonClass.secondary} onClick={draft} disabled={pending}>
          {pending ? "Drafting…" : "Draft with AI"}
        </button>
      </div>
      <ResultMessage result={result} />
    </div>
  );
}
