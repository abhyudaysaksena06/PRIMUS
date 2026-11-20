// The Run page's switches (migration 070): every behaviour added for the 600-team night can be turned off here during
// the night without a deploy. Off means the game behaves exactly as it did before that change.

import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Panel } from "@/components/ui/ui";
import { ActionButton } from "@/components/ui/action";
import { setFeature } from "./actions";

interface Switch {
  key: string;
  label: string;
  kind: "SCALE" | "RULE" | "DISPLAY";
  is_on: boolean;
  on_by_default: boolean;
}

const KIND: Record<Switch["kind"], { tone: "blue" | "amber" | "green"; text: string }> = {
  SCALE: { tone: "blue", text: "Scale" },
  RULE: { tone: "amber", text: "Rule" },
  DISPLAY: { tone: "green", text: "Display" },
};

export async function SwitchesPanel({ eventId, organiser }: { eventId: string; organiser: boolean }) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("feature_switches", { p_event: eventId });
  if (error) return null; // a database older than migration 070 has no switches
  const rows = (data ?? []) as Switch[];
  if (rows.length === 0) return null;
  return (
    <Panel title="Switches">
      <p className="mb-3 max-w-3xl text-sm text-muted">
        Each change made for tonight can be turned off here at once, without a deploy; off means the game works exactly as it did
        before it. <strong>Rule</strong> switches change how the game plays: turn them on only after their rehearsal check passed.
      </p>
      <ul className="divide-y divide-line" data-testid="switches">
        {rows.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid={`switch-${s.key}`}>
            <span className="flex items-center gap-2 text-sm text-paper">
              <Badge tone={KIND[s.kind].tone}>{KIND[s.kind].text}</Badge>
              <span>{s.label}</span>
              {s.is_on !== s.on_by_default ? <span className="text-xs text-muted">(changed from its default)</span> : null}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={s.is_on ? "green" : "slate"}>{s.is_on ? "On" : "Off"}</Badge>
              {organiser ? (
                <ActionButton
                  action={setFeature.bind(null, eventId, s.key, !s.is_on)}
                  confirm={s.is_on ? "Click again: turn it off" : "Click again: turn it on"}
                  variant={s.is_on ? "secondary" : "primary"}
                >
                  {s.is_on ? "Turn off" : "Turn on"}
                </ActionButton>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
