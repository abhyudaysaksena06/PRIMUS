"use server";

// The Run page's "Prepare the practice market" button (migration 076): fixes the simulated companies (one per
// checked-in Finance team) and stores their price paths in chunks, as the signed-in organiser. Safe to press again.

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/rpc";
import { supabaseServer } from "@/lib/supabase/server";
import { preparePracticeMarket } from "@/lib/team/practice";

export async function preparePracticeMarketAction(eventId: string): Promise<ActionResult> {
  const sb = await supabaseServer();
  const r = await preparePracticeMarket(sb, eventId);
  if (r.ok) revalidatePath("/admin", "layout");
  return { ok: r.ok, code: r.code, message: r.message, data: { companies: r.companies, loaded: r.loaded, ready: r.ready } };
}
