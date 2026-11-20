import type { Metadata } from "next";
import Link from "next/link";
import { loadTeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { GuidePageTitle, GuidePanel } from "@/components/guide/guide";
import { BulletinItem, type PublishedBulletin } from "./bulletin";

export const metadata: Metadata = { title: "Bulletins" };

// Bulletins: every published bulletin of the event, newest first, as the demo's newsroom (app/demo/newsroom). A new
// one arrives over the event's realtime channel, which refreshes the page.
export default async function TeamBulletinsPage() {
  const { event } = await loadTeamContext();
  const sb = await supabaseServer();
  const rows = await fetchAll<PublishedBulletin>((from, to) =>
    sb
      .from("bulletins")
      .select("id, kind, title, body, published_at")
      .eq("event_id", event.id)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  // Crisis and flash bulletins are the ones that can move prices: the demo's second panel, from the same rows.
  const movers = rows.filter((b) => b.kind === "CRISIS" || b.kind === "FLASH");
  return (
    <>
      <GuidePageTitle
        as="p"
        eyebrow="EVENT-WIDE BULLETINS / ALL TEAMS"
        title="News & announcements."
        sub="The shared event feed: crises, flash news and organiser notices, newest first. New ones also run in the ticker at the bottom of every page."
      />
      <div className="guide-grid two">
        <GuidePanel title={`Bulletins (${rows.length})`} tag="EVENT-WIDE FEED">
          {rows.length === 0 ? (
            <p className="guide-muted">No bulletins yet. They appear here, and in the news ticker, the moment the organisers publish them.</p>
          ) : (
            <ul className="guide-scroll-box" aria-label="Bulletins">
              {rows.map((b) => (
                <li key={b.id}>
                  <BulletinItem b={b} />
                </li>
              ))}
            </ul>
          )}
        </GuidePanel>
        <GuidePanel title="Crisis & flash news" tag="CAN MOVE PRICES">
          {movers.length === 0 ? (
            <p className="guide-muted">No crisis or flash news yet.</p>
          ) : (
            <div className="space-y-3">
              {movers.slice(0, 4).map((b) => (
                <div key={b.id} className={`guide-alert ${b.kind === "CRISIS" ? "guide-warning" : ""}`}>
                  <b>{b.title}</b>
                  {b.body ? <span className="mt-1 line-clamp-3 block">{b.body}</span> : null}
                </div>
              ))}
            </div>
          )}
          <p className="guide-muted mt-4">Crisis and flash bulletins can move share prices. Other notices change nothing in the market.</p>
          <Link href="/team/market" className="guide-chip mt-3 inline-block">
            Open market prices
          </Link>
        </GuidePanel>
      </div>
      <div className="guide-alert mt-4">Organiser notices and changes to the plan appear here and in the ticker at the bottom of every page.</div>
    </>
  );
}
