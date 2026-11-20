// Home: two QR codes for the team's track, drawn on the server as SVG (lib/team/qr.ts) with the host the page was
// asked for: the track's demo video and the track's PDF guide (its track card, then the Team Guide). Both are static,
// view-only files under /media that open on a phone without signing in. Without a usable host, nothing is shown.

import { headers } from "next/headers";
import type { Track } from "@msim/engine";
import { TRACK_LABELS } from "@msim/engine";
import { demoVideoLink, guidePdfLink, originOf, qrSvg } from "@/lib/team/qr";

export async function QrCard({ track }: { track: Track }) {
  const origin = originOf(await headers());
  if (!origin) return null;
  const items = [
    { key: "video", href: demoVideoLink(track, origin), title: `${TRACK_LABELS[track]} demo video`, note: "A 7-minute walkthrough of your screens." },
    { key: "pdf", href: guidePdfLink(track, origin), title: `${TRACK_LABELS[track]} guide (PDF)`, note: "Your track card and the full Team Guide." },
  ];
  const svgs = await Promise.all(items.map((i) => qrSvg(i.href).catch(() => null)));
  return (
    <section className="guide-panel" aria-label="Scan for your video and guide" data-testid="qr-card">
      <div className="guide-panel-head">
        <h2>Scan for your video and guide</h2>
        <span>VIEW ONLY · NO SIGN-IN NEEDED</span>
      </div>
      <div className="guide-panel-body grid gap-3 sm:grid-cols-2">
        {items.map((item, n) => (
          <a key={item.key} href={item.href} target="_blank" rel="noreferrer" className="guide-task-row !mt-0" data-testid={`qr-${item.key}`}>
            {svgs[n] ? (
              // The SVG is drawn by the qrcode package from our own link: paths only, no text or script.
              <span className="block h-28 w-28 shrink-0 rounded bg-white p-1" aria-hidden dangerouslySetInnerHTML={{ __html: svgs[n]! }} />
            ) : null}
            <span className="min-w-0">
              <span className="block text-[12px] font-bold text-[var(--track-accent)]">{item.title}</span>
              <span className="guide-muted block">{item.note}</span>
              <span className="mt-1 block break-all font-mono text-xs text-muted">{item.href.replace(/^https?:\/\//, "")}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
