// Reads Home's past rounds as the signed-in team, through RLS: the squad's (or, for a firm, its clients') current
// submissions, the released scores (teams read only released ones) and the SUB_TIER price moves. A failure gives no
// section rather than a broken Home.

import type { SubmissionType } from "@msim/engine";
import type { TeamContext } from "@/lib/team/context";
import { supabaseServer } from "@/lib/supabase/server";
import { pastRounds, type PastRound, type PastSubmission } from "./past-rounds";

const PRODUCT_TYPES: SubmissionType[] = ["PITCH", "CRISIS_1", "CRISIS_2", "CRISIS_3", "CRISIS_4", "SOLUTION"];
const FIRM_TYPES: SubmissionType[] = ["MEMO", "ADVICE_1", "ADVICE_2", "ADVICE_3", "ADVICE_4", "ADVICE_5"];

export async function loadPastRounds(ctx: TeamContext, closed: (code: string) => boolean): Promise<PastRound[] | null> {
  const { team, company } = ctx;
  if (ctx.event.format !== "PRIMUS" || team.track === "FINANCE") return null;
  if (!closed("PITCH") && ![1, 2, 3, 4, 5].some((k) => closed(`DUE_${k}`))) return [];
  try {
    const sb = await supabaseServer();
    let clients: { k: number; company_id: string; ticker: string | null }[] = [];
    if (team.track === "CONSULTING") {
      const { data, error } = await sb.from("engagements").select("k, company_id").eq("firm_team_id", team.id);
      if (error) throw new Error(error.message);
      const engs = (data ?? []) as { k: number; company_id: string }[];
      const ids = [...new Set(engs.map((e) => e.company_id))];
      const tickers = new Map<string, string | null>();
      if (ids.length) {
        const { data: cos } = await sb.from("companies").select("id, ticker").in("id", ids);
        for (const c of (cos ?? []) as { id: string; ticker: string | null }[]) tickers.set(c.id, c.ticker);
      }
      clients = engs.map((e) => ({ k: Number(e.k), company_id: e.company_id, ticker: tickers.get(e.company_id) ?? null }));
    }
    const ids = [...new Set([...(company ? [company.id] : []), ...clients.map((c) => c.company_id)])];
    if (ids.length === 0) return [];
    const types = team.track === "PRODUCT" ? PRODUCT_TYPES : FIRM_TYPES;
    const [subs, scores, moves] = await Promise.all([
      sb.from("submissions").select("company_id, type, content, submitted_at, word_count, auto_submitted").in("company_id", ids).in("type", types).is("superseded_at", null),
      sb.from("scores").select("company_id, type, final_score").in("company_id", ids).in("type", types),
      sb.from("round_prices").select("company_id, subround, tier_bp").in("company_id", ids).eq("kind", "SUB_TIER"),
    ]);
    for (const r of [subs, scores, moves]) if (r.error) throw new Error(r.error.message);
    return pastRounds({
      track: team.track,
      companyId: company?.id ?? null,
      closed,
      submissions: (subs.data ?? []) as PastSubmission[],
      scores: (scores.data ?? []) as { company_id: string; type: SubmissionType; final_score: number | null }[],
      moves: (moves.data ?? []) as { company_id: string; subround: number; tier_bp: number | null }[],
      clients,
    });
  } catch (err) {
    console.error("past rounds: could not read them:", err);
    return null;
  }
}
