# CRISIS · `time_to_recovery`: Time to recovery (15 points)

**Type:** Crisis response plan (Round 2, Product; CRISIS_1 to CRISIS_4). **Maximum:** 15 of 100. **Prompt:** `prompts/CRISIS.md` (the judge's exact rubric). **Sections it reads:** Time to recovery. **What the score does:** Moves the market and AI price by the plan tier (−20% to +25%).

The whole rubric: [`solves_crisis`](CRISIS-solves_crisis.md) 25 · [`money_logic`](CRISIS-money_logic.md) 20 · [`consultant_advice`](CRISIS-consultant_advice.md) 15 · **`time_to_recovery` 15** · [`new_risks`](CRISIS-new_risks.md) 15 · [`next_steps`](CRISIS-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

A believable timeline back to normal, with milestones.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 3 | no timeline, or an impossible one |
| about 8 | a rough timeline |
| about 12 | a believable timeline with milestones |
| 15 | also says how progress will be measured |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | Week 1: shelf deals signed in 3 cities; month 2: sales at 80% of before; month 4: back to normal. Measured by weekly sales per store against the pre-crisis average. | milestones and how progress is measured |
| Half (about 7) | We expect to recover in about three months. | a rough timeline |
| Zero or near it | We will recover immediately. | impossible |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Recovering in days from a crisis that takes months.
- No milestones.
- No measure of progress.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
