# MEMO · `options`: Options and trade-offs (20 points)

**Type:** ZestUp crisis memo (Round 1, Consulting). **Maximum:** 20 of 100. **Prompt:** `prompts/MEMO.md` (the judge's exact rubric). **Sections it reads:** Options and trade-offs. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), from −$10,000 to +$25,000, at settlement; tonight it also sets the firm's base rate.

The whole rubric: [`diagnosis`](MEMO-diagnosis.md) 25 · **`options` 20** · [`recommendation`](MEMO-recommendation.md) 20 · [`numbers`](MEMO-numbers.md) 15 · [`risks`](MEMO-risks.md) 10 · [`next_steps`](MEMO-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Two or more real options, with what each one costs, gains and risks.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 4 | one option or a wish list |
| about 10 | two or three options with little on their trade-offs |
| about 16 | at least two of the four options compared on cost, time and risk with the case's figures |
| 20 | all four compared: the new formula (₹55 lakh, four months), Supplier A against Supplier B, the three routes for the 1,20,000 cans worth ₹27 lakh, and what fits in the ₹35 lakh for new products |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (20) | Formula (₹55 lakh, 4 months, no sales meanwhile) vs Supplier A (₹18 lakh + ₹12/can) vs B (₹19/can); stock: export ₹15 lakh, buyback ₹10.8 lakh, disposal −₹5 lakh; new products within ₹35 lakh. | all four options on cost, time and risk |
| Half (about 10) | We could reformulate, find a new supplier or diversify. | options without trade-offs |
| Zero or near it | ZestUp should launch a new product. | one option |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Listing options without their costs.
- Ignoring the existing stock.
- Comparing suppliers at one volume only.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
