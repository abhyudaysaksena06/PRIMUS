# ADVICE · `fit`: Fit to the client's crisis (15 points)

**Type:** Advice memo to a client (Rounds 2 and 3, Consulting; ADVICE_1 to ADVICE_5). **Maximum:** 15 of 100. **Prompt:** `prompts/ADVICE.md` (the judge's exact rubric). **Sections it reads:** Why it fits your company. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), clamped to −$10,000 … +$25,000, plus $1,000 × (stars − 3), for a paid engagement.

The whole rubric: [`diagnosis`](ADVICE-diagnosis.md) 25 · [`actionable_advice`](ADVICE-actionable_advice.md) 30 · [`evidence`](ADVICE-evidence.md) 20 · **`fit` 15** · [`clarity`](ADVICE-clarity.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Advice for this client's business and this crisis or statement, not generic.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 3 | could be sent to any company |
| about 8 | mentions the client's business |
| about 12 | builds on the client's PRD and situation |
| 15 | uses the client's own strengths |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | Your PRD says 40% of sales come from your own app: use it to clear stock to existing buyers before any discount reaches shelves. | built on the client's own strength |
| Half (about 7) | As a drinks company, you should look after your brand. | mentions the business |
| Zero or near it | Companies in crisis should cut costs. | fits any company |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Advice that ignores the client's PRD.
- A template memo sent to both clients.
- Round 3: ignoring the statement's catch and target.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words; an advice memo also needs at least 150 words for the fee to be paid).
