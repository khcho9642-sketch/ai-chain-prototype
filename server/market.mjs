export const ranges = Object.freeze({ '1d': '5m', '5d': '30m', '1mo': '1d', '3mo': '1d', '1y': '1d', '3y': '1d', '5y': '1wk' })
const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
const number = value => Number.isFinite(value) ? value : null
const failure = (message, status) => Object.assign(new Error(message), { status })

export function normalize(result, range = '1d', dailyResult = range === '1d' ? result : null) {
  const meta = dailyResult?.meta || result?.meta || {}
  const historyMeta = result?.meta || {}
  const quote = result?.indicators?.quote?.[0] || {}
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : []
  const bars = timestamps.map((time, index) => ({
    time: number(time), open: number(quote.open?.[index]), high: number(quote.high?.[index]),
    low: number(quote.low?.[index]), close: number(quote.close?.[index]), volume: number(quote.volume?.[index]),
  })).filter(bar => bar.time !== null && bar.close !== null)
  const price = number(meta.regularMarketPrice)
  // For long ranges chartPreviousClose is a historical baseline, not yesterday's close.
  // Only the separately requested one-day metadata may supply that field.
  const previousClose = number(meta.previousClose)
    ?? (price !== null && Number.isFinite(meta.fulldayChange) ? price - meta.fulldayChange : null)
    ?? (dailyResult ? number(dailyResult.meta?.chartPreviousClose) : null)
  const change = price !== null && previousClose !== null ? price - previousClose : null
  const dailyOpens = dailyResult?.indicators?.quote?.[0]?.open
  const dailyOpen = Array.isArray(dailyOpens) ? dailyOpens.find(Number.isFinite) : undefined
  const symbol = meta.symbol || historyMeta.symbol || ''
  return {
    symbol, name: meta.longName || meta.shortName || historyMeta.longName || historyMeta.shortName || symbol,
    currency: meta.currency || '', exchange: meta.fullExchangeName || meta.exchangeName || '',
    price, previousClose, change, changePercent: change !== null && previousClose !== 0 ? change / previousClose * 100 : null,
    open: number(meta.regularMarketOpen) ?? number(dailyOpen), high: number(meta.regularMarketDayHigh),
    low: number(meta.regularMarketDayLow), volume: number(meta.regularMarketVolume),
    yearHigh: number(meta.fiftyTwoWeekHigh), yearLow: number(meta.fiftyTwoWeekLow),
    marketTime: number(meta.regularMarketTime), timezone: meta.exchangeTimezoneName || 'UTC',
    source: 'Yahoo Finance', sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,
    delayed: true, status: 'ok', range, interval: ranges[range], bars, events: result?.events || {},
  }
}

// In-memory caches are best-effort optimizations. Correctness never relies on a warm instance.
export function createChartService({ fetchImpl = globalThis.fetch, now = Date.now, ttl = 60_000, timeoutMs = 8_000, maxEntries = 200 } = {}) {
  const cache = new Map(), pending = new Map(), rawCache = new Map(), rawPending = new Map()
  function remember(map, key, value) {
    if (map.size >= maxEntries) map.delete(map.keys().next().value)
    map.set(key, { expires: now() + ttl, value })
    return value
  }
  async function loadRange(symbol, range) {
    const key = `${symbol}:${range}`
    if (rawCache.get(key)?.expires > now()) return rawCache.get(key).value
    if (rawPending.has(key)) return rawPending.get(key)
    const request = (async () => {
      let last
      for (const host of hosts) {
        try {
          const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`)
          const params = new URLSearchParams({ interval: ranges[range], events: 'div,splits' })
          if (range === '3y') {
            // Request exact daily periods; standard Yahoo ranges omit 3y.
            const end = new Date(now())
            const start = new Date(end)
            start.setUTCFullYear(start.getUTCFullYear() - 3)
            start.setUTCDate(start.getUTCDate() - 14)
            params.set('period1', String(Math.floor(start.getTime() / 1000)))
            params.set('period2', String(Math.floor(end.getTime() / 1000)))
          } else params.set('range', range)
          url.search = params.toString()
          const response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
          if (!response.ok) throw new Error(`제공처 HTTP ${response.status}`)
          const body = await response.json()
          const result = body.chart?.result?.[0]
          if (!result?.meta) {
            throw new Error(body.chart?.error?.description || '조회 가능한 시세가 없습니다.')
          }
          // Closed intraday sessions (especially futures on weekends) legitimately
          // return quote metadata without timestamps. Keep those bars unavailable.
          const closedIntraday = range === '1d' && (result.timestamp == null || (Array.isArray(result.timestamp) && !result.timestamp.length))
          const hasBars = Array.isArray(result.timestamp) && result.timestamp.some((time, index) => Number.isFinite(time) && Number.isFinite(result.indicators?.quote?.[0]?.close?.[index]))
          if (!Number.isFinite(result.meta.regularMarketPrice) || !Number.isFinite(result.meta.regularMarketTime)
            || (!closedIntraday && !hasBars)) {
            throw new Error('필수 시세 데이터가 없습니다.')
          }
          return remember(rawCache, key, result)
        } catch (error) { last = error }
      }
      const reason = last?.name === 'TimeoutError' || last?.name === 'AbortError' ? '제공처 응답 시간 초과' : last?.message || '제공처 응답 없음'
      throw failure(`실제 시세 조회 실패: ${reason}`, 502)
    })()
    rawPending.set(key, request)
    try { return await request } finally { rawPending.delete(key) }
  }
  return async function chart(symbol, range = '1d') {
    if (typeof symbol !== 'string' || !/^[A-Z0-9^=.-]{1,24}$/i.test(symbol) || !Object.hasOwn(ranges, range)) {
      throw failure('종목 코드 또는 조회 기간이 올바르지 않습니다.', 400)
    }
    symbol = symbol.toUpperCase()
    const key = `${symbol}:${range}`
    if (cache.get(key)?.expires > now()) return cache.get(key).value
    if (pending.has(key)) return pending.get(key)
    const request = (async () => {
      const [history, daily] = await Promise.all([loadRange(symbol, range), loadRange(symbol, '1d')])
      const value = { ...normalize(history, range, daily), fetchedAt: new Date(now()).toISOString() }
      return remember(cache, key, value)
    })()
    pending.set(key, request)
    try { return await request } finally { pending.delete(key) }
  }
}

export const chart = createChartService()

export async function middleware(req, res, next = () => {}, chartService = chart) {
  let url
  try { url = new URL(req.url, 'http://localhost') }
  catch { res.statusCode = 400; return res.end('잘못된 요청입니다.') }
  if (!url.pathname.startsWith('/api/')) return next()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  try {
    if (url.pathname !== '/api/chart') throw failure('없는 API입니다.', 404)
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); throw failure('GET 요청만 지원합니다.', 405) }
    if (url.searchParams.getAll('symbol').length !== 1 || url.searchParams.getAll('range').length > 1) {
      throw failure('종목 코드와 조회 기간은 한 번씩 지정해 주세요.', 400)
    }
    const result = await chartService(url.searchParams.get('symbol'), url.searchParams.get('range') || '1d')
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (error) {
    res.statusCode = [400, 404, 405, 502].includes(error.status) ? error.status : 500
    res.end(JSON.stringify({ error: error.status ? error.message : '시세 조회 중 오류가 발생했습니다.' }))
  }
}
