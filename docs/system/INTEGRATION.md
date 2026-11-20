# Money and shares between the tracks

Every movement of cash and shares between Product companies, Consulting firms, Finance funds and the exchange during
a PRIMUS night, with the rule, the moment and the function that makes it; then the invariants that prove the books
balance, with SQL to check them on the live database. Written for the organisers and the software specialist. The
trading rules themselves are in [TRADING-ALGORITHM.md](TRADING-ALGORITHM.md); scores and tiers are in
[`docs/judge/PARAMETERS.md`](../judge/PARAMETERS.md).

Status words: **built** = in the repository at migration 070; **tonight** = being built today behind a switch
(`app.feature_catalog()`, migration 070), described from the plan with its migration number.

## 1. The accounts

| Account | Where | Notes |
| --- | --- | --- |
| A team's cash | `teams.cash_cents` | Product and Consulting start at $0, each Finance fund at $500,000 (`STARTING_CASH`, `public.seed_event`) |
| The exchange's cash | `events.exchange_cash_cents` | The other side of every payment that is not team to team. It starts at minus the funds' starting cash, so **all team cash + the exchange's cash = 0** at every moment. It holds the fee escrow, receives IPO and trading cash, and pays bonuses, prizes and the Round 3 injection, so it is often negative: that is by design. |
| Collateral | `teams.collateral_cents` | 150% of each open short at the current price, recalculated after every price change (`app.recalculate_collateral`). A lock on the fund's cash, not a payment. |
| Shares | `holdings` (team, company, lot) and `companies.exchange_inventory` | Lots: `RETAINED` (the Product company's own), `SQUAD` (a fund's seed shares and raises), `EXCHANGE` (a fund's IPO and trading position), `SHORT` (shares a fund owes), `FEE` (a firm's fee shares). The exchange holds the rest. |
| The ledger | `ledger_entries` (append-only) | Every movement writes both sides with one `txn_id`; a line with no team is the exchange. `public_ledger` is the feed teams see. |
| Practice money | `practice_accounts` | $100,000 of play money per fund in Round 1. It never mixes with real cash; only the prize crosses (section 2, step 3). |

Prices are in cents; `RULES` in `packages/engine/src/rules.ts` holds the fixed numbers.

## 2. Every flow, in the order of the night

