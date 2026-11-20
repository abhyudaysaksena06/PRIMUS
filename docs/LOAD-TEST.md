# The bot test: 600 cards, 400 present, 10 projectors, 20 consoles

How to run tonight's load test on a **throwaway rehearsal event** (`load-600`) on the live Supabase project and the
live app, read the results, and remove the event afterwards. Three tools run at the same time:

| Tool | What it plays | Measures |
| --- | --- | --- |
| `pnpm rehearse` | 400 present teams play the whole PRIMUS night through the real game functions; `--autopilot` plays the organisers (draw, auto-advance, fake judge, releases, statements, flags) | game-call errors and latency, clearing time of every round |
| `pnpm app-load-test` | one screen per present team, 10 projectors, 20 organiser consoles (each calls `tick()` every second) loading the real pages | page time p50/p95, page errors, tick errors |
| `pnpm load-test` | 450 realtime connections and every fund trading in a round's last minute | broadcast delivery %, delivery latency, clearing under load, busiest second |

Every tool refuses a live event (`is_rehearsal` must be true), prints one summary table at the end and writes it,
with the checks and details, to `out/load-<timestamp>.md`. It exits 1 when a target is missed.

## Pass / fail

| Check | Target | Where |
| --- | --- | --- |
| Pages under 2 s | ≥ 95% of pages | app-load-test |
| Errors | < 1% (pages; turn reads and game calls; orders) | all three |
| Clearing | every round cleared < 5 s after its close | rehearse (all rounds), load-test (under load) |
| Realtime delivery | ≥ 99% of event broadcasts reach the connected screens | load-test |
| Within Pro | ≤ 500 connections (450 + 30 here); busiest second ≤ 500 deliveries | load-test details |
| Sign-ins / joins | ≥ 99% of bots, screens and connections | all three |

Refusals (`HIRING_CLOSED`, `NOT_YOUR_TURN`, `RATE_LIMITED`, …) are the game's own answers and are not errors; the
rehearse details list them per function.

## Before you start (once)

1. Run from a laptop or machine on a good wired connection, with the repo at the merged `main`, after
   migration 076 (200 per track) is live. Raise the open-file limit in each terminal: `ulimit -n 10240`.
2. `.env` in the repo root (never commit it) with:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the live project.
   - `CARD_SECRET`: any secret of 16+ characters; the load event's passwords derive from it. Keep it the same for
     every step (create, play, purge).
   - `TEAM_EMAIL_DOMAIN`: the team email domain (synthetic, nobody receives mail there).
   - `JUDGE_FAKE=1` (and optionally `JUDGE_FAKE_LATENCY_MS=1500`) so the autopilot judges with the fake judge.
     The fake judge is accepted only on rehearsal events.
3. Supabase → Authentication → Rate Limits: sign-ins and token refreshes at least **1,500 per 5 minutes** for the test
   (the three tools sign in about 1,300 times within a few minutes, all from one address). Tools back off and retry on
   429, and the summary says how many 429s they met. Start the tools a minute or two apart if you cannot raise it.
4. Supabase compute raised for the night (the test is also the check of that size).

## 1. Create the event (≈ 2–4 min)

```bash
pnpm rehearse --create --slug load-600 --per-track 200 --speed 20 --starts-in 10 --admins 20 --projectors 10
```

A PRIMUS rehearsal named "Load test (load-600)" with **600 cards LP01–LP200, LC01–LC200, LF01–LF200** (card letter
`L`: team codes are unique across the database, so the load event can never take the live event's P01… or the demo's
XP01…; `--prefix X` is refused, and a code another event uses stops the create before any login is touched), the
sector decks from `seed/sectors/`, the Round 3 statements from `seed/sectors/statements.csv`, and 30 staff logins
(`load-600-admin-01…20@<domain>` organisers, `load-600-projector-01…10@<domain>` displays) written to
`out/load-600-staff-logins.txt` (passwords: keep it private). At `--speed 20` the night (690 event minutes) takes
about **35 minutes** after its start; `--starts-in 10` leaves 10 minutes to start the tools. `--replace` purges and
re-creates an earlier load event.

## 2. Check in 400 and let the bots play (≈ 45 min)

```bash
pnpm rehearse --slug load-600 --autopilot --present 400
```

