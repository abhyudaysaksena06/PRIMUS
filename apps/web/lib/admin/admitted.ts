// The organisers' rule: no team is shown on any page until the registration desk has checked it in. With the event's
// desk check-in on (events.desk_check_in, migration 048), the login cards not checked in yet (the placeholder teams
// "Product Team P01", ...) are left out of every staff list and count; with it off (classic and rehearsal events)
// every team is listed, exactly as before. The database applies the same rule to what teams and the projector read
// (app.team_listed, migration 090).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Admission {
  checked_in_at?: string | null;
}

/** The teams that may be shown: all of them with the desk off, only the checked-in ones with it on. */
export function admittedOnly<T extends Admission>(teams: readonly T[], deskOn: boolean): T[] {
  return deskOn ? teams.filter((t) => t.checked_in_at != null) : [...teams];
}

/** Whether the event requires the desk's check-in (false if the column cannot be read). */
export async function deskCheckInOn(sb: SupabaseClient, eventId: string): Promise<boolean> {
  const { data, error } = await sb.from("events").select("desk_check_in").eq("id", eventId).maybeSingle<{ desk_check_in: boolean }>();
  return !error && data?.desk_check_in === true;
}

/** The lowest code of a track that no team is checked in on yet ("next free card"), in the database's order. */
export function nextFreeCard<T extends Admission & { code: string; track: string; disqualified?: boolean | null }>(
  cards: readonly T[],
  track: string,
): string | null {
  const free = cards
    .filter((c) => c.track === track && c.checked_in_at == null && !c.disqualified)
    .map((c) => c.code)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return free[0] ?? null;
}
