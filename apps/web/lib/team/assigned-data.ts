// Was the Product team's firm for the current crisis assigned by the draw (no hire made in time) rather than hired?
// Read straight from engagements.assigned (the hiring change, migration 071) when the plan's facts do not carry it
// yet. On a database without the column the read fails and the facts stay as they are ("You hired …").

import type { HomeFacts } from "@/lib/team/home";
import { supabaseServer } from "@/lib/supabase/server";

export async function withAssigned(facts: HomeFacts, companyId: string | null): Promise<HomeFacts> {
  const p = facts.primus;
  const e = p?.engagement;
  if (!p || !e || e.assigned !== undefined || !companyId || p.k === null) return facts;
  try {
    const sb = await supabaseServer();
    const { data, error } = await sb.from("engagements").select("assigned").eq("company_id", companyId).eq("k", p.k).maybeSingle<{ assigned: boolean | null }>();
    if (error || !data) return facts;
    return { ...facts, primus: { ...p, engagement: { ...e, assigned: data.assigned === true } } };
  } catch {
    return facts;
  }
}
