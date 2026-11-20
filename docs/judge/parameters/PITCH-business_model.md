# PITCH · `business_model`: Business model (15 points)

**Type:** PRD (Round 1, Product). **Maximum:** 15 of 100. **Prompt:** `prompts/PITCH.md` (the judge's exact rubric). **Sections it reads:** Business model. **What the score does:** The PRD's final score sets the IPO price ($9.00 to $11.00).

The whole rubric: [`problem`](PITCH-problem.md) 20 · [`solution`](PITCH-solution.md) 20 · [`metrics`](PITCH-metrics.md) 15 · **`business_model` 15** · [`feasibility`](PITCH-feasibility.md) 15 · [`clarity`](PITCH-clarity.md) 15. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Who pays, how much and how often, and whether that revenue can cover the costs.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| 0 to 2 | no way to make money, or "we will decide later" |
| about 6 | a revenue source ("subscriptions", "ads") with no price or payer |
| about 11 | price, payer and rough volume that add up to real revenue |
| 15 | also the cost of serving each customer and a believable path to profit |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | Shops pay ₹499 a month; 300 shops = ₹1.5 lakh a month. Serving a shop costs ₹120 a month (messages, support), so each shop contributes ₹379; we break even at 260 shops. | payer, price, volume, cost per customer and a break-even |
| Half (about 7) | We will charge shops a subscription. | a source of revenue, no price or volume |
| Zero or near it | Monetisation will come later once we have scale. | no way to make money |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- A price with no payer named.
- Revenue that ignores the cost of serving each customer.
- Numbers that do not add up (volume × price ≠ the revenue claimed).
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 800 words).
