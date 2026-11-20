# ADVICE · `actionable_advice`: Actionable advice (30 points)

**Type:** Advice memo to a client (Rounds 2 and 3, Consulting; ADVICE_1 to ADVICE_5). **Maximum:** 30 of 100. **Prompt:** `prompts/ADVICE.md` (the judge's exact rubric). **Sections it reads:** What to do. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), clamped to −$10,000 … +$25,000, plus $1,000 × (stars − 3), for a paid engagement.

The whole rubric: [`diagnosis`](ADVICE-diagnosis.md) 25 · **`actionable_advice` 30** · [`evidence`](ADVICE-evidence.md) 20 · [`fit`](ADVICE-fit.md) 15 · [`clarity`](ADVICE-clarity.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Specific steps the client can take now, in order, with who and when.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 5 | generic ("improve marketing") |
| about 15 | steps without order or owners |
| about 24 | ordered, specific steps the client can start today (advice that skips the card's decision cannot score above about 16) |
| 30 | also gives a fallback if the first step fails |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (30) | 1. Today the CFO accepts the export offer for 60% of the stock, ring-fenced to Gulf buyers. 2. This week ops renegotiates the plant commitment. 3. If the export falls through by day 10, sell through the two largest wholesalers at 30% off, outside metro shelves. | ordered, owned, with a fallback |
| Half (about 15) | Sell abroad, renegotiate contracts, forecast better. | steps without order or owners |
| Zero or near it | Focus on marketing and customer experience. | generic |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Skipping the decision the card's twist asks for.
- Advice with no order or owner.
- No fallback.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words; an advice memo also needs at least 150 words for the fee to be paid).
