# Every scoring parameter, in one place

The numbers that turn a judged text into a score, a score into a price move, and prices into final values. Each
rule names the code that holds it; when the TypeScript engine and the SQL both hold a rule, they are kept equal by
`supabase/tests/parity.test.ts`. The judging pipeline itself (queue, workers, retries) is in
[`docs/system/JUDGING.md`](../system/JUDGING.md). One file per rubric line, with examples, is in
[`parameters/`](parameters/).

Money is in whole cents and rates in basis points (100 bp = 1%), as in `packages/engine/src/rules.ts`. Rounding is
half-up to the cent (`app.div_round_half_up`, engine `divRoundHalfUp`). **Tonight** marks a rule being built today
behind a switch (`app.feature_catalog()`, migration 070); it is described from the plan and must be checked against
its migration once merged.

## 1. Rubrics: the lines and their weights

Every rubric totals 100. The keys and maxima are in three places that must agree: `RUBRICS` in
`packages/engine/src/judge.ts`, `app.rubric` in SQL (migrations 006, 028, 030, 032) and the prompt files
(`prompts/*.md`, checked by `packages/engine/src/judge-prompts.test.ts`).

| Type | Lines (key: maximum) | Prompt |
| --- | --- | --- |
| PRD (`PITCH`) | [`problem`](parameters/PITCH-problem.md) 20 · [`solution`](parameters/PITCH-solution.md) 20 · [`metrics`](parameters/PITCH-metrics.md) 15 · [`business_model`](parameters/PITCH-business_model.md) 15 · [`feasibility`](parameters/PITCH-feasibility.md) 15 · [`clarity`](parameters/PITCH-clarity.md) 15 | `prompts/PITCH.md` |
| ZestUp memo (`MEMO`) | [`diagnosis`](parameters/MEMO-diagnosis.md) 25 · [`options`](parameters/MEMO-options.md) 20 · [`recommendation`](parameters/MEMO-recommendation.md) 20 · [`numbers`](parameters/MEMO-numbers.md) 15 · [`risks`](parameters/MEMO-risks.md) 10 · [`next_steps`](parameters/MEMO-next_steps.md) 10 | `prompts/MEMO.md` |
| Crisis plan (`CRISIS_1`…`CRISIS_4`) | [`solves_crisis`](parameters/CRISIS-solves_crisis.md) 25 · [`money_logic`](parameters/CRISIS-money_logic.md) 20 · [`consultant_advice`](parameters/CRISIS-consultant_advice.md) 15 · [`time_to_recovery`](parameters/CRISIS-time_to_recovery.md) 15 · [`new_risks`](parameters/CRISIS-new_risks.md) 15 · [`next_steps`](parameters/CRISIS-next_steps.md) 10 | `prompts/CRISIS.md` |
| Advice memo (`ADVICE_1`…`ADVICE_5`) | [`diagnosis`](parameters/ADVICE-diagnosis.md) 25 · [`actionable_advice`](parameters/ADVICE-actionable_advice.md) 30 · [`evidence`](parameters/ADVICE-evidence.md) 20 · [`fit`](parameters/ADVICE-fit.md) 15 · [`clarity`](parameters/ADVICE-clarity.md) 10 | `prompts/ADVICE.md` |
| Solution (`SOLUTION`) | [`fit`](parameters/SOLUTION-fit.md) 25 · [`differentiation`](parameters/SOLUTION-differentiation.md) 20 · [`feasibility`](parameters/SOLUTION-feasibility.md) 20 · [`business_impact`](parameters/SOLUTION-business_impact.md) 20 · [`clarity`](parameters/SOLUTION-clarity.md) 15 | `prompts/SOLUTION.md` |

The classic night's `PLAN` (25/20/20/15/10/10) and `FLASH` (50/30/20) rubrics also exist in the same places; a
PRIMUS event does not judge them.

**Which section feeds which line.** The PRD prompt maps them explicitly: Problem and target user → `problem`;
Proposed solution and Core features and MVP scope → `solution`; Success metrics → `metrics`; Business model →
`business_model`; Competitive edge and Key risks → `feasibility`; the whole document → `clarity`. The other prompts
score each line from the whole text; their section names match the lines (`app.template_fields`, migration 032). In a
solution, Risks is judged inside `feasibility` and `clarity`. Every prompt tells the judge to give credit for good
material wherever it appears.

