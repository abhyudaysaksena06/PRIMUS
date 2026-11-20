# PRIMUS trading algorithm: specification, verification, findings

Everything the market does on a PRIMUS night, written down from the code (`supabase/migrations`, the functions as
they stand after migration 079, and `packages/engine`), with the evidence that it does exactly this and nothing else.
Money is in whole cents, prices are whole cents per share, and every rounding is **half-up to the cent after each
multiplication** (`app.div_round_half_up`, the engine's `divRoundHalfUp`; exact integer arithmetic, no floating point).

Status for tonight: every rule below is covered by a property test and by SQL-vs-engine parity, with zero
violations. Seven findings; six are fixed in migration 079 (section 4); one (F7) is outside the trading functions
and needs a one-line patch by the owner of `release_primus` / `release_scores`.

---

## 1. The rules, formula by formula

### 1.1 Prices from scores

| Rule | Formula | Example |
| --- | --- | --- |
| IPO price (PRD = `PITCH`) | $10.00 × (1 + tier); tier: ≥80 +10%, ≥60 +5%, ≥50 0, ≥40 −5%, else −10% | PRD 60 → $10.50 |
| Crisis reveal (each of crises 1–4) | market and AI price × 0.95 (`app.reveal_subround`, tier −500 bp) | $10.50 → $9.98 (997.5 rounds up) |
| Crisis plan `CRISIS_k` | market and AI price × (1 + tier); ≥90 +25%, ≥80 +20%, ≥70 +10%, ≥60 +5%, ≥50 0, ≥40 −10%, else −20% | $9.98, plan 85 → $11.98 (1,197.6) |
| Round 3 solution (leveller, 064) | positive tier × (1.25 − (place − 1)/(n − 1)), whole basis points (truncated); place 1 = weakest score so far; ties share the lower place; negative tiers in full | n = 200, +25%: place 1 → +31.25%, place 100 → +18.81%, place 200 → +6.25% |

"Score so far" = average of PRD and the four crisis plan scores (missing = 0), to 2 decimals. Releases are applied
only when no round is open (`release_primus` refuses with `TRADING_OPEN`; see F7 for the gap), and collateral is
recalculated right after every price change.

### 1.2 Orders (`public.place_order`, `edit_order`, `cancel_order`; checks in `app.check_order`)

Checked in this order (the first failure is the reason the team sees):

1. Rate limit (20 order actions per team per 10 s), the team row is locked.
2. **Cooling-off** (PRIMUS, 069): the company's last cleared round had |capped net| = 10,000 (it moved the full
   ±10%) → `COOLING_OFF` for every order type, for one round.
3. Finance team only; not paused; a round open; whole quantity 1–100,000; not the fund's own squad company
   (`INSIDER`); company listed.
4. BUY and SHORT need cash ≥ collateral (`COLLATERAL_DEFICIT`).
5. BUY: exchange lot + pending buys + qty ≤ **4,000**; reserve ≤ available cash.
   SELL: qty ≤ exchange lot − pending sells. COVER: qty ≤ short lot − pending covers. (Neither reserves anything.)
   SHORT: short lot + pending shorts + qty ≤ **2,000**; total short exposure (every short and pending short at the
   current price, this order included) ≤ **$250,000**; reserve ≤ available cash.

* Available cash = cash − collateral − reserves of the fund's pending orders.
* **Buy reserve** = max(qty × price × 1.10, qty × (price after a full +10% round, rounded)) — the most the buy can cost.
  1,000 @ $10.50 → $11,550; 4,000 @ $10.05 → $44,240 (not $44,220: the fill can be $11.06, see F1).
* **Short reserve** = qty × price × 150%, × 110% (rounded after each step). 1,000 @ $10.50 → $17,325.
* **Collateral** = Σ over open shorts of 150% × qty × current price.
* An edit re-runs the check with the edited order left out of the pending totals; it changes quantity only.
  A cancel needs the round open and not paused.

