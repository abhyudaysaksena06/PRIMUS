"use server";

import { redirect } from "next/navigation";
import { TEAM_CODE_RE, normalizePassword, normalizeTeamCode, teamEmail } from "@msim/engine";
import { teamEmailDomain } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { homeFor, isDeskRole, landingFor, safeNext, type Role } from "@/lib/auth/routes";
import { portalAdmits, portalUrl, teamPortal, wrongPortalMessage } from "@/lib/portal/portal";
import { signInWithRetry } from "@/lib/auth/retry";

export interface LoginState {
  error?: string;
  /** Echoed back so the field is not cleared after a failed attempt. */
  login?: string;
}

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const mode = form.get("mode") === "staff" ? "staff" : "team";
  let email: string;
  let password: string;

  if (mode === "team") {
    const code = normalizeTeamCode(String(form.get("code") ?? ""));
    if (!TEAM_CODE_RE.test(code)) return { error: "Enter the team code printed on your card, for example P07.", login: code };
    email = teamEmail(code, teamEmailDomain());
    password = normalizePassword(String(form.get("password") ?? ""));
  } else {
    email = String(form.get("email") ?? "").trim().toLowerCase();
    password = String(form.get("password") ?? "");
    if (!email.includes("@")) return { error: "Enter your staff email address.", login: email };
  }
  const login = mode === "team" ? normalizeTeamCode(String(form.get("code") ?? "")) : email;
  if (!password) return { error: "Enter your password.", login };

  const sb = await supabaseServer();
  // At check-in hundreds of phones sign in at once: a busy or briefly overloaded Auth is tried again, quietly.
  const { error } = await signInWithRetry(() => sb.auth.signInWithPassword({ email, password }));
  if (error) {
    const wrongCredentials = error.status === 400 || error.code === "invalid_credentials";
    return {
      login,
      error:
        error.status === 429
          ? "The sign-in service is very busy right now. Wait a minute and try again."
          : !wrongCredentials
            ? "The login service cannot be reached. Try again in a moment; if it keeps failing, go to the technical support desk."
            : mode === "team"
              ? "That team code and password do not match. Check your card."
              : "That email and password do not match.",
    };
  }

  // A live event's team login works only once the registration desk has checked the team in.
  const { data: desk } = await sb.rpc("my_desk_status");
  if (desk && (desk as { team?: boolean; admitted?: boolean }).team && !(desk as { admitted?: boolean }).admitted) {
    await sb.auth.signOut();
    return {
      login,
      error: "Your team is not checked in yet. Go to the registration desk with your card: your login works as soon as they check your team in.",
    };
  }

  const viewer = await getViewer(sb);
  if (!viewer) {
    await sb.auth.signOut();
    return { error: "This login is not set up for the event. Please go to the technical support desk.", login };
  }
  // A track's portal admits only that track's teams (organisers can sign in everywhere).
  const portal = await teamPortal();
  if (portal && viewer.team && !portalAdmits(portal, viewer.team.track)) {
    await sb.auth.signOut();
    return { error: wrongPortalMessage(portal, viewer.team.track, portalUrl(viewer.team.track)), login };
  }
  // Staff: a desk role (registration, judging, crisis) lands on its own desk of the live event, unless it asked for
  // one of its own pages.
  const role = viewer.role as Role;
  const next = safeNext(form.get("next"), role);
  if (isDeskRole(role) && next === homeFor(role)) redirect(landingFor(role, await liveEventSlug(sb)));
  redirect(next);
}

/** The live night (else the newest rehearsal), for a desk role's landing page. */
async function liveEventSlug(sb: Awaited<ReturnType<typeof supabaseServer>>): Promise<string | null> {
  const { data } = await sb
    .from("events")
    .select("slug")
    .order("is_rehearsal")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ slug: string }>();
  return data?.slug ?? null;
}

export async function signOut(): Promise<void> {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
