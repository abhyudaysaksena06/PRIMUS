# SOLUTION · `feasibility`: Feasibility (20 points)

**Type:** Round 3 solution (Product with its firm). **Maximum:** 20 of 100. **Prompt:** `prompts/SOLUTION.md` (the judge's exact rubric). **Sections it reads:** How we will build it · Risks. **What the score does:** Moves the market and AI price by the plan tier; a rise is scaled by the Round 3 leveller (×1.25 to ×0.25).

The whole rubric: [`fit`](SOLUTION-fit.md) 25 · [`differentiation`](SOLUTION-differentiation.md) 20 · **`feasibility` 20** · [`business_impact`](SOLUTION-business_impact.md) 20 · [`clarity`](SOLUTION-clarity.md) 15. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

A small team could build and run it with the money and time it has.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 4 | needs money, people or time the company does not have |
| about 10 | possible but vague about how |
| about 15 | the build steps, the cost and the timeline |
| 20 | also names what is left out of the first version |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (20) | Weeks 1–4: route rules on 2 trucks in one city, ₹6 lakh; months 2–3: 500 shops. Left out: produce and cold chain. Risk: drivers skip stops; fix: per-stop payment. | steps, cost, timeline, what is left out |
| Half (about 10) | We will build the platform and roll it out nationally. | possible, vague |
| Zero or near it | A national fleet of 1,000 electric trucks next month. | far beyond the company's means |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- No cost or timeline.
- Risks named only as words, never handled.
- Everything in version one.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 600 words).
