# SOLUTION · `business_impact`: Business impact (20 points)

**Type:** Round 3 solution (Product with its firm). **Maximum:** 20 of 100. **Prompt:** `prompts/SOLUTION.md` (the judge's exact rubric). **Sections it reads:** Business impact. **What the score does:** Moves the market and AI price by the plan tier; a rise is scaled by the Round 3 leveller (×1.25 to ×0.25).

The whole rubric: [`fit`](SOLUTION-fit.md) 25 · [`differentiation`](SOLUTION-differentiation.md) 20 · [`feasibility`](SOLUTION-feasibility.md) 20 · **`business_impact` 20** · [`clarity`](SOLUTION-clarity.md) 15. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Who pays, how much, and what it does for the company's revenue and users, with numbers.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| 0 to 3 | no revenue or users in it |
| about 10 | a payer and a price |
| about 15 | adds believable volumes |
| 20 | adds the cost of serving users and a path to profit |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (20) | The brand pays ₹2 per kg saved; 6% of ₹60 crore of stock saved = ₹3.6 crore a year to the brand, ₹40 lakh a year to us; serving costs ₹15 lakh, profit from month 8. | payer, price, volume, cost, path to profit |
| Half (about 10) | The brand pays a monthly fee. | a payer and a price, no volume |
| Zero or near it | It will be very good for the business. | no numbers |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- No payer.
- Revenue without the cost of serving.
- Numbers that ignore the statement's figures.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 600 words).
