// A live check of the AI judge against the real model, before the night: for every kind of answer the PRIMUS night
// judges (the PRD, the ZestUp memo, a crisis plan, an advice memo, a Round 3 solution) it judges one strong and one
// weak sample, built from the final case book's own cards, through exactly the code the worker uses (the prompts in
// prompts/, buildJudgeRequest, judgeOnce with structured output). It prints each score with its breakdown and
// rationale, the time and the cost, and fails if a call fails or a strong answer does not beat its weak one by at
// least 15 points.
//
//   ANTHROPIC_API_KEY=… pnpm judge-check                # the model and effort the night uses (JUDGE_MODEL, JUDGE_EFFORT)
//   pnpm judge-check --model claude-sonnet-5-5 --only MEMO,CRISIS_1
//
// About 10 calls; with Claude Haiku 5.5 well under one US cent in all.

import { readFileSync } from "node:fs";
import type { SubmissionType } from "@msim/engine";
import { anthropicClient, judgeOnce } from "../apps/web/lib/judge/call";
import { hasApiCredential, judgeConfig } from "../apps/web/lib/judge/config";
import { loadPrompt } from "../apps/web/lib/judge/prompts";
import { buildJudgeRequest } from "../apps/web/lib/judge/request";
import type { JudgeInput } from "../apps/web/lib/judge/types";
import { parseArgs } from "./lib/args";

/** Rows of a seed CSV (the decks the night is played with). */
function csv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

const sections = (s: Record<string, string>) => Object.entries(s).map(([k, v]) => `${k}:\n${v}`).join("\n\n");

const problems = csv("seed/sectors/problem-cards.csv");
const crises = csv("seed/sectors/crisis-cards.csv");
const statements = csv("seed/sectors/statements.csv");
const aviation = problems.find((p) => p.sector === "Aviation")!;
const grounded = crises.find((c) => c.sector === "Aviation" && c.number === "1")!;
const feeder = statements.find((s) => s.sector === "Aviation" && s.title?.startsWith("Get people from town"))!;

const PRD_STRONG = `RunwayLink (RWLK)\n\n${sections({
  "Problem and target user":
    "Travellers in small towns whose airport sits 38 km away. A taxi costs about ₹1,200 each way, more than a third of the ₹3,400 average fare, so many skip the flight. With 58% average seat load, each 72-seat turboprop flies about 30 empty seats; at ₹3,400 that is about ₹1 lakh of unsold seats a flight.",
  "Proposed solution":
    "Shared minivans timed to each flight, booked with the ticket, that also carry airport staff and town commuters between flights so the van is never empty.",
  "Core features and MVP scope":
    "One airport, its 4 flights a day and 3 vans: seat booking at checkout with the airline, live van tracking, a flight-delay hold so no one misses a plane. No other airports until the pilot pays.",
  "Success metrics":
    "Within 90 days: 25% of the airport's passengers ride with us, a seat price under ₹300, van occupancy above 60%, and seat load on our routes up from 58% to 62%.",
  "Business model":
    "Travellers pay ₹249 a seat; the regional airline pays ₹50 per passenger we bring, because each extra filled seat earns it about ₹3,400. A van trip costs ₹1,600 and carries 10 riders on average: ₹2,990 in, a margin of about ₹1,390 a trip.",
  "Competitive edge":
    "Taxis cost five times more; a bus that waits for every flight runs empty. Mixing flyers with staff and commuters is what makes the trips pay.",
  "Key risks":
    "Fog: 1 airport in 3 loses 40 days a year, so trips are refunded automatically when a flight is cancelled. Scaling: once one airport pays, we copy the van-and-airline contract to the operator's other airports, since all four operators fly to every game airport.",
})}`;

const PRD_WEAK = `SkyApp (SKYA)\n\n${sections({
  "Problem and target user": "Flying is hard for many people in India.",
  "Proposed solution": "An AI super-app for all of aviation: tickets, cargo, hotels, cabs, loyalty and drones.",
  "Core features and MVP scope": "Everything in the first version, in all 500 airports, with our own 180-seat jets.",
  "Success metrics": "Millions of users.",
  "Business model": "Ads and commissions.",
  "Competitive edge": "We use AI.",
  "Key risks": "None.",
})}`;

