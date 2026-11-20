# Sectors: FMCG, Aviation and Luxury (the event), from a library of five

Upload these on the organiser's Content page, before the squad draw (both decks lock at the draw).

| File | Upload as | What it does |
| --- | --- | --- |
| `problem-cards.csv` | Problem deck | 3 cards, one per sector (FMCG, Aviation, Luxury: the official PRIMUS 2026 Product Track statements). The lottery splits the squads equally between them (67, 67 and 66 for 200 squads) and each squad's card is chosen at the draw. |
| `crisis-cards.csv` | Crisis deck | 4 cards per sector. In crisis *k* every company gets its own sector's card number *k* (1 operations, 2 market, 3 trust, 4 money). |
| `statements.csv` | Round 3 problem statements | 10 per sector, cap 7 each (room for 70 companies per sector: enough for 67, i.e. 200 squads over three sectors). A company drafts only its own sector's statements. Each sector drafts in its own queue, all three at the same time: lowest score so far first, 20 seconds per pick, so 67 companies take about 22 minutes. A company that misses its pick gets a random statement of its sector with room (drawn from the lottery's seed, so it can be replayed). |

The problem statements are the official PRIMUS 2026 Product Track statements; Aviation is about the data of Air Traffic Management. These files are `pnpm sectors --pick FMCG,Aviation,Luxury --out seed/sectors`. Every number on the crisis cards is invented for the game: check them before the event.

## Other sectors: Energy and Fintech

`all/` holds the same three files with all five sectors (Luxury, FMCG, Energy, Aviation and Fintech): 5 problem cards,
20 crisis cards and 50 statements (cap 7, room for 70 per sector). Upload them to play all five (the lottery gives 40 squads to each of 200).

To play any other mix of 2 to 6 sectors, for example Energy instead of Luxury, write the three files with:

```bash
pnpm sectors --pick FMCG,Aviation,Energy
```

It writes `out/sectors/fmcg-aviation-energy/` (problem cards and statements numbered again in the order given),
checked with the Content page's own rules. Upload those three files instead of the ones in this folder.

Every card, with what a strong answer covers, is in `docs/case-studies/PRIMUS-Problem-Statements-and-Crises.pdf`.
