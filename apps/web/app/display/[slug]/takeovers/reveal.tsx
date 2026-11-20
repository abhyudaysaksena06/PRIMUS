// A PRIMUS crisis reveal (Round 2, crises 1–4), for 60 s after the sub-round's revealed_at: which crisis, every
// price −5%, trading halted for 5 minutes, and when hiring closes. The cards' categories show only if the display may
// read them; on a PRIMUS night each company's card stays sealed until its hiring closes, and so does this screen.

import { TAKEOVER_TITLES } from "@/lib/display/takeover";
import { revealCategories } from "@/lib/display/takeovers";
import { clock, count } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import type { TakeoverProps } from "./index";
import { TakeoverFrame } from "./frame";
import { loadPriceMoves } from "./data";
import { ThermalBeam } from "@/components/ui/matrix/thermal-scan";

export async function RevealTakeover({ event, takeover }: TakeoverProps) {
  const k = takeover.k ?? 1;
  const sb = await supabaseServer();
  const [moves, cards, hire] = await Promise.all([
    loadPriceMoves(event.id, "SUB_SHOCK", k),
    sb.from("subround_crises").select("crisis_cards(category)").eq("event_id", event.id).eq("k", k),
    sb.from("deadlines").select("at").eq("event_id", event.id).eq("code", `HIRE_${k}`).maybeSingle<{ at: string }>(),
  ]);
  // A read that fails only leaves its line out: the headline is what the hall needs.
  const categories = cards.error ? [] : revealCategories((cards.data ?? []) as { crisis_cards: { category: string } | { category: string }[] | null }[]);
  const hireAt = hire.error ? null : (hire.data?.at ?? null);
  const tiles: [string, string][] = [
    ["Every share price", "−5%"],
    ["Trading halted", "5 minutes"],
    ["Hiring closes", hireAt ? clock(hireAt) : "—"],
  ];

  return (
    <TakeoverFrame title={`${TAKEOVER_TITLES.REVEAL} ${k} of 4`} at={takeover.at} until={takeover.until} tone="bg-danger text-ink">
      <div className="relative flex h-full flex-col gap-10" data-testid="reveal-takeover">
        <ThermalBeam />
        <p className="text-[64px] leading-tight font-black text-paper">Crisis {k}: every company is hit.</p>
        <div className="grid shrink-0 grid-cols-3 gap-8">
          {tiles.map(([label, value]) => (
            <div key={label} className="dsp-metric px-8 py-6">
              <p className="text-[30px] font-semibold tracking-wide text-muted uppercase">{label}</p>
              <p className="text-[80px] leading-tight font-black tabular-nums text-danger">{value}</p>
            </div>
          ))}
        </div>
        <div className="text-[40px] leading-snug text-paper" data-testid="reveal-cards">
          {categories.length ? (
            <>
              <p className="font-bold">New crisis cards:</p>
              <p className="mt-2 text-[36px]">{categories.map((c) => `${c.category} ×${c.count}`).join("  ·  ")}</p>
            </>
          ) : (
            <p>
              Each company has a new crisis card. It opens when hiring closes{hireAt ? ` at ${clock(hireAt)}` : ""}.
            </p>
          )}
          {moves.size ? <p className="mt-4 text-[32px] text-muted">{count(moves.size)} companies fell 5%.</p> : null}
        </div>
      </div>
    </TakeoverFrame>
  );
}