| # | When | Flow | Cash | Shares | Ledger kind | Code |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Event created | Starting cash | exchange → each fund: $500,000 | | `STARTING_CASH` | `public.seed_event` |
| 2 | Squad draw, 21:00 | Shares issued | | 60,000 to the company (`RETAINED`), 35,000 to the exchange for the IPO | `ISSUE` | `public.run_lottery` (010) |
| 2b | Squad draw | Seed money | squad's fund → its company: $50,000 | company → fund: 5,000 shares at $10.00 (`SQUAD` lot) | `SEED` | `public.run_lottery` |
| 3 | Entering `READING`, 22:00 | Practice prize | exchange → each of the top 3 funds that traded: $50,000 | | `PRACTICE_EDGE` | `app.settle_practice` (058) |
| 4 | Leaving `IPO`, 22:45 | IPO allocation | fund → exchange: shares × IPO price | exchange → fund (`EXCHANGE` lot) | `IPO_ALLOCATION` | `app.allocate_ipo` (009) |
| 5 | Every trading round's close | Clearing | BUY, COVER: fund → exchange; SELL, SHORT: exchange → fund; all at the round's one price | the reverse way; a short adds to the `SHORT` lot | `TRADE` | `app.clear_round` (009) |
| 6 | Hiring (minutes 0–20; Round 3 from the draft's end to `HIRE_5`) | Fee into escrow, on a binding accept | company → exchange: the fee's cash | fee shares are **promised**, not moved; they count against the 40,000-share floor | `ESCROW_HOLD` | `public.respond_offer` (033) |
| 7 | `HIRE_k` | A firm assigned to an unhired company | company → exchange: $22,500 (Round 3: 10% of its cash), never more than it has | | `ESCROW_HOLD` | `app.assign_default_firms` (061, 065, 066) |
| 8 | `DUE_k`, minute 65 | Escrow settled | memo of 150+ words: exchange → firm; otherwise exchange → company (refund) | paid: company `RETAINED` → firm `FEE` (only as many as it still retains); refunded: nothing moves | `ESCROW_RELEASE` / `ESCROW_REFUND` | `app.settle_engagements` (033, 065) |
| 9 | Advice scores released, after `RATE_k` | Reputation bonus, per paid engagement | exchange → firm: $500 × (score − 50) clamped to −$10,000 … +$25,000, + $1,000 × (stars − 3); negative = firm → exchange | | `BONUS_ADVICE` | `app.after_advice_release` (033) |
| 10 | Round 2 (`PRESSURE`) only | Equity raise | fund → company: shares × market price | company `RETAINED` → fund `SQUAD` | `DEAL` | `public.post_raise`, `public.fund_raise` (067, 069) |
| 11 | Entering `SATURATION`, 04:45 | Round 3 injection | exchange → each fund: 50% of its starting cash ($250,000) | | `INJECTION` | `app.enter_saturation` (034) |
| 12 | `CLOSE`, 06:30 | Shorts covered | fund → exchange: short shares × closing price | the `SHORT` lot goes to 0 | `SHORT_CLOSE` | `app.close_market` (011, 068) |
| 13 | `SETTLEMENT` | Consultant pay | exchange → the squad's firm: ZestUp memo bonus $500 × (score − 50), clamped; $2,500 per correct call | | `BONUS_MEMO`, `CALL_EARNINGS` (and `BONUS_PLAN`, see below) | `app.pay_consultant_bonuses` (030), via `app.settle` |
| 14 | Appeals after release | Corrections | classic night only today (see JUDGING.md, section 8) | | `SHORT_CLOSE`, `CALL_EARNINGS`, `BONUS_PLAN` | `public.apply_appeal` (020) |

Notes on the rules behind the flows:

- **IPO (4).** A fund bids 0–4,000 shares per company at its IPO price, never for its own squad's company, and the
  whole book must fit its cash (`app.check_ipo_book`). If a company's bids total 35,000 shares or fewer, every bid is
  filled; otherwise each bid gets ⌊bid × 35,000 ÷ total ÷ 10⌋ × 10 shares (`app.ipo_allocation`). The cash goes to the
  exchange, not to the company.
- **Trading (5).** Every order of a round fills at one price; limits are 4,000 long and 2,000 short per company,
  $250,000 of short exposure, 110% of the cost reserved for a buy, 150% collateral for a short, no orders on a
  company in its cooling-off round (`RULES`; `app.check_order`; migration 069). A sale removes the average cost.
- **Fees (6–8).** One firm per company per crisis, two clients per firm, five open offers per company, three counters
  per side (`public.make_offer`, `public.respond_offer`). A company always keeps 40,000 of its 100,000 shares,
  counting fee shares it has promised and not yet paid (`app.min_retained_shares`, `app.offer_problem`, migration
  060). A Round 3 fee must be worth 5–20% of the company's cash. Who hired whom, and for how much, is public.
- **The 150-word rule (8).** `submit_for` refuses an advice memo under 150 words; a shorter draft can still be
  auto-submitted at the deadline, but the escrow is paid only for a memo of 150 words or more
  (`app.settle_engagements`, migration 065; `RULES.ADVICE_MIN_WORDS`).
- **Raises (10).** 1,000 to 10,000 shares (1–10%) in steps of 10; one open raise per company; one funded raise per
  company per crisis; one raise per fund per crisis; at most 10,000 shares of one company held through raises; never
  the fund's own squad's company; above the 40,000-share floor; the fund needs the cash after reserves and collateral.
  An open raise lapses at the next crisis (`app.raise_k`).
- **Injection (11).** It counts as capital received: a fund's return is measured on starting cash plus the injection
  (`app.primus_results`). The practice prize (3) is a gain, not capital.

**Tonight (W9, migration 071, switches `hire_base_rate` and `hire_min_bid`, RULE, off by default).** Each firm's
base rate is 2% + 0.04% × (score − 50), between 1% and 4% of the company (1,000 to 4,000 shares). Since migration 089
the score is the average of the firm's released Round 1 memo (ZestUp) score and every advice memo score released so
far (each client's `ADVICE_k`, once per engagement); it is recalculated after each crisis's advice scores are
released, and is 2% with no released score (`app.firm_base_rate`). It is the
firm's minimum bid: an offer worth less (cash + shares × market price, against the base-rate shares × market price)
is refused (`BELOW_MIN_BID`). When hiring closes (crises 1–4 and Round 3), the companies with no firm and the firms
with room are shuffled by the lottery's generator (root SHA-256(seed + dice), stream `hire:k`, `app.hire_draw`); in
that order each company takes the least busy firm. It pays that firm's base rate in shares, held in escrow like an
accepted share offer (they move at the due time if the memo is in), or their cash value at the market price if the
40,000-share floor blocks the shares, never more than its cash; the ledger writes both sides. This replaces flow 7 while the switch is on. Both sides see
"assigned by the draw".

> **Found while writing this (built code, settlement).** `app.pay_consultant_bonuses` is the classic night's
> settlement step and runs on a PRIMUS night too (`app.settle`, `SETTLEMENT`). Its first part pays each squad's
> firm a plan bonus of $500 × (classic `PLAN` score − 50). A PRIMUS company has no `PLAN` score, so
> `app.plan_score` gives 0 and every squad's firm is charged **−$10,000** (`BONUS_PLAN`). Every firm in a squad loses
> the same amount, so the Consulting ranking does not change, but firm values are $10,000 too low. The PRIMUS tests
> stop at `CLOSE`, so none covers it. Fix before settlement (skip `BONUS_PLAN` and `BONUS_DEAL` when the event's
> format is `PRIMUS`), or correct it afterwards with a logged correction.

## 3. What each track ends with

| Track | Final value | Code |
| --- | --- | --- |
| Product | retained shares × closing price + cash | `app.compute_results` (013) |
| Consulting | cash (fees, bonuses, call earnings) + `FEE` shares × closing price | `app.primus_results` (034) |
| Finance | cash + long shares × closing price (shorts are already covered); return = final value ÷ (starting cash + injection) − 1 | `app.compute_results`, `app.primus_results` |

## 4. The invariants

These must hold after every transaction. They are checked after every phase of the full-night test
(`checkInvariants` in `supabase/tests/night.ts`) and are what tonight's snapshots and fuzz tests guard.

| # | Invariant | Why it holds |
| --- | --- | --- |
| I1 | All team cash + the exchange's cash = 0 | Every payment moves cash between a team and the exchange, or between two teams; the escrow sits inside the exchange's cash, so "cash + escrow + exchange" is this same sum |
| I2 | Each team's cash = the sum of its ledger cash lines | Every change to `cash_cents` writes a ledger line in the same transaction |
| I3 | Every ledger transaction's cash sums to 0, and its shares per company sum to 0 (except the draw's `ISSUE` and `SEED` lines, which create the shares) | The two-line rule |
| I4 | Each holding = the sum of its ledger share lines (a `SHORT` lot = minus the sum) | Every change to `holdings` writes a ledger line |
| I5 | Each company's exchange inventory = the sum of the exchange's share lines for it | As I4, for the exchange |
| I6 | Each company has exactly 100,000 shares: exchange inventory + all long lots − all short lots | Shares are created once at the draw and only move afterwards |
| I7 | Cash held in escrow = cash of engagements still `HELD` | Hold and settle write matching exchange lines |

`ledger_entries`, `public_ledger`, `round_prices`, `injection_logs` and `audit_log` are append-only (a trigger refuses
updates and deletes, migration 004), so a balance can be rebuilt from the lines at any time.

## 5. SQL to check them

Read-only. Paste into the Supabase SQL editor; change the slug on the first line if needed. Every check should say
`OK`; anything else names what to look at.

```sql
-- PRIMUS ledger invariants: read-only. Every row should end in OK.
with ev as (select id from public.events where slug = 'primus-2026'),
i1 as (select e.exchange_cash_cents + coalesce((select sum(t.cash_cents) from public.teams t where t.event_id = e.id), 0) as v
         from public.events e where e.id = (select id from ev)),
i2 as (select count(*) as v from (
         select t.id from public.teams t left join public.ledger_entries l on l.team_id = t.id
          where t.event_id = (select id from ev)
          group by t.id having t.cash_cents <> coalesce(sum(l.cash_delta_cents), 0)) x),
i3a as (select count(*) as v from (
          select txn_id from public.ledger_entries where event_id = (select id from ev)
           group by txn_id having sum(cash_delta_cents) <> 0) x),
i3b as (select count(*) as v from (
          select txn_id, company_id from public.ledger_entries
           where event_id = (select id from ev) and kind not in ('ISSUE', 'SEED')
           group by txn_id, company_id having sum(share_delta) <> 0) x),
i4 as (select count(*) as v from (
         select h.id from public.holdings h
           left join public.ledger_entries l on l.team_id = h.team_id and l.company_id = h.company_id and l.lot = h.lot
          where h.event_id = (select id from ev)
          group by h.id having h.qty <> case when h.lot = 'SHORT' then -1 else 1 end * coalesce(sum(l.share_delta), 0)) x),
i5 as (select count(*) as v from (
         select c.id from public.companies c
           left join public.ledger_entries l on l.company_id = c.id and l.team_id is null
          where c.event_id = (select id from ev) and c.squad_id is not null
          group by c.id having c.exchange_inventory <> coalesce(sum(l.share_delta), 0)) x),
i6 as (select count(*) as v from (
         select c.id from public.companies c left join public.holdings h on h.company_id = c.id
          where c.event_id = (select id from ev) and c.squad_id is not null
          group by c.id
         having c.exchange_inventory + coalesce(sum(h.qty) filter (where h.lot <> 'SHORT'), 0)
                - coalesce(sum(h.qty) filter (where h.lot = 'SHORT'), 0) <> 100000) x),
i7 as (select (select coalesce(sum(cash_cents), 0) from public.engagements where event_id = (select id from ev) and escrow = 'HELD')
            - (select coalesce(sum(cash_delta_cents), 0) from public.ledger_entries
                where event_id = (select id from ev) and team_id is null
                  and kind in ('ESCROW_HOLD', 'ESCROW_RELEASE', 'ESCROW_REFUND')) as v)
select 'I1 all cash + exchange = 0' as invariant, (select v from i1)::text as found, case when (select v from i1) = 0 then 'OK' else 'FIX' end as result
union all select 'I2 teams whose cash differs from the ledger', (select v from i2)::text, case when (select v from i2) = 0 then 'OK' else 'FIX' end
union all select 'I3 transactions whose cash does not balance', (select v from i3a)::text, case when (select v from i3a) = 0 then 'OK' else 'FIX' end
union all select 'I3 transactions whose shares do not balance', (select v from i3b)::text, case when (select v from i3b) = 0 then 'OK' else 'FIX' end
union all select 'I4 holdings that differ from the ledger', (select v from i4)::text, case when (select v from i4) = 0 then 'OK' else 'FIX' end
union all select 'I5 exchange inventories that differ from the ledger', (select v from i5)::text, case when (select v from i5) = 0 then 'OK' else 'FIX' end
union all select 'I6 companies without exactly 100,000 shares', (select v from i6)::text, case when (select v from i6) = 0 then 'OK' else 'FIX' end
union all select 'I7 escrow held − exchange escrow lines', (select v from i7)::text, case when (select v from i7) = 0 then 'OK' else 'FIX' end;
```

To see which rows break a check, run its inner `select` on its own (for example the body of `i2` lists the teams
whose cash differs from their ledger). A check that fails is a reason to pause and look before the next release, not
to change numbers by hand: every repair goes through a logged, two-person correction.

## Sources

`supabase/migrations/20261007000004_integrity.sql`, `20261008000009_trading.sql`, `20261008000010_squads.sql`,
`20261008000011_prices_scores.sql`, `20261008000013_settlement.sql`, `20261112000030_memo.sql`,
`20261113000033_marketplace.sql`, `20261113000034_saturation.sql`, `20261124000058_practice_market.sql`,
`20261126000060_dilution_floor.sql`, `20261127000061_assign_firms.sql`, `20261201000065_night_fixes.sql`,
`20261202000066_present_hiring.sql`, `20261203000067_equity_raises.sql`, `20261204000068_close_counts_the_end.sql`,
`20261205000069_anti_saturation.sql`, `20261206000070_switches.sql`; `supabase/tests/night.ts`;
`packages/engine/src/rules.ts`. Tonight's hiring rules: the plan (W9).
