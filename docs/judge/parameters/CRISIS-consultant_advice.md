# CRISIS · `consultant_advice`: Use of consultant advice (15 points)

**Type:** Crisis response plan (Round 2, Product; CRISIS_1 to CRISIS_4). **Maximum:** 15 of 100. **Prompt:** `prompts/CRISIS.md` (the judge's exact rubric). **Sections it reads:** What we take from our consultant. **What the score does:** Moves the market and AI price by the plan tier (−20% to +25%).

The whole rubric: [`solves_crisis`](CRISIS-solves_crisis.md) 25 · [`money_logic`](CRISIS-money_logic.md) 20 · **`consultant_advice` 15** · [`time_to_recovery`](CRISIS-time_to_recovery.md) 15 · [`new_risks`](CRISIS-new_risks.md) 15 · [`next_steps`](CRISIS-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Uses the firm's advice where it is good, says why where it is not.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 2 | ignores a memo it had, or says nothing about advice |
| about 7 | typical for a company that hired no firm and tests its own options as a firm would |
| about 8 | mentions the advice in passing |
| about 12 | adopts specific points of the memo with reasons |
| 15 | also explains any advice it rejects |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | We take the firm's two-city exclusivity and its margin figure; we reject its advice to sell direct, because our delivery cost per order is ₹65 against its ₹40 estimate. | adopts and rejects with reasons |
| Half (about 7) | Our consultant advised us well and we followed their memo. | mentions the advice in passing |
| Zero or near it | (no section about the advice, though a memo was received) | ignores the memo |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Copying the memo without saying why.
- Rejecting advice with no reason.
- Leaving the section empty when no firm was hired: test your own options instead.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
