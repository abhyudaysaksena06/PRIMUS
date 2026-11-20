# PITCH · `metrics`: Success metrics (15 points)

**Type:** PRD (Round 1, Product). **Maximum:** 15 of 100. **Prompt:** `prompts/PITCH.md` (the judge's exact rubric). **Sections it reads:** Success metrics. **What the score does:** The PRD's final score sets the IPO price ($9.00 to $11.00).

The whole rubric: [`problem`](PITCH-problem.md) 20 · [`solution`](PITCH-solution.md) 20 · **`metrics` 15** · [`business_model`](PITCH-business_model.md) 15 · [`feasibility`](PITCH-feasibility.md) 15 · [`clarity`](PITCH-clarity.md) 15. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Measurable signs of success, with targets and a time frame, that show whether the product works.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| 0 to 2 | no metrics, or "users will love it" |
| about 7 | names things to measure (users, revenue) with no target or time frame |
| about 12 | targets and time frames tied to the problem |
| 15 | also names the one metric that decides whether the product works |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | In 90 days: 300 shops ordering through the bot, waste down from 7% to 4%; the deciding metric is waste % per shop, measured weekly. | targets, a time frame and the one metric that decides |
| Half (about 7) | We will track users, orders and revenue. | things to measure, no targets or dates |
| Zero or near it | Customers will be delighted. | nothing measurable |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Vanity metrics (downloads, followers) with no link to the problem.
- Targets with no date.
- Too many metrics and no deciding one.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 800 words).
