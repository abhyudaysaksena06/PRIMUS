import type { Metadata } from "next";
import Link from "next/link";
import { featureOn } from "@/lib/event-status";
import { clock, money } from "@/lib/format";
import { RULES } from "@msim/engine";
import { loadTeamContext } from "@/lib/team/context";
import { loadCrisisRoom } from "@/lib/team/crisis-data";
import { FIRM_CLIENTS_PER_SUBROUND, currentSubround, feeBand, hiringOpen, stepAt, subroundTitle } from "@/lib/team/crisis";
import { profileCompleteness, ratingSummary } from "@/lib/team/hire";
import { aboutText, minBidText, rateShares, rateText } from "@/lib/team/hire-lists";
import { sectionAllowed } from "@/lib/team/sections";
import { pauseOf } from "@/lib/team/squad-data";
import { ActionForm } from "@/components/ui/action";
import { buttonClass } from "@/components/ui/ui";
import { RoomShell } from "../../crisis/room-shell";
import { makeOffer } from "../../crisis/actions";
import { EngagementTable, OfferCard, TermsFields } from "../../crisis/parts";
import { Chip, GuideAlert, GuidePanel } from "../../crisis/guide";

export const metadata: Metadata = { title: "Firm profile" };

// One Consulting firm's profile: its pitch (headline, specialities, about, rate card, asking fee), its value and
// clients, every star its clients gave it and its track record. A Product team hires it from here (an offer, then the
// firm's answer and counters), and once hired opens the one-on-one hire chat.
export default async function FirmProfilePage({ params }: { params: Promise<{ code: string }> }) {
  const ctx = await loadTeamContext();
  if (!sectionAllowed(ctx.team.track, "/firms")) return <GuideAlert>This section is not part of your team&apos;s portal.</GuideAlert>;
  const data = await loadCrisisRoom(ctx);
  if (data.format !== "PRIMUS") return <GuideAlert>Tonight&apos;s event plays the classic format: there is no firm marketplace.</GuideAlert>;
  const { code } = await params;
  const f = data.firms.find((x) => x.code.toLowerCase() === decodeURIComponent(code).toLowerCase());
  if (!f) {
    return (
      <GuideAlert>
        No firm with the code {decodeURIComponent(code)}.{" "}
        <Link href="/team/firms" className="underline">
          Back to the directory
        </Link>
      </GuideAlert>
    );
  }
  const p = data.profiles.get(f.team_id);
  const rank = data.firms.findIndex((x) => x.team_id === f.team_id) + 1;
  const k = currentSubround(ctx.status.phase, data.subrounds);
  const nowMs = new Date(ctx.status.server_time).getTime();
  const hiring = hiringOpen(k, ctx.status.phase, data.deadlines, nowMs, pauseOf(ctx));
  const isMe = f.team_id === ctx.team.id;
  const product = ctx.team.track === "PRODUCT";
  const mine = product ? data.companies.find((c) => c.product_team_id === ctx.team.id) ?? null : null;
  const record = data.engagements.filter((e) => e.firm_team_id === f.team_id);
  const takenNow = k === null ? 0 : record.filter((e) => e.k === k).length;
  const full = takenNow >= FIRM_CLIENTS_PER_SUBROUND;
  const hiredNow = k !== null && mine ? data.engagements.find((e) => e.company_id === mine.id && e.k === k) : undefined;
  const hiredThisFirm = mine ? record.some((e) => e.company_id === mine.id) : false;
  const offers = mine ? data.offers.filter((o) => o.company_id === mine.id && o.firm_team_id === f.team_id && (k === null || o.k === k)) : [];
  const openOffer = offers.some((o) => o.status === "OPEN");
  const openOffers = k !== null && mine ? data.offers.filter((o) => o.company_id === mine.id && o.k === k && o.status === "OPEN" && o.opened_by === "COMPANY").length : 0;
  const stars = ratingSummary(data.engagements, f.team_id);
  const band = k === 5 ? feeBand(ctx.team.cash) : null;
  // Tonight's hiring rules (migration 071): the firm's base rate is its minimum bid and what a drawn client pays.
  const minBidOn = featureOn(ctx.status, "hire_min_bid");
  const drawOn = featureOn(ctx.status, "hire_base_rate");
  const rate = minBidOn || drawOn ? f.base_rate_bp : null;
  const rateCells: string[][] = [
    ...(rate !== null ? [["Base rate", rateText(rate), "text-[#39ff88]"]] : []),
    ...(rate !== null && minBidOn && f.min_bid_cents !== null ? [["Your minimum bid", aboutText(f.min_bid_cents), "text-[#39ff88]"]] : []),
  ];

  return (
    <RoomShell track={ctx.team.track}>
      <p className="text-sm">
        <Link href="/team/firms" className="text-[#39ff88] hover:underline">
          ← All firms
        </Link>
      </p>

      <section className="pd-panel overflow-hidden" aria-label="Firm" data-testid="firm-profile">
        <div className="pd-panel-head justify-start">
          <span className="guide-chip active text-sm">{f.code}</span>
          <span className="pd-title my-0 text-2xl sm:text-3xl">{f.name}</span>
          <Chip tone="slate">#{rank} by value</Chip>
          {isMe ? <Chip tone="violet">Your firm</Chip> : null}
          {hiredThisFirm ? <Chip tone="green">Hired by you</Chip> : null}
          {k !== null ? (
            <Chip tone={full ? "red" : "green"}>
              {takenNow}/{FIRM_CLIENTS_PER_SUBROUND} clients this sub-round
            </Chip>
          ) : null}
        </div>
        <div className="pd-panel-body">
          <p className="text-base font-semibold text-paper">{p?.headline || <span className="font-normal text-muted">This firm has not written a headline yet.</span>}</p>
          {p?.specialities.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Specialities">
              {p.specialities.map((s) => (
                <li key={s} className="guide-chip">
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="pd-mini-metrics mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Firm value", money(f.value_cents), "text-[var(--term-green)]"],
              ["Cash", money(f.cash_cents), "text-paper"],
              ["Fee shares", money(f.fee_share_value_cents), "text-paper"],
              ["Clients so far", String(f.clients), "text-paper"],
              ["Avg rating", f.avg_rating === null ? "—" : `★ ${f.avg_rating.toFixed(2)}`, "text-paper"],
              ["Asking fee", p && p.asking_cents > 0 ? money(p.asking_cents) : "—", "text-[#39ff88]"],
              ...rateCells,
            ].map(([label, value, tone]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={`font-mono ${tone}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <GuidePanel title="About the firm">
          {p?.about ? <p className="whitespace-pre-wrap text-sm text-paper">{p.about}</p> : <p className="guide-muted">Nothing written yet.</p>}
          <h3 className="guide-label uppercase mb-1 mt-5">Rate card</h3>
          {p?.rate_card ? <p className="whitespace-pre-wrap text-sm text-paper">{p.rate_card}</p> : <p className="guide-muted">No rate card yet.</p>}
          <p className="mt-3 text-xs text-muted">Profile {profileCompleteness(p)}/5 complete.</p>
          {isMe ? (
            <Link href="/team/crisis" className={`${buttonClass.secondary} mt-3 inline-block`}>
              Edit your profile in the Crisis room
            </Link>
          ) : null}
        </GuidePanel>

        <GuidePanel title="Client ratings">
          {stars.rated === 0 ? (
            <p className="guide-muted">No client has rated this firm yet.</p>
          ) : (
            <ul className="space-y-1" aria-label="Ratings">
              {[5, 4, 3, 2, 1].map((r) => {
                const n = stars.stars[r - 1];
                return (
                  <li key={r} className="flex items-center gap-2 text-sm">
                    <span className="w-14 font-mono text-[#39ff88]">{"★".repeat(r)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                      <span className="block h-2 rounded-full bg-[var(--term-amber)]" style={{ width: `${(n / stars.rated) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right font-mono text-paper">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {stars.defaults ? <p className="mt-2 text-xs text-muted">{stars.defaults} of these are the default 3 stars (the client did not rate).</p> : null}
        </GuidePanel>
      </div>

      {product ? (
        <GuidePanel title={k === null ? "Hire this firm" : `Hire this firm · ${subroundTitle(k)}`}>
          {hiredThisFirm ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <GuideAlert>You have hired this firm. Talk to it one on one in the hire chat.</GuideAlert>
              <Link href={`/team/messages?c=${mine!.id}&f=${f.team_id}`} className={buttonClass.primary} data-testid="open-hire-chat">
                Open the hire chat →
              </Link>
            </div>
          ) : null}
          {!mine ? (
            <GuideAlert>Your company appears here once it is listed.</GuideAlert>
          ) : k === null ? (
            <GuideAlert>Hiring opens in Round 2, when the first crisis card is revealed.</GuideAlert>
          ) : hiredNow ? (
            hiredNow.firm_team_id === f.team_id ? null : (
              <GuideAlert>You already hired {data.firms.find((x) => x.team_id === hiredNow.firm_team_id)?.code ?? "a firm"} for this sub-round (one firm per sub-round).</GuideAlert>
            )
          ) : !hiring ? (
            <GuideAlert>{k === 5 ? "Hiring opens when the draft ends." : "Hiring for this sub-round is closed."}</GuideAlert>
          ) : full ? (
            <GuideAlert tone="bad">This firm already has {FIRM_CLIENTS_PER_SUBROUND} clients this sub-round. Pick another firm.</GuideAlert>
          ) : openOffer ? (
            <GuideAlert tone="warn">Your offer to this firm is open: see it below. The firm can accept, decline or counter.</GuideAlert>
          ) : openOffers >= RULES.MAX_OPEN_OFFERS ? (
            <GuideAlert tone="warn">
              You have {openOffers} of {RULES.MAX_OPEN_OFFERS} offers open. Withdraw one, or wait for a firm to answer, before sending another.
            </GuideAlert>
          ) : (
            <>
              <p className="mb-3 text-sm text-paper">
                Offer {f.code} a stake in your company (equity %), with cash only if you want to add it. The firm can accept, decline or counter; each side
                counters at most three times. Accepting is binding: the fee is held until the due time and goes to the firm if its memo is in. Hiring closes at {clock(stepAt(data.deadlines, "HIRE", k))}.
                {band ? ` In Round 3 the fee must be worth ${money(band.min)}–${money(band.max)} (5–20% of your cash).` : ""}
              </p>
              <ActionForm action={makeOffer.bind(null, f.team_id, f.code)} submit={`Send offer to ${f.code}`} resetOnSuccess>
                <TermsFields
                  cash={0}
                  shares={minBidOn && rate !== null ? rateShares(rate) : 0}
                  priceCents={mine?.market_price ?? null}
                  hint={
                    [
                      minBidOn && rate !== null ? `Minimum bid: ${minBidText(rate, mine?.market_price)}; less is refused.` : "",
                      p && p.asking_cents > 0 ? `The firm asks for about ${money(p.asking_cents)}.` : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
                <label className="mt-2 block text-sm">
                  <span className="guide-label uppercase">Note to the firm (optional)</span>
                  <input name="note" maxLength={300} placeholder="What you need help with" className={`guide-input mt-1`} />
                </label>
              </ActionForm>
            </>
          )}
          {offers.length ? (
            <>
              <h3 className="guide-label uppercase mb-2 mt-5">Your offers to {f.code}</h3>
              <ul className="space-y-2">
                {offers.map((o) => (
                  <OfferCard key={o.id} offer={o} side="COMPANY" hiring={hiring} counterpart={f.code} priceCents={mine?.market_price ?? null} />
                ))}
              </ul>
            </>
          ) : null}
        </GuidePanel>
      ) : null}

      <EngagementTable data={data} rows={[...record].reverse()} title={`Track record · ${f.code}`} />
    </RoomShell>
  );
}
