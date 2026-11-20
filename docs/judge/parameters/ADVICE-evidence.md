# ADVICE · `evidence`: Evidence and numbers (20 points)

**Type:** Advice memo to a client (Rounds 2 and 3, Consulting; ADVICE_1 to ADVICE_5). **Maximum:** 20 of 100. **Prompt:** `prompts/ADVICE.md` (the judge's exact rubric). **Sections it reads:** Evidence and numbers. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), clamped to −$10,000 … +$25,000, plus $1,000 × (stars − 3), for a paid engagement.

The whole rubric: [`diagnosis`](ADVICE-diagnosis.md) 25 · [`actionable_advice`](ADVICE-actionable_advice.md) 30 · **`evidence` 20** · [`fit`](ADVICE-fit.md) 15 · [`clarity`](ADVICE-clarity.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Numbers, comparisons and reasons that support the advice and add up.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| 0 to 3 | no numbers or wrong ones |
| about 10 | some numbers not worked through |
| about 15 | works out the key numbers |
| 20 | correct, complete and fits the client's situation |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (20) | The export offer is 60% of ₹12 crore = ₹7.2 crore before logistics; holding the stock costs ₹30 lakh a month and loses it all in 9 months. | key numbers worked out and correct |
| Half (about 10) | The export offer is lower than wholesale but brings cash. | numbers named, not worked through |
| Zero or near it | This will definitely be profitable. | no numbers |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Using figures that contradict the card.
- Percentages with no base.
- Numbers that support a different recommendation.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words; an advice memo also needs at least 150 words for the fee to be paid).