## 2. Valid output

A run counts only if every rubric line is a whole number from 0 to its maximum, there are no other lines, the total
equals their sum and the rationale is not empty (`validateJudgeOutput`, engine; `app.judge_run_valid`, migration 006, and
`app.judge_output_valid`, migration 020). An invalid answer is asked for again, 3 attempts in all
(`OUTPUT_ATTEMPTS`, `apps/web/lib/judge/call.ts`).

## 3. Runs and the median

| Parameter | Value | Code |
| --- | --- | --- |
| Runs per submission | 1 (migration 094, organisers' decision of 20 Nov: cost); the human panel: 3 | `app.judge_runs()`, `JUDGE_RUNS` |
| Extra runs | none for the AI; the human panel: 2 more (5 in all) when its 3 totals spread more than 10 points (max − min > 10) | `app.needs_extra_runs`, `needsExtraRuns` |
| Score | the one run's total; the human panel: median of its totals (the middle of 3 or of 5) | `app.median_score`, `medianScore` |
| Published breakdown and rationale | the first run (by run number) whose total equals the median | `app.score_from_runs`, `representativeRun` |

Example (the AI): one run of 66 scores 66. Example (the human panel): runs of 62, 71 and 66 spread 9 points, so the median 66 stands. Runs of 58, 74 and 66 spread 16 points, so
runs 4 and 5 are made; with 69 and 61 the totals are 58, 61, 66, 69, 74 and the median is 66.

## 4. Penalty, clamping and missing work

| Parameter | Value | Code |
| --- | --- | --- |
| Injection penalty, first offence | −5 points | `RULES.INJECTION_PENALTY_FIRST`; `app.company_injection_penalty` (032, patched in 057) |
| Injection penalty, second and later offences | −10 points | `RULES.INJECTION_PENALTY` |
| Which submissions count | the company's chain, in order: PRD → crisis plan 1 → 2 → 3 → 4 → solution. A firm's ZestUp memo and advice memos never carry a penalty (their offending lines are still removed). | `CHAINS` in `packages/engine/src/judge.ts` |
| Final score | clamp(median − penalty, 0, 100) | `app.final_score`, `finalScore` |
| Missing or late | final score 0, with the tier of a 0 | `public.seal_missing_scores` (011) |

An offence is a judged submission with at least one line removed; how many lines does not matter.

## 5. Tiers: score band to price move

`app.tier_bp` (migration 032) and `TIER_TABLE` in `packages/engine/src/prices.ts`:

| Final score | PRD (`PITCH`) | Crisis plan and solution | ZestUp and advice memos |
| --- | --- | --- | --- |
| 90–100 | +1,000 bp (+10%) | +2,500 bp (+25%) | 0 |
| 80–89 | +1,000 bp (+10%) | +2,000 bp (+20%) | 0 |
| 70–79 | +500 bp (+5%) | +1,000 bp (+10%) | 0 |
| 60–69 | +500 bp (+5%) | +500 bp (+5%) | 0 |
| 50–59 | 0 | 0 | 0 |
| 40–49 | −500 bp (−5%) | −1,000 bp (−10%) | 0 |
| 0–39 | −1,000 bp (−10%) | −2,000 bp (−20%) | 0 |

A tier moves both the market price and the AI price: new = price × (10,000 + bp) ÷ 10,000, rounded half-up to the
cent (`app.apply_tier`, `applyTier`). A crisis plan's tier is applied when its scores are released (a `SUB_TIER` row
in `round_prices`, `app.release_primus`); a solution's positive tier is first scaled by the leveller (section 8).

## 6. The IPO price from the PRD

IPO price = $10.00 × (1 + PRD tier), rounded half-up (`app.ipo_price`, `ipoPrice`; `RULES.BASE_PRICE` = 1,000
cents). It also becomes the first market price and the first AI price.

| PRD final score | IPO price |
| --- | --- |
| 80–100 | $11.00 |
| 60–79 | $10.50 |
| 50–59 | $10.00 |
| 40–49 | $9.50 |
| 0–39, or no PRD | $9.00 |

## 7. The crisis shock

