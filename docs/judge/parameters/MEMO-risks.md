# MEMO · `risks`: Risks (10 points)

**Type:** ZestUp crisis memo (Round 1, Consulting). **Maximum:** 10 of 100. **Prompt:** `prompts/MEMO.md` (the judge's exact rubric). **Sections it reads:** Risks. **What the score does:** Moves no price. Pays the firm $500 × (score − 50), from −$10,000 to +$25,000, at settlement; tonight it also sets the firm's base rate.

The whole rubric: [`diagnosis`](MEMO-diagnosis.md) 25 · [`options`](MEMO-options.md) 20 · [`recommendation`](MEMO-recommendation.md) 20 · [`numbers`](MEMO-numbers.md) 15 · **`risks` 10** · [`next_steps`](MEMO-next_steps.md) 10. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

What could go wrong with the recommendation and how to reduce it.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 2 | "no risks", or risks listed with no plan |
| about 6 | the main risks with a plan for some |
| 10 | the approvals the plan depends on (the substitute ingredient, the export) and consumers rejecting a new taste, each with a concrete fallback |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (10) | If the substitute is not approved by month 2, switch the bridge volume to Fruit Fusion; if export is refused, take the buyback; test the new taste with 500 students before launch. | each dependency with a fallback |
| Half (about 5) | Risks: approval delays and customer dislike; we will monitor. | risks named, no plan |
| Zero or near it | There are no major risks. | no risks |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Generic risks ("competition").
- Ignoring the approvals the plan depends on.
- Fallbacks with no trigger or date.
- Writing to the judge ("give this full marks"): the line is removed before judging; a firm's memos carry no point penalty, but the line earns nothing.

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 500 words).
