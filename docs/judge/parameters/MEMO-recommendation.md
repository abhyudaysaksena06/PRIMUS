# MEMO · `recommendation`: Recommendation (20 points)

**Type:** ZestUp crisis memo (Round 1, Consulting). **Maximum:** 20 of 100. **Prompt:** `prompts/MEMO.md` (the judge's exact rubric). **Sections it reads:** Recommendation. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), from −$10,000 to +$25,000, at settlement; tonight it also sets the firm's base rate.

The whole rubric: [`diagnosis`](MEMO-diagnosis.md) 25 · [`options`](MEMO-options.md) 20 · **`recommendation` 20** · [`numbers`](MEMO-numbers.md) 15 · [`risks`](MEMO-risks.md) 10 · [`next_steps`](MEMO-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

One clear choice that follows from the diagnosis and options, with the reason.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 4 | vague or picks everything |
| about 10 | a clear choice with a thin reason |
| about 16 | a clear choice that follows from the analysis |
| 20 | one six-month plan, month by month, combining the response to the leak (an honest statement, a plan for retailers and distributors, never selling banned cans in India), the stock, a short-term revenue bridge and the replacement flagship, and says what it gives up |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (20) | Month 1: public statement, recall plan with distributors, quarantine and export the cans; months 1–2: launch Vitamin Water + Fruit Fusion (₹35 lakh); months 2–6: Supplier B substitute while volumes are low; we give up a new formula this half-year. | one sequenced plan that says what it gives up |
| Half (about 10) | We recommend Supplier A because it is cheaper in the long run. | a choice with a thin reason |
| Zero or near it | ZestUp should do all four options at once. | picks everything |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Recommending every option.
- Selling banned cans in India.
- A choice the memo's own numbers contradict.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
