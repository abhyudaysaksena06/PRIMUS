# CRISIS · `money_logic`: Money logic (20 points)

**Type:** Crisis response plan (Round 2, Product; CRISIS_1 to CRISIS_4). **Maximum:** 20 of 100. **Prompt:** `prompts/CRISIS.md` (the judge's exact rubric). **Sections it reads:** The money. **What the score does:** Moves the market and AI price by the plan tier (−20% to +25%).

The whole rubric: [`solves_crisis`](CRISIS-solves_crisis.md) 25 · **`money_logic` 20** · [`consultant_advice`](CRISIS-consultant_advice.md) 15 · [`time_to_recovery`](CRISIS-time_to_recovery.md) 15 · [`new_risks`](CRISIS-new_risks.md) 15 · [`next_steps`](CRISIS-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Costs, revenue lost and cash needed that are believable and add up.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| 0 to 3 | no numbers, or numbers that contradict each other |
| about 10 | some costs or losses without working them through |
| about 15 | the main costs, the revenue at risk and how they are paid for |
| 20 | complete, and fits the company's cash |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (20) | Revenue at risk ₹18 lakh a month; extra shelf margin costs ₹4 lakh a month; paid from cash of ₹40 lakh, leaving 6 months of runway. | costs, revenue at risk and how it is paid, against the cash |
| Half (about 10) | This will cost a few lakh but we will recover. | costs not worked through |
| Zero or near it | Money is not a problem. | no numbers |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Contradicting the card's own figures.
- Costs with no source of cash.
- Totals that do not add up.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
