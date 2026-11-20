// The Run page's switches (migration 070): every behaviour added for the 600-team night can be turned off here during
// the night without a deploy. Off means the game behaves exactly as it did before that change.

import { supabaseServer } from "@/lib/supabase/server";
import { Badge, Panel } from "@/app/admin/guide-ui";
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
    <Panel title="Switches" tag="ORGANISER ONLY">
      <p className="guide-muted mb-3 max-w-3xl">
        Each change made for tonight can be turned off here at once, without a deploy; off means the game works exactly as it did
        before it. <strong>Rule</strong> switches change how the game plays: turn them on only after their rehearsal check passed.
      </p>
      <div className="guide-scroll-box table-8">
        <table className="guide-table">
          <thead>
            <tr>
              <th>KIND</th>
              <th>SWITCH</th>
              <th>STATE</th>
              {organiser ? <th>ACTION</th> : null}
            </tr>
          </thead>
          <tbody data-testid="switches">
            {rows.map((s) => (
              <tr key={s.key} data-testid={`switch-${s.key}`}>
                <td>
                  <Badge tone={KIND[s.kind].tone}>{KIND[s.kind].text}</Badge>
                </td>
                <td>
                  <strong>{s.label}</strong>
                  {s.is_on !== s.on_by_default ? <span className="guide-status ml-2">(changed from its default)</span> : null}
                </td>
                <td>
                  <Badge tone={s.is_on ? "green" : "slate"}>{s.is_on ? "On" : "Off"}</Badge>
                </td>
                {organiser ? (
                  <td>
                    <ActionButton
                      action={setFeature.bind(null, eventId, s.key, !s.is_on)}
                      confirm={s.is_on ? "Click again: turn it off" : "Click again: turn it on"}
                      variant={s.is_on ? "secondary" : "primary"}
                    >
                      {s.is_on ? "Turn off" : "Turn on"}
                    </ActionButton>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
