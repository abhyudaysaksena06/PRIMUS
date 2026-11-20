import type { Metadata } from "next";
import { loadAdminEvent, loadEventStatus } from "@/lib/admin/event";
import { loadSquads, loadSubmissions, mark } from "@/lib/admin/tracks-data";
import { supabaseServer } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { equityText } from "@/lib/team/equity";
import { Notice, Panel, Stat, Table, Td } from "@/app/admin/guide-ui";
import { Countdown } from "@/components/ui/countdown";

export const metadata: Metadata = { title: "Product" };

const CRISES = ["CRISIS_1", "CRISIS_2", "CRISIS_3", "CRISIS_4"] as const;

// The Product track: every company's hand-ins (the PRD, the four crisis plans, the Round 3 solution) and its price,
// and the Round 3 draft.
export default async function ProductTrack({ params }: PageProps<"/admin/[slug]/product">) {
  const { slug } = await params;
  const event = await loadAdminEvent(slug);
  const [status, { squads }, subs] = await Promise.all([loadEventStatus(event.id), loadSquads(event.id), loadSubmissions(event.id)]);
  const sb = await supabaseServer();
  const [picks, statements] = await Promise.all([
    sb.from("draft_picks").select("company_id, pick_no, closes_at, statement_id, by_default").eq("event_id", event.id).order("pick_no"),
    sb.from("problem_statements").select("id, number, title, cap, sector").eq("event_id", event.id).order("number"),
  ]);
  // Round 2 equity raises (migration 067): which company sold how much of itself, to which fund, at what price.
  const raises = await sb
    .from("raises")
    .select("id, company_id, k, shares, status, funded_by, price_cents, cash_cents, created_at")
    .eq("event_id", event.id)
    .order("created_at", { ascending: false });
  const raiseRows = (raises.data ?? []) as {
    id: string; company_id: string; k: number; shares: number; status: string; funded_by: string | null;
    price_cents: number | null; cash_cents: number | null; created_at: string;
  }[];
  const fundCode = new Map(squads.map((s) => [s.finance.id, s.finance.code]));
  const sub = (company: string | undefined, type: string) => subs.find((s) => s.company_id === company && s.type === type);
  const companies = squads.filter((s) => s.company);
  const done = (type: string) => companies.filter((s) => sub(s.company!.id, type)?.submitted_at).length;
  const draftPicks = (picks.data ?? []) as { company_id: string; pick_no: number; closes_at: string; statement_id: string | null; by_default: boolean }[];
  const stRows = (statements.data ?? []) as { id: string; number: number; title: string; cap: number; sector: string | null }[];
  const ticker = new Map(companies.map((s) => [s.company!.id, s.company!.ticker ?? "—"]));
  const onClock = draftPicks.find((p) => p.statement_id === null) ?? null;
  // Room in the statements: in an event split across sectors, each sector's statements must fit that sector's companies.
  const room = stRows.reduce((t, x) => t + x.cap, 0);
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const sectorShort = stRows.some((x) => x.sector)
    ? [...new Set(companies.map((c) => c.sector).filter((v): v is string => !!v))]
        .map((sec) => ({
          sec,
          n: companies.filter((c) => norm(c.sector) === norm(sec)).length,
          room: stRows.filter((x) => norm(x.sector) === norm(sec)).reduce((t, x) => t + x.cap, 0),
        }))
        .filter((x) => x.room < x.n)
    : [];
  const pickOf = new Map(draftPicks.filter((p) => p.statement_id).map((p) => [p.company_id, stRows.find((s) => s.id === p.statement_id)?.number ?? null]));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Companies" value={companies.length} hint={squads.length ? `${squads.length} squads` : "after the squad draw"} />
        <Stat label="PRDs submitted" value={`${done("PITCH")} / ${companies.length}`} hint="Round 1" />
        <Stat
          label="Crisis plans"
          value={CRISES.map((t) => done(t)).join(" · ")}
          hint="submitted in crises 1 · 2 · 3 · 4"
        />
        <Stat label="Solutions" value={`${done("SOLUTION")} / ${companies.length}`} hint="Round 3" />
      </div>

      <Panel title="Companies">
        {companies.length === 0 ? (
          <p className="guide-muted">The companies appear after the squad draw.</p>
        ) : (
          <Table head={["Squad", "Team", "Company", "Sector", "PRD", "Crisis 1", "Crisis 2", "Crisis 3", "Crisis 4", "Statement", "Solution", "Price"]} label="Companies">
            {companies.map((s) => (
              <tr key={s.id} data-testid={`product-${s.product.code}`}>
                <Td mono>{s.number}</Td>
                <Td mono>{s.product.code}</Td>
                <Td>
                  <span className="font-mono font-semibold">{s.company!.ticker ?? "—"}</span> <span className="text-muted">{s.company!.name ?? ""}</span>
                </Td>
                <Td>{s.sector ?? "—"}</Td>
                <Td>{mark(sub(s.company!.id, "PITCH"))}</Td>
                {CRISES.map((t) => (
                  <Td key={t}>{mark(sub(s.company!.id, t))}</Td>
                ))}
                <Td mono>{pickOf.get(s.company!.id) ?? "—"}</Td>
                <Td>{mark(sub(s.company!.id, "SOLUTION"))}</Td>
                <Td mono>{s.company!.price ? money(s.company!.price) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="guide-muted mt-2">✓ submitted · ✓ auto: the last saved draft, submitted for the team at the deadline · — nothing yet.</p>
      </Panel>

      {event.format === "PRIMUS" ? (
        <Panel title="Round 3 · the draft" actions={<a href={`/admin/${slug}/content`} className="text-sm underline">Statements</a>}>
          {stRows.length === 0 ? (
            <Notice tone={status.phase === "SATURATION" ? "red" : "amber"}>
              {status.phase === "SATURATION"
                ? "Round 3 has started but there are no problem statements: the draft is waiting. Upload them under Content now; the draft starts at once."
                : "No problem statements yet. Upload them under Content before Round 3: the draft starts with Round 3 only if they are there."}
            </Notice>
          ) : sectorShort.length ? (
            <Notice tone="red">
              Not enough room in {sectorShort.map((x) => `${x.sec} (room for ${x.room}, ${x.n} companies)`).join(", ")}. Each sector&apos;s statements must fit
              its companies: raise the caps or add statements under Content.
            </Notice>
          ) : room < companies.length ? (
            <Notice tone="red">
              The statements have room for {room} companies, but {companies.length} companies play. Raise the caps or add statements under Content.
            </Notice>
          ) : draftPicks.length === 0 ? (
            <p className="text-sm text-paper">
              {stRows.length} statements, room for {room} companies ({companies.length} play). The draft starts with Round 3: lowest score so far first, 20 seconds each.
            </p>
          ) : onClock ? (
            <p className="text-sm text-paper">
              On the clock: <strong className="font-mono">{ticker.get(onClock.company_id)}</strong> (pick {onClock.pick_no} of {draftPicks.length}) ·{" "}
              <Countdown to={onClock.closes_at} passed="given by default on the next heartbeat" /> · {draftPicks.filter((p) => p.statement_id).length} picked.
            </p>
          ) : (
            <p className="text-sm font-semibold text-phosphor">
              The draft is over: every company has its statement ({draftPicks.filter((p) => p.by_default).length} given by default).
            </p>
          )}
          {draftPicks.length ? (
            <Table head={["#", "Sector", "Statement", "Companies"]} className="mt-3" label="Draft">
              {stRows.map((s) => {
                const on = draftPicks.filter((p) => p.statement_id === s.id);
                return (
                  <tr key={s.id}>
                    <Td mono>{s.number}</Td>
                    <Td>{s.sector ?? "—"}</Td>
                    <Td>{s.title}</Td>
                    <Td mono>
                      {on.length}/{s.cap} {on.map((p) => `${ticker.get(p.company_id)}${p.by_default ? "*" : ""}`).join(" ")}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ) : null}
          <p className="guide-muted mt-2">* given by default (no pick in time).</p>
        </Panel>
      ) : null}

      <Panel title="Round 2 · equity raised from Finance">
        <div data-testid="admin-raises">
          <Table head={["Crisis", "Company", "Stake", "Status", "Fund", "Price", "Cash"]} empty={raiseRows.length === 0 ? "No company has raised from Finance yet." : undefined}>
            {raiseRows.map((r) => (
              <tr key={r.id}>
                <Td mono>{r.k || "—"}</Td>
                <Td mono>{ticker.get(r.company_id) ?? "—"}</Td>
                <Td mono>{equityText(r.shares)}</Td>
                <Td>{r.status}</Td>
                <Td mono>{r.funded_by ? (fundCode.get(r.funded_by) ?? "—") : "—"}</Td>
                <Td mono>{r.price_cents ? money(r.price_cents) : "—"}</Td>
                <Td mono>{r.cash_cents ? money(Number(r.cash_cents)) : "—"}</Td>
              </tr>
            ))}
          </Table>
          <p className="guide-muted mt-2">
            Funded: {raiseRows.filter((r) => r.status === "FUNDED").length} raises,{" "}
            {money(raiseRows.filter((r) => r.status === "FUNDED").reduce((t, r) => t + Number(r.cash_cents ?? 0), 0))} paid by funds.
          </p>
        </div>
      </Panel>
    </div>
  );
}
