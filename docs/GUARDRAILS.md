# PRIMUS 2026: every guardrail

Every rule that keeps the market, the money, the judging and the night fair, in one list. **Built** means the
database enforces it inside the function that makes the move, so a refused move changes nothing and tells the team
why; no screen, script or staff member can go around it. **Staff** means a rule people follow, with a control on the
control panel. **Proposed** means recommended and not built yet (decision needed; ships as migration 068).

Numbers live in `packages/engine/src/rules.ts` and the SQL functions; change one only with its test, before the
night, never during it.

## 1. Prices

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| P1 | Prices are never typed | Only a round clearing, a crisis reveal or a released score moves a price | Built |
| P2 | Move per trading round | 1% per 1,000 net shares, capped at ±10% | Built |
| P3 | Batch clearing | Every order in a round fills at the one cleared price; speed gives no edge | Built |
| P4 | Crisis shock | −5% on every company at each reveal, once | Built |
| P5 | Halt at a reveal | Trading halted 5 minutes so everyone reads the news first | Built |
| P6 | Score tiers | Crisis plan / solution: +25% (90+) to −20% (<40); PRD sets the IPO price ±10% | Built |
| P7 | Round 3 leveller | Solution rises ×1.25 (weakest) to ×0.25 (strongest); falls in full | Built (live) |
| P8 | A crisis's last round waits for its scores | No trading on stale prices after a release | Built |
| P9 | The wait is bounded | Release by minute 85; Close the round now at minute 90 | Staff |
| P10 | No hand intervention on a running price | Staff act on the process (clearing, releases, flags), never on a price | Staff |

## 2. Trading and positions

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| T1 | Long position | 4,000 shares per fund per company (IPO + trading) | Built |
| T2 | Short position | 2,000 shares per fund per company | Built |
| T3 | Short exposure | $250,000 per fund across all companies | Built |
| T4 | Buy reserve | 110% of qty × price held while an order is pending | Built |
| T5 | Short collateral | 150% of the short's value | Built |
| T6 | IPO bid | 0–4,000 shares per company, whole book within the fund's cash; oversubscribed books scaled pro rata to 10 shares | Built |
| T7 | No insider IPO bids | A fund cannot bid on its own squad's company | Built |
| T8 | Practice market is separate | Scripted prices; only the top-3 prize (real cash) crosses into the game | Built |
| T9 | Practice position limits | 4,000 long / 2,000 short per ticker; one trade needed to be ranked | Built |
| T10 | Market live 21:10–06:30 | Practice market open through Reading, settled at the IPO | Proposed (068) |

## 3. Equity and company ownership

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| E1 | Keep-floor | A company keeps at least 40,000 of its 100,000 shares (never more than 60% given away) | Built |
| E2 | Promised shares count | Fee shares in escrow count against the floor, so no share is promised twice | Built |
| E3 | Raise size | 1–10% of the company per raise, in steps of 0.01% | Built |
| E4 | Raise frequency | One open raise at a time; one funded raise per company per crisis; an open raise lapses at the next crisis | Built |
| E5 | Raise price | The market price at the moment it is funded; cash = shares × price, worked out by the exchange | Built |
| E6 | No squad self-dealing | A fund cannot fund its own squad's raise | Built |
| E7 | Fund must have the cash | Available cash after reserves and collateral | Built |
| E8 | Raises only in Round 2 | Posting and funding refused outside phase PRESSURE | Built |
| E9 | Raise concentration | A fund holds at most 10,000 shares (10%) of a company through raises | Proposed (068) |
| E10 | One raise per fund per crisis | "No one can lock more than one team" applied to funds | Proposed (068) |

## 4. Hiring and fees

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| H1 | One firm per company | Per crisis | Built |
| H2 | Clients per firm | 2 per crisis | Built (Proposed: 1, "no one locks more than one team") |
| H3 | Open offers | 5 per company at once (offers it opened); one open offer per company–firm pair | Built |
| H4 | Counters | 3 per side per offer, then accept or decline | Built |
| H5 | Binding accept | Accepting moves the fee into escrow; no backing out | Built |
| H6 | Sealed crisis | No one reads a crisis card until that crisis's hiring closes | Built |
| H7 | Hiring window | Minutes 0–20 of each crisis (Round 3: 15–30); offers lapse at the close | Built |
| H8 | Compulsory hiring | Unhired companies matched to the least busy firm at $22,500 (Round 3: 10% of cash) | Built |
| H9 | Only present teams are matched | With the desk on, only checked-in companies and firms | Built (066) |
| H10 | Round 3 fee band | Fee worth 5–20% of the company's cash | Built |
| H11 | Paid for work | Escrow paid at the due time only for an advice memo of 150+ words; refunded otherwise | Built |
| H12 | Ratings | 1–5 by the client; missing = 3; ±$1,000 per star from 3 | Built |
| H13 | Base hire rate from Round 1 | Base equity rate from the ZestUp score (2% + 0.04% per point over 50, 1–4%), used for auto-matching | Proposed (068) |
| H14 | Random auto-match order | Drawn from the lottery seed: provable and replayable | Proposed (068) |