### 1.3 The batch clearing (`app.clear_round`, run by the 2-second tick when a round's time is up)

One price per company per round:

* net = (BUY + COVER) − (SELL + SHORT), over the round's pending orders;
  capped net = clamp(net, −10,000, +10,000);
  **new price = old × (100,000 + capped net) ÷ 100,000**, rounded half-up (1% per 1,000 net shares, at most ±10%).
  $10.50, buys 6,000, sells 1,000, shorts 2,500 → net +2,500 → $10.76 (1,076.25).
* Every pending order fills at its company's new price; a price row is written for every listed company, traded or not.
* Per fund and company: SELL then BUY on the exchange lot, COVER then SHORT on the short lot. A sell takes out
  cost × sold ÷ held (rounded); a cover takes out proceeds the same way; buys add qty × price to cost, shorts add
  qty × price to proceeds. Cash += (sells − buys + shorts − covers) × price.
* Ledger: one `TRADE` row per filled order (fund) and one per company (the exchange: cash net × price, shares −net);
  every transaction sums to zero in cash and in shares. The exchange is the counterparty for the net
  (its inventory may go below zero: it is a market maker).
* Collateral of every fund recalculated at the new prices; reserves end with the round (they were never cash moves).
* Rounds clear strictly in order; the next round opens only after the previous one cleared.

### 1.4 IPO (`public.place_ipo_bid`, `app.allocate_ipo` on leaving the IPO phase)

* A fund requests 0–4,000 shares per company at the IPO price; total requests ≤ its cash; none for its own company.
* 35,000 shares per company. If requests ≤ 35,000 everyone gets their request; otherwise
  **allocation = ⌊request × 35,000 ÷ (total × 10)⌋ × 10** (pro rata, down to 10 shares). The unallocated remainder
  (< 10 shares per bidder) stays with the exchange.
  Example (tested): 11 bids totalling 39,833 → 4,000 gets 3,510, 3,333 gets 2,920, 2,501 gets 2,190;
  34,940 allocated, 60 left with the exchange.

### 1.5 The close (`app.close_market`, 068)

