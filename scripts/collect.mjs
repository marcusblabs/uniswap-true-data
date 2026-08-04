/**
 * Collect Uniswap pool data from GeckoTerminal into public/pools.json.
 *
 * Rewritten from a supplied prototype after verification. What the prototype
 * got right: TVL and 24h volume read straight from GeckoTerminal and match the
 * live API to within 0.02% (WETH/USDC 0.05% on Ethereum: $99,279,920 against
 * $99,262,200). Those numbers were never the problem.
 *
 * What it got wrong, and what changed here:
 *
 * 1. COVERAGE. It claimed to cover "ALL Uniswap pools" but paged the GLOBAL
 *    top-pools list per chain and kept whatever happened to be Uniswap — 297
 *    pools, biased toward whatever ranks highly across every DEX at once. This
 *    uses /networks/{net}/dexes/{dex}/pools, which asks for Uniswap pools
 *    directly, per version, per chain.
 * 2. DEX IDS ARE EXPLICIT. Matching /uni/i against Unichain's dex list also
 *    catches velodrome-finance-*, because the CHAIN is called Unichain.
 * 3. FEES ARE LABELLED AS ESTIMATES. GeckoTerminal exposes no fee field at all
 *    — its pool attributes are price, volume and reserve only — so the tier
 *    must be read out of the pool NAME. That is the only option, not laziness,
 *    but it means: static tiers only, nothing for v4 dynamic-fee/hook pools,
 *    and the result is GROSS fees generated, not LP take-home.
 *
 * Hard limit worth knowing: pagination stops at page 10 (page 11 returns 401),
 * so ~200 pools per dex per chain is the API's ceiling. "Every Uniswap pool"
 * is not reachable from this source; the dashboard says so rather than
 * implying completeness.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const GT = 'https://api.geckoterminal.com/api/v2'
const RATE_MS = 2300 // free tier: 30 requests/minute
const MAX_PAGE = 10 // page 11 → 401
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Explicit ids, verified against /networks/{net}/dexes. Never pattern-matched:
// "uniswap" appears in velodrome's Unichain ids purely because of the chain
// name, and a regex would silently import another DEX's pools.
export const CHAINS = {
  eth:         { name: 'Ethereum',  short: 'ETH',  explorer: 'https://etherscan.io/address/',
                 dexes: { uniswap_v2: 2, uniswap_v3: 3, 'uniswap-v4-ethereum': 4 } },
  base:        { name: 'Base',      short: 'BASE', explorer: 'https://basescan.org/address/',
                 dexes: { 'uniswap-v2-base': 2, 'uniswap-v3-base': 3, 'uniswap-v4-base': 4 } },
  arbitrum:    { name: 'Arbitrum',  short: 'ARB',  explorer: 'https://arbiscan.io/address/',
                 dexes: { 'uniswap-v2-arbitrum': 2, uniswap_v3_arbitrum: 3, 'uniswap-v4-arbitrum': 4 } },
  polygon_pos: { name: 'Polygon',   short: 'POLY', explorer: 'https://polygonscan.com/address/',
                 dexes: { 'uniswap-v2-polygon': 2, uniswap_v3_polygon_pos: 3, 'uniswap-v4-polygon': 4 } },
  optimism:    { name: 'Optimism',  short: 'OP',   explorer: 'https://optimistic.etherscan.io/address/',
                 dexes: { 'uniswap-v2-optimism': 2, uniswap_v3_optimism: 3, 'uniswap-v4-optimism': 4 } },
  unichain:    { name: 'Unichain',  short: 'UNI',  explorer: 'https://uniscan.xyz/address/',
                 dexes: { 'uniswap-v2-unichain': 2, 'uniswap-v3-unichain': 3, 'uniswap-v4-unichain': 4 } },
  bsc:         { name: 'BNB',       short: 'BNB',  explorer: 'https://bscscan.com/address/',
                 dexes: { 'uniswap-v2-bsc': 2, 'uniswap-bsc': 3 } },
  avax:        { name: 'Avalanche', short: 'AVAX', explorer: 'https://snowtrace.io/address/',
                 dexes: { 'uniswap-v2-avalanche': 2, 'uniswap-v3-avalanche': 3, 'uniswap-v4-avalanche': 4 } },
  monad:       { name: 'Monad',     short: 'MON',  explorer: 'https://monadexplorer.com/address/',
                 dexes: { 'uniswap-v2-monad': 2, 'uniswap-v3-monad': 3, 'uniswap-v4-monad': 4 } },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function gt(pathname, { tries = 3 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    let res
    try {
      res = await fetch(GT + pathname, {
        headers: { accept: 'application/json', 'user-agent': 'uniswap-true-data/1.0' },
      })
    } catch {
      await sleep(5000)
      continue
    }
    if (res.ok) {
      const json = await res.json().catch(() => null)
      await sleep(RATE_MS)
      return json
    }
    if (res.status === 404 || res.status === 401) {
      await sleep(RATE_MS)
      return null // 401 = past the pagination ceiling, not an auth problem
    }
    await sleep(res.status === 429 ? 11000 : 5000)
  }
  return null
}

/**
 * Fee tier, read from the pool name — the only route available.
 *
 * v2 is a fixed 0.30% constant-product fee and needs no name. v3 names carry
 * their static tier. v4 pools MAY carry one, but hook and dynamic-fee pools
 * do not, and for those the honest answer is null rather than a guess: on
 * Ethereum that includes the two largest v4 pools by TVL (PYUSD/USDS at $100M
 * and USDT/USDS at $50M).
 */
