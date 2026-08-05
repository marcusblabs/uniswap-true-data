/**
 * Shared, side-effect-free pieces: the chain set, Uniswap's token lists, and
 * the listing classifier.
 *
 * Kept separate from collect.mjs because that file runs a full collection at
 * module scope — importing it to reuse a function starts a two-hour scrape.
 */

// Scoped to the chains where Balancer v3 is deployed AND Uniswap exists, so
// the two dashboards compare like for like. That intersection is exactly these
// seven: Gnosis, Plasma and HyperEVM carry Balancer v3 but have no Uniswap
// deployment at all, and Unichain and BNB are the reverse.
//
// Ids are explicit, never pattern-matched: "uniswap" appears in velodrome's
// Unichain ids purely because of the chain name, and a regex would quietly
// pull in another DEX's pools.
export const CHAINS = {
  eth:         { uniSlug: 'ethereum', name: 'Ethereum',  short: 'ETH',  chainId: 1,     explorer: 'https://etherscan.io/address/',
                 dexes: { uniswap_v2: 2, uniswap_v3: 3, 'uniswap-v4-ethereum': 4 } },
  base:        { uniSlug: 'base', chainId: 8453, name: 'Base',      short: 'BASE', explorer: 'https://basescan.org/address/',
                 dexes: { 'uniswap-v2-base': 2, 'uniswap-v3-base': 3, 'uniswap-v4-base': 4 } },
  arbitrum:    { uniSlug: 'arbitrum', chainId: 42161, name: 'Arbitrum',  short: 'ARB',  explorer: 'https://arbiscan.io/address/',
                 dexes: { 'uniswap-v2-arbitrum': 2, uniswap_v3_arbitrum: 3, 'uniswap-v4-arbitrum': 4 } },
  polygon_pos: { uniSlug: 'polygon', chainId: 137, name: 'Polygon',   short: 'POLY', explorer: 'https://polygonscan.com/address/',
                 dexes: { 'uniswap-v2-polygon': 2, uniswap_v3_polygon_pos: 3, 'uniswap-v4-polygon': 4 } },
  optimism:    { uniSlug: 'optimism', chainId: 10, name: 'Optimism',  short: 'OP',   explorer: 'https://optimistic.etherscan.io/address/',
                 dexes: { 'uniswap-v2-optimism': 2, uniswap_v3_optimism: 3, 'uniswap-v4-optimism': 4 } },
  avax:        { uniSlug: 'avalanche', chainId: 43114, name: 'Avalanche', short: 'AVAX', explorer: 'https://snowtrace.io/address/',
                 dexes: { 'uniswap-v2-avalanche': 2, 'uniswap-v3-avalanche': 3, 'uniswap-v4-avalanche': 4 } },
  monad:       { uniSlug: 'monad', chainId: 143, name: 'Monad',     short: 'MON',  explorer: 'https://monadexplorer.com/address/',
                 dexes: { 'uniswap-v2-monad': 2, 'uniswap-v3-monad': 3, 'uniswap-v4-monad': 4 } },
}


/**
 * Uniswap's own token lists, which decide what its app will show you.
 *
 *   default      appears normally when browsing
 *   extended     findable, but only via search
 *   unsupported  the interface actively blocks or warns on it
 *   on no list   reachable only by pasting the address, behind warnings
 *
 * A pool is only browsable in the app when BOTH its tokens are on the default
 * list, so the ones worth surfacing here are precisely those that are not.
 */
const TOKEN_LISTS = {
  default: 'https://tokens.uniswap.org',
  extended: 'https://extendedtokens.uniswap.org',
  unsupported: 'https://unsupportedtokens.uniswap.org',
}

export async function fetchTokenLists(log = console.log) {
  const sets = { default: new Set(), extended: new Set(), unsupported: new Set() }
  for (const [key, url] of Object.entries(TOKEN_LISTS)) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const j = await r.json()
      for (const t of j.tokens || []) sets[key].add(`${t.chainId}:${String(t.address).toLowerCase()}`)
      log(`  ${key.padEnd(12)} ${sets[key].size} tokens`)
    } catch (e) {
      log(`  ${key.padEnd(12)} FAILED (${e.message}) — listing status will be unknown`)
    }
  }
  return sets
}

/**
 * How the Uniswap interface would treat this pool.
 *
 * `unlisted` is the interesting bucket: a real pool with real liquidity that
 * you cannot reach by browsing the app, because at least one of its tokens is
 * on none of Uniswap's lists.
 */
// Uniswap v4 holds native ETH directly and denotes it with the zero address.
// No ERC20 token list contains it, so testing membership naively marks every
// native-ETH v4 pool as unlisted — 442 of them, $195M of TVL, including
// mainstream pairs like ETH/USDC. The native asset is always supported.
const NATIVE = new Set([
  '0x0000000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
])

export function classifyListing(pool, chainId, sets) {
  if (!chainId || !pool.token0 || !pool.token1) return 'unknown'
  if (NATIVE.has(pool.token0) && NATIVE.has(pool.token1)) return 'listed'
  const k0 = NATIVE.has(pool.token0) ? null : `${chainId}:${pool.token0}`
  const k1 = NATIVE.has(pool.token1) ? null : `${chainId}:${pool.token1}`
  if ((k0 && sets.unsupported.has(k0)) || (k1 && sets.unsupported.has(k1))) return 'blocked'
  // a null key means the native asset, which is always available
  const onDefault = (k) => k === null || sets.default.has(k)
  const onExtended = (k) => k === null || sets.default.has(k) || sets.extended.has(k)
  if (onDefault(k0) && onDefault(k1)) return 'listed'
  if (onExtended(k0) && onExtended(k1)) return 'search-only'
  return 'unlisted'
}