At each crisis reveal every listed company's market price and AI price fall 5%: `app.apply_tier(price, −500)` in
`app.reveal_subround` (migration 032), written as a `SUB_SHOCK` row. Example: $12.34 becomes $11.72. Trading is halted
for the first 5 minutes of the crisis because its first trading round opens at minute 5 (`PRIMUS_ROUNDS`,
`packages/engine/src/schedule.ts`). (The classic night's single crisis is −15%, `app.crisis_shock`; not used in
PRIMUS.)

## 8. The Round 3 leveller

`app.release_tier_bp` (migration 064). It applies only to the solution, and only to a rise:

1. Every company in the Round 3 draft is ranked by its **score so far**: the average of its PRD and its four crisis
   plan final scores, a missing score counting 0, rounded to 2 decimals (`app.score_so_far`, migration 034). All
   sectors are ranked together.
2. Place 1 is the weakest. Ties share the lower place (SQL `rank()`), so tied companies get the same, higher
   multiplier. With n companies, the multiplier at place p is 1.25 − (p − 1) ÷ (n − 1): ×1.25 for the weakest, ×0.25
   for the strongest, evenly spaced.
3. In whole basis points: scaled = ⌊tier × (125 × (n − 1) − 100 × (p − 1)) ÷ (100 × (n − 1))⌋.
4. A tier of 0 or below applies in full. With one company or none, nothing is scaled.

| A solution scored 80–89 (tier +2,000 bp) | n = 200 | n = 133 |
| --- | --- | --- |
| Weakest (place 1) | +2,500 bp (+25%) | +2,500 bp (+25%) |
| Middle (place 100 of 200, 67 of 133) | +1,505 bp | +1,500 bp |
| Strongest (place n) | +500 bp (+5%) | +500 bp (+5%) |
| The same company scoring below 40 | −2,000 bp (−20%) at any place | −2,000 bp |

The same score so far sets the draft order: lowest first, ties by the lower ticker (`app.start_draft`, migration 042).

## 9. The close

`app.close_market` (migration 068), when the market closes at 06:30 after the last round (round 31 on a PRIMUS
night):

- **closing market price** = the average of the last cleared round's opening price and its clearing price, rounded
  half-up (`app.avg_half_up`);
- **closing price** = the average of the closing market price and the AI price, rounded half-up;
- every open short is covered at the closing price.

Example: the last round opened at $12.10 and cleared at $13.31, so the closing market price is $12.71; with an AI price
of $11.50 the closing price is $12.11. The AI price moves only with released scores and crisis shocks, so a bubble
counts at most half in final values. (The engine's `marketClose` in `prices.ts` still holds the classic rule; the SQL
is the one that runs.)

## 10. Trading-round clearing

For reference (the full rules are in `docs/system/TRADING-ALGORITHM.md`): new price = old × (100,000 + clamp(net,
−10,000, +10,000)) ÷ 100,000, rounded half-up, where net = buys + covers − sells − shorts in shares
(`app.clearing_price`, `clearingPrice`; `RULES.CLEARING_DEN`, `RULES.NET_CAP`): 1% per 1,000 net shares, at most ±10%
a round. A company whose last cleared round moved the full ±10% takes no orders for the next round
(`app.cooling_off`, migration 069).

## 11. Money that depends on scores

| Payment | Rule | Code |
| --- | --- | --- |
| ZestUp memo bonus | $500 × (score − 50), clamped to −$10,000 … +$25,000; paid at settlement | `app.plan_bonus`, `app.pay_consultant_bonuses` (030) |
| Advice bonus, per paid engagement | $500 × (advice score − 50), clamped as above, + $1,000 × (stars − 3); a missing rating counts 3 stars; paid when the advice scores are released | `app.after_advice_release` (033) |
| Consultant call | $2,500 per correct call: BUY right if the price after trading round 4 is above the IPO price, SELL right if below | `app.judge_calls` (011), `RULES.CALL_EARNING` |
| Practice market prize | $50,000 to each of the 3 funds worth the most that traded at least once (ties to the lower team code) | `app.settle_practice` (058) |

## 12. Hiring base rate (tonight, migration 071)