// Anchored to the END: GeckoTerminal formats Uniswap names as
// "TOKEN0 / TOKEN1 FEE%". Verified across 2,557 v3/v4 pools that no name
// carries a percentage anywhere else, so this cannot capture part of a token
// name — but anchoring keeps it that way if naming ever changes.
const FEE_RE = /(\d*\.?\d+)\s*%\s*$/
export function parseFee(name, version) {
  if (version === 2) return { fee: 0.003, source: 'v2-fixed' }
  const m = FEE_RE.exec((name || '').trim())
  if (m) {
    const fee = parseFloat(m[1]) / 100
    if (isFinite(fee) && fee >= 0 && fee < 1) return { fee, source: 'name' }
  }
  return { fee: null, source: version === 4 ? 'dynamic-or-hook' : 'unknown' }
}

async function collect({ maxPages = MAX_PAGE, log = console.log } = {}) {
  const pools = new Map()
  let calls = 0

  for (const [net, meta] of Object.entries(CHAINS)) {
    for (const [dex, version] of Object.entries(meta.dexes)) {
      let got = 0
      for (let page = 1; page <= maxPages; page++) {
        const d = await gt(`/networks/${net}/dexes/${dex}/pools?page=${page}&sort=h24_volume_usd_desc`)
        calls++
        const rows = d?.data || []
        if (!rows.length) break
        for (const p of rows) {
          const a = p.attributes || {}
          const name = a.name || ''
          const { fee, source } = parseFee(name, version)
          const vol24 = +(a.volume_usd?.h24 || 0)
          const tvl = +(a.reserve_in_usd || 0)
          pools.set(p.id, {
            id: p.id,
            chain: meta.name,
            net,
            short: meta.short,
            dex,
            version,
            address: a.address,
            name,
            tvl: +tvl.toFixed(2),
            vol24: +vol24.toFixed(2),
            vol6h: +(+(a.volume_usd?.h6 || 0)).toFixed(2),
            vol1h: +(+(a.volume_usd?.h1 || 0)).toFixed(2),
            txns24: (a.transactions?.h24?.buys || 0) + (a.transactions?.h24?.sells || 0),
            priceChange24: a.price_change_percentage?.h24 == null ? null : +a.price_change_percentage.h24,
            swapFee: fee,
            feeSource: source,
            // Gross fees generated by swaps. NOT LP take-home: v3 can have a
            // protocol fee switched on and v4 hooks may take a cut, neither of
            // which this source exposes.
            fees24: fee == null ? null : +(vol24 * fee).toFixed(2),
            created: (a.pool_created_at || '').slice(0, 10),
          })
          got++
        }
        if (rows.length < 20) break
      }
      log(`  ${meta.name.padEnd(10)} ${dex.padEnd(24)} v${version}  ${String(got).padStart(4)} pools`)
    }
  }
  return { pools: [...pools.values()], calls }
}

const started = Date.now()
console.log('collecting Uniswap pools from GeckoTerminal (explicit dex ids, per version)…')
const { pools, calls } = await collect()

// Quality flags, computed once here so the UI never has to infer them.
for (const p of pools) {
  const flags = []
  if (!(p.tvl > 0)) flags.push('no-tvl')
  if (p.swapFee == null) flags.push('fee-unknown')
  if (p.tvl > 0 && p.vol24 / p.tvl > 50) flags.push('vol-tvl-outlier')
  // Above 1% is impossible on v3 (its top tier) and means a v4 pool set a
  // custom fee. Real, but worth surfacing: some sit at 90-95%, which takes
  // almost the entire trade. Verified as genuine — v3 fees land exactly on the
  // four canonical tiers, so the parse is not at fault.
  if (p.swapFee != null && p.swapFee > 0.01) flags.push('extreme-fee')
  p.flags = flags
}

pools.sort((a, b) => b.tvl - a.tvl)

const byChain = {}
const byVersion = {}
for (const p of pools) {
  byChain[p.chain] = (byChain[p.chain] || 0) + 1
  byVersion['v' + p.version] = (byVersion['v' + p.version] || 0) + 1
}

const out = {
  generatedAt: new Date().toISOString(),
  source: 'GeckoTerminal API v2 (/networks/{net}/dexes/{dex}/pools)',
  // Stated plainly so nothing here reads as a complete census of Uniswap.
  coverageNote:
    'GeckoTerminal paginates to page 10 (~200 pools per Uniswap version per chain), ordered by 24h volume. ' +
    'This is the deepest the public API allows and is not every Uniswap pool.',
  feeNote:
    'GeckoTerminal exposes no fee field. Tiers are read from the pool name (v2 is a fixed 0.30%). ' +
    'Fees are gross fees generated by swaps, not LP take-home, and are unavailable for v4 dynamic-fee and hook pools.',
  counts: {
    pools: pools.length,
    apiCalls: calls,
    byChain,
    byVersion,
    feeUnknown: pools.filter((p) => p.swapFee == null).length,
    noTvl: pools.filter((p) => !(p.tvl > 0)).length,
  },
  chains: Object.values(CHAINS).map((c) => ({ name: c.name, short: c.short, explorer: c.explorer })),
  pools,
}

const dest = path.join(ROOT, 'public/pools.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(out))

console.log(`\nwrote public/pools.json — ${pools.length} pools, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${calls} API calls, ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`)
console.log('  by chain  :', Object.entries(byChain).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))
console.log('  by version:', JSON.stringify(byVersion))
console.log(`  fee unknown: ${out.counts.feeUnknown}   zero TVL: ${out.counts.noTvl}`)
console.log(`  total TVL : $${Math.round(pools.reduce((a, p) => a + p.tvl, 0)).toLocaleString()}`)
console.log(`  total 24h : $${Math.round(pools.reduce((a, p) => a + p.vol24, 0)).toLocaleString()}`)