Before the draw the desk is switched on for the event and **400 teams are checked in** with the desk's own function
(the lowest cards of each track: 134 Product, 133 Consulting, 133 Finance; or give one count per track, e.g.
`--present 140,130,130` to test an uneven room). Only they play; the other 200 cards stay locked out, as on the night.
The bots then play: problem cards and PRDs, the firms' memos, **practice trades**, IPO bids, orders every trading
round, hiring offers and answers, crisis plans and advice memos, ratings, Round 3 draft picks and solutions. The
autopilot starts the night at its planned time, draws, keeps auto-advance on, judges in-process, releases, uploads
statements if missing, publishes the flash bulletin and clears flags.

Two things the autopilot cannot do for you and will say so in its log:
- **Uneven tracks** (400 is not divisible by 3): if the draw is held until the surplus is confirmed, confirm it on the
  Desk page; the autopilot keeps trying the draw every 2 s.
- **The practice market** at Round 1: prepare it on the Run page (or it is prepared by the first Finance screen, as
  the app load test opens the practice page). The funds' bots trade once it exists.

Progress every 30 s (phase, turns/s, calls, errors, call p95). Ctrl-C once stops after the current turns and still
writes the summary. Options: `--interval 5000` (one turn per team every 5 s), `--concurrency 64` (turns at once),
`--minutes N`, `--teams N`. Use `pnpm rehearse --check-in --present 400` to only do the desk's part.

## 3. The app load test, at the same time (15–30 min)

Start it once the bots are signed in (Round 1 is a good moment: practice terminal, PRDs and the desk's aftermath):

```bash
pnpm app-load-test --base https://primus.mrdev4u.com --slug load-600 --projectors 10 --admins 20 --duration 1800
```

One screen per present team (400), 10 projectors on `/display/load-600` (re-read after each event message and every
60 s), 20 organiser consoles on the admin pages (re-read after each event or staff message, `tick()` every second,
ping every 20 s). Team screens re-read after each event message, spread over 1.2 s as the app does. `--think 6` is a
busy room (a page every ~6 s per phone); `--think 20` is closer to a normal one. The consoles' judge loop is off:
`--judge-loop` works the judge queue through `/api/judge/work`, which judges with the **deployment's** model (real
API calls on production): leave it off unless you mean that.

Peaks, as separate short runs when you want them:

```bash
pnpm app-load-test --base https://primus.mrdev4u.com --slug load-600 --burst 1.2   # a round clears: every screen re-reads
pnpm app-load-test --base https://primus.mrdev4u.com --slug load-600 --rush 60     # check-in: 400 phones sign in in 60 s
```

## 4. The realtime test, during Round 2 (≈ 5–10 min)

```bash
pnpm load-test --slug load-600 --connections 450 --rounds 3
```

450 connections (with the 30 of the app load test: 480 of Pro's 500; if you also watch in browsers, use 440), each on
the event channel, its team channel and its squad chat. It records **every event broadcast** from the moment all have
joined: delivery = the share of connected screens that heard it; latency after the broadcast's `at` and after the
first screen. For each of `--rounds` rounds every present fund places 6 orders in the last minute while the other
teams re-read their pages, then the clearing is timed. Start it when Round 2 (PRESSURE) is under way; it waits for an
open round with 60 s or less to go.

## 5. Read the results

Each run prints and writes `out/load-<timestamp>.md`:

```
| Run | Event | Screens | Connections | p50 ms | p95 ms | Errors | Clearing ms | Realtime delivery | Result |
```

then a **Checks** table (each target, the measured value, pass/FAIL) and **Details**: per game function (calls, ok,
refused, errors) and every round's clearing for the bots; per screen kind and per page (slowest first), tick and ping
results for the app; broadcasts by kind, latency, busiest second, orders and clearings for realtime.

What a failure usually means:
- Pages slow or failing (500, TimeoutError) → database CPU: raise compute one size and run again; the per-page table
  names the page to look at.
- Connections not joined (`CHANNEL_ERROR`), or delivery under 99% with a busiest second above 500 → the Realtime
  quota: fewer connections, or the broadcast coalescing switch, or a plan upgrade.
- Sign-in failures with 429 → Auth rate limits too low (step 3 above).
- Clearing ≥ 5 s → the clearing at 200 companies × 200 funds; look at the round in the rehearse details.

## 6. Purge (≈ 1–2 min)

```bash
pnpm rehearse --purge --slug load-600
```

Deletes the event and everything in it (`purge_event`), the 600 team logins of its cards and the 30 consoles and
projectors made for it (found by their exact addresses). It refuses a live event, the demo, and any event not made by
`--create` (unless `--force`). Then delete `out/load-600-staff-logins.txt` and `out/load-600-rehearsal-seed.txt`.
Check the live event and the demo are untouched: `pnpm preflight`.
