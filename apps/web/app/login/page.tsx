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
import "./login.css";

export const metadata: Metadata = { title: "Sign in · PRIMUS" };
// A sign-in during a check-in rush may wait for Supabase's rate limit to refill (lib/auth/retry.ts, about 12 s at
// most): give the sign-in action room for that on every plan.
export const maxDuration = 30;

// The sign-in page in the PRIMUS demo's look (app/demo/login): the Matrix rain in the track's colour, the PRIMUS mark,
// and one card with bracket corners holding the real sign-in form.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, code } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  // The QR code on a login card opens /login?code=P07: the team code is filled in and only the password is typed.
  const cardCode = typeof code === "string" ? normalizeTeamCode(code) : "";
  const prefill = TEAM_CODE_RE.test(cardCode) ? cardCode : undefined;
  const viewer = await getViewer();
  const portal = await teamPortal();
  if (viewer) redirect(safeNext(nextPath, viewer.role));

  return (
    <main className="mx-login terminal-theme-scope" data-track={portal ?? undefined}>
      {/* Backdrop only: the rain, a faint grid and a glow behind the card. */}
      <div aria-hidden className="mx-login-backdrop">
        <MatrixRain opacity={0.44} size={15} className="absolute inset-0 h-full w-full" />
        <div className="mx-login-grid" />
        <div className="mx-login-glow" />
      </div>
      <div className="mx-login-content">
        <header className="mx-login-top">
          <Image src="/primus-logo-light.svg" alt="PRIMUS" width={154} height={58} priority className="mx-login-logo" />
          <span className="mx-login-network" aria-hidden>
            <i /> {portal ? `${TRACK_LABELS[portal].toUpperCase()} ACCESS NODE` : "ACCESS NODE"} · IST
          </span>
        </header>
        <section className="mx-login-card" aria-labelledby="login-title">
          <p className="mx-login-eyebrow" aria-hidden>
            PRIMUS ’26 <b>/</b> LIVE MARKET SIMULATION
          </p>
          <div className="mx-login-heading">
            <h1 id="login-title">
              <CipherText text={portal ? PORTAL_TITLES[portal] : "Sign in"} duration={900} />
            </h1>
            <p>
              {portal
                ? `For ${TRACK_LABELS[portal]} teams. Sign in with the team code and password on your card.`
                : "Sign in with the team code and password on your card."}
            </p>
          </div>
          <LoginForm next={nextPath} code={prefill} />
          <p className="mx-login-note">
            Keep your team card safe. Anyone holding it can act for your team, including editing submissions and placing trades.
          </p>
        </section>
        <footer className="mx-login-footer" aria-hidden>
          <span>
            PRIMUS ’26 <b>·</b> MATRIX NETWORK
          </span>
          <span>WHERE EVERY DECISION CONNECTS</span>
        </footer>
      </div>
    </main>
  );
}
