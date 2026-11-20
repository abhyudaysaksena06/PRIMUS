# MEMO · `diagnosis`: Diagnosis (25 points)

**Type:** ZestUp crisis memo (Round 1, Consulting). **Maximum:** 25 of 100. **Prompt:** `prompts/MEMO.md` (the judge's exact rubric). **Sections it reads:** Diagnosis. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), from −$10,000 to +$25,000, at settlement; tonight it also sets the firm's base rate.

The whole rubric: **`diagnosis` 25** · [`options`](MEMO-options.md) 20 · [`recommendation`](MEMO-recommendation.md) 20 · [`numbers`](MEMO-numbers.md) 15 · [`risks`](MEMO-risks.md) 10 · [`next_steps`](MEMO-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

The real problem, why it matters and what is at stake for ZestUp, using the case's facts.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 5 | restates the case or is generic |
| about 12 | names the ban but not what is at stake |
| about 20 | 75% of revenue (ZestUp Original, made with Virex-7) becomes illegal the moment the ban is notified, the leak has taken control of the story before the planned week of preparation, and cash is limited |
| 25 | also sets the order of the work: survive the next six months first, then build a new flagship |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (25) | 75% of revenue dies the day the ban is notified; the leak took away the week ZestUp planned to prepare; cash is short. First survive six months, then replace the flagship. | the stakes, from the case's facts, with the order of the work |
| Half (about 12) | Virex-7 will be banned, which is a serious problem for ZestUp. | names the ban, not what is at stake |
| Zero or near it | ZestUp is a fast-growing beverage startup facing challenges. | restates the case |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Ignoring the leak and the lost week.
- Treating it as a marketing problem.
- No mention of limited cash.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
