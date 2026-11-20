# SOLUTION · `clarity`: Clarity (15 points)

**Type:** Round 3 solution (Product with its firm). **Maximum:** 15 of 100. **Prompt:** `prompts/SOLUTION.md` (the judge's exact rubric). **Sections it reads:** the whole solution. **What the score does:** Moves the market and AI price by the plan tier; a rise is scaled by the Round 3 leveller (×1.25 to ×0.25).

The whole rubric: [`fit`](SOLUTION-fit.md) 25 · [`differentiation`](SOLUTION-differentiation.md) 20 · [`feasibility`](SOLUTION-feasibility.md) 20 · [`business_impact`](SOLUTION-business_impact.md) 20 · **`clarity` 15**. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Well organised, specific and easy to act on, with no filler.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 4 | hard to follow or padded |
| about 9 | readable but general in places |
| about 13 | organised and specific throughout |
| 15 | a solution a team could start building tomorrow |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | Six sections, every claim with a number, nothing repeated. | ready to build from |
| Half (about 7) | Organised, but the impact section repeats the solution in general terms. | general in places |
| Zero or near it | A missing Risks section and 600 words of slogans. | a missing section lowers this line |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- A missing required section.
- Padding: length earns nothing.
- Contradictions between sections.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 600 words).
