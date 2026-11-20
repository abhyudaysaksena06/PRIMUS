# PITCH · `clarity`: Clarity (15 points)

**Type:** PRD (Round 1, Product). **Maximum:** 15 of 100. **Prompt:** `prompts/PITCH.md` (the judge's exact rubric). **Sections it reads:** the whole PRD. **What the score does:** The PRD's final score sets the IPO price ($9.00 to $11.00).

The whole rubric: [`problem`](PITCH-problem.md) 20 · [`solution`](PITCH-solution.md) 20 · [`metrics`](PITCH-metrics.md) 15 · [`business_model`](PITCH-business_model.md) 15 · [`feasibility`](PITCH-feasibility.md) 15 · **`clarity` 15**. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

A PRD that is well organised, specific and easy to act on, with no filler.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 4 | hard to follow, repetitive or padded |
| about 9 | readable but general in places |
| about 13 | well organised and specific throughout |
| 15 | a PRD a team could start building from tomorrow |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | Seven short sections, each with numbers that agree with each other; no sentence repeats another. | specific and ready to act on |
| Half (about 7) | Clear sections, but two of them repeat the problem in general words. | readable, general in places |
| Zero or near it | 800 words of slogans, a missing business model section and contradicting numbers. | padded and missing a section |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Padding to reach 800 words: length earns nothing.
- A missing required section.
- Numbers that differ between sections.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 800 words).
