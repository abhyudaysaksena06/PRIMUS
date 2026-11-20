# CRISIS · `solves_crisis`: Solves the crisis (25 points)

**Type:** Crisis response plan (Round 2, Product; CRISIS_1 to CRISIS_4). **Maximum:** 25 of 100. **Prompt:** `prompts/CRISIS.md` (the judge's exact rubric). **Sections it reads:** The crisis and what it does to us · Our response. **What the score does:** Moves the market and AI price by the plan tier (−20% to +25%).

The whole rubric: **`solves_crisis` 25** · [`money_logic`](CRISIS-money_logic.md) 20 · [`consultant_advice`](CRISIS-consultant_advice.md) 15 · [`time_to_recovery`](CRISIS-time_to_recovery.md) 15 · [`new_risks`](CRISIS-new_risks.md) 15 · [`next_steps`](CRISIS-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Deals directly with this crisis card and keeps the business serving its users.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 5 | ignores the card or restates it |
| about 12 | answers the card in general terms (a plan that does not make the card's decision cannot score above about 12) |
| about 20 | answers this card for this business with concrete actions, and makes the card's decision if it asks for one |
| 25 | also protects the users most affected |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (25) | We take the quick-commerce exclusivity for one year in two cities only, keep retailers elsewhere with a higher shelf margin, and phone our top 200 repeat buyers about where to find us. (FMCG crisis 1, "The product nobody wants to sell") | answers this card, makes its decision, protects the users |
| Half (about 12) | We will improve our distribution and marketing to recover sales. | answers in general, no decision |
| Zero or near it | Our product is great and customers love it. | ignores the card |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Skipping the twist's decision.
- Answering a different crisis.
- Forgetting the users who depend on the product now.
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
