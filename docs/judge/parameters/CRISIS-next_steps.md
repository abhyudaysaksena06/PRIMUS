# CRISIS · `next_steps`: Clear, practical next steps (10 points)

**Type:** Crisis response plan (Round 2, Product; CRISIS_1 to CRISIS_4). **Maximum:** 10 of 100. **Prompt:** `prompts/CRISIS.md` (the judge's exact rubric). **Sections it reads:** Next steps. **What the score does:** Moves the market and AI price by the plan tier (−20% to +25%).

The whole rubric: [`solves_crisis`](CRISIS-solves_crisis.md) 25 · [`money_logic`](CRISIS-money_logic.md) 20 · [`consultant_advice`](CRISIS-consultant_advice.md) 15 · [`time_to_recovery`](CRISIS-time_to_recovery.md) 15 · [`new_risks`](CRISIS-new_risks.md) 15 · **`next_steps` 10**. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Clear, practical steps for the next few days, with owners.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 2 | "implement the plan" |
| about 6 | actions without owners or dates |
| 10 | this week's actions, owners and dates |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (10) | Today: CEO calls the 3 largest retailers; tomorrow: sales lead sends the new margin terms; Friday: ops starts the two-city launch. | actions, owners and dates |
| Half (about 5) | Contact retailers, launch in two cities, monitor sales. | no owners or dates |
| Zero or near it | Execute the plan. | nothing concrete |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Long-term goals instead of this week's steps.
- No owners.
- Steps that do not match the response.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
