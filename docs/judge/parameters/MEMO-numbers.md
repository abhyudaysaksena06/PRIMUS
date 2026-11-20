# MEMO · `numbers`: Numbers (15 points)

**Type:** ZestUp crisis memo (Round 1, Consulting). **Maximum:** 15 of 100. **Prompt:** `prompts/MEMO.md` (the judge's exact rubric). **Sections it reads:** The numbers. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), from −$10,000 to +$25,000, at settlement; tonight it also sets the firm's base rate.

The whole rubric: [`diagnosis`](MEMO-diagnosis.md) 25 · [`options`](MEMO-options.md) 20 · [`recommendation`](MEMO-recommendation.md) 20 · **`numbers` 15** · [`risks`](MEMO-risks.md) 10 · [`next_steps`](MEMO-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Costs, revenue at risk, cash and timing that are correct and add up.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| 0 to 2 | no numbers or wrong ones |
| about 7 | uses some of the case's numbers without working them through |
| about 11 | works out the supplier break-even, the best route for the stock or the best product mix correctly |
| 15 | gets all of them right, states its assumption for the new formula's margin, and shows cash in and out over the six months |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | A = B at 18,00,000 ÷ 7 ≈ 2,57,143 cans; export beats buyback only if approval comes within 2.8 months; Vitamin Water + Fruit Fusion = ₹13.7 lakh a month, paid back in about 2.6 months. | the case's worked numbers, correct |
| Half (about 7) | Supplier B is cheaper at low volumes; buyback recovers ₹10.8 lakh. | some numbers, not worked through |
| Zero or near it | Diversification will bring huge profits. | no numbers |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Arithmetic errors in the break-even.
- Choosing Hydration Plus with another product (over ₹35 lakh).
- No assumption stated for the new formula's margin.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