* Closing market price = (last round's opening price + its clearing price) ÷ 2. Round 31 opens only after the
  solution scores are released, so Round 3's judging counts in full and a pump in the last round counts half.
* **Closing price = (closing market price + AI price) ÷ 2.** Open $12.00, clear $12.60, AI $11.00 → market $12.30,
  closing $11.65.
* Every short is covered at the closing price; collateral goes to 0.

### 1.6 Equity raises (067, 069; Round 2 only)

* A company offers 1,000–10,000 shares (1–10%) in steps of 10; one open raise at a time; one funded raise per crisis.
* It keeps ≥ 40,000 shares after the raise **and** after every fee share promised to a firm (escrow `HELD`); funding
  re-checks this and lets the raise lapse if the floor would break.
* The fund pays shares × the market price at that moment (5,000 @ $12.34 → $61,700) from available cash; not its
  own squad's company; one funded raise per fund per crisis; at most 10,000 shares of a company through raises.
* A raise lapses when the next crisis is revealed. Before crisis 1 is revealed a raise belongs to crisis 1 (079).

### 1.7 Finance results (`app.primus_results`)

Final value = cash + long shares (exchange and raise lots) × closing price (shorts were covered at the close).
Return = (final − capital) ÷ capital in basis points, capital = starting cash + the Round 3 injection
($500,000 + $250,000). $900,000 → +20.00%. Rankings are by final value. A fund with zero capital gets no return (079).

### 1.8 The practice market (058, Round 1)

$100,000 practice money; scripted prices every 5 s (`packages/engine/src/candles.ts`); trades fill at once at the
latest price; 1–4,000 shares; ≤ 4,000 long or 2,000 short per company; sell a long before shorting, cover before
buying; cash never below 0; a BUY or SHORT must leave cash ≥ 150% of all shorts (SELL and COVER only reduce risk and
are not held to it, 079). On entering READING the 3 funds with the highest equity that traded at least once
(ties: the lower team code) each win $50,000 of real cash (`PRACTICE_EDGE`, paid by the exchange).

---

## 2. Invariants and their evidence

Engine property tests: `packages/engine/src/trading.fuzz.test.ts` (seeds `0x5eed0001`–`0x5eed0009`, named in the
file; `TRADING_FUZZ_SCALE` multiplies the counts). The oracles are written from the rules in BigInt, independently of
the engine's arithmetic. About 600,000 scenarios, ~8 s. Zero violations.

| Invariant | Scenarios (seed) |
| --- | --- |
| Clearing price = formula, half-up once; \|move\| ≤ 10% + ½¢; ≥ 1¢; never against the net; monotone in net | 200,000 (price, net) pairs (`…01`) |
| One price per company per round; every order fills at it | 40,000 random books + 31,000 night rounds |
| Cash conserved (funds + exchange); shares conserved per company | same |
| Positions never above 4,000 long / 2,000 short, never negative; empty lots carry no cost | same |
| Entry rules: no insider orders, limits incl. pending, exposure ≤ $250,000, reserves ≤ available cash | 40,000 books (`…02`) |
| Collateral = 150% × shorts at new prices, exactly | same |
| No buy costs more than it reserved; a short's reserve covers its net collateral | same |
| A fund that could afford its orders (no deficit, available ≥ 0) never ends a round below zero | same |
| Buy reserve = max(110% rule, worst fill), at most ½¢/share above the 110% rule | 100,000 |
| Whole nights: IPO, 4 reveals, 5 tiers incl. the leveller, injection, 31 rounds, cooling-off, the close; money and the 35,000 IPO shares conserved at every step; prices 2¢…$31 reached | 1,000 nights × 31 rounds (`…03`); 636 deficits and 138 cooling-offs reached |
| IPO: ≤ 35,000; exact pro rata to 10; ≤ request; remainder < 10 per bidder; a larger request never gets less | 50,000 books (`…04`) |
| Price never reaches 0 under any mix of −10% rounds, −20% tiers, −5% and −15% shocks | 20,000 paths × 40 steps (`…05`) |
| Cooling-off ⇔ \|net\| ≥ 10,000 | exhaustive, net −20,000…20,000 |
| Raises keep the 40% floor (escrow included) and the 10% cap; cash ≤ available | 50,000 (`…06`) |
| Leveller formula, ×0.25…×1.25, monotone, ties share | 20,000 drafts up to 200 (`…07`) |
| Practice: limits, cash ≥ 0, 150% on BUY/SHORT, equity unchanged by a trade, prize ranking | 4,000 sessions × 60 attempts (`…08`), 46,766 trades |
| `maxQuantity` passes and +1 fails | 10,000 (`…09`) |

SQL parity: `supabase/tests/trading-fuzz.test.ts` (seed 20261120; knobs `TRADING_FUZZ_EVENTS`, `_ATTEMPTS`,
`_BULK_ROUNDS`, `_SEED`), ~1 minute:

* **A.** 2 PRIMUS events × 24 rounds × 30 actions = 1,440 real `place_order` / `edit_order` / `cancel_order` calls
  by the teams: every verdict (code, reserve, entry price) equal to the engine's; reached OK, COOLING_OFF, INSIDER,
  BAD_QUANTITY, LONG_LIMIT, SHORT_LIMIT, NOT_ENOUGH_SHARES, NOT_ENOUGH_SHORT. Every round cleared by the tick and
  compared with `clearRound` (every price, cash, collateral, position); 6 crisis reveals compared with `subShock`.
* **B.** 3,000 bulk rounds, 40,600 orders, cleared by `app.clear_round`, the engine carrying its own state from round
  to round: prices, capped nets, every fill, cash, cost bases, proceeds, collateral, exchange cash and inventory equal
  after every round; ledger invariants checked per event. No difference.
* The existing `parity.test.ts` (5,000 order contexts reaching every refusal code, reserves, tiers, IPO book) passes
  with the new reserve.

Edges, through the real functions (`supabase/tests/trading-edges.test.ts`):

| Question | Answer (test) |
| --- | --- |
| Can a price reach 0 or fail `market_after > 0`? | No. Every multiplier is ≥ ×0.8 and half-up keeps 1¢ at 1¢. A 5¢ stock stays 5¢ under a full −10% round, 1¢ stays 1¢, the −5% reveal at 1¢ stays 1¢. |
| Integer overflow? | No. Prices are int4 (max $21.4M); the highest a night can reach is < $1,000. Amounts are bigint. A 200 × 200 full book: largest company buy total 128,016 shares (int4 limit 2.1 billion). |
| Rounding drift over 31 rounds? | The rule is "round after every step"; SQL and engine follow the same integer path exactly (3,000-round cumulative parity). |
| A short after +10% rounds and +25% tiers? | Collateral above cash: BUY and SHORT refused (`COLLATERAL_DEFICIT`), SELL and COVER accepted, clearing unaffected. Covering can take cash below 0 (the loss on the short); it then buys nothing until it sells. Money balances. |
| Edits/cancels racing the clearing? | Committed before the clearing reads the book → honoured (edited quantity fills, cancelled order does not). After → refused `NOT_EDITABLE` (review-races CONC-2). No deadlocks. |
| IPO oversubscription remainders? | Pro rata to 10, remainder with the exchange, no insider bid, ledger balanced. |
| Cooling-off boundaries? | +10,000 and −10,000 cool off, 9,999 does not; none in the first round; one quiet round ends it; `cooling_off_companies` = what the check refuses. |
| Raise floor with escrow? | Counts promised fee shares; funding re-checks and lapses. |
| Practice? | Limits, 150% on BUY/SHORT, de-risking allowed, a cover still needs the cash. |
| Finance return on zero capital? | No longer a division by zero (F3). |

---

## 3. Timings (200 companies × 200 funds)

Measured on the test runner (local Postgres, 4 shared cores, the whole tick through the pool), a **full book**:
every fund has an order in every company it may trade, 39,997 orders.

| | Before 079 | After 079 |
| --- | --- | --- |
| Clearing tick, full book | 4.67 s | **2.40 s** |
| Leveller for a release (200 companies) | 256 ms | 44–77 ms (1–2 ms ranked once, `app.release_tier_bps`) |

Where the time goes: about half was the per-row audit trigger on the 40,000 orders and the positions and funds the
clearing rewrites (now skipped while the clearing runs; the ledger records every change). The rest is updating the
40,000 orders, writing 40,000 ledger rows, the position updates and the collateral recalculation, all set-based.
A realistic round (a few thousand orders) is a few hundred milliseconds. The 2-second target holds for any
realistic round; a full book is about the target on the event's larger database server.

---

## 4. Findings

| # | Severity | Finding | Reproduce | Fix (migration 079 unless stated) |
| --- | --- | --- | --- | --- |
| F1 | Low | A buy could cost more than its reserve: the reserve rounded qty × price × 1.10 once, the clearing rounds the price per share. At $10.05 a +10% round fills at $11.06: 4,000 shares cost $20 more than reserved; an all-in fund ended below $0 and was told its collateral was short. | `trading.fuzz` "the old reserve…"; `trading-edges` "the reserve covers the worst fill" | Reserve = max(110% rule, qty × worst fill price), SQL and engine. **Visible:** reserves at prices ending in 5–9¢ grow by ≤ ½¢ a share. |
| F2 | Low (scale) | The leveller ranked the draft once per company: n² `score_so_far` calls. | `trading-edges` 200 × 200 | `app.release_tier_bps` ranks once in one query; `app.release_tier_bp` reads its row. Results identical (compared with the old function on 200 companies, 3 types). |
| F3 | High impact, rare | `app.primus_results` divided by the fund's capital; capital 0 (e.g. reversed starting cash) made the settlement fail. | `trading-edges` "zero capital" | Return left empty when capital ≤ 0. |
| F4 | Low | Practice: every trade needed cash ≥ 150% of shorts, so a fund whose shorts rose could neither sell a long nor cover part of a short. | `trading-edges` practice; fuzz counted 110 such trades | SELL and COVER exempt from the 150% rule (a cover still needs its cash). **Visible** (practice only). |
| F5 | Low | `raise_k` was 0 before crisis 1 was revealed (seconds; minutes if the reveal is held), so a company could raise at 0 and again in crisis 1, and a fund fund two raises in crisis 1. | `trading-edges` raises | `raise_k` ≥ 1. **Visible:** a raise posted before the reveal belongs to crisis 1 and does not lapse at that reveal. |
| F6 | Medium (scale) | A full-book clearing took 4.7 s, over the 2 s heartbeat. | `trading-edges` 200 × 200 | Index on pending orders by (round, company) for the live range; the per-row audit skips the clearing's own writes of orders, holdings, teams and companies (`app.price_writer = 'CLEARING'`, reset when the clearing ends; restores with `app.allow_purge` still skip everything). **Visible:** no per-row audit rows for the clearing's writes; the round row, the ledger and the fill prices record them. |
| F7 | **Medium, open** (not in the trading functions) | `release_primus` (and the classic `release_scores`) refuse a release only while `app.open_round` returns a round, which ignores a round past its close that the tick has not cleared yet. A release clicked in that window (≤ 2 s; the plan release is due exactly when round 5 of a sub-round closes) moves the price the pending book then clears at: buys fill up to 37.5% above what they reserved for, pre-release orders fill at post-release prices. | `trading-edges` "a release is refused while a closed round waits for its clearing" (`test.fails` until fixed) | Owner of those functions, one patch for both: see below; then make the test a plain `test`. |

F7 patch (both functions contain the same lines):

```sql
select app.patch_functions(
$o$  if (app.open_round(p_event)).id is not null then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');$o$,
$n$  if (app.open_round(p_event)).id is not null
     or exists (select 1 from public.rounds r where r.event_id = p_event and r.status = 'OPEN') then
    return app.fail('TRADING_OPEN', 'Release scores between rounds, while trading is closed.');$n$, 2);
```

Until it is applied: **release a sub-round's scores only after the round banner shows the round cleared** (a few
seconds after it closes).

