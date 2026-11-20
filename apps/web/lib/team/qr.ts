// The two QR codes on a team's Home: its track's demo walkthrough (the public /demo pages, opened as that track) and
// its track guide (the public /guide/<track> page). Links use the host the page was asked for, so a code scanned on
// the night opens the same deployment.

import QRCode from "qrcode";
import type { Track } from "@msim/engine";

/** The closest demo page per track (the demo picks its track from ?asTrack=). */
export const DEMO_PATHS: Record<Track, string> = {
  FINANCE: "/demo/finance?asTrack=FINANCE",
  PRODUCT: "/demo/dashboard?asTrack=PRODUCT",
  CONSULTING: "/demo/dashboard?asTrack=CONSULTING",
};

export const GUIDE_TRACKS = ["product", "consulting", "finance"] as const;
export type GuideTrack = (typeof GUIDE_TRACKS)[number];
export const guidePath = (track: Track) => `/guide/${track.toLowerCase()}`;

/** "https://primus.example.com" from the request's headers (http for localhost); null without a usable host. */
export function originOf(headers: { get(name: string): string | null }): string | null {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}

export function teamQrLinks(track: Track, origin: string): { demo: string; guide: string } {
  return { demo: `${origin}${DEMO_PATHS[track]}`, guide: `${origin}${guidePath(track)}` };
}

/** A QR code as an SVG string (paths only, no text). */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
}
