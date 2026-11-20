// The bulletin banner: the latest published bulletin, under the header. The projector is the hall's only view of
// most bulletins, so the title and the body each get up to two lines (a title may be 140 characters); the board
// below takes whatever height is left. With no bulletin yet there is no banner. Drawn as the demo's alert box
// (.guide-alert; a crisis or flash as its .guide-warning), with the kind in a .guide-chip.

import type { DisplayBulletin } from "@/lib/display/frame";
import { clock } from "@/lib/format";

export function BulletinBanner({ bulletin }: { bulletin: DisplayBulletin | null }) {
  if (!bulletin) return null;
  const warn = bulletin.kind === "CRISIS" || bulletin.kind === "FLASH";
  return (
    <div
      className={`guide-alert guide-stage-banner ${warn ? "guide-warning" : ""} mx-6 flex max-h-[200px] min-h-[110px] shrink-0 items-center gap-6`}
      data-kind={bulletin.kind}
      data-testid="display-bulletin"
    >
      <b className="guide-chip shrink-0" data-kind={bulletin.kind}>
        {bulletin.kind}
      </b>
      <span className="guide-stage-time shrink-0 tabular-nums">{clock(bulletin.published_at)}</span>
      <div className="min-w-0">
        <p className={`line-clamp-2 leading-tight font-bold text-[#f0fff3] ${bulletin.title.length > 70 ? "text-[34px]" : "text-[38px]"}`}>{bulletin.title}</p>
        {bulletin.body ? <p className="line-clamp-2 text-[26px] leading-snug text-[#9db1a1]">{bulletin.body}</p> : null}
      </div>
    </div>
  );
}
