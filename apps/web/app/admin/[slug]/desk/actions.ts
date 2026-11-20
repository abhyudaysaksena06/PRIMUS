"use server";

// The registration desk: upload the team list, admit a team onto a login card (its login starts working), save changes
// to it, or check it out again. Each is one game function run as the signed-in organiser.

import type { Track } from "@msim/engine";
import { revalidatePath } from "next/cache";
import { rpc, type ActionResult } from "@/lib/rpc";
import { readTeamList } from "@/lib/admin/team-list";

export interface DeskMember {
  full_name: string;
  roll_number: string | null;
}

export interface DeskDetails {
  college: string;
  email: string;
  phone: string;
}

export async function importTeamList(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const list = await readTeamList(form.get("file"));
  if (!list.ok) return { ok: false, code: "BAD_LIST", message: list.message };
  const r = await rpc("import_roster", { p_event: eventId, p_rows: list.rows, p_replace: form.get("replace") === "on" });
  if (!r.ok) return r;
  const skipped = list.skipped ? ` ${list.skipped} rows without a team name were skipped.` : "";
  return { ...r, message: `Added ${String(r.data?.added ?? 0)} teams to the list (${String(r.data?.total ?? 0)} in all).${skipped}` };
}

export async function admitTeam(
  eventId: string,
  input: { rosterId: string | null; track: Track; code: string | null; edit: boolean; name: string; members: DeskMember[]; details: DeskDetails },
): Promise<ActionResult> {
  const r = await rpc("desk_check_in", {
    p_event: eventId,
    p_track: input.track,
    p_code: input.code,
    p_name: input.name,
    p_members: input.members,
    p_roster: input.rosterId,
    p_edit: input.edit,
    p_details: input.details,
  });
  if (!r.ok) return r;
  const card = String(r.data?.card ?? "");
  return {
    ...r,
    message: r.data?.new
      ? `Checked in as ${card} — hand over card ${card}: their login works now. ${String(r.data?.checked_in ?? "")} teams checked in.`
      : `Saved ${card}.`,
  };
}

export async function checkOut(eventId: string, teamId: string): Promise<ActionResult> {
  const r = await rpc("desk_check_out", { p_event: eventId, p_team: teamId });
  return r.ok ? { ...r, message: `Checked out: card ${String(r.data?.card ?? "")} no longer signs in and is free again.` } : r;
}

export async function setDeskRule(eventId: string, on: boolean): Promise<ActionResult> {
  const r = await rpc("set_desk_check_in", { p_event: eventId, p_on: on });
  return r.ok
    ? { ...r, message: on ? "Teams now need the desk's check-in before they can sign in." : "Every team can sign in without the desk." }
    : r;
}

export async function saveTeam(input: { rosterId: string; track: Track; name: string; members: DeskMember[]; details: DeskDetails }): Promise<ActionResult> {
  const r = await rpc("update_roster", {
    p_roster: input.rosterId,
    p_name: input.name,
    p_track: input.track,
    p_members: input.members,
    p_details: input.details,
  });
  return r.ok ? { ...r, message: `Saved team #${String(r.data?.number ?? "")}. It is not admitted yet.` } : r;
}

export async function setRegistration(eventId: string, on: boolean): Promise<ActionResult> {
  const r = await rpc("set_registration_open", { p_event: eventId, p_on: on });
  return r.ok ? { ...r, message: on ? "Online registration is open." : "Online registration is closed." } : r;
}

/**
 * After registration (migration 101): remove every card the desk did not admit, with its login. Organisers only (the
 * database refuses everyone else); typing REMOVE <slug> is the confirmation.
 */
export async function removeUnadmitted(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await rpc("remove_unadmitted", { p_event: eventId, p_confirm: String(form.get("confirm") ?? "").trim() });
  if (!r.ok) return r;
  revalidatePath("/admin", "layout");
  return {
    ...r,
    message: `Removed ${String(r.data?.teams ?? 0)} teams not admitted and ${String(r.data?.logins ?? 0)} logins. The admitted teams are untouched.`,
  };
}
