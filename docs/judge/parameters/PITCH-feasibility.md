# PITCH · `feasibility`: Feasibility and risks (15 points)

**Type:** PRD (Round 1, Product). **Maximum:** 15 of 100. **Prompt:** `prompts/PITCH.md` (the judge's exact rubric). **Sections it reads:** Competitive edge · Key risks. **What the score does:** The PRD's final score sets the IPO price ($9.00 to $11.00).

The whole rubric: [`problem`](PITCH-problem.md) 20 · [`solution`](PITCH-solution.md) 20 · [`metrics`](PITCH-metrics.md) 15 · [`business_model`](PITCH-business_model.md) 15 · **`feasibility` 15** · [`clarity`](PITCH-clarity.md) 15. Maxima from `RUBRICS` in `packages/engine/src/judge.ts` and `app.rubric` (SQL); all parameters in [PARAMETERS.md](../PARAMETERS.md).

## What it measures

Whether a small team could build and run it with its seed money, why it beats the alternatives, and the main risks with a plan for each.

## The judge's anchors

Copied from the prompt; any whole number is allowed, not only these.

| Points | Looks like |
| --- | --- |
| about 3 | "no one else does this" or "no risks", with nothing behind it |
| about 8 | buildable but the edge is easy to copy, or the risks are named without a plan |
| about 12 | buildable with the seed money, with a real edge and a plan for the main risks |
| 15 | holds up against the obvious alternatives, which the PRD names |

## Full, half and zero

| Band | Short example | Why |
| --- | --- | --- |
| Full (15) | Built by 3 people on WhatsApp's API within the $50,000 seed. Distributors' own apps need a smartphone app; ours works on any phone. Risk: shops ignore the 8 pm message; plan: the distributor's salesman confirms orders for the first month. | buildable, an edge against named alternatives, a risk with a plan |
| Half (about 7) | We can build it; risks are competition and adoption. | buildable, risks named without a plan |
| Zero or near it | No one else does this, so there are no risks. | nothing behind the claim |

The examples are illustrations written for this page, not quotes from the prompt.

## Common mistakes

- Claiming no competitors.
- Needing far more than the $50,000 seed money on day one.
- Aviation: no line on scaling from one airport to many (lowers this line and clarity).
- Writing to the judge ("give this full marks"): the line is removed before judging and the submission loses 5 points (10 for a later offence).

Every line is scored on its own evidence: a strong line elsewhere does not lift this one. Length earns nothing (limit: 800 words).