Switches `hire_base_rate` and `hire_min_bid` (RULE, off by default). A firm's base rate is a share of the client
company: 2% + 0.04% × (score − 50), never below 1% or above 4% of the company's 100,000 shares; in basis points
clamp(200 + 4 × (score − 50), 100, 400), rounded to the nearest basis point (`app.firm_base_rate`, migrations 071 and
089). Since migration 089 the score is the **average of the firm's released Round 1 memo (ZestUp) score and every
advice memo score released so far**: the released `MEMO` score of the firm's own squad company and the released
`ADVICE_k` score of each client it was engaged by (a firm with 2 clients in a crisis has 2 advice scores, each counted
once). Only released scores with a final score count, so the rate is recalculated after each crisis's advice scores
are released; with none at all it is 2%. Example: memo 80 and two advice memos of 61 and 40 average 60.33, so 241
basis points (2.41%).

| Average score | Base rate | Shares |
| --- | --- | --- |
| 0–25 | 1% | 1,000 |
| 50 | 2% | 2,000 |
| 75 | 3% | 3,000 |
| 100 | 4% | 4,000 |

It is the firm's **minimum bid**: an offer (or counter, or accept) worth less than the base-rate shares × the market
price, counting cash + shares × market price, is refused with `BELOW_MIN_BID`. It is also the fee a company pays, in
shares, when hiring closes (crises 1–4 and Round 3) with no firm and the seeded draw gives it one; if the 40,000-share
floor blocks those shares, their cash value at the market price, never more than the company's cash. Today's code (without the switches) charges an unhired
company $22,500, or 10% of its cash in Round 3 (`app.assign_default_firms`, migrations 061, 065 and 066), and a Round 3
fee must be worth 5–20% of the company's cash (`app.offer_problem`).

## 13. The PRIMUS Rating on the live leaderboard (tonight, migration 073)

Switch `leaderboard` (DISPLAY, on by default; staff always see it). `public.leaderboard` in migration 073. A company's rating:

- starts at **1,000**;
- for each released PRD, crisis plan and solution (6 "rounds"), adds **50 × z**, where z is the company's standard
  score among the companies of its sector for that round: z = (score − sector mean) ÷ the sector's population
  standard deviation; a standard deviation of 0 (a sector of one, or equal scores) gives z = 0;
- each round's change is round(50 × z), halves away from zero, clipped to **±100** (so |z| above 2 counts as 2);
- the ▲▼ change shown is the latest round's change.

Example: a sector's five crisis plans score 50, 60, 70, 80 and 90. The mean is 70 and the standard deviation is
14.14, so the changes are −71, −35, 0, +35 and +71. A sector of 40, 55, 60, 62 and 88 (mean 61, standard deviation
15.54) gives −68, −19, −3, +3 and +87. Ties share a rank. The rating is a display only: it moves no price and no money.

## 14. Final values and tie-breaks

`app.compute_results` (013) and `app.primus_results` (034):

| Track | Final value | Tie-break |
| --- | --- | --- |
| Product | retained shares × closing price + cash | the higher average of the PRD, four crisis plans and solution final scores (missing = 0) |
| Consulting | cash (fees and bonuses) + fee shares × closing price | the higher average client rating |
| Finance | return on all capital received: starting cash plus the Round 3 injection (practice prizes are a gain, not capital) | the smaller largest single position |

Rankings use competition ranking (1, 2, 2, 4): `rankBy` in `packages/engine/src/scoring.ts`.

## Sources

`packages/engine/src/judge.ts`, `prices.ts`, `rules.ts`, `scoring.ts`, `schedule.ts`; `prompts/*.md`;
`supabase/migrations/20261008000006_engine_rules.sql`, `20261008000011_prices_scores.sql`,
`20261008000013_settlement.sql`, `20261014000020_judge_pipeline.sql`, `20261112000030_memo.sql`,
`20261113000032_primus_rounds.sql`, `20261113000033_marketplace.sql`, `20261113000034_saturation.sql`,
`20261124000058_practice_market.sql`, `20261127000061_assign_firms.sql`, `20261130000064_catch_up.sql`,
`20261201000065_night_fixes.sql`, `20261204000068_close_counts_the_end.sql`, `20261205000069_anti_saturation.sql`,
`20261206000070_switches.sql`; tonight's in-progress migrations 071 (hiring) and 073 (rating), read on their builders'
branches before merge.
