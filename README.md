# Uniswap True Data

Uniswap pools across **v2, v3 and v4** on the seven chains where Balancer v3 also runs — TVL, volume and fees, with every figure
labelled by how it was obtained.

Live: https://marcusblabs.github.io/uniswap-true-data/

## Verifying the supplied prototype

Built from a supplied `build_uniswap_pools.py` + snapshot, after checking it. What it got **right**:
TVL and 24h volume are read correctly from GeckoTerminal and match the live API to within 0.02%
(WETH/USDC 0.05% on Ethereum: `$99,279,920` in the snapshot against `$99,262,200` live). Those
numbers were never the problem.

What was wrong, and what changed:

| Issue | Prototype | Now |
|---|---|---|
| Coverage | claimed "ALL Uniswap pools", actually **297** — the global top-80 per chain, filtered to whatever happened to be Uniswap | **3,747** via `/dexes/{dex}/pools`, asked for per version per chain |
| Freshness | static snapshot | nightly CI refresh |
| Dex matching | n/a | explicit ids — `/uni/i` also matches `velodrome-finance-*` on **Uni**chain |
| Fee honesty | `fees24` presented as fact | labelled an estimate; gross, not LP take-home |

## Fees: read the label

**GeckoTerminal exposes no fee field** — its pool attributes are price, volume and reserve only. The
tier therefore has to be parsed from the pool *name*. That is the only route available, and it is
sound: across 1,398 v3 pools the parsed tiers land on **exactly** the four canonical Uniswap tiers
(0.01%, 0.05%, 0.30%, 1.00%) and nothing else, with **zero** v3 pools above 1% — its maximum. No pool
name carries a percentage anywhere but the end, so nothing can capture part of a token name.

Consequences, stated on the page rather than buried:

- `Fees 24h` and `Fee APR` are **estimates** — volume × tier.
- They are **gross fees generated**, not LP take-home: v3 can have a protocol fee switched on and
  v4 hooks may take a cut, neither of which this source reports.
- **138 pools show `dynamic`** instead of a number — v4 dynamic-fee and hook pools have no static
  tier, and on Ethereum that includes the two largest v4 pools by TVL (PYUSD/USDS at $100M and
  USDT/USDS at $50M). A fabricated figure there would be worse than a blank.
- **155 pools charge over 1%**, some 90%+. These are genuine v4 custom fees, not parse errors —
  the v3 tier distribution above is what establishes that — and are marked in red.

## Coverage limit

GeckoTerminal paginates to page 10 (page 11 returns 401), so **~200 pools per version per chain** is
the API ceiling. This is not every Uniswap pool and the page says so. Pools are ordered by 24h
volume within each version, so the tail is thin-volume pools rather than a random sample.

## Caveats

- **112 pools report zero TVL** and are filtered out by the default $1k floor.
- **194 pools trade over 50× their own TVL in 24h**, which usually means a near-empty pool rather
  than a busy one; hidden by default behind the outlier toggle since it makes the APR meaningless.
- Some very high TVL pools have almost no transactions (e.g. `BLOTIX / SAFEMONEY` at $473M and one
  trade). Reported as the source gives them; treat unfamiliar pairs with suspicion.

## Run

```bash
npm install
npm run collect   # ~20 min, GeckoTerminal free tier is 30 req/min
npm run dev
npm run build
npm run deploy
```
