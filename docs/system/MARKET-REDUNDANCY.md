# The market's redundancy

What keeps prices, rounds and money right when a part of the system fails: two implementations of every rule, two
heartbeats with one lock, state that lives only in tables, a guard on every price, a two-line ledger, backups and a
monitor. Written for the organisers and the software specialist. The trading rules themselves are in
[TRADING-ALGORITHM.md](TRADING-ALGORITHM.md); the money flows and the invariant SQL are in
[INTEGRATION.md](INTEGRATION.md).

Status words: **built** = in the repository at migration 070; **tonight** = being built today behind a switch
(`app.feature_catalog()`, migration 070), described from the plan with its migration number.

## 1. Two implementations of every market rule

| | The SQL (runs on the night) | The TypeScript engine (the twin) |
| --- | --- | --- |
| Where | `app.*` and `public.*` functions in `supabase/migrations/` | `packages/engine/src/` (`trading.ts`, `prices.ts`, `ipo.ts`, `money.ts`, `judge.ts`, `lottery.ts`, `scoring.ts`) |
| Role | Every move is made inside the database function that checks it, in one transaction | Screens use it for previews (what an order would cost, the most a fund can buy); tests use it as the reference |
| Rounding | `app.div_round_half_up`, integer cents | `divRoundHalfUp` with BigInt, integer cents |

**Parity tests** (`supabase/tests/parity.test.ts`) run each SQL port and its engine twin on thousands of generated
inputs and require equal answers: money helpers; `tier_bp` and `ipo_price` for every score and type;
`apply_tier`, `clearing_price` and `crisis_shock`; reserves and collateral; IPO allocation on 300 random books;
`check_order` on 5,000 generated order contexts; the IPO book; word counts; the classic fee and deal checks; judging
(`judge_call`, `median_score`, `needs_extra_runs`, `judge_run_valid`, `injection_penalty`, `final_score`,
`plan_bonus`, `return_bp`); and the lottery (the SHA-256 word stream, `rng_int`, `rng_shuffle`, `lottery_draw`,
`lottery_crises`).

**The full night** (`supabase/tests/full-night.test.ts`): 150 teams played through every phase by bots, every
clearing compared with the engine's own clearing, the ledger invariants checked after each phase, final values and
rankings recomputed with the engine, and every clearing timed against a 5-second budget. **Races**
(`supabase/tests/review-races.test.ts`): a tick against cancels, a forced close against new orders, a phase change
against edits, an IPO bid against the allocation.

