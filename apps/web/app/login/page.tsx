import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/routes";
import { LoginForm } from "./login-form";
import { MatrixRain } from "@/components/ui/matrix/matrix-rain";
import { CipherText } from "@/components/ui/matrix/cipher-text";
import { PORTAL_TITLES, teamPortal } from "@/lib/portal/portal";
import { TEAM_CODE_RE, TRACK_LABELS, normalizeTeamCode } from "@msim/engine";
import "@/styles/primus/demo.css";
import "./login.css";
import { LoginBoot } from "./login-boot";

export const metadata: Metadata = { title: "Sign in · PRIMUS" };
// A sign-in during a check-in rush may wait for Supabase's rate limit to refill (lib/auth/retry.ts, about 12 s at
// most): give the sign-in action room for that on every plan.
export const maxDuration = 30;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, code, other } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  // The QR code on a login card opens /login?code=P07: the team code is filled in and only the password is typed.
  const cardCode = typeof code === "string" ? normalizeTeamCode(code) : "";
  const prefill = TEAM_CODE_RE.test(cardCode) ? cardCode : undefined;
  const viewer = await getViewer();
  const portal = await teamPortal();
  if (viewer) redirect(safeNext(nextPath, viewer.role));

  const tone = portal === "CONSULTING" ? "blue" : portal === "PRODUCT" ? "amber" : portal === "FINANCE" ? "gold" : "blue";
  // The demo's sign-in page (app/demo/login), its markup and classes: the glitch boot, the rain in the track's colour,
  // the grid and the glow, the PRIMUS mark, and the bracket-cornered card holding the real sign-in form.
  return (
    <main className="demo-login demo-entry" data-track={portal ?? "CONSULTING"}>
      <LoginBoot track={portal ? TRACK_LABELS[portal].toUpperCase() : null} />
      <MatrixRain opacity={0.44} size={15} tone={tone} className="demo-matrix-rain" />
      <div className="demo-login-grid" aria-hidden />
      <div className="demo-login-glow" aria-hidden />
      <div className="demo-login-content">
        <header className="demo-login-top flex items-center justify-between">
          <Image src="/primus-logo-light.svg" alt="PRIMUS" width={154} height={58} priority className="demo-official-logo" />
          <span className="demo-entry-network" aria-hidden>
            <i /> {portal ? `${TRACK_LABELS[portal].toUpperCase()} ACCESS NODE` : "ACCESS NODE"} · IST
          </span>
        </header>
        <section className="demo-login-card" aria-labelledby="login-title">
          <div className="demo-entry-eyebrow" aria-hidden>
            20 NOVEMBER 2026 <b>/</b> PRIMUS ’26
          </div>
          <div className="demo-login-heading">
            <h1 id="login-title">
              <CipherText text={portal ? PORTAL_TITLES[portal] : "Sign in"} duration={900} />
            </h1>
            <p>
              {portal
                ? `For ${TRACK_LABELS[portal]} teams. Sign in with the team code and password on the access card issued at check-in.`
                : "Sign in with the team code and password on the access card issued at check-in."}
            </p>
          </div>
          {other ? (
            <p role="alert" className="mb-3 rounded border border-amber-400/60 bg-amber-400/10 p-2 text-sm text-amber-200" data-testid="signed-in-elsewhere">
              Your team signed in on another device, so this device was signed out. One device per team: sign in here again only if this is the device your team will use.
            </p>
          ) : null}
          <LoginForm next={nextPath} code={prefill} />
          <div className="mt-5 border-t border-[var(--track-line,#294832)] pt-4 text-[9px] leading-5 text-[#8a97a8]">
            Keep your team card safe. Anyone holding it can act for your team, including editing submissions and placing trades.
          </div>
        </section>
        <footer className="demo-entry-footer" aria-hidden>
          <span>
            PRIMUS ’26 <b>·</b> MATRIX NETWORK
          </span>
          <span>WHERE EVERY DECISION CONNECTS</span>
        </footer>
      </div>
    </main>
  );
}
