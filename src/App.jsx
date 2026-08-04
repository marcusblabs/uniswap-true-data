import React, { useEffect, useState } from 'react'
import PoolTable from './components/PoolTable'

// Refreshed nightly by CI. 'no-cache' revalidates via ETag, so a rebuilt file
// is picked up straight away rather than a stale copy sitting in the browser.
const DATA_URL = `${import.meta.env?.BASE_URL ?? '/'}pools.json`

export default function App() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let on = true
    fetch(DATA_URL, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`pools.json ${r.status}`)
        return r.json()
      })
      .then((d) => on && setData(d))
      .catch((e) => on && setErr(e))
    return () => { on = false }
  }, [])

  return (
    <>
      <div className="head">
        <h1>
          Uniswap True Data
          <span className="tag">v2 · v3 · v4 — nine chains</span>
        </h1>
        <p>
          Uniswap pools with <b>TVL, volume and fees</b>, sourced per version per chain rather than
          skimmed off a global leaderboard. Every figure is labelled by how it was obtained:
          measured values come straight from the API, and anything derived from a fee tier is marked
          as an estimate — because the source exposes no fee field, so the tier has to be read from
          the pool name.
        </p>
      </div>

      {err && <div className="err">{String(err.message || err)}</div>}
      {!data && !err && <div className="loading">Loading pool data…</div>}
      {data && <PoolTable data={data} />}
    </>
  )
}
