# How cards are dealt

Every piece of content a team is dealt during a PRIMUS night, who decides it, when it can change and how anyone can
check it was fair: the problem cards (Round 1), the crisis cards (Round 2), the Round 3 statements and the bulletins.
Written for the organisers and the software specialist. Each rule names the code that holds it.

Status words: **built** = in the repository at migration 070; **tonight** = being built today behind a switch on the
Run page (`app.feature_catalog()`, `supabase/migrations/20261206000070_switches.sql`), described from the plan with
the migration number the plan gave it.

| Content | File to upload (tonight's set) | Locked | Dealt | Who sees it |
| --- | --- | --- | --- | --- |
| Problem cards (sector briefs) | `seed/sectors/problem-cards.csv`: 3 cards, FMCG, Aviation, Luxury | at the squad draw | at the draw, 21:00 | the squad, from the draw |
| Crisis cards | `seed/sectors/crisis-cards.csv`: 4 per sector, 12 in all | at the squad draw | at each crisis reveal (22:45, 00:15, 01:45, 03:15) | everyone in the event once that crisis's hiring closes (minute 20); staff always |
| Round 3 statements | `seed/sectors/statements.csv`: 10 per sector, 30 in all | at the first draft pick | in the draft, from 04:45 | everyone, during Round 3 |
| Bulletins | written on the night | when published | when published | everyone |

Upload all three files on the organiser's **Content** page before the draw (`seed/sectors/README.md`). The event
cannot leave `SETUP` without a seed commitment, a problem deck of a valid size and a crisis deck (`app.gate_blocker`).

## 1. Problem cards and the squad draw

**The deck.** `public.upload_problem_deck` (migration 042) takes cards with a number (1–999, unique), an optional
sector, a title (≤ 200 characters) and a body (≤ 4,000). The deck's size decides the mode (`app.problem_deck_size_ok`):

| Cards | Mode | Tonight |
| --- | --- | --- |
| 1 | one case: every squad gets the same card | no |
| 2 to 6 (and fewer than squads + 2) | **sectors**: one card per sector, squads dealt round the cards | **yes: 3 sectors** |
| squads + 2 or more | hands: each squad is dealt 3 cards and picks one by `PROBLEM_PICK` | no |

The deck is fixed once the lottery has been drawn (`TOO_LATE`).

**The provable seed.**

1. The day before, an organiser runs `pnpm new-seed` (`scripts/new-seed.ts`): 32 random bytes as 64 hex characters
   (the secret seed) and its SHA-256 (the commitment). The commitment is published and entered while the event is
   still in `SETUP` (`public.set_seed_commitment`); it cannot change once the event has started.
2. At the draw (phase `SQUAD_DRAW`, 21:00) the organiser enters the seed and a public dice roll (1 to 6 digits).
   `public.run_lottery` refuses a seed that is not 64 lower-case hex characters and a seed whose SHA-256 is not the
   commitment (`COMMITMENT_MISMATCH`).
3. Root = SHA-256(seed + dice). Each draw uses its own stream of the same generator: block i of stream s is
   SHA-256(root + ":" + s + ":" + i), read as eight 32-bit numbers; integers are drawn without bias (rejection
   sampling) and shuffles are Fisher–Yates (`app.rng_*`, migration 007; `packages/engine/src/lottery.ts`). The SQL and
   the TypeScript generator are tested against each other (`supabase/tests/parity.test.ts`, "lottery").

**The draw itself** (`app.lottery_draw`, migration 042, mirrored by the engine's `drawLottery`):

- **Squads** (stream `squads`): each track's team codes, sorted, are shuffled; squad s is the s-th Product, Consulting
  and Finance team. The tracks must be the same size, with at least 3 squads.
- **Sectors** (stream `problems`): the squads are shuffled and dealt round the cards in turn, so every sector gets an
  equal share (the counts differ by at most one): 67, 67 and 66 for 200 squads; 17, 17 and 16 for 50. Each squad's
  card is chosen at once; a company's sector is the sector of its squad's card (`app.company_sector`).
- **Coverage** (stream `coverage`): squads are put in a random cycle and each Consulting firm follows the next two
  squads' companies for its BUY/SELL call.

The draw also creates each company (60,000 shares retained, 5,000 to the squad's fund for its $50,000 seed money,
35,000 for the IPO); see [INTEGRATION.md](INTEGRATION.md).

**Tonight (W2, switch `draw_checked_in`, SCALE, on by default).** Only teams checked in at the desk are drawn; the
smallest checked-in track sets the number of squads, and the Desk page shows each track's surplus and blocks the draw
until the organisers confirm what to do with it. Without the switch, `run_lottery` draws every team of each track and
refuses tracks of different sizes.

**Checking the draw.** The projector shows the commitment, the dice and "verified" when the draw is made. Anyone can
recompute the whole draw with `pnpm verify-lottery --file lottery-record.json --commitment <published value>`
(`scripts/verify-lottery.ts`), from the record served at `/api/lottery-record` (`public.lottery_record_rows`).

> **Gap on a PRIMUS night (built code).** The record is served only once `events.seed_revealed` is set, and only the
> classic night's crisis sets it (`app.apply_crisis`, migration 011). A PRIMUS event never runs that phase, so the
> seed is never revealed and `/api/lottery-record` answers 404 all night. Tonight's random firm assignment (071) and
> the draft's random fallback (077) are also drawn from the seed, so the seed must stay secret until the last of
> those draws (Round 3 hiring, about 05:15) and be published by hand after it: as a bulletin, or by a fix that sets
> `seed_revealed` then.

## 2. Crisis cards

**The deck.** `public.upload_crisis_deck` (migration 042): 1 to 500 cards, each with a category, a number (1–999), a
title, a body and an optional sector; the sector, category and number together are unique. Fixed once the squads are
drawn. Tonight's deck has 4 cards per sector, numbered by crisis: 1 operations, 2 market, 3 trust, 4 money
(`seed/sectors/README.md`).

**Dealing, at each reveal.** When `REVEAL_k` passes (crisis k starts: 22:45, 00:15, 01:45, 03:15), the heartbeat runs
`app.reveal_subround(event, k)` (migration 032) once:

1. Every company gets its card for crisis k (`subround_crises`). A company whose sector has cards gets its
   **sector's card numbered k**; if there is no card numbered k, the sector's cards in turn ((k − 1) mod n + 1 in
   number order) (`app.sector_crisis_card`). So **every company of a sector faces the same card** in a crisis. Cards
   without a sector fall back to the lottery's crisis draw (`app.lottery_crises`: root SHA-256(seed + dice +
   ":crisis:" + k), stream `crisis`, categories in turn round the shuffled squads, a random card of the category).