**Not covered by a twin today.** The close of migration 068 (the SQL averages the last round's opening and clearing
prices; the engine's `marketClose` in `prices.ts` still holds the classic rounds 20–21 rule), the Round 3 leveller
(`app.release_tier_bp`, SQL only) and the PRIMUS injection chain (`app.company_injection_penalty`; the parity test
covers the classic three-argument function). Tonight's W5 adds property-based fuzzing of the engine and a SQL
fuzz-parity run of random rounds; its findings are in TRADING-ALGORITHM.md.

## 2. The heartbeat: two clocks, one lock

| Clock | How often | Code |
| --- | --- | --- |
| `pg_cron` job `msim-tick` inside the database | every **2 seconds** | `select app.tick_all()` (migration 014) |
| Every open organiser console | every **5 seconds** while the page is open | `Heartbeat` with `tick` on, `apps/web/lib/live/heartbeat.tsx` (`TICK_MS`), mounted by `app/admin/[slug]/layout.tsx` for organisers |

`app.tick_all()` ticks every event whose phase is between `CHECKIN` and `APPEALS`, each inside its own exception
block: an error in one event is written to `error_log` (source `tick`) and the others still tick. It waits at most
3 seconds for a lock (`lock_timeout`), so a busy event never holds the rest up.

**The lock.** `public.tick(event)` (migrations 012 onward) first takes a transaction advisory lock on
`'tick:' || event` with `pg_try_advisory_xact_lock`. If another tick holds it, the second returns at once with
`{skipped: true}`: pg_cron and any number of consoles can tick together and only one does the work. It then locks
the event row `FOR NO KEY UPDATE`, which serialises it with organiser actions (advance, pause, extend) while team
actions keep their weaker locks. A paused event is not ticked.

**Idempotent steps.** Every step checks its own state before acting, so a repeated tick does nothing twice: a round
is cleared only while OPEN (`app.clear_round` answers `{already: true}` for a cleared one); a crisis is revealed,
hiring closed, escrow settled and ratings closed only while `subrounds.revealed_at`, `hiring_closed_at`,
`due_closed_at` and `rated_at` are empty; the IPO, the close, settlement, the practice prize and the injection check
`ipo_allocated_at`, `market_closed_at`, `settled_at`, `practice_markets.settled_at` and the `INJECTION` ledger lines.

**What one tick does** (`public.tick`, `app.primus_tick`): clears every round of the phase whose time is up; opens
the next round when all earlier rounds are cleared and the scores it waits for are released; applies the old
defaults (problem pick, classic fees); submits saved drafts whose deadline has passed; on a PRIMUS night runs the
held steps and then reveals crises, gives missed draft picks their statements, closes hiring (assigning firms),
settles escrow and closes ratings; and, with auto-advance on, starts the next phase when the current one's time is up
and no round is still open or waiting.

## 3. When something fails

| Failure | What happens | What staff do |
| --- | --- | --- |
| A tick raises an error | Its whole transaction rolls back: nothing is half done. The error is logged; the next tick (2 s, or 1 s from a console) tries again | Health page: tick errors in the last hour, with the message. A step that keeps failing names itself there |
| pg_cron stops | Every open organiser console keeps ticking every 5 seconds | Keep one organiser console open all night; `scripts/sql/night-check.sql` checks 2–3: the job exists and ran in the last minute |
| The database restarts or blips | All state is in tables (rounds, orders, deadlines, sub-rounds, scores, holdings, the ledger); the app holds none in memory. The next tick resumes: a round whose closing time passed is cleared at once with the orders that were in; a team action either committed or did not (one transaction each) | Check Health; screens reconnect and re-read by themselves |
| A round opens late (after an outage, a pause or a wait for scores) | If it opens more than 5 seconds late, every later time moves by the delay (`app.shift_schedule`), so the round keeps its full length and no window is cut short | Nothing |
| The website is down | The database heartbeat keeps clearing rounds and running crisis steps; teams cannot act until the site is back | Pause if teams cannot play fairly, then fix |
| An order arrives as the round closes | `app.clear_round` locks every fund in id order before reading the book: an order in flight commits first and is cleared; a later one finds the round closed | Nothing |
| Two ticks at once | The advisory lock: the second skips | Nothing |
| A clearing is slow | Each clearing reports its time (`ms`); the full-night test holds it under 5 s | Watch the round's close on the Rounds page; tonight W1 measures 200 companies × 200 funds |

**Pause and resume.** `public.pause_event` stops the clock (the tick returns at once); `public.resume_event` moves
every later time by the length of the pause (`app.shift_schedule`), so no deadline passes while paused. "+ time"
(`public.extend_event`) moves everything after now.

## 4. The price writer guard

A trigger on `companies` (`price_guard`, `app.companies_price_guard`, migration 004) refuses any change to a
company's IPO, market, AI, post-crisis, closing market or closing price unless the transaction has declared who is
writing, through the setting `app.price_writer`. Only these functions set it:

| Writer | Set by | Moves |
| --- | --- | --- |
| `IPO` | `public.release_scores` for the PRD | the IPO price, the first market and AI price |
| `CLEARING` | `app.clear_round` | the market price |
| `CRISIS` | `app.reveal_subround` (PRIMUS), `app.apply_crisis` (classic) | market and AI price, −5% (classic −15%) |
| `TIER` | `public.release_scores`, `app.release_primus` | market and AI price, by the tier |
| `CLOSE` | `app.close_market` | the closing prices |
| `APPEAL` | `public.apply_appeal` | the AI and closing price |

So no screen, script or staff member can type a price. Every move also writes a row in `round_prices` (kind `IPO`,
`CLEARING`, `SUB_SHOCK`, `SUB_TIER`, `CLOSE`, `APPEAL`, …), and `round_prices` is append-only, so the price history
can always be audited and replayed.

## 5. The two-line ledger and the checks

Every movement of cash or shares writes both sides in `ledger_entries` with one `txn_id`; a line without a team is
the exchange. `ledger_entries`, `public_ledger`, `round_prices`, `injection_logs` and `audit_log` refuse updates and
deletes (`app.forbid_change`, migration 004), and a submission can only be marked superseded, never changed
(`app.submissions_guard`). The seven invariants (all cash + the exchange = 0; cash and holdings equal their ledger
lines; every transaction balances; 100,000 shares per company; escrow matches) and a read-only SQL that checks them
all are in [INTEGRATION.md](INTEGRATION.md), sections 4 and 5. Run it after each crisis's release and before
settlement.

## 6. Snapshots and resets (tonight)

- **Snapshots (migration 075, switch `snapshots`, SCALE, on by default).** A backup is every row of every
  event-scoped table as JSON, with a fingerprint (row counts, team cash and collateral, the exchange's cash, shares
  per lot, the exchange's inventory, the sum of prices). Requested when the event leaves `SETUP` ("Base"), a phase
  starts, a round clears, scores are released, or an organiser presses **Back up now**; the game's transaction only
  queues the request and a separate pg_cron job (`msim-snapshot`, every 10 seconds) takes it in one statement, at most
  one per event every 5 seconds; the last 200 are kept (Base always). Downloadable from Exports.
- **Restore (W16, migration 075).** An organiser asks with a reason and a different organiser or the fairness
  officer approves, only while the event is paused. In one transaction the job backs up the present state, writes the
  backup's rows back, checks the fingerprint (or undoes everything) and logs it; logins, attendance, the logs and the
  switches are kept as they are. The event stays paused; Resume moves every later time by the gap. "Reset to base" restores the first snapshot; "reset a
  round" restores that round's. The test plays a night, restores every snapshot and compares fingerprints. It must be
  rehearsed once before it is used on the night.
- Before tonight's catch-up migrations, the live database is snapshotted first (the plan's ground rule 2).

## 7. The saturation monitor

`scripts/sql/saturation-monitor.sql` is read-only: run it in the SQL editor at each crisis reveal and at 04:45
(`docs/GUARDRAILS.md`, O9).

| Signal | Act when |
| --- | --- |
| Share of fund money in the top 5 companies | above 55% |
| Companies at the ±10% limit in the last 4 rounds | 3 times or more |
| Most overpriced against the AI price | above 1.5× |
| Median price against the IPO price, by sector | one sector 0.5× or more away from the others |

The market also limits saturation by itself: at most ±10% a round (1% per 1,000 net shares, `RULES.NET_CAP`), a
one-round cooling-off after a full ±10% move (`app.cooling_off`, migration 069), raise caps (10,000 shares per fund
per company, one raise per fund per crisis), and a close that averages the market price with the AI price (migration
068), so a bubble counts at most half in final values. Staff act on the process (a bulletin, a spare card, releasing
on time), never on a price.

## 8. What staff watch every 30 minutes

The Health page (`public.admin_health`): the heartbeat's last runs and last error from `cron.job_run_details`, tick
errors in the last hour, connected screens and their realtime status, failed judge runs; then the invariant SQL after
each release. `scripts/sql/night-check.sql` before doors.

## Sources

`supabase/migrations/20261007000004_integrity.sql`, `20261008000009_trading.sql`, `20261008000012_phases.sql`,
`20261008000014_access_and_cron.sql`, `20261009000015_control_panel.sql`, `20261113000032_primus_rounds.sql`,
`20261120000051_full_control.sql`, `20261204000068_close_counts_the_end.sql`, `20261205000069_anti_saturation.sql`,
`20261206000070_switches.sql`; `apps/web/lib/live/heartbeat.tsx`; `packages/engine/src/`;
`supabase/tests/parity.test.ts`, `full-night.test.ts`, `review-races.test.ts`, `night.ts`;
`scripts/sql/night-check.sql`, `scripts/sql/saturation-monitor.sql`. Tonight's items: the plan (W1, W5, W8, W16).
