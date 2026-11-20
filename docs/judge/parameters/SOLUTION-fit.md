# SOLUTION · `fit`: Fit to the statement (25 points)

**Type:** Round 3 solution (Product with its firm). **Maximum:** 25 of 100. **Prompt:** `prompts/SOLUTION.md` (the judge's exact rubric). **Sections it reads:** Our solution · Why it fits the statement. **What the score does:** Moves the market and AI price by the plan tier; a rise is scaled by the Round 3 leveller (×1.25 to ×0.25).

The whole rubric: **`fit` 25** · [`differentiation`](SOLUTION-differentiation.md) 20 · [`feasibility`](SOLUTION-feasibility.md) 20 · [`business_impact`](SOLUTION-business_impact.md) 20 · [`clarity`](SOLUTION-clarity.md) 15. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Answers this statement, for the users and the situation it names.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 5 | answers a different problem or the statement in general |
| about 12 | answers the statement but not its users or constraints |
| about 20 | answers the statement for the users it names (ignoring the catch or missing the target caps it at about 20) |
| 25 | also handles the statement's hardest part (its catch) and shows how the target would be met |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (25) | Waste falls from 9% to 3% by redistributing near-date stock from 30,000 shops each evening, using the brand's own dispatch data, so shops share no data and need no space. (FMCG statement 1, cut fresh-food waste from 9% to 3%) | the users, the catch and the target |
| Half (about 12) | A forecasting tool that helps shops order better. | answers the statement, not its constraints |
| Zero or near it | A loyalty app for shoppers. | a different problem |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Ignoring the catch.
- Not showing how the "You win if" target is met.
- Picking a statement and answering another.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 600 words).