2. Every market price and AI price falls 5% (`SUB_SHOCK` rows in `round_prices`); collateral is recalculated.
3. A bulletin goes out: "Crisis k: every company is hit".
4. Trading is halted: the crisis's first trading round opens at minute 5 (`PRIMUS_ROUNDS`,
   `packages/engine/src/schedule.ts`).

**Sealed until hiring closes** (migration 063). Teams read a card only through its `subround_crises` row, and the
row-level policy lets a team read it only once `app.hiring_closed(event, k)` is true. The heartbeat closes hiring at
`HIRE_k` (minute 20, `app.primus_tick`): it first assigns a firm to every unhired company, lapses open offers, then
stamps `subrounds.hiring_closed_at`, which opens every card of the crisis to everyone at once. Organisers and the
fairness officer (`app.is_staff`) read every card throughout, to run the night. So hiring is blind: a company hires
on a firm's record and pitch, and every firm bids without knowing the crisis.

**Tonight (W11, switch `crisis_popup`, DISPLAY, on by default).** A pop-up for everyone at the reveal ("Crisis k:
prices −5%, trading halted 5 minutes, your card opens at HH:MM") and a second one, once per team per crisis, when the
card unseals.

The card is also the judge's context for the crisis plan (`CRISIS_k`) and the firm's advice memo (`ADVICE_k`)
(`app.primus_judge_context`, migration 053).

## 3. Round 3 statements and the draft

**The statements.** `public.set_problem_statements` (migration 042) takes rows of `sector, number, title, body,
cap` (cap = how many companies may pick it; 5 when blank). It refuses a set without room for every company
(`NOT_ENOUGH_ROOM`), and, when statements name sectors, a set where some sector's statements have less room than
that sector has companies. Statements can be replaced until the first pick (`DRAFT_STARTED`).

| | Statements per sector | Cap each | Room per sector |
| --- | --- | --- | --- |
| `seed/sectors/statements.csv` today | 10 | 3 | 30 (for 16–17 companies per sector at 50 per track) |
| Tonight (W4) | 10 | 7 | 70 (for up to 67 companies per sector at 200 per track) |

**The draft today (built).** It starts when Round 3 (`SATURATION`) begins and the statements have room for every
company, or as soon as such statements are uploaded during Round 3 (`app.start_draft`, migrations 038 and 042):

- one queue of every company, **lowest score so far first** (the average of its PRD and four crisis plan scores;
  ties to the lower ticker), **20 seconds** each. Each pick gives the next company a fresh 20 seconds
  (`app.advance_draft`);
- a company may pick only a statement of its own sector that still has room (`public.pick_statement`: `WRONG_SECTOR`,
  `STATEMENT_FULL`);
- a missed turn: the heartbeat gives the company its own sector's **least crowded** statement with room, lowest number
  first (`app.draft_tick`, `app.open_statement`);
- if the planned time is too short, the `DRAFT` deadline and the rest of Round 3 move later so every company gets its
  20 seconds.

With one queue, 200 companies take 200 × 20 s ≈ 67 minutes.

**Tonight (077, switches `draft_by_sector`, SCALE, and `draft_random_fallback`, RULE, both on by default).**

- **Three sector queues at once**, each lowest score so far first: 67 companies × 20 s ≈ 22 minutes. Round 3 moves
  later by the time the draft runs over its planned 15 minutes.
- A missed pick gets a **seeded random** statement of the company's sector that still has room, instead of the least
  crowded one (drawn from the lottery seed, so it can be checked once the seed is published).
- Picks no longer go to every screen: staff and the projector hear them; draft screens re-read every 3 seconds. The
  "Your pick!" alert is back for the company on the clock.

The statement is the judge's context for the solution (`SOLUTION`) and the firm's Round 3 memo (`ADVICE_5`).

## 4. Bulletins

| Kind | Who | How |
| --- | --- | --- |
| `GENERAL`, `FAIRNESS`, `SYSTEM` news | organisers, any time | `public.publish_bulletin`: title up to 140 characters, body up to 4,000; every screen hears it. *Draft with AI* on the Bulletins page writes a draft from the market as it stands; nothing is published until an organiser edits and sends it, and prices never come from the model. |
| `CRISIS` | the heartbeat | at each reveal ("Crisis k: every company is hit") |
| `GENERAL` | the heartbeat | when the practice market closes (the prize winners) and when Round 3 starts |
| `FLASH` (classic night only) | organisers | prepared under Content (`public.prepare_flash_bulletin`) and published with `public.publish_flash_bulletin`, which works only in phase `ROUNDS_13_21`. A PRIMUS night never enters that phase, so it has **no flash round** and no `FLASH` answers to judge; `publish_bulletin` refuses the `FLASH` kind. `seed/flash-bulletins/` holds the classic night's files. |

A spare card published as an ordinary bulletin (for a quiet market, `docs/GUARDRAILS.md` O10) changes no company's
crisis card.

## 5. Checks before and during the night

| When | Check | Where |
| --- | --- | --- |
| Before doors | problem cards ≥ 3, crisis cards ≥ 12, seed commitment set | `scripts/sql/night-check.sql` checks 12–14 |
| Before the draw | the problem deck's size fits the mode; checked-in counts per track (tonight) | Content page; Desk page |
| Before Round 3 | statements have room per sector (the Round 3 overview warns in red) | `app.sector_room_short` |
| After the night | publish the seed; anyone re-runs the draw | `pnpm verify-lottery` |

## Sources

`supabase/migrations/20261008000007_lottery_rng.sql`, `20261008000010_squads.sql`, `20261008000011_prices_scores.sql`,
`20261113000032_primus_rounds.sql`, `20261113000034_saturation.sql`, `20261115000038_primus_event_safety.sql`,
`20261116000042_sectors.sql`, `20261122000053_judge_context.sql`, `20261129000063_sealed_crisis.sql`,
`20261206000070_switches.sql`; `packages/engine/src/lottery.ts`, `schedule.ts`; `scripts/new-seed.ts`,
`scripts/verify-lottery.ts`; `seed/sectors/`. Tonight's items: the plan (W2, W4, W11) and migration 070's switch
list.
