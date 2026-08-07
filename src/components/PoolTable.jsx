import React, { useEffect, useMemo, useRef, useState } from 'react'

const fmtUsd = (v) => {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k'
  return '$' + n.toFixed(0)
}
/**
 * TVL bound entry. Accepts 1000, 1k, 2.5M, $1.2b, 250,000 — the forms people actually
 * type — and a blank meaning "no bound on this side".
 *
 * Three outcomes, deliberately distinct: null for blank, NaN for something unreadable,
 * a number otherwise. Collapsing unreadable into 0 would silently filter the table on a
 * typo with nothing on screen to explain it.
 */
function parseAmount(str) {
  const t = String(str ?? '').trim().replace(/[$,\s_]/g, '')
  if (!t) return null
  const m = /^(\d*\.?\d+)([kmb])?$/i.exec(t)
  if (!m) return NaN
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1
  return parseFloat(m[1]) * mult
}

/* generatedAt is a full ISO instant, but the page only ever printed its first ten
   characters — so a table rebuilt eight hours ago and one rebuilt eight minutes ago looked
   identical. UTC is stated rather than converted to local time, because the scrape runs in
   UTC and a bare local clock would read differently for every viewer with nothing saying so. */
function fmtStamp(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso).slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}
/** Relative age — the part you actually read to judge whether the data is stale. */
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return null
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.round(m / 60)
  if (h < 48) return h + 'h ago'
  return Math.round(h / 24) + 'd ago'
}

/** Compact form a bound is written back as after a drag: 2500000 -> "2.5m". Chosen so it
 *  round-trips through parseAmount, i.e. the box shows something the user could have typed. */
function toShort(v) {
  if (v == null || !isFinite(v) || v <= 0) return ''
  const trim = (x) => String(+x.toPrecision(3))
  if (v >= 1e9) return trim(v / 1e9) + 'b'
  if (v >= 1e6) return trim(v / 1e6) + 'm'
  if (v >= 1e3) return trim(v / 1e3) + 'k'
  return String(Math.round(v))
}

/* TVL is distributed over seven orders of magnitude — three quarters of these pools sit under
   $100k, which is a fifth of one percent of the way along a linear track from zero to the
   largest pool. A linear slider would therefore spend almost all of its travel on the handful
   of giants and give no purchase at all on the range anyone actually wants to sift. The track
   is logarithmic for that reason.

   The two ends are reserved for "no bound": the low thumb at rest means no floor, the high
   thumb at rest means no ceiling. Without that, pushing the max fully right would assert a
   limit exactly at the largest pool rather than removing the limit. */
const TVL_FLOOR = 100
const TVL_STEPS = 1000

const fmtFee = (f) => (f == null ? null : (f * 100).toFixed(f < 0.001 ? 3 : 2).replace(/\.?0+$/, '') + '%')

// Fee-derived figures are estimates: GeckoTerminal has no fee field, so the
// tier comes from the pool name and the result is gross fees generated, not
// LP take-home.
const feeApr = (p) => (p.fees24 == null || !(p.tvl > 0) ? null : (p.fees24 * 365 * 100) / p.tvl)

/**
 * Where a pool row links.
 *
 * v4 pools live inside a singleton PoolManager, so their identifier is a
 * 32-byte poolId, NOT a contract — 1,374 of the pools here. Handing that to a
 * block explorer yields an invalid-address page, which is why so many links
 * were dead. Uniswap's own pool page accepts both forms, so it is the primary
 * link; the explorer is offered only for v2/v3, where a contract exists.
 */
const uniswapUrl = (p, chains) => {
  const slug = chains.find((c) => c.name === p.chain)?.uniSlug
  return slug ? `https://app.uniswap.org/explore/pools/${slug}/${p.address}` : null
}
const explorerUrl = (p, chains) => {
  if (p.version === 4) return null
  const ex = chains.find((c) => c.name === p.chain)?.explorer
  return ex ? ex + p.address : null
}

