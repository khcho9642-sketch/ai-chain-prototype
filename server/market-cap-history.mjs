// Provider-dated capitalization observations. Neither current quote caps nor
// sparse share counts are converted into invented daily historical values.
const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
const seriesNames = ['trailingMarketCap', 'monthlyMarketCap', 'quarterlyMarketCap', 'annualMarketCap']
const validSymbol = value => typeof value === 'string' && /^[A-Z0-9^=.-]{1,24}$/i.test(value)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const positive = value => Number.isFinite(value) && value > 0
const fail = message => Object.assign(new Error(message), { status: 502 })
const source = 'Yahoo Finance'

export function normalizeHistoricalMarketCaps(body, { symbol, startDate, endDate, observedAt } = {}) {
  if (!validSymbol(symbol) || !validDate(startDate) || !validDate(endDate) || startDate > endDate
    || !Number.isFinite(Date.parse(observedAt))) throw new TypeError('시총 이력 조회 범위가 올바르지 않습니다.')
  symbol = symbol.toUpperCase()
  if (!body?.timeseries || body.timeseries.error || !Array.isArray(body.timeseries.result)) throw fail('과거 시총 응답 형식 오류')
  const byDate = new Map(), conflicts = new Set()
  const sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics/`
  for (const row of body.timeseries.result) {
    if (!row || typeof row !== 'object') continue
    const type = row.meta?.type?.[0]
    if (!seriesNames.includes(type)) continue
    if (row.meta?.symbol?.length !== 1 || row.meta.symbol[0]?.toUpperCase() !== symbol) throw fail('요청 종목과 과거 시총 종목이 일치하지 않습니다.')
    if (!Array.isArray(row[type])) continue
    for (const point of row[type]) {
      const date = point?.asOfDate, value = point?.reportedValue?.raw, currency = point?.currencyCode
      // The provider labels the capitalization currency explicitly. Never infer
      // it from the listing's share-price currency or issuer country.
      if (!validDate(date) || date < startDate || date > endDate || !positive(value)
        || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || ['GBX', 'ILA'].includes(currency)) continue
      const previous = byDate.get(date)
      if (previous && (previous.value !== value || previous.currency !== currency)) {
        conflicts.add(date)
        continue
      }
      if (!previous || seriesNames.indexOf(type) < seriesNames.indexOf(previous.series)) {
        byDate.set(date, { date, value, currency, basis: 'provider-dated', series: type,
          source, sourceUrl, observedAt })
      }
    }
  }
  for (const date of conflicts) byDate.delete(date)
  const observations = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  return {
    symbol, source, sourceUrl, fetchedAt: observedAt, status: observations.length ? 'ok' : 'unavailable',
    coverage: 'dated-observations-only', startDate, endDate, observations,
    conflictingDates: [...conflicts].sort(),
    error: observations.length ? null : '기간 시작일과 일치하는 과거 시총은 별도로 확인해야 합니다.',
  }
}

export function createHistoricalMarketCapService({
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10_000, ttl = 6 * 3600_000, maxEntries = 100,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(ttl) || ttl < 0
    || !Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('시총 이력 수집 설정 오류')
  const cache = new Map(), pending = new Map()
  return async function historicalMarketCap(symbol, { startDate, endDate } = {}) {
    if (!validSymbol(symbol)) throw new TypeError('종목 코드가 올바르지 않습니다.')
    symbol = symbol.toUpperCase()
    const nowMs = Number(now())
    if (!Number.isFinite(nowMs)) throw new TypeError('시총 이력 수집 시각 오류')
    const currentDate = new Date(nowMs).toISOString().slice(0, 10)
    if (!endDate) endDate = currentDate
    if (!startDate) {
      const start = new Date(nowMs)
      start.setUTCFullYear(start.getUTCFullYear() - 2)
      start.setUTCDate(start.getUTCDate() - 14)
      startDate = start.toISOString().slice(0, 10)
    }
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate > currentDate) throw new TypeError('과거 시총 조회 날짜가 올바르지 않습니다.')
    const key = `${symbol}:${startDate}:${endDate}`
    if (cache.get(key)?.expires > nowMs) return cache.get(key).value
    if (pending.has(key)) return pending.get(key)
    const request = (async () => {
      let last
      for (const host of hosts) {
        try {
          const url = new URL(`https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`)
          url.search = new URLSearchParams({ symbol, type: seriesNames.join(','),
            period1: String(Date.parse(startDate + 'T00:00:00Z') / 1000),
            period2: String(Date.parse(endDate + 'T00:00:00Z') / 1000 + 86400), merge: 'false' }).toString()
          const response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
          if (!response.ok) throw new Error(`과거 시총 제공처 HTTP ${response.status}`)
          const value = normalizeHistoricalMarketCaps(await response.json(), { symbol, startDate, endDate,
            observedAt: new Date(Number(now())).toISOString() })
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value)
          cache.set(key, { value, expires: Number(now()) + ttl })
          return value
        } catch (error) { last = error }
      }
      const reason = ['TimeoutError', 'AbortError'].includes(last?.name) ? '제공처 응답 시간 초과' : last?.message || '과거 시총 미제공'
      throw fail(`과거 시총 조회 실패: ${reason}`)
    })()
    pending.set(key, request)
    try { return await request } finally { pending.delete(key) }
  }
}

export const historicalMarketCap = createHistoricalMarketCapService()
