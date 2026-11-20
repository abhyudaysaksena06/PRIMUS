// Home: the QR code for the team's track guide (the public /guide/<track> page), drawn on the server as SVG
// (lib/team/qr.ts) with the host the page was asked for. Without a usable host, nothing is shown.

import { headers } from "next/headers";
import type { Track } from "@msim/engine";
import { TRACK_LABELS } from "@msim/engine";
import { originOf, qrSvg, teamQrLink } from "@/lib/team/qr";

export async function QrCard({ track }: { track: Track }) {
  const origin = originOf(await headers());
  if (!origin) return null;
  const href = teamQrLink(track, origin);
  const svg = await qrSvg(href).catch(() => null);
  return (
    <section className="guide-panel" aria-label="Scan for help" data-testid="qr-card">
      <div className="guide-panel-head">
        <h2>Scan for your guide</h2>
        <span>NO SIGN-IN NEEDED</span>
      </div>
      <div className="guide-panel-body">
        <a href={href} target="_blank" rel="noreferrer" className="guide-task-row !mt-0" data-testid="qr-guide">
          {svg ? (
            // The SVG is drawn by the qrcode package from our own link: paths only, no text or script.
            <span className="block h-28 w-28 shrink-0 rounded bg-white p-1" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
          ) : null}
          <span className="min-w-0">
            <span className="block text-[12px] font-bold text-[var(--track-accent)]">{TRACK_LABELS[track]} guide</span>
            <span className="guide-muted block">The rules and times for your track. Open it on a phone.</span>
            <span className="mt-1 block break-all font-mono text-xs text-muted">{href.replace(/^https?:\/\//, "")}</span>
          </span>
        </a>
      </div>
    </section>
  );
}