const LISTING = {
  listed:        { label: 'listed',      cls: 'lst-ok',    t: 'Both tokens are on Uniswap’s default list — this pool shows up normally in the app.' },
  'search-only': { label: 'search only', cls: 'lst-warn',  t: 'Tokens are on the extended list: findable in the app, but only if you search.' },
  unlisted:      { label: 'UNLISTED',    cls: 'lst-hide',  t: 'A token is on none of Uniswap’s lists. Unreachable by browsing the app — only by pasting an address, behind warnings.' },
  blocked:       { label: 'FLAGGED',     cls: 'lst-block', t: 'A token is on Uniswap’s unsupported list — its own scam/warning blocklist. Excluded by default.' },
  unknown:       { label: '—',           cls: 'dim',       t: 'Listing status could not be determined.' },
}

// `req` columns cannot be switched off — without them a row has no identity.
const ALL_COLS = [
  { k: 'name',     l: 'Pool',        a: 'l', req: true },
  { k: 'listing',  l: 'In the app?', a: 'l', t: 'Whether Uniswap’s own interface will surface this pool, judged against its default / extended / unsupported token lists.' },
  { k: 'version',  l: 'Ver',         a: 'l' },
  { k: 'chain',    l: 'Chain',       a: 'l' },
  { k: 'swapFee',  l: 'Fee tier',    a: 'r', t: 'Read from the pool name — GeckoTerminal exposes no fee field. v2 is a fixed 0.30%.' },
  { k: 'tvl',      l: 'TVL',         a: 'r', t: 'Reserves in USD, straight from GeckoTerminal. Verified against the live API to within 0.02%.' },
  { k: 'vol24',    l: 'Volume 24h',  a: 'r', t: 'Straight from GeckoTerminal.' },
  { k: 'fees24',   l: 'Fees 24h',    a: 'r', t: 'ESTIMATE: 24h volume × fee tier. Gross fees generated, not LP take-home.' },
  { k: 'apr',      l: 'Fee APR',     a: 'r', t: 'ESTIMATE: annualised 24h fees over TVL. One day of volume is a thin basis for an annual rate.' },
  { k: 'turnover', l: 'Vol/TVL',     a: 'r', t: 'How many times the pool’s own liquidity traded in 24h. High values usually mean a very thin pool.' },
  { k: 'txns24',   l: 'Txns 24h',    a: 'r' },
  { k: 'vol6h',    l: 'Volume 6h',   a: 'r', off: true },
  { k: 'vol1h',    l: 'Volume 1h',   a: 'r', off: true },
  { k: 'priceChange24', l: 'Price 24h', a: 'r', off: true, t: 'Price change of the pool’s base token over 24h.' },
  { k: 'created',  l: 'Created',     a: 'r', off: true },
  { k: 'address',  l: 'Address / poolId', a: 'l', off: true },
]
const DEFAULT_COLS = ALL_COLS.filter((c) => !c.off).map((c) => c.k)
const COL_KEY = 'utd.columns.v1'
const NUMERIC = new Set(['tvl', 'vol24', 'vol6h', 'vol1h', 'fees24', 'apr', 'turnover', 'txns24', 'swapFee', 'priceChange24'])

function sortVal(p, k) {
  switch (k) {
    case 'name': return (p.name || '').toLowerCase()
    case 'listing': return ['unlisted', 'blocked', 'search-only', 'listed', 'unknown'].indexOf(p.listing)
    case 'version': return p.version
    case 'chain': return p.chain.toLowerCase()
    case 'swapFee': return p.swapFee
    case 'tvl': return p.tvl
    case 'vol24': return p.vol24
    case 'vol6h': return p.vol6h
    case 'vol1h': return p.vol1h
    case 'fees24': return p.fees24
    case 'apr': return feeApr(p)
    case 'turnover': return p.tvl > 0 ? p.vol24 / p.tvl : null
    case 'txns24': return p.txns24
    case 'priceChange24': return p.priceChange24
    case 'created': return p.created || ''
    case 'address': return p.address
    default: return null
  }
}