const MEMO_STRONG = sections({
  Diagnosis:
    "75% of ZestUp's revenue comes from ZestUp Original, which becomes illegal the moment the Virex-7 ban is notified. The leak took away the week of quiet preparation, so the story is now controlled by others, and cash is limited. The first job is to survive six months; the second is a new flagship.",
  "Options and trade-offs":
    "Supplier A costs ₹18 lakh plus ₹12 a can; Supplier B ₹19 a can. They break even at 18,00,000 ÷ 7 ≈ 2,57,143 cans, so at 1 lakh cans a month A wins after about 2.6 months. For the 1,20,000 banned cans worth ₹27 lakh: export brings ₹15 lakh but needs approval and costs ₹1.5 lakh a month to store; buyback brings 40% × ₹27 lakh = ₹10.8 lakh now; disposal loses ₹32 lakh. Export beats buyback only if approved within 2.8 months. Within ₹35 lakh, Vitamin Water (₹6 lakh a month) plus Fruit Fusion (₹7.7 lakh a month) fit exactly and earn ₹13.7 lakh a month, paid back in about 2.6 months. The new formula costs ₹55 lakh and four months with no sales from it.",
  Recommendation:
    "Month 1: a public statement today, retailer notice, never sell banned cans in India, take the buyback (₹10.8 lakh, certain), launch Vitamin Water and Fruit Fusion. Months 1–4: the Supplier A substitute, subject to approval, as the new flagship. We give up the export upside because approval is uncertain.",
  "The numbers":
    "Cash in: ₹10.8 lakh buyback plus ₹13.7 lakh a month from the two products from month 2. Cash out: ₹35 lakh launch plus ₹18 lakh Supplier A. Back to profit in month 4.",
  Risks: "If the substitute is not approved, fall back to Supplier B with no upfront cost; if young buyers reject the new taste, keep the two new products as the bridge.",
  "Next steps": "CEO issues the statement Monday; sales head notifies distributors Tuesday; ops head quarantines stock Wednesday; R&D lead signs Supplier A by Friday.",
});

const MEMO_WEAK = sections({
  Diagnosis: "ZestUp has a problem with an ingredient.",
  "Options and trade-offs": "They could change the formula or sell other drinks.",
  Recommendation: "Do all the options.",
  "The numbers": "It will cost some money but be worth it.",
  Risks: "There are some risks.",
  "Next steps": "Implement the plan.",
});

const PLAN_STRONG = sections({
  "The crisis and what it does to us":
    "22 of 64 turboprops are grounded for 21 days and 131 of 380 routes stop. About 40% of our van riders fly on those routes, so trip revenue falls about 40% for three weeks, about ₹9 lakh.",
  "Our response":
    "First 72 hours: we drive stranded travellers on our routes to the nearest working airport or the railhead free, paid from our reserve, and refund van seats in full. By Friday we hand each operator a 14-day list of confirmed bookings from our hospital and college partners, so our routes are restored first.",
  "The money": "Rescue trips cost about ₹4 lakh; refunds ₹2 lakh; lost trip revenue ₹9 lakh. Our ₹30 lakh cash covers it, leaving 7 months of runway.",
  "What we take from our consultant":
    "We adopt the firm's split between the 72-hour rescue and the Friday deadline. We reject its idea of chartering buses on every route: at ₹18,000 a day it costs more than the trips it saves.",
  "Time to recovery": "Rescue done in 72 hours; committed-demand lists by Friday; routes back in 3 weeks; riders back to 90% by week 5.",
  "New risks": "If an operator drops our route anyway, we move the vans to the 249 routes still flying within a week.",
  "Next steps": "Ops lead books rescue vans today; partnerships lead collects bookings by Thursday; CEO meets the operators on Friday.",
});

const PLAN_WEAK = sections({
  "The crisis and what it does to us": "Some planes are grounded.",
  "Our response": "We will monitor the situation and stay positive.",
  "The money": "It will be fine.",
  "What we take from our consultant": "",
  "Time to recovery": "Soon.",
  "New risks": "",
  "Next steps": "Keep going.",
});

const ADVICE_STRONG = sections({
  Diagnosis:
    "With 131 of 380 routes stopped for 21 days, about 40% of RWLK's riders lose their flights. The twist decides the future: routes without a confirmed 14-day booking list by Friday may never return, and RWLK's business lives on those routes.",
  "What to do":
    "Today the ops lead moves stranded riders to the nearest working airport or the railhead free of charge. By Wednesday the partnerships lead asks the hospitals and colleges RWLK already serves to confirm 14 days of bookings. On Friday the CEO hands each operator the list. If an operator still drops a route, the vans move to the 249 routes still flying within a week.",
  "Evidence and numbers":
    "Rescue trips cost about ₹4 lakh against ₹9 lakh of revenue lost over the three weeks; losing the routes for good would cost the whole ₹30 lakh business. A charter bus on every route at ₹18,000 a day would cost more than it saves.",
  "Why it fits your company": "RWLK already holds the partner bookings operators want, which most startups do not.",
});

const ADVICE_WEAK = sections({
  Diagnosis: "There is a crisis.",
  "What to do": "Improve marketing and cut costs.",
  "Evidence and numbers": "Many companies do this.",
  "Why it fits your company": "It fits.",
});

