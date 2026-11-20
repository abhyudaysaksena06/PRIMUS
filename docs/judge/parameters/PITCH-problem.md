# PITCH · `problem`: Problem and target user (20 points)

**Type:** PRD (Round 1, Product). **Maximum:** 20 of 100. **Prompt:** `prompts/PITCH.md` (the judge's exact rubric). **Sections it reads:** Problem and target user. **What the score does:** The PRD's final score sets the IPO price ($9.00 to $11.00).

The whole rubric: **`problem` 20** · [`solution`](PITCH-solution.md) 20 · [`metrics`](PITCH-metrics.md) 15 · [`business_model`](PITCH-business_model.md) 15 · [`feasibility`](PITCH-feasibility.md) 15 · [`clarity`](PITCH-clarity.md) 15. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

A specific problem, the user who has it, how many people have it and what it costs them today.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 4 | vague or generic ("students face many problems") |
| about 10 | a real problem for a named user, with no sense of how often, how many or what it costs |
| about 16 | a specific user and situation with a believable size or evidence (a survey, a count, a pilot) and the cost today |
| 20 | all of that, sharp and hard to argue with |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (20) | Kirana owners in Ludhiana throw away 7% of their dairy stock; 4,200 such shops in the city lose about ₹9,000 a month each. We surveyed 40: 31 order by guesswork. | a named user, a count, the cost today and evidence |
| Half (about 10) | Small shops waste a lot of fresh food because they cannot predict demand. | a real user and problem, but no size, frequency or cost |
| Zero or near it | FMCG has many inefficiencies that hurt everyone. | no user, no problem anyone could act on |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Describing the whole sector instead of one user.
- Market size with no link to the user's pain ("a ₹10 lakh crore market").
- Numbers that contradict the problem card or, in Aviation, the network fact sheet (for example 180-seat jets).
- Copying a sample company from the case book.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 800 words).