function toCsv(rows) {
  const head = ['pool', 'version', 'chain', 'address_or_poolid', 'app_listing', 'fee_tier', 'fee_source',
    'tvl_usd', 'volume_24h_usd', 'fees_24h_usd_estimated', 'fee_apr_pct_estimated', 'vol_over_tvl',
    'txns_24h', 'created', 'flags']
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [head.join(','), ...rows.map((p) => [
    p.name, 'v' + p.version, p.chain, p.address, p.listing, p.swapFee ?? '', p.feeSource, p.tvl,
    p.vol24, p.fees24 ?? '', feeApr(p)?.toFixed(2) ?? '', p.tvl > 0 ? (p.vol24 / p.tvl).toFixed(3) : '',
    p.txns24, p.created, (p.flags || []).join(' '),
  ].map(esc).join(','))].join('\n')
}

export default function PoolTable({ data, onRefresh, refreshing }) {
  const all = data.pools
  const [sort, setSort] = useState({ k: 'tvl', d: 'desc' })
  const [q, setQ] = useState('')
  const [chain, setChain] = useState('ALL')
  const [ver, setVer] = useState('ALL')
  // Held as the text the user typed, not a number, so "2.5m" survives a re-render and
  // a half-typed value never round-trips into something they did not write.
  const [minTvl, setMinTvl] = useState('1k')
  const [maxTvl, setMaxTvl] = useState('')
  const [hideSuspect, setHideSuspect] = useState(true)
  /* Was a boolean: show everything, or show only what the app hides. The inverse — only the
     pools Uniswap will actually surface — was not expressible, so 'all' | 'out' | 'in'.
     A pool whose listing could not be determined belongs to neither side and is shown only
     under 'all', because claiming it either way would be a guess. */
  const [appOnly, setAppOnly] = useState('all')
  // Uniswap's unsupported list is its own scam/warning blocklist. Excluded by
  // default; the toggle keeps the exclusion visible rather than silent.
  const [showFlagged, setShowFlagged] = useState(false)
  const [colsOpen, setColsOpen] = useState(false)
  const [cols, setCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_KEY) || 'null')
      if (Array.isArray(saved) && saved.length) return saved
    } catch { /* ignore */ }
    return DEFAULT_COLS
  })

  useEffect(() => {
    try { localStorage.setItem(COL_KEY, JSON.stringify(cols)) } catch { /* ignore */ }
  }, [cols])

  const shown = ALL_COLS.filter((c) => c.req || cols.includes(c.k))
  const toggleCol = (k) => setCols((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))

  const chains = useMemo(() => {
    const m = new Map()
    for (const p of all) m.set(p.chain, (m.get(p.chain) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [all])

  // Ceiling comes from the data, so the track always spans exactly what exists.
  const tvlCeil = useMemo(() => {
    let m = 0
    for (const p of all) if (p.tvl > m) m = p.tvl
    return Math.max(m, TVL_FLOOR * 1000)
  }, [all])
  const posToVal = (t) =>
    t <= 0 ? 0 : +(TVL_FLOOR * Math.pow(tvlCeil / TVL_FLOOR, t / TVL_STEPS)).toPrecision(2)
  const valToPos = (v) => {
    if (!(v > TVL_FLOOR)) return 0
    if (v >= tvlCeil) return TVL_STEPS
    return Math.round(TVL_STEPS * Math.log(v / TVL_FLOOR) / Math.log(tvlCeil / TVL_FLOOR))
  }

  const loRaw = parseAmount(minTvl)
  const hiRaw = parseAmount(maxTvl)
  const badMin = Number.isNaN(loRaw)
  const badMax = Number.isNaN(hiRaw)
  // An unreadable bound is treated as no bound and flagged, rather than as zero — showing
  // everything with a visible warning beats showing nothing for no stated reason.
  const lo = badMin || loRaw == null ? -Infinity : loRaw
  const hi = badMax || hiRaw == null ? Infinity : hiRaw
  const inverted = lo > hi

  const loPos = lo === -Infinity ? 0 : Math.min(valToPos(lo), TVL_STEPS)
  const hiPos = hi === Infinity ? TVL_STEPS : Math.min(valToPos(hi), TVL_STEPS)
  // Thumbs cannot cross. Dragging either to its own end clears that bound rather than pinning
  // it to the extreme value, which is what "no minimum" / "no maximum" should mean.
  const dragLo = (t) => setMinTvl(t <= 0 ? '' : toShort(posToVal(Math.min(t, hiPos))))
  const dragHi = (t) => setMaxTvl(t >= TVL_STEPS ? '' : toShort(posToVal(Math.max(t, loPos))))

  /* Overlaid range inputs mean one thumb always sits on top of the other, and the buried one
     cannot be grabbed — worst exactly when the two meet, which is the state a user most wants
     to escape. So the nearer thumb is raised as the pointer moves. The z-order is frozen while
     a button is held, otherwise re-ordering mid-drag would hand the drag to the other thumb. */
  const [grabHi, setGrabHi] = useState(true)
  const dualRef = useRef(null)
  const aimAt = (e) => {
    if (e.buttons !== 0 || !dualRef.current) return
    const r = dualRef.current.getBoundingClientRect()
    if (!r.width) return
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * TVL_STEPS
    setGrabHi(Math.abs(t - hiPos) <= Math.abs(t - loPos))
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = all.filter(
      (p) =>
        (showFlagged || p.listing !== 'blocked') &&
        (chain === 'ALL' || p.chain === chain) &&
        (ver === 'ALL' || p.version === +ver) &&
        p.tvl >= lo && p.tvl <= hi &&
        (!hideSuspect || !(p.flags || []).includes('vol-tvl-outlier')) &&
        (appOnly === 'all' ||
          (appOnly === 'out'
            ? (p.listing === 'unlisted' || p.listing === 'blocked')
            : (p.listing === 'listed' || p.listing === 'search-only'))) &&
        (!needle || (p.name || '').toLowerCase().includes(needle) ||
          p.address?.toLowerCase().includes(needle) || p.chain.toLowerCase().includes(needle))
    )
    out.sort((a, b) => {
      const va = sortVal(a, sort.k)
      const vb = sortVal(b, sort.k)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'string') return sort.d === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sort.d === 'asc' ? va - vb : vb - va
    })
    return out
  }, [all, q, chain, ver, lo, hi, hideSuspect, appOnly, showFlagged, sort])

  const click = (k) =>
    setSort((s) => (s.k === k ? { k, d: s.d === 'asc' ? 'desc' : 'asc' }
      : { k, d: ['name', 'chain', 'address', 'listing'].includes(k) ? 'asc' : 'desc' }))

  const tvlSum = rows.reduce((a, p) => a + p.tvl, 0)
  const volSum = rows.reduce((a, p) => a + p.vol24, 0)
  const feeSum = rows.reduce((a, p) => a + (p.fees24 || 0), 0)
  const unknownFee = rows.filter((p) => p.swapFee == null).length
  const hiddenRows = rows.filter((p) => p.listing === 'unlisted' || p.listing === 'blocked')
  const hiddenTvl = hiddenRows.reduce((a, p) => a + p.tvl, 0)
  const flaggedCount = all.filter((p) => p.listing === 'blocked').length

  function downloadCsv() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `uniswap-pools-${String(data.generatedAt).slice(0, 16).replace('T', '_').replace(':', '')}Z.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cell = (p, k) => {
    switch (k) {
      case 'name': {
        const uni = uniswapUrl(p, data.chains)
        const ex = explorerUrl(p, data.chains)
        return (
          <>
            {uni
              ? <a className="pairname" href={uni} target="_blank" rel="noreferrer"
                   title="Open this pool on app.uniswap.org">{p.name || p.address}</a>
              : <span className="pairname">{p.name || p.address}</span>}
            {ex && (
              <a className="exlink" href={ex} target="_blank" rel="noreferrer"
                 title="Pool contract on the block explorer. v2/v3 only — a v4 poolId is not a contract, so an explorer cannot resolve it.">↗</a>
            )}
          </>
        )
      }
      case 'listing':
        return <span className={'lstag ' + (LISTING[p.listing]?.cls || 'dim')} title={LISTING[p.listing]?.t}>
          {LISTING[p.listing]?.label || p.listing}</span>
      case 'version': return <span className={'vtag v' + p.version}>v{p.version}</span>
      case 'chain': return <span className="chaintag">{p.short}</span>
      case 'swapFee':
        return p.swapFee != null
          ? <span className={p.flags?.includes('extreme-fee') ? 'extreme' : undefined}
                  title={p.flags?.includes('extreme-fee')
                    ? `A ${(p.swapFee * 100).toFixed(1)}% fee takes most of every trade. Real, not a parsing error — v4 permits any fee.`
                    : undefined}>{fmtFee(p.swapFee)}</span>
          : <span className="dim" title="v4 dynamic-fee or hook pool — no static tier to read">dynamic</span>
      case 'tvl': return fmtUsd(p.tvl)
      case 'vol24': return fmtUsd(p.vol24)
      case 'vol6h': return fmtUsd(p.vol6h)
      case 'vol1h': return fmtUsd(p.vol1h)
      case 'fees24': return p.fees24 != null ? fmtUsd(p.fees24) : <span className="dim">—</span>
      case 'apr': {
        const a = feeApr(p)
        return a != null ? a.toFixed(a >= 100 ? 0 : 1) + '%' : <span className="dim">—</span>
      }
      case 'turnover': {
        const t = p.tvl > 0 ? p.vol24 / p.tvl : null
        return t != null ? t.toFixed(t >= 10 ? 0 : 2) + '×' : <span className="dim">—</span>
      }
      case 'txns24': return p.txns24 ? p.txns24.toLocaleString() : <span className="dim">—</span>
      case 'priceChange24':
        return p.priceChange24 == null ? <span className="dim">—</span>
          : <span className={p.priceChange24 >= 0 ? 'pos' : 'neg'}>
              {(p.priceChange24 >= 0 ? '+' : '') + p.priceChange24.toFixed(1)}%</span>
      case 'created': return p.created || <span className="dim">—</span>
      case 'address': return <span className="mono">{p.address.slice(0, 10)}…{p.address.slice(-6)}</span>
      default: return null
    }
  }

  return (
    <>
      <div className="statstrip">
        <div><span className="sl">Pools</span><span className="sv">{rows.length.toLocaleString()}</span></div>
        <div><span className="sl">Total TVL</span><span className="sv">{fmtUsd(tvlSum)}</span></div>
        <div><span className="sl">Volume 24h</span><span className="sv">{fmtUsd(volSum)}</span></div>
        <div>
          <span className="sl">Fees 24h (est.)</span>
          <span className="sv">{fmtUsd(feeSum)}<span className="sv-sub"> · {unknownFee} unknown</span></span>
        </div>
        <div>
          <span className="sl">Not in the Uniswap app</span>
          <span className="sv" style={{ color: 'var(--amber)' }}>
            {hiddenRows.length.toLocaleString()}<span className="sv-sub"> · {fmtUsd(hiddenTvl)} TVL</span>
          </span>
        </div>
        <div>
          <span className="sl">Updated</span>
          <span className="sv sm">{fmtStamp(data.generatedAt)}
            {ago(data.generatedAt) && <span className="sv-sub"> · {ago(data.generatedAt)}</span>}</span>
        </div>
      </div>

      <div className="fbar">
        <span className="prompt">&gt;</span>
        <input className="fsearch" type="text" placeholder="search pair, chain or address…"
               value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        <span className="fgroup">
          <span className="flabel">CHAIN</span>
          <select value={chain} onChange={(e) => setChain(e.target.value)}>
            <option value="ALL">ALL</option>
            {chains.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
          </select>
        </span>
        <span className="fgroup">
          <span className="flabel">VERSION</span>
          <select value={ver} onChange={(e) => setVer(e.target.value)}>
            <option value="ALL">ALL</option><option value="2">v2</option>
            <option value="3">v3</option><option value="4">v4</option>
          </select>
        </span>
        <span className="fgroup tvlgroup"
              title="TVL range in USD. Drag the handles, or type a bound: 1000, 1k, 2.5m, 1b. The track is logarithmic because three quarters of these pools are under $100k. Either end at rest means no bound.">
          <span className="flabel">TVL</span>
          <span className="tvlbody">
            <span className="tvlrow">
              <input className={'frange' + (badMin ? ' bad' : '')} list="tvlsteps" value={minTvl}
                     placeholder="min" aria-label="minimum TVL" inputMode="decimal" spellCheck={false}
                     onChange={(e) => setMinTvl(e.target.value)} />
              <span className="fdash">–</span>
              <input className={'frange' + (badMax ? ' bad' : '')} list="tvlsteps" value={maxTvl}
                     placeholder="max" aria-label="maximum TVL" inputMode="decimal" spellCheck={false}
                     onChange={(e) => setMaxTvl(e.target.value)} />
              {(minTvl || maxTvl) && (
                <button className="fclear" title="clear the TVL range"
                        onClick={() => { setMinTvl(''); setMaxTvl('') }}>✕</button>
              )}
            </span>
            <span className="dual" ref={dualRef} onPointerMove={aimAt}>
              <span className="dtrack" />
              <span className="dfill" style={{ left: (loPos / TVL_STEPS) * 100 + '%',
                                               right: 100 - (hiPos / TVL_STEPS) * 100 + '%' }} />
              {/* Two overlaid range inputs rather than a hand-rolled drag: keyboard, focus and
                  screen-reader behaviour come for free. Only the thumbs take pointer events, so
                  the lower thumb stays grabbable underneath the upper one. */}
              <input type="range" className="dthumb" min={0} max={TVL_STEPS} value={loPos}
                     aria-label="minimum TVL slider" onChange={(e) => dragLo(+e.target.value)}
                     style={{ zIndex: grabHi ? 3 : 4 }} />
              <input type="range" className="dthumb" min={0} max={TVL_STEPS} value={hiPos}
                     aria-label="maximum TVL slider" onChange={(e) => dragHi(+e.target.value)}
                     style={{ zIndex: grabHi ? 4 : 3 }} />
            </span>
          </span>
        </span>
        {/* Suggestions, not a fixed set — the field still takes any number typed into it. */}
        <datalist id="tvlsteps">
          <option value="1k" /><option value="10k" /><option value="100k" />
          <option value="1m" /><option value="10m" /><option value="100m" /><option value="1b" />
        </datalist>
        {(badMin || badMax || inverted) && (
          <span className="rangewarn">
            {badMin || badMax
              ? `can't read "${badMin ? minTvl : maxTvl}" — try 250k or 1.5m; that side is unbounded for now`
              : 'min is above max, so nothing can match'}
          </span>
        )}
        <span className="fgroup"
              title="Filter by whether Uniswap's own interface will surface the pool. NOT IN APP is unlisted or flagged tokens — reachable only by pasting an address. IN APP ONLY is the default and extended lists. A pool whose status could not be determined appears under ALL only.">
          <span className="flabel">IN THE APP</span>
          <select value={appOnly} onChange={(e) => setAppOnly(e.target.value)}>
            <option value="all">ALL</option>
            <option value="out">NOT IN APP</option>
            <option value="in">IN APP ONLY</option>
          </select>
        </span>
      </div>

      <div className="fbar">
        <span className="colwrap">
          <button className={'fbtn' + (colsOpen ? ' on' : '')} onClick={() => setColsOpen((v) => !v)}>
            [ COLUMNS ▾ ]
          </button>
          {colsOpen && (
            <div className="colmenu">
              {ALL_COLS.map((c) => (
                <label key={c.k} className={c.req ? 'dim' : ''}>
                  <input type="checkbox" checked={c.req || cols.includes(c.k)} disabled={c.req}
                         onChange={() => toggleCol(c.k)} />
                  <span>{c.l}</span>
                </label>
              ))}
              <button className="fbtn" onClick={() => setCols(DEFAULT_COLS)}>[ RESET ]</button>
            </div>
          )}
        </span>
        <button className={'fbtn' + (hideSuspect ? ' on' : '')} onClick={() => setHideSuspect((v) => !v)}
                title="Hide pools trading more than 50× their own TVL in 24h — usually a near-empty pool, which makes the APR meaningless">
          [ {hideSuspect ? 'HIDING' : 'SHOWING'} VOL/TVL OUTLIERS ]
        </button>
        <button className={'fbtn' + (showFlagged ? ' on' : '')} onClick={() => setShowFlagged((v) => !v)}
                title="Uniswap's unsupported list is its own scam/warning blocklist. Those pools are excluded by default.">
          [ {showFlagged ? 'SHOWING' : 'HIDING'} {flaggedCount} FLAGGED ]
        </button>
        <button className="fbtn" onClick={onRefresh} disabled={refreshing}
                title="Re-fetch the data file. It is rebuilt nightly by CI, so this picks up the newest build rather than re-scraping live.">
          {refreshing ? '[ REFRESHING… ]' : '[ REFRESH ]'}
        </button>
        <button className="fbtn" onClick={downloadCsv} disabled={!rows.length}>[ CSV ]</button>
        <span className="muted tinystat">
          {rows.filter((p) => p.flags?.includes('extreme-fee')).length} charge over 1%
        </span>
      </div>

      <div className="tablewrap">
        <table className="pooltable">
          <thead>
            <tr>
              {shown.map((c) => (
                <th key={c.k} className={`${c.a === 'r' ? 'r' : ''} ${sort.k === c.k ? 'sorted' : ''}`}
                    onClick={() => click(c.k)} title={c.t}>
                  {c.l}<span className="arrow">{sort.k === c.k ? (sort.d === 'asc' ? '▲' : '▼') : '·'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 600).map((p) => (
              <tr key={p.id}>
                {shown.map((c) => (
                  <td key={c.k}
                      className={`${c.a === 'r' ? 'r' : ''} ${NUMERIC.has(c.k) ? 'num' : ''} ${c.k === 'name' ? 'pool' : ''}`}>
                    {cell(p, c.k)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 600 && (
          <div className="loading">Showing the top 600 of {rows.length.toLocaleString()} — narrow the filters or export CSV for the rest.</div>
        )}
        {!rows.length && <div className="loading">No pools match those filters.</div>}
      </div>

      <p className="foot">
        <b>What is measured, and what is estimated.</b> <b>TVL</b>, <b>volume</b> and <b>transactions</b>
        come straight from GeckoTerminal and were checked against the live API. <b>Fees</b> and
        <b> fee APR</b> are estimates: GeckoTerminal exposes no fee field, so the tier is read from the
        pool name and multiplied by volume. That is <b>gross fees generated</b>, not LP take-home.
        Pools whose fee cannot be established show <span className="dim">dynamic</span> rather than a
        fabricated number, and fees above 1% are marked <span className="extreme">in red</span> —
        impossible on v3, whose top tier is 1%, but permitted on v4 where some charge 90%+.
        {' '}<b>Links.</b> A pool name opens its page on app.uniswap.org. The{' '}
        <span className="exlink">↗</span> opens the contract on a block explorer and appears only for
        v2/v3 — a v4 pool lives inside a singleton and its identifier is a poolId, not a contract, so
        an explorer cannot resolve it.
        {' '}<b>Not in the app.</b> Each pool is checked against the <b>default</b>, <b>extended</b> and
        <b>unsupported</b> token lists Uniswap publishes.{' '}
        <span className="lstag lst-hide">UNLISTED</span> means a token is on none of them, so the pool
        is reachable only by pasting an address.{' '}
        <span className="lstag lst-block">FLAGGED</span> means a token is on Uniswap's unsupported
        list — its scam/warning blocklist — and those are excluded by default.
        {' '}<b>Coverage.</b> {data.coverageNote} Data refreshed {fmtStamp(data.generatedAt)}.
      </p>
    </>
  )
}
