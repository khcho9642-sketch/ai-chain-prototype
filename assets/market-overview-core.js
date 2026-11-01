// Collected current price versus previous close, without a new provider request.
// The first configured chain is a display group, not a factual primary exposure.
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const dateMs = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN
const observationMs = value => finite(value) && value > 0 ? value * 1000 : dateMs(value)
const text = value => typeof value === 'string' && value.trim() ? value : null
const chainId = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null

function describeChains(chains, instruments) {
  const groups = new Map()
  for (const item of Array.isArray(chains) ? chains : []) {
    const id = chainId(item?.id)
    if (id && !groups.has(id)) groups.set(id, { id, name: text(item.name) || `${id}번 고리`, color: text(item.color) })
  }
  if (!groups.size) {
    for (const item of instruments) for (const value of Array.isArray(item?.chains) ? item.chains : []) {
      const id = chainId(value)
      if (id && !groups.has(id)) groups.set(id, { id, name: `${id}번 고리`, color: null })
    }
  }
  return groups
}

function summarize(rows) {
  const valid = rows.filter(row => row.valid)
  return {
    totalCount: rows.length, validCount: valid.length, missingCount: rows.length - valid.length,
    staleCount: rows.filter(row => row.status === 'stale').length,
    errorCount: rows.filter(row => row.status === 'error').length,
    noQuoteCount: rows.filter(row => row.status === 'missing').length,
    advancers: valid.filter(row => row.changePercent > 0).length,
    decliners: valid.filter(row => row.changePercent < 0).length,
    unchanged: valid.filter(row => row.changePercent === 0).length,
    averageChangePercent: valid.length ? valid.reduce((mean, row) => mean + row.changePercent / valid.length, 0) : null,
  }
}

function describeRow(item, quote, nowMs) {
  const row = {
    symbol: item.symbol, name: item.name, chains: [...item.chains], primaryChain: item.chains[0],
    price: positive(quote?.price) ? quote.price : null, currency: text(quote?.currency),
    marketTime: finite(quote?.marketTime) ? quote.marketTime : text(quote?.marketTime), fetchedAt: text(quote?.fetchedAt), timezone: text(quote?.timezone),
    source: text(quote?.source), sourceUrl: text(quote?.sourceUrl),
    status: quote ? text(quote.status) || 'unknown' : 'missing',
    changePercent: null, valid: false, reason: null,
  }
  const fetched = dateMs(row.fetchedAt), observed = observationMs(row.marketTime)
  if (!quote) row.reason = '수집 시세 없음'
  else if (row.status !== 'ok') row.reason = row.status === 'stale' ? '이전 수집값·조회 실패' : '정상 수집 상태가 아님'
  else if (!Number.isFinite(nowMs)) row.reason = '비교 기준 시각 오류'
  else if (!Number.isFinite(fetched) || !Number.isFinite(observed)) row.reason = '수집·관측 시각 없음 또는 오류'
  else if (fetched > nowMs || observed > nowMs) row.reason = '미래 수집·관측 시각'
  else if (!positive(quote.price)) row.reason = '정상 가격 없음'
  else if (!finite(quote.changePercent)) row.reason = '전일 대비 등락률 없음 또는 오류'
  else { row.changePercent = quote.changePercent; row.valid = true }
  return row
}

/**
 * Only known AI catalog symbols participate, once each. Secondary chain membership
 * is respected by filters and group means; each tile uses its first display group.
 * Groups can overlap, while breadth and movers count each catalog symbol once.
 * Equal-sized tiles and equal-weight means do not represent market-cap weights.
 * MissingCount counts all excluded rows. Explicit stale/error quotes retain their
 * observation data but cannot affect colors, breadth, movers or group rankings.
 * Dates may differ by exchange and current sessions may still be in progress.
 */
export function buildMarketOverview({ quotes = [], instruments = [], chains = [], chain = 0, now = Date.now() } = {}) {
  const catalogInput = Array.isArray(instruments) ? instruments : []
  const chainMap = describeChains(chains, catalogInput)
  const catalog = new Map()
  for (const item of catalogInput) {
    const symbol = text(item?.symbol)
    if (!symbol || catalog.has(symbol)) continue
    const memberships = [...new Set((Array.isArray(item.chains) ? item.chains : []).map(chainId).filter(id => id && chainMap.has(id)))]
    if (memberships.length) catalog.set(symbol, { symbol, name: text(item.name) || symbol, chains: memberships })
  }
  const latest = new Map()
  for (const quote of Array.isArray(quotes) ? quotes : []) {
    if (!quote || !catalog.has(quote.symbol)) continue
    const previous = latest.get(quote.symbol)
    const fetched = dateMs(quote.fetchedAt), priorFetched = dateMs(previous?.fetchedAt)
    if (!previous || (Number.isFinite(fetched) ? fetched : -Infinity) >= (Number.isFinite(priorFetched) ? priorFetched : -Infinity)) latest.set(quote.symbol, quote)
  }
  const selected = chainMap.has(Number(chain)) ? Number(chain) : 0
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now)
  const rows = [...catalog.values()].filter(item => !selected || item.chains.includes(selected))
    .map(item => describeRow(item, latest.get(item.symbol), nowMs))
  const groups = [...chainMap.values()].map(group => {
    const members = rows.filter(row => row.chains.includes(group.id))
    const summary = summarize(members)
    return { ...group, rows: members, ...summary, rankEligible: summary.validCount >= 3 && finite(summary.averageChangePercent) }
  })
  const byChange = (a, b) => b.changePercent - a.changePercent || a.symbol.localeCompare(b.symbol, 'en')
  const valid = rows.filter(row => row.valid)
  return {
    chain: selected, totalCount: catalog.size, displayedCount: rows.length, rows, groups,
    breadth: summarize(rows),
    gainers: valid.filter(row => row.changePercent > 0).sort(byChange).slice(0, 5),
    losers: valid.filter(row => row.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent || a.symbol.localeCompare(b.symbol, 'en')).slice(0, 5),
    groupRanking: groups.filter(group => group.rankEligible).sort((a, b) => b.averageChangePercent - a.averageChangePercent || a.id - b.id),
  }
}
