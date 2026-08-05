import React, { useEffect, useState } from 'react'
import PoolTable from './components/PoolTable'

// Refreshed nightly by CI. 'no-cache' revalidates via ETag, so a rebuilt file
// is picked up straight away rather than a stale copy sitting in the browser.
const DATA_URL = `${import.meta.env?.BASE_URL ?? '/'}pools.json`

export default function App() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  // 'reload' skips the cache entirely, so the button genuinely re-reads the
  // file rather than handing back what the browser already had. The data is
  // rebuilt nightly by CI, so this fetches the newest build — it cannot
  // re-scrape the source live, which takes tens of minutes.
  const load = (bypassCache) => {
    setErr(null)
    return fetch(DATA_URL, { cache: bypassCache ? 'reload' : 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`pools.json ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(setErr)
  }

  useEffect(() => { load(false) }, [])

  const onRefresh = async () => {
    setRefreshing(true)
    try { await load(true) } finally { setRefreshing(false) }
  }

  return (
    <>
      <div className="head">
        <h1>
          Uniswap True Data
          <span className="tag">v2 · v3 · v4 — the seven Balancer-v3 chains</span>
        </h1>
        <p>
          Every Uniswap pool the data source indexes — <b>including the ones Uniswap's own app will
          not show you</b> — with TVL, volume and fees. Sourced per version per chain rather than
          skimmed off a global leaderboard, and scoped to the chains where Balancer v3 also runs so
          the two are directly comparable. Every figure is labelled by how it was obtained: measured
          values come straight from the API, anything derived from a fee tier is marked as an
          estimate, and the <b>In the app?</b> column says whether Uniswap's interface would surface
          the pool at all.
        </p>
      </div>

      {err && <div className="err">{String(err.message || err)}</div>}
      {!data && !err && <div className="loading">Loading pool data…</div>}
      {data && <PoolTable data={data} onRefresh={onRefresh} refreshing={refreshing} />}
    </>
  )
}