Checked and not flaws: rounds never overlap; releases are refused while a round is open; a pending order can never be
in a cooling-off company (the round opens after the clearing that sets it); a correction that undercuts a pending
sell or cover is refused (`decide_correction`); no deadlock between the clearing and team actions; the IPO cannot be
over-allocated; integer ranges are ample.

---

## 5. Residual risks and what staff watch on the night

* **Release timing (F7)** until patched: wait for "round cleared" before releasing.
* **The clearing raises on an oversell** (a fund selling more than it holds). No game function can cause it; a
  database restore (snapshots, W16) during an open round could. A restore must cancel the open round's pending
  orders, or the next tick stalls. Watch: the tick's actions show `cleared N` every 15 minutes; a round past its close
  by more than 10 s means the clearing failed: look at `error_log`.
* **Collateral deficits** are expected after spikes: those funds can only sell or cover; a fund covering at a loss
  may show negative cash. That is the game, not a bug.
* **Prices of a few cents are sticky** (5¢ does not fall on a −10% round, 10¢ not on a −5% reveal) and move in big
  percentage steps upwards (5¢ → 6¢ on +10%). Only reachable for a company that collapses all night.
* **Cooling-off also blocks covers**: a fund short in a company that rose 10% cannot cover it for one round.
* Load: a full book is ~2.4 s on the test runner; watch the tick duration on the Run page; realistic rounds are far
  below.
* The order ticket's help text says "quantity × price × 1.10"; at prices ending 5–9¢ the reserve is up to ½¢ a share
  more (F1). The ticket uses the engine, so the number it shows is the right one.
