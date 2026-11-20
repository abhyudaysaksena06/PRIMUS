"use server";

// Bulletins: the general composer (publish_bulletin, never FLASH) and the 04:00 flash bulletin
// (publish_flash_bulletin). Each action is one game function, run as the signed-in organiser.

import Anthropic from "@anthropic-ai/sdk";
import { rpc, type ActionResult } from "@/lib/rpc";
import { currentViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { anthropicClient } from "@/lib/judge/call";
import { hasApiCredential } from "@/lib/judge/config";
import { FALLBACK_BETA, NEWS_DEFAULT_MODEL, NEWS_SCHEMA, NEWS_SYSTEM, newsPrompt, parseNewsDraft, takesServerFallback } from "@/lib/admin/news-draft";
import { USE_FLASH, bulletinFromForm } from "@/lib/admin/content-bulletins";

export async function publishBulletin(eventId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const b = bulletinFromForm({ kind: form.get("kind"), title: form.get("title"), body: form.get("body") });
  if (!b.ok) return { ok: false, code: b.message === USE_FLASH ? "USE_FLASH" : "BAD_BULLETIN", message: b.message };
  const r = await rpc("publish_bulletin", { p_event: eventId, p_kind: b.value.kind, p_title: b.value.title, p_body: b.value.body });
  return r.ok ? { ...r, message: `Published “${b.value.title}” to every screen.` } : r;
}

/** Publishes the draft the page showed (`bulletinId`): a draft replaced since is refused (DRAFT_CHANGED). */
export async function publishFlashBulletin(eventId: string, bulletinId: string | null): Promise<ActionResult> {
  const r = await rpc("publish_flash_bulletin", { p_event: eventId, p_bulletin: bulletinId });
  return r.ok ? { ...r, message: "Flash bulletin published. The flash answers are open." } : r;
}

/**
 * Asks Claude for a news bulletin draft from the market as it stands. Returns the draft for the composer; nothing is
 * published. Model: NEWS_MODEL (default claude-opus-5-5) with ANTHROPIC_API_KEY, the same key as the judge.
 */
export async function draftNews(eventId: string, angle: string): Promise<ActionResult> {
  const viewer = await currentViewer();
  if (viewer?.role !== "ORGANISER") return { ok: false, code: "NOT_ALLOWED", message: "Only organisers draft bulletins." };
  if (!hasApiCredential(process.env)) return { ok: false, code: "NO_KEY", message: "Set ANTHROPIC_API_KEY in Vercel to draft news with AI." };
  const sb = await supabaseServer();
  const [companies, sectors, bulletins, event] = await Promise.all([
    // Every drawn company (up to 200 a track, paged past PostgREST's 1,000 rows); an undrawn team's company is not news.
    fetchAll<{ id: string; ticker: string | null; name: string | null; ipo_price: number | null; market_price: number | null }>((from, to) =>
      sb.from("companies").select("id, ticker, name, ipo_price, market_price").eq("event_id", eventId).not("squad_id", "is", null).order("id").range(from, to),
    ).then((data) => ({ data, error: null }), (e: Error) => ({ data: null, error: { message: e.message } })),
    sb.rpc("company_sectors", { p_event: eventId }),
    sb.from("bulletins").select("title, published_at").eq("event_id", eventId).not("published_at", "is", null).order("published_at", { ascending: false }).limit(8),
    sb.from("events").select("current_phase").eq("id", eventId).maybeSingle<{ current_phase: string }>(),
  ]);
  if (companies.error) return { ok: false, code: "ERROR", message: companies.error.message };
  const sectorOf = new Map(((sectors.data ?? []) as { company_id: string; sector: string | null }[]).map((s) => [s.company_id, s.sector]));
  const model = process.env.NEWS_MODEL || NEWS_DEFAULT_MODEL;
  const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: NEWS_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: newsPrompt({
          angle: angle.slice(0, 500),
          phase: event.data?.current_phase ?? "unknown",
          companies: (companies.data ?? []).map((c) => ({ ticker: c.ticker, name: c.name, sector: sectorOf.get(c.id) ?? null, open: c.ipo_price, now: c.market_price })),
          recentTitles: (bulletins.data ?? []).map((b) => b.title as string),
        }),
      },
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema: NEWS_SCHEMA } },
  };
  if (takesServerFallback(model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = "default";
  }
  try {
    const message = await anthropicClient().beta.messages.create(params);
    if (message.stop_reason === "refusal") return { ok: false, code: "REFUSED", message: "The model declined this one: try a different angle." };
    if (message.stop_reason !== "end_turn") return { ok: false, code: "CUT_OFF", message: "The draft was cut off: try again." };
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const draft = parseNewsDraft(text);
    if (!draft) return { ok: false, code: "BAD_DRAFT", message: "The draft did not fit the composer: try again." };
    return { ok: true, message: "Draft ready: check it, edit it, then publish.", data: { ...draft } };
  } catch (e) {
    if (e instanceof Anthropic.APIError) return { ok: false, code: "API_ERROR", message: `The AI service answered ${e.status ?? ""}: ${e.message}`.slice(0, 300) };
    return { ok: false, code: "ERROR", message: "Could not reach the AI service: try again." };
  }
}
