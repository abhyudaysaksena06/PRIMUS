// Reads what the health view needs, as the signed-in staff member: admin_health (staff only), the event's teams,
// the team screens' heartbeats (client_pings, staff only) and the latest error_log rows (staff only).

import { rpc } from "@/lib/rpc";
import { supabaseServer } from "@/lib/supabase/server";
import { parseHealth, type AdminHealth, type HealthTeam, type PingRow } from "./health";
import { fetchAll } from "./rounds";
import { admittedOnly, deskCheckInOn } from "./admitted";

export interface ErrorRow {
  id: number;
  at: string;
  source: string;
  message: string;
  context: Record<string, unknown> | null;
}

export interface HealthData {
  health: AdminHealth;
  teams: HealthTeam[];
  pings: PingRow[];
  errors: ErrorRow[];
}

export const ERROR_ROWS = 50;

export async function loadHealthData(eventId: string): Promise<HealthData> {
  const sb = await supabaseServer();
  const [health, teams, pings, errors, deskOn] = await Promise.all([
    rpc("admin_health", { p_event: eventId }).then((r) => {
      if (!r.ok) throw new Error(`admin_health: ${r.message ?? r.code}`);
      return parseHealth(r.data);
    }),
    sb
      .from("teams")
      .select("id, code, track, checked_in_at")
      .eq("event_id", eventId)
      .order("code")
      .then((r) => {
        if (r.error) throw new Error(`teams: ${r.error.message}`);
        return r.data as (HealthTeam & { checked_in_at: string | null })[];
      }),
    fetchAll<PingRow>((from, to) =>
      sb
        .from("client_pings")
        .select("client_id, team_id, role, area, realtime, first_seen, last_seen")
        .eq("event_id", eventId)
        .not("team_id", "is", null)
        .order("client_id")
        .range(from, to),
    ),
    sb
      .from("error_log")
      .select("id, at, source, message, context")
      .eq("event_id", eventId)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ERROR_ROWS)
      .then((r) => {
        if (r.error) throw new Error(`error_log: ${r.error.message}`);
        return r.data as ErrorRow[];
      }),
    deskCheckInOn(sb, eventId),
  ]);
  // With desk check-in on, the cards not checked in yet are not teams of the event: they are not listed as silent.
  return { health, teams: admittedOnly(teams, deskOn).map(({ id, code, track }) => ({ id, code, track })), pings, errors };
}
