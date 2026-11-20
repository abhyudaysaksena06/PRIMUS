import type { Metadata } from "next";
import Link from "next/link";
import { featureOn } from "@/lib/event-status";
import { money } from "@/lib/format";
import { loadTeamContext } from "@/lib/team/context";
import { loadCrisisRoom } from "@/lib/team/crisis-data";
import { FIRM_CLIENTS_PER_SUBROUND, currentSubround, hiringOpen, subroundTitle } from "@/lib/team/crisis";
import { FIRM_SORTS, parseSort, profileCompleteness, searchFirms } from "@/lib/team/hire";
import { minBidText, openFirms, rateText } from "@/lib/team/hire-lists";
import { sectionAllowed } from "@/lib/team/sections";
import { pauseOf } from "@/lib/team/squad-data";
import { RoomShell } from "../crisis/room-shell";
import { buttonClass } from "@/components/ui/ui";
import { Chip, GuideAlert, GuidePanel } from "../crisis/guide";

export const metadata: Metadata = { title: "Firms" };

// The Consulting firm directory: every firm of the event with its profile, value, clients and rating, searchable and
// sortable. A Product team opens a firm's profile to hire it; a firm sees the field it competes in. While hiring is
// open a full firm is not listed (locked = gone: the hire_locked message makes the page re-read as one fills).
export default async function FirmsPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/firms")) return <GuideAlert>This section is not part of your team&apos;s portal.</GuideAlert>;
  const data = await loadCrisisRoom(ctx);
  if (data.format !== "PRIMUS") return <GuideAlert>Tonight&apos;s event plays the classic format: there is no firm marketplace.</GuideAlert>;
  const { q = "", sort: rawSort } = await searchParams;
  const sort = parseSort(rawSort);
  const query = q.slice(0, 80);
  const k = currentSubround(ctx.status.phase, data.subrounds);
  const nowMs = new Date(ctx.status.server_time).getTime();
  const hiring = hiringOpen(k, ctx.status.phase, data.deadlines, nowMs, pauseOf(ctx));
  const product = ctx.team.track === "PRODUCT";
  const mine = product ? data.companies.find((c) => c.product_team_id === ctx.team.id) ?? null : null;
  const hiredNow = k !== null && mine ? data.engagements.find((e) => e.company_id === mine.id && e.k === k) : undefined;
  const found = searchFirms(data.firms, data.profiles, query, sort);
  const firms = hiring && k !== null ? openFirms(found, data.engagements, k) : found;
  const fullHidden = found.length - firms.length;
  const minBidOn = featureOn(ctx.status, "hire_min_bid");
  const drawOn = featureOn(ctx.status, "hire_base_rate");

  return (
    <RoomShell
      track={ctx.team.track}
      eyebrow={k !== null ? subroundTitle(k) : "Firm marketplace"}
      title="Consulting firms"
      lede={product ? "Compare every firm's pitch, base rate, value and client ratings, then offer the one you want a stake in your company." : "The marketplace as Product teams see it when they choose whom to hire."}
    >
      <GuidePanel title="Consulting firm directory">
        <p className="text-sm text-paper">
          {product
            ? "Every Consulting firm of tonight's event. Open a firm's profile to read its pitch, track record and client ratings, then send it an offer. Once a firm accepts, a private one-on-one chat with it opens under Hire chat."
            : "Every Consulting firm of tonight's event, as Product teams see it when they choose whom to hire. Edit your own profile in the Crisis room."}
        </p>
        {k !== null ? (
          <p className="mt-2 text-sm">
            <span className="text-[#39ff88]">{subroundTitle(k)}</span>
            <span className="text-paper"> · hiring is {hiring ? "open" : "closed"}</span>
            {hiredNow ? (
              <span className="text-paper">
                {" "}· you hired <strong>{data.firms.find((f) => f.team_id === hiredNow.firm_team_id)?.code ?? "a firm"}</strong> this sub-round
              </span>
            ) : null}
          </p>
        ) : null}
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2" role="search" aria-label="Search the firms">
          <label className="min-w-0 flex-1 text-sm">
            <span className="guide-label uppercase">Search</span>
            <input name="q" defaultValue={query} placeholder="pricing, supply chain, C07…" className={`guide-input mt-1`} />
          </label>
          <label className="text-sm">
            <span className="guide-label uppercase">Sort by</span>
            <select name="sort" defaultValue={sort} className={`guide-input mt-1`}>
              {FIRM_SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass.primary}>
            Search
          </button>
          {query || rawSort ? (
            <Link href="/team/firms" className={buttonClass.secondary}>
              Clear
            </Link>
          ) : null}
        </form>
      </GuidePanel>

      {fullHidden > 0 ? (
        <p className="guide-muted" data-testid="full-firms-hidden">
          {fullHidden === 1 ? "1 firm is" : `${fullHidden} firms are`} full for this {k === 5 ? "round" : "crisis"} and not shown.
        </p>
      ) : null}
      {firms.length === 0 ? (
        <GuideAlert>
          {data.firms.length === 0
            ? "No Consulting firm in this event yet."
            : found.length === 0
              ? "No firm matches that search."
              : `Every firm${query ? " that matches" : ""} is full for this ${k === 5 ? "round" : "crisis"}.`}
        </GuideAlert>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Firms">
          {firms.map((f) => {
            const p = data.profiles.get(f.team_id);
            const taken = k === null ? 0 : data.engagements.filter((e) => e.firm_team_id === f.team_id && e.k === k).length;
            const hiredByMe = mine ? data.engagements.some((e) => e.company_id === mine.id && e.firm_team_id === f.team_id) : false;
            const openOffer = mine && k !== null ? data.offers.some((o) => o.company_id === mine.id && o.firm_team_id === f.team_id && o.k === k && o.status === "OPEN") : false;
            const complete = profileCompleteness(p);
            return (
              <li key={f.team_id} className={`border border-[#294832] p-3.5 flex flex-col ${hiredByMe ? "border border-[#294832] p-3.5-hot" : ""}`} data-testid={`directory-${f.code}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="guide-chip active">{f.code}</span>
                  <span className="text-base font-semibold text-paper">{f.name}</span>
                  {f.team_id === ctx.team.id ? <Chip tone="violet">You</Chip> : null}
                  {hiredByMe ? <Chip tone="green">Hired by you</Chip> : null}
                  {openOffer ? <Chip tone="amber">Offer open</Chip> : null}
                  {k !== null && taken >= FIRM_CLIENTS_PER_SUBROUND ? <Chip tone="red">Full this sub-round</Chip> : null}
                </div>
                <p className="mt-1 text-sm font-semibold text-paper">{p?.headline || <span className="font-normal text-muted">No headline yet.</span>}</p>
                {p?.specialities.length ? <p className="mt-1 text-xs text-[var(--term-cyan)]">{p.specialities.join(" · ")}</p> : null}
                {p?.about ? <p className="mt-1 line-clamp-2 text-xs text-muted">{p.about}</p> : null}
                <dl className="pd-mini-metrics mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt>Value</dt>
                    <dd className="font-mono text-[var(--term-green)]">{money(f.value_cents)}</dd>
                  </div>
                  <div>
                    <dt>Asking</dt>
                    <dd className="font-mono text-paper">{p && p.asking_cents > 0 ? money(p.asking_cents) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Clients</dt>
                    <dd className="font-mono text-paper">{f.clients}</dd>
                  </div>
                  <div>
                    <dt>Rating</dt>
                    <dd className="font-mono text-paper">{f.avg_rating === null ? "—" : `★ ${f.avg_rating.toFixed(1)}`}</dd>
                  </div>
                </dl>
                {f.base_rate_bp !== null && (minBidOn || drawOn) ? (
                  <p className="mt-2 text-xs text-[#39ff88]" data-testid={`directory-rate-${f.code}`}>
                    {minBidOn && mine ? `Minimum bid: ${minBidText(f.base_rate_bp, mine.market_price)}.` : `Base rate: ${rateText(f.base_rate_bp)} of a company.`}
                  </p>
                ) : null}
                <div className="mt-3 flex items-center gap-2">
                  <Link href={`/team/firms/${encodeURIComponent(f.code)}`} className={buttonClass.primary}>
                    {product && hiring && !hiredNow && f.team_id !== ctx.team.id ? "View profile & hire" : "View profile"}
                  </Link>
                  <span className="ml-auto text-[11px] text-muted">Profile {complete}/5</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </RoomShell>
  );
}
