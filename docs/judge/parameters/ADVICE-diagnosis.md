# ADVICE · `diagnosis`: Diagnosis (25 points)

**Type:** Advice memo to a client (Rounds 2 and 3, Consulting; ADVICE_1 to ADVICE_5). **Maximum:** 25 of 100. **Prompt:** `prompts/ADVICE.md` (the judge's exact rubric). **Sections it reads:** Diagnosis. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), clamped to −$10,000 … +$25,000, plus $1,000 × (stars − 3), for a paid engagement.

The whole rubric: **`diagnosis` 25** · [`actionable_advice`](ADVICE-actionable_advice.md) 30 · [`evidence`](ADVICE-evidence.md) 20 · [`fit`](ADVICE-fit.md) 15 · [`clarity`](ADVICE-clarity.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

What the crisis or statement means for this client, why, and what it costs.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 5 | restates the card or statement |
| about 12 | names the real problem but not its cost |
| about 20 | explains the cause, the effect on this client and the cost |
| 25 | also names what the client should not do |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (25) | Your 3-year manufacturing commitment, not demand, is the problem: ₹12 crore of stock ties up cash and expires in 9 months. Do not dump it in India: it would cut your shelf price for good. | cause, effect, cost and what not to do |
| Half (about 12) | The client has too much stock it cannot sell. | the problem without its cost |
| Zero or near it | The client faces a difficult crisis. | restates the card |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Diagnosing the sector, not this client.
- No cost.
- Missing what the client must avoid.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words; an advice memo also needs at least 150 words for the fee to be paid).
