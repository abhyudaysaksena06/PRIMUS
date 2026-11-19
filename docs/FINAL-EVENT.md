# PRIMUS 2026: the final event build

Thapar, Friday 20 November 2026, doors 20:00 IST. 150 teams (50 Product, 50 Consulting, 50 Finance), event slug
`primus-2026`, site `https://primus.mrdev4u.com`. This page says what the final build is, where each part came from,
and the exact steps to put it live tonight. The night itself (times, who does what, failures) is
[FINAL-DAY.md](FINAL-DAY.md) part B; the staff's quick card is [RUNBOOK.md](../RUNBOOK.md).

## 1. What the final build is

The branch `claude/blissful-heisenberg-pkx53e` of `abhyudaysaksena06/PRIMUS`. It is TushKum's `TushKum/shutUpV`
as the base, with everything built on top of it in this repo.

| From `TushKum/shutUpV` | In this build? |
| --- | --- |
| `claude/market-simulation-platform-9rk357` (the platform, up to e8f24bd, 18 Nov: the final case book) | Yes, all of it, byte for byte (the case-book PDF, `build.py`, `final_case.py`, `portfolios.py`) |
| `Final-Frontend` (up to 7c17ef2, 19 Nov: Matrix sign-in, team navigation, market board, `/demo` walkthrough, the Shares & Equity % deal screens in `/demo`) | Yes, at its last commit |
| `matrix-theme`, `claude/project-thread-rypawk` | Yes (both are inside `Final-Frontend`) |
| `primus-frontend` (9 commits, 13–18 Nov: an earlier "Matrix command navigation" design) | **No**: it was replaced by `Final-Frontend`'s navigation the next day |

Do **not** `git merge` shutUpV into this repo: it was brought in as copies, so a merge reports 82 conflicts, and it
would add shutUpV's migrations 048–052, which are the same changes as this repo's 053–056 and 058 under other numbers and
would run them twice on the live database.

Built here on top of shutUpV (all in the repo, all tested):

| Part | Where |
| --- | --- |
| Registration desk (Excel upload, check-in, a card signs in only after check-in) | migrations 048–049, `/admin/<slug>/desk`, `/register` |
| Run-the-event page and full organiser control | migrations 050–052, `/admin/<slug>/run` |
| Market algorithm: the Round 1 practice market (top 3 funds win $50,000 each, real cash); Round 3 evens out the market (×1.25 of the price rise for the weakest company down to ×0.25 for the strongest) | migrations 058, 064; `packages/engine/src/candles.ts` |
| Hiring: 60% dilution cap (a company keeps 40,000 of 100,000 shares), compulsory hiring (base fee $22,500; Round 3: 10% of cash), the open two-sided market (a firm can pitch first), 5 open offers per company, hire chat 30 a minute | migrations 057, 060–062, 065 |
| Compulsory hiring matches only teams that checked in at the desk | migration 066 |
| Crisis cards sealed until that sub-round's hiring closes | migration 063 |
| The AI judge: prompts for every round (`prompts/*.md`), Claude Haiku 5.5, median of 3 (5 if the spread is over 10), prompt-injection removal, 150-word minimum memo | `prompts/`, `apps/web/lib/judge/`, `docs/JUDGE.md` |
| The organisers' judging specifications (reference) | [judge/PRODUCT-JUDGE-SPEC.md](judge/PRODUCT-JUDGE-SPEC.md), [judge/CONSULTING-JUDGE-SPEC.md](judge/CONSULTING-JUDGE-SPEC.md) |
| Case studies: the sector case book, problem statements and crises (the PDF the organisers sent), the 30 Round 3 statements, the 12 crisis cards, ZestUp | `docs/case-studies/`, `seed/sectors/`, `prompts/MEMO.md` |
| Track guides and cards for teams and staff | `docs/event/primus/`, `docs/event/staff/` |
| One catch-up SQL for the live database, and a read-only night check | `pnpm catch-up-sql`, `scripts/sql/night-check.sql` |

