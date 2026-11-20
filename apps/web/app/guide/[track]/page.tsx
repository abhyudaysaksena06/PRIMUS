import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseMarkdown } from "@/lib/team/markdown";
import { GUIDE_TRACKS, type GuideTrack } from "@/lib/team/qr";
import { Markdown } from "@/app/team/judging/markdown";
import "@/app/demo/demo.css";

// The public track guide (/guide/product, /guide/consulting, /guide/finance): docs/event/primus/<TRACK>.md as a page,
// opened from the QR code on a team's Home without signing in. Built once at `next build` (static), when the repository
// is there, so the deployed app does not need the docs folder at run time; rendered as React text, never as HTML.

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDE_TRACKS.map((track) => ({ track }));
}

const TITLES: Record<GuideTrack, string> = { product: "Product", consulting: "Consulting", finance: "Finance" };

/** The guide's text: from the app folder (next build runs in apps/web) or from the repository root. */
async function readGuide(track: GuideTrack): Promise<string | null> {
  const file = `${track.toUpperCase()}.md`;
  for (const dir of [path.join(process.cwd(), "..", "..", "docs", "event", "primus"), path.join(process.cwd(), "docs", "event", "primus")]) {
    try {
      return await readFile(path.join(dir, file), "utf8");
    } catch {
      // try the next place
    }
  }
  return null;
}

const isTrack = (t: string): t is GuideTrack => (GUIDE_TRACKS as readonly string[]).includes(t);

export async function generateMetadata({ params }: PageProps<"/guide/[track]">): Promise<Metadata> {
  const { track } = await params;
  return { title: isTrack(track) ? `PRIMUS ${TITLES[track]} guide` : "PRIMUS guide" };
}

export default async function GuidePage({ params }: PageProps<"/guide/[track]">) {
  const { track } = await params;
  if (!isTrack(track)) notFound();
  const text = await readGuide(track);
  return (
    // The demo's look (app/demo): its page head and one panel, in the track's colours, over the demo's background.
    <main className="guide-app min-h-dvh" data-track={track.toUpperCase()}>
      <div className="guide-atmosphere" />
      <div className="relative mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="guide-page-head">
          <small>PRIMUS ’26 · {TITLES[track].toUpperCase()} GUIDE</small>
          <h1>How the {TITLES[track]} track plays.</h1>
        </div>
        {text ? (
          <article className="guide-panel" data-testid="guide">
            <div className="guide-panel-head">
              <h2>{TITLES[track]} guide</h2>
              <span>NO SIGN-IN NEEDED</span>
            </div>
            <div className="guide-panel-body">
              <Markdown blocks={parseMarkdown(text)} label={`${TITLES[track]} guide`} />
            </div>
          </article>
        ) : (
          <p className="guide-alert guide-warning" data-testid="guide-missing">
            The guide is not available here. Ask a member of staff.
          </p>
        )}
        <nav className="mt-6 flex flex-wrap gap-2">
          {GUIDE_TRACKS.filter((t) => t !== track).map((t) => (
            <Link key={t} href={`/guide/${t}`} className="guide-btn secondary">
              {TITLES[t]} guide
            </Link>
          ))}
          <Link href="/login" className="guide-btn">
            Sign in →
          </Link>
        </nav>
      </div>
    </main>
  );
}
