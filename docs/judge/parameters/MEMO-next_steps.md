# MEMO · `next_steps`: Next steps (10 points)

**Type:** ZestUp crisis memo (Round 1, Consulting). **Maximum:** 10 of 100. **Prompt:** `prompts/MEMO.md` (the judge's exact rubric). **Sections it reads:** Next steps. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), from −$10,000 to +$25,000, at settlement; tonight it also sets the firm's base rate.

The whole rubric: [`diagnosis`](MEMO-diagnosis.md) 25 · [`options`](MEMO-options.md) 20 · [`recommendation`](MEMO-recommendation.md) 20 · [`numbers`](MEMO-numbers.md) 15 · [`risks`](MEMO-risks.md) 10 · **`next_steps` 10**. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Concrete actions for this week, with who does them and by when.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 2 | "implement the plan" |
| about 6 | actions without owners or dates |
| 10 | this week's actions (the public statement on the leak, the notice to retailers and distributors, quarantining the stock, starting the supplier and R&D work) with owners and dates |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (10) | Mon: CEO issues the public statement; Tue: sales head notifies all distributors; Wed: ops quarantines the 1,20,000 cans; Fri: procurement signs Supplier B samples. | this week's actions, owners and dates |
| Half (about 5) | Issue a statement, inform retailers, start R&D. | actions without owners or dates |
| Zero or near it | Implement the plan. | nothing to do on Monday |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Six-month goals instead of this week's actions.
- No owners.
- Missing the public statement on the leak.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