Checked against the organisers' files: every rubric line and maximum in the code equals the two judging specs; the
aviation fact sheet, the 12 crisis cards with their twists, the 30 statements and the ZestUp numbers are in the
prompts and decks; the case-book PDF in the repo is byte for byte the one the organisers sent.

Tests on the final build: typecheck, 290 engine, 820 web and 310 database tests pass (`pnpm test`).

### One thing that is a preview only

TushKum's `/demo` screens show Consulting and Finance deals in **Shares & Equity %** (a base equity rate from the
Round 1 score, a 1-to-1 "lock", Product teams selling equity to Finance teams). That is the walkthrough on sample
data; it calls no database. The real game tonight hires a firm with **cash, shares or both**, three counters each
side, a binding accept and up to two clients per firm, and Finance trades on the market. The rules teams read
(`docs/event/primus/`) describe the real game.

## 2. Tonight, in this order

### Supabase (project `primus`, Mumbai) → SQL Editor → New query

1. **Catch-up SQL.** Generate it with `pnpm catch-up-sql` (writes `out/catch-up-20261125000059-to-20261202000066.sql`)
   and run the whole file once. It applies only the migrations the database is missing (060–066 for a database at
   059), in one transaction, and its last line shows the schema version: it must be `20261202000066`. Running it
   again changes nothing. It replaces the old `run-event-sql/16-hiring-guardrails.sql` and `17-sealed-crisis.sql`.
2. **The event SQL** you already generated for `primus-2026` (150 teams, start 20:00 IST 20 Nov). Use the same file
   whose login cards you printed: generating a new one makes new passwords. To reprint the same cards, run
   `pnpm event-sql` again with the `CARD_SECRET` at the bottom of your logins file. If a 9-team demo event's codes
   clash, delete that event first.
3. **Night check:** run `scripts/sql/night-check.sql` (read-only). Every line should say OK; a FIX line says what is
   wrong. Its first line names the slug: change it if your event is not `primus-2026`.

### Vercel (project `primus`) → Settings → Environment Variables

4. Rotate `SUPABASE_SERVICE_ROLE_KEY` in Supabase (Settings → API) first, then paste the new value here.
5. Add `ANTHROPIC_API_KEY`. Delete `JUDGE_FAKE`. Set `JUDGE_MODEL` and `JUDGE_BACKUP_MODEL` to `claude-haiku-5-5`.
   Delete `JUDGE_PRD_MODEL` and `JUDGE_SOLUTION_MODEL`: nothing reads them.
6. Deploy this branch to production (or merge it to `main`), then redeploy so the variables take effect.
   Next.js is 16.4.3, with two moderate advisories fixed in 16.4.5; the first `next build` can stop on that warning,
   and running it again builds.

### Checks

7. `https://primus.mrdev4u.com/api/health` → `"database":"ok","schema":"ok"`.
8. On the organiser laptop with the new key in `.env`: `pnpm judge-check` (a live test of the judge; there is no
   `pnpm calibrate`), then `pnpm preflight --slug primus-2026` → all PASS.
9. Control panel → Judge → calibration: each sample's median inside its band.
10. Print or hand out `primus-2026-login-cards.pdf`; keep `primus-2026-logins.txt` private.

## 3. Rules that are decided in the code

| Rule | Tonight |
| --- | --- |
| Practice market prize | The 3 funds worth the most at 22:00 each win $50,000 in real cash (a fund must trade once to be ranked) |
| Round 3 multipliers | Every Round 3 company ranked by its score so far; its price rise ×1.25 for the weakest down to ×0.25 for the strongest, evenly spaced; a falling tier applies in full |
| Equity | A company keeps at least 40,000 of its 100,000 shares (40%) |
| Hiring | Compulsory: a company with no firm when hiring closes is matched at $22,500 (Round 3: 10% of its cash); only checked-in teams are matched |
| Advice memo | At least 150 words, or the fee is refunded to the client |

To change one of these, change the code and its test before the night, never on it.

## 4. Not in this build

- A 600-team version: no `600-teams` branch exists on GitHub. The code allows 3–50 teams per track.
- `primus-frontend` (see section 1).
