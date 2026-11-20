import { BULLETIN_KIND_LABELS, type BulletinKind } from "@/lib/admin/content-bulletins";
import { clock, dateTime } from "@/lib/format";

export interface PublishedBulletin {
  id: string;
  kind: string;
  title: string;
  body: string;
  published_at: string;
}

const kindOf = (k: string): BulletinKind => (k in BULLETIN_KIND_LABELS ? (k as BulletinKind) : "GENERAL");

/** One published bulletin, as a story of the demo's newsroom feed (app/demo/newsroom): the kind and the time (IST) on
 *  one row, the title, the body. FLASH and CRISIS bulletins move prices: they carry the kind's colour (team.css). */
export function BulletinItem({ b, clamp = false }: { b: PublishedBulletin; clamp?: boolean }) {
  const kind = kindOf(b.kind);
  return (
    <article className="guide-news-story" data-kind={kind} aria-label={`${BULLETIN_KIND_LABELS[kind]} bulletin: ${b.title}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="guide-status">{BULLETIN_KIND_LABELS[kind]}</span>
        <time dateTime={b.published_at} title={`${dateTime(b.published_at)} IST`} className="guide-news-time">
          {clock(b.published_at, true)} IST
        </time>
      </div>
      <h3 className="mt-2 text-sm font-semibold">{b.title}</h3>
      {b.body ? <p className={`guide-muted mt-1 whitespace-pre-wrap ${clamp ? "line-clamp-3" : ""}`}>{b.body}</p> : null}
    </article>
  );
}
