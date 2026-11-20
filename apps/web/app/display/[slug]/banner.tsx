// The bulletin banner: the latest published bulletin, under the header. The projector is the hall's only view of
// most bulletins, so the title and the body each get up to two lines (a title may be 140 characters); the board
// below takes whatever height is left. With no bulletin yet there is no banner.

import type { DisplayBulletin } from "@/lib/display/frame";
import { clock } from "@/lib/format";

const KIND: Record<string, string> = {
  CRISIS: "bg-danger text-ink",
  FLASH: "bg-warn text-ink",
  FAIRNESS: "bg-phosphor-mid text-ink",
  SYSTEM: "bg-phosphor-deep text-phosphor",
  GENERAL: "border-2 border-[rgba(91,139,100,.5)] bg-[rgba(57,255,136,.08)] text-[#39ff88]",
};

export function BulletinBanner({ bulletin }: { bulletin: DisplayBulletin | null }) {
  if (!bulletin) return null;
  return (
    <div className="dsp-header flex max-h-[200px] min-h-[110px] shrink-0 items-center gap-6 px-12 py-3" data-testid="display-bulletin">
      <span className={`shrink-0 px-4 py-1 font-mono text-[26px] font-black tracking-wider ${KIND[bulletin.kind] ?? KIND.GENERAL}`}>{bulletin.kind}</span>
      <span className="dsp-label shrink-0 text-[30px] tabular-nums">{clock(bulletin.published_at)}</span>
      <div className="min-w-0">
        <p className={`line-clamp-2 leading-tight font-bold text-[#f0fff3] ${bulletin.title.length > 70 ? "text-[34px]" : "text-[38px]"}`}>{bulletin.title}</p>
        {bulletin.body ? <p className="line-clamp-2 text-[26px] leading-snug text-[#9db1a1]">{bulletin.body}</p> : null}
      </div>
    </div>
  );
}
