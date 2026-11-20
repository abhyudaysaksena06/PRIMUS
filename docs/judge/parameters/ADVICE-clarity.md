# ADVICE · `clarity`: Clarity (10 points)

**Type:** Advice memo to a client (Rounds 2 and 3, Consulting; ADVICE_1 to ADVICE_5). **Maximum:** 10 of 100. **Prompt:** `prompts/ADVICE.md` (the judge's exact rubric). **Sections it reads:** the whole memo. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), clamped to −$10,000 … +$25,000, plus $1,000 × (stars − 3), for a paid engagement.

The whole rubric: [`diagnosis`](ADVICE-diagnosis.md) 25 · [`actionable_advice`](ADVICE-actionable_advice.md) 30 · [`evidence`](ADVICE-evidence.md) 20 · [`fit`](ADVICE-fit.md) 15 · **`clarity` 10**. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Easy to follow in one reading, with no filler.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 2 | hard to follow or padded |
| about 6 | readable but wordy |
| 10 | makes every sentence count |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (10) | Four short sections, each sentence a fact, a number or an action. | every sentence counts |
| Half (about 5) | Clear advice buried in long paragraphs that repeat the card. | readable but wordy |
| Zero or near it | 500 words of general business phrases. | padded |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Padding past the point (the floor is 150 words, not 500).
- Repeating the card back to the client.
- Jargon instead of steps.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words; an advice memo also needs at least 150 words for the fee to be paid).