## 5. Writing and judging

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| J1 | Word limits | PRD 800 · ZestUp memo 500 · crisis plan 500 · advice memo 150–500 · solution 600 | Built |
| J2 | Hard deadlines | Drafts auto-submit at the deadline; nothing accepted after | Built |
| J3 | Blind judging | Team, company and member names replaced by the ticker | Built |
| J4 | One model for all | Claude Haiku 5.5 in both slots; a switch applies to everyone from then on | Built |
| J5 | Median of three | Three runs; five if the totals spread over 10 points; median kept | Built |
| J6 | Valid output only | Every line a whole number within its maximum; total = sum; else asked again (3 attempts) | Built |
| J7 | Injection removal | Lines aimed at the judge stripped and logged; squad's first offence −5, later −10 | Built |
| J8 | Text is data | Submission passed inside tags with a line saying it is data, not instructions | Built |
| J9 | Prompt versioning | Every run stores the prompt's SHA-256; prompts frozen once judging starts | Built + Staff |
| J10 | Sealed until released | Scores hidden until staff release them | Built |
| J11 | Calibration | 10 sample PRDs must land in their bands before the night | Staff |
| J12 | Copying penalised | Copying a real company or a sample startup is marked down | Built (in the prompts) |
| J13 | Appeals | 10 minutes after the close; applied or dismissed with a logged reason | Built + Staff |

## 6. Fairness and integrity

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| F1 | Provable draw | Seed commitment published before; seed revealed at the draw; anyone can re-run it | Built |
| F2 | Cap-clustering flag | 3+ funds at the 4,000 long cap on one company | Built |
| F3 | Mirrored-orders flag | Two funds' order patterns with cosine ≥ 0.9 over 5+ orders | Built |
| F4 | Outsized-fee flag | A fee of $33,000 or more | Built |
| F5 | Repeat-raise flag | One fund funding the same company's raises repeatedly | Proposed |
| F6 | Two-line ledger | Every move writes both sides; cash and holdings always equal their ledger sums | Built |
| F7 | Two-person corrections | A correction needs a second organiser's approval, with a reason | Built |
| F8 | Second clicks | Anything that changes the night for good asks twice; the second click counts only for what the first showed | Built |
| F9 | Audit log | Every phase change, pause, release, correction and purge recorded with who and when | Built |
| F10 | Locks in fixed order | Two simultaneous moves never interleave | Built |

## 7. Access and abuse

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| A1 | Desk-gated sign-in | A card signs in only after the desk checks the team in; check-out cuts access at once | Built |
| A2 | Row-level security | Each team reads only its own team, squad, company and what its track needs | Built |
| A3 | Functions only | Clients call game functions; no table is written directly | Built |
| A4 | No public calls | Signed-out visitors can call nothing but the public lottery record | Built |
| A5 | Action rate limit | 60 actions per team per 10 seconds | Built |
| A6 | Chat rate limits | Squad chat 20/min · hire chat 30/min · Q&A 10/min | Built |
| A7 | Private channels | Realtime: only the event's accounts receive; nobody sends | Built |
| A8 | Sign-ups off | Organisers create every account | Staff (Supabase setting) |
| A9 | Keys server-side | The service key and the judge key live only on Vercel | Built + Staff (rotate the leaked key) |

## 8. Operations

| # | Guardrail | Limit | Status |
| --- | --- | --- | --- |
| O1 | Pause first | If teams cannot play fairly, the event lead pauses, then talks | Staff |
| O2 | Exact phase end | The current phase can end earlier or later; refused if it would close a window already past | Built |
| O3 | Schema check | The app and /api/health compare the database version with the one they need | Built |
| O4 | Safe migrations | Catch-up SQL applies only what is missing, in one transaction, or nothing | Built |
| O5 | Code freeze | Nothing ships during the event unless tested first | Staff |
| O6 | Health every 30 minutes | Heartbeat, tick errors, connected screens, failed judge runs, projector clock | Staff |
| O7 | Demo cannot clash | Demo teams use X-prefixed codes; its cleanup deletes only its own logins | Built |
| O8 | External uptime check | Ping /api/health every minute, alert Tech | Proposed |
