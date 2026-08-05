/**
 * Recompute listing status on an existing pools.json.
 *
 * Token addresses are already stored, so re-deriving the classification needs
 * only Uniswap's three token lists — no GeckoTerminal traffic and no waiting
 * out its rate limit for a fresh collection.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
// From the shared lib, never from collect.mjs — that file collects on import.
const { CHAINS, fetchTokenLists, classifyListing } =
  await import(pathToFileURL(path.join(ROOT, 'src/lib/listing.mjs')).href)

const file = path.join(ROOT, 'public/pools.json')
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const sets = await fetchTokenLists()

const before = { ...(data.counts.byListing || {}) }
for (const p of data.pools) {
  p.listing = classifyListing(p, CHAINS[p.net]?.chainId, sets)
  p.flags = (p.flags || []).filter((f) => f !== 'unlisted' && f !== 'blocked')
  if (p.listing === 'unlisted') p.flags.push('unlisted')
  if (p.listing === 'blocked') p.flags.push('blocked')
}
data.counts.byListing = data.pools.reduce((m, p) => ({ ...m, [p.listing]: (m[p.listing] || 0) + 1 }), {})
fs.writeFileSync(file, JSON.stringify(data))
console.log('before:', JSON.stringify(before))
console.log('after :', JSON.stringify(data.counts.byListing))
const hidden = data.pools.filter((p) => (p.listing === 'unlisted' || p.listing === 'blocked') && p.tvl >= 10000)
console.log(`not browsable in the app, TVL >= $10k: ${hidden.length}, holding $${Math.round(hidden.reduce((a, p) => a + p.tvl, 0)).toLocaleString()}`)
