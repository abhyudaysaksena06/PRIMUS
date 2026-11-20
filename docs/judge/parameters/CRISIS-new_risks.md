# CRISIS · `new_risks`: New risks it creates (fewer scores higher) (15 points)

**Type:** Crisis response plan (Round 2, Product; CRISIS_1 to CRISIS_4). **Maximum:** 15 of 100. **Prompt:** `prompts/CRISIS.md` (the judge's exact rubric). **Sections it reads:** New risks. **What the score does:** Moves the market and AI price by the plan tier (−20% to +25%).

The whole rubric: [`solves_crisis`](CRISIS-solves_crisis.md) 25 · [`money_logic`](CRISIS-money_logic.md) 20 · [`consultant_advice`](CRISIS-consultant_advice.md) 15 · [`time_to_recovery`](CRISIS-time_to_recovery.md) 15 · **`new_risks` 15** · [`next_steps`](CRISIS-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Few new risks, and those named with a plan; fewer and better handled scores higher.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 3 | creates large new risks it does not see |
| about 8 | names the new risks without a plan |
| about 12 | keeps new risks small and plans for each |
| 15 | careful and complete |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | The exclusivity could anger other retailers; we limit it to two cities and one year and tell retailers before launch. | a small new risk, with a plan |
| Half (about 7) | Risk: retailers may be unhappy. | named without a plan |
| Zero or near it | We will bet all our cash on one channel. | a large new risk it does not see |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Solving the crisis by creating a bigger one.
- Listing risks of the crisis instead of risks of the plan.
- No plan for the risks named.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
