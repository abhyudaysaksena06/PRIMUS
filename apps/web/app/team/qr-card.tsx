// Home: two QR codes for the team's track: the demo walkthrough and the track guide, drawn on the server as SVG
// (lib/team/qr.ts) with the host the page was asked for. Without a usable host, the links alone.

import { headers } from "next/headers";
import type { Track } from "@msim/engine";
import { TRACK_LABELS } from "@msim/engine";
import { originOf, qrSvg, teamQrLinks } from "@/lib/team/qr";

export async function QrCard({ track }: { track: Track }) {
  const origin = originOf(await headers());
  if (!origin) return null;
  const links = teamQrLinks(track, origin);
  const [demo, guide] = await Promise.all([qrSvg(links.demo), qrSvg(links.guide)]).catch(() => [null, null] as const);
  const items = [
    { key: "demo", title: "Demo walkthrough", note: "Try every step on sample data", href: links.demo, svg: demo },
    { key: "guide", title: `${TRACK_LABELS[track]} guide`, note: "The rules and times for your track", href: links.guide, svg: guide },
  ];
  return (
    <section className="mx-panel rounded-2xl p-4" aria-label="Scan for help" data-testid="qr-card">
      <h2 className="text-lg font-extrabold text-phosphor">Scan for help</h2>
      <p className="mt-0.5 text-sm text-muted">Open these on a phone: they need no sign-in.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <a key={i.key} href={i.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line p-3 hover:border-phosphor" data-testid={`qr-${i.key}`}>
            {i.svg ? (
              // The SVG is drawn by the qrcode package from our own link: paths only, no text or script.
              <span className="block h-28 w-28 shrink-0 rounded bg-white p-1" aria-hidden dangerouslySetInnerHTML={{ __html: i.svg }} />
            ) : null}
            <span className="min-w-0">
              <span className="block font-semibold text-phosphor">{i.title}</span>
              <span className="block text-sm text-paper">{i.note}</span>
              <span className="mt-1 block break-all font-mono text-xs text-muted">{i.href.replace(/^https?:\/\//, "")}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
