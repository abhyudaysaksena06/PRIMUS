import { money } from "@/lib/format";
import type { CrisisReport, Standing } from "@/lib/team/report-data";
import { moveText, type ReportState } from "@/lib/team/report";
import { ordinal } from "@/lib/team/crisis";

const MARK: Record<ReportState, string> = { scored: "✓", judging: "…", now: "●", later: "" };
const WORDS: Record<ReportState, string> = { scored: "", judging: "being scored", now: "on now", later: "still to come" };
const name = (k: number) => (k === 5 ? "Round 3" : `Crisis ${k}`);
/** Round 3's leveller in words: the rise multiplier from this company's standing by score so far (migration 064). */
export const standingText = (s: Standing) =>
  s.of <= 1
    ? "Your price rise counts in full (×1.00)."
    : `Price rise ×${s.multiplier.toFixed(2)}: you are ${ordinal(s.place)} of ${s.of} by score so far (weakest ×1.25, strongest ×0.25).`;
const starText = (n: number) => `${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}`;

// Home, PRIMUS Rounds 2 and 3: this team's own line for each crisis (never another team's: rankings wait for the
// awards), as a row of the demo's chips inside the "Do this now" steps (the round's line).
export function CrisisReportLine({ report }: { report: CrisisReport }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Your crises so far" data-testid="crisis-report">
      {report.rows.map((r) => {
        const parts: string[] = [];
        let rank: string | null = null;
        if (report.kind === "company") {
          const c = r as Extract<CrisisReport, { kind: "company" }>["rows"][number];
          if (c.title) parts.push(c.title);
          if (c.score !== null) parts.push(`${c.score}/100${c.moveBp !== null ? ` price ${moveText(c.moveBp)}` : ""}`);
          if (c.state !== "later") parts.push(c.hired ? (c.rating !== null ? `Your firm: ${starText(c.rating)}` : "Firm hired") : "No firm hired");
          if (r.k === 5 && report.standing) rank = c.moveBp !== null && c.moveBp < 0 ? "A fall applies in full." : standingText(report.standing);
        } else {
          const f = r as Extract<CrisisReport, { kind: "firm" }>["rows"][number];
          if (f.state !== "later") {
            parts.push(f.clients === 0 ? "No client" : f.clients === 1 ? "1 client" : `${f.clients} clients`);
            if (f.avgRating !== null) parts.push(starText(f.avgRating));
            if (f.feesCents > 0 || f.feeShares > 0) parts.push(`Fees ${money(f.feesCents)}${f.feeShares > 0 ? ` + ${f.feeShares.toLocaleString("en-US")} shares` : ""}`);
            if (f.bonusCents !== null) parts.push(`Bonus ${f.bonusCents < 0 ? "−" : "+"}${money(Math.abs(f.bonusCents))}`);
          }
        }
        return (
          <li key={r.k} className={`guide-chip ${r.state === "now" ? "active" : ""} [overflow-wrap:anywhere]`} data-testid={`report-${r.k}`} data-state={r.state}>
            {MARK[r.state] ? <span aria-hidden>{MARK[r.state]}&nbsp;</span> : null}
            {name(r.k)}
            {WORDS[r.state] ? ` · ${WORDS[r.state]}` : ""}
            {parts.length ? ` · ${parts.join(" · ")}` : ""}
            {rank ? (
              <span data-testid="report-rank">
                {" · "}
                {rank}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