const SOLUTION_STRONG = sections({
  "Our solution":
    "Shared vans timed to every flight, sold with the air ticket, that between flights carry airport staff and town commuters, so a 38 km trip costs a traveller ₹249.",
  "Why it fits the statement":
    "It solves the catch directly: with only 4 flights a day a waiting bus runs empty, but our vans run all day on mixed trips and wait for no flight.",
  "How we stand apart": "Taxis cost ₹1,200; a dedicated airport bus loses money. Mixing riders keeps every trip above 60% full.",
  "How we will build it": "Pilot: 3 vans, one airport, 8 weeks, ₹9 lakh; booking added to the airline's checkout; flight-delay holds.",
  "Business impact": "₹249 a seat, 10 riders a trip, ₹1,600 cost: about ₹1,390 margin a trip, profitable on every trip from week 6.",
  Risks: "Fog cancellations: automatic refunds; low early demand: staff contracts guarantee half the seats.",
});

const SOLUTION_WEAK = sections({
  "Our solution": "A bus to the airport.",
  "Why it fits the statement": "It goes to the airport.",
  "How we stand apart": "It is a nice bus.",
  "How we will build it": "Buy buses.",
  "Business impact": "People will pay.",
  Risks: "",
});

const card = (c: Record<string, string>) => ({ category: c.category!, title: c.title!, body: c.body! });

interface Case {
  type: SubmissionType;
  label: string;
  strong: string;
  weak: string;
  extra: Partial<JudgeInput>;
}

const CASES: Case[] = [
  { type: "PITCH", label: "PRD · Aviation", strong: PRD_STRONG, weak: PRD_WEAK, extra: { problem_card: { sector: "Aviation", title: aviation.title!, body: aviation.body! } } },
  { type: "MEMO", label: "Round 1 memo · ZestUp", strong: MEMO_STRONG, weak: MEMO_WEAK, extra: {} },
  {
    type: "CRISIS_1",
    label: "Crisis plan · Grounded at Dawn",
    strong: PLAN_STRONG,
    weak: PLAN_WEAK,
    extra: { pitch_text: PRD_STRONG, crisis_card: card(grounded), advice_text: ADVICE_STRONG, firm_hired: true },
  },
  { type: "ADVICE_1", label: "Advice memo · Grounded at Dawn", strong: ADVICE_STRONG, weak: ADVICE_WEAK, extra: { pitch_text: PRD_STRONG, crisis_card: card(grounded) } },
  {
    type: "SOLUTION",
    label: "Round 3 solution · statement " + feeder.number,
    strong: SOLUTION_STRONG,
    weak: SOLUTION_WEAK,
    extra: { statement: { number: Number(feeder.number), title: feeder.title!, body: feeder.body! }, advice_text: null, firm_hired: false },
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!hasApiCredential()) {
    console.error("No Anthropic credential: set ANTHROPIC_API_KEY (the same key as on Vercel) and run again.");
    process.exit(2);
  }
  const config = judgeConfig();
  const model = typeof args.model === "string" ? args.model : config.models.PRIMARY;
  const only = typeof args.only === "string" ? new Set(args.only.split(",").map((s) => s.trim().toUpperCase())) : null;
  const client = anthropicClient();
  console.log(`Judge check: model ${model}, effort ${config.effort}\n`);

  let failed = false;
  let inTokens = 0;
  let outTokens = 0;
  for (const c of CASES.filter((x) => !only || only.has(x.type))) {
    const prompt = loadPrompt(c.type);
    const totals: number[] = [];
    for (const [which, text] of [["strong", c.strong], ["weak", c.weak]] as const) {
      const input: JudgeInput = {
        run_id: `check-${c.type}-${which}`,
        type: c.type,
        ticker: "RWLK",
        company_name: "RunwayLink",
        names: [],
        submission_id: "check",
        submission_text: text,
        injections_recorded: true,
        ...c.extra,
      };
      const req = buildJudgeRequest(input, prompt.text);
      const r = await judgeOnce(client, { model, system: req.system, userText: req.userText, type: c.type, effort: config.effort });
      inTokens += r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens;
      outTokens += r.usage.output_tokens;
      if (!r.ok) {
        failed = true;
        console.log(`✗ ${c.label} (${which}): ${r.error}`);
        continue;
      }
      totals.push(r.total);
      const parts = Object.entries(r.breakdown).map(([k, v]) => `${k} ${v}`).join(", ");
      console.log(`${c.label} (${which}): ${r.total}/100 in ${(r.latencyMs / 1000).toFixed(1)} s, ${r.attempts} attempt(s)\n  ${parts}\n  ${r.rationale}\n`);
    }
    if (totals.length === 2 && totals[0]! - totals[1]! < 15) {
      failed = true;
      console.log(`✗ ${c.label}: the strong answer (${totals[0]}) does not beat the weak one (${totals[1]}) by 15 points\n`);
    }
  }
  console.log(`Tokens: ${inTokens.toLocaleString()} in, ${outTokens.toLocaleString()} out.`);
  console.log(failed ? "\nJUDGE CHECK FAILED" : "\nJudge check passed: every call answered, and every strong answer clearly beat its weak one.");
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
