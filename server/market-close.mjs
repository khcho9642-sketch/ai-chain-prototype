const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const positive = value => number(value) !== null && value > 0
const symbolPattern = /^[A-Z0-9^=.-]{1,24}$/i
const failure = (message, status) => Object.assign(new Error(message), { status })

function timeMs(value) {
  const actual = typeof value === 'function' ? value() : value
  const milliseconds = actual instanceof Date ? actual.getTime() : typeof actual === 'string' ? Date.parse(actual) : Number(actual)
  if (!Number.isFinite(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) throw new RangeError('종가 판정 시각이 올바르지 않습니다.')
  return milliseconds
}

function dateFormatter(timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) throw new Error('거래소 시간대가 없습니다.')
  let formatter
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }) }
  catch { throw new Error('거래소 시간대가 올바르지 않습니다.') }
  return seconds => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  }
}

/**
 * Daily timestamps identify the session's opening date, not a completed candle.
 * Past local dates are complete unless metadata identifies a still-open
 * overnight session. Today's candle additionally needs a matching ended regular
 * session and a delay allowance. Missing metadata never promotes today's candle.
 */
export function normalizeDailyClose(result, { now = Date.now(), graceMinutes = 20, range = '1y' } = {}) {
  const nowMs = timeMs(now), nowSeconds = nowMs / 1000
  if (!['1y', '3y'].includes(range)) throw new RangeError('일별 종가 조회 기간이 올바르지 않습니다.')
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 1440) throw new RangeError('종가 확정 대기 시간이 올바르지 않습니다.')
  const meta = result?.meta
  if (!meta || typeof meta.symbol !== 'string' || !symbolPattern.test(meta.symbol)) throw new Error('종목 코드가 없거나 올바르지 않습니다.')
  if (meta.dataGranularity && meta.dataGranularity !== '1d') throw new Error('일봉 종가 응답이 아닙니다.')
  const localDate = dateFormatter(meta.exchangeTimezoneName)
  const today = localDate(nowSeconds)
  const regular = meta.currentTradingPeriod?.regular
  const validPeriod = Number.isInteger(regular?.start) && Number.isInteger(regular?.end)
    && regular.start > 0 && regular.end > regular.start && regular.end - regular.start <= 86400
  const periodDate = validPeriod ? localDate(regular.start) : null
  const periodComplete = validPeriod && nowSeconds >= regular.end + graceMinutes * 60
  const rawQuote = result?.indicators?.quote?.[0] || {}
  const points = new Map()
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : []
  // Later observations for the same exchange-local date take precedence.
  for (const [index, time] of timestamps.entries()) {
    const close = rawQuote.close?.[index]
    if (!Number.isInteger(time) || time <= 0 || time > nowSeconds || !positive(close)) continue
    const date = localDate(time)
    if (date === periodDate && !periodComplete) continue
    if (date > today || (date === today && !(periodComplete && periodDate === date))) continue
    const old = points.get(date)
    if (old && old.time > time) continue
    points.set(date, {
      time, open: number(rawQuote.open?.[index]), high: number(rawQuote.high?.[index]),
      low: number(rawQuote.low?.[index]), close, volume: number(rawQuote.volume?.[index]),
    })
  }
  const bars = [...points.values()].sort((a, b) => a.time - b.time)
  const latest = bars.at(-1), prior = bars.at(-2)
  if (!latest) throw new Error('확정된 일별 종가가 없습니다.')
  const closeDate = localDate(latest.time)
  const price = latest.close, previousClose = prior?.close ?? null
  const change = previousClose !== null ? price - previousClose : null
  const symbol = meta.symbol.toUpperCase()
  return {
    symbol, name: meta.longName || meta.shortName || symbol,
    currency: typeof meta.currency === 'string' ? meta.currency : '',
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    price, previousClose, change, changePercent: previousClose !== null ? change / previousClose * 100 : null,
    open: latest.open, high: latest.high, low: latest.low, volume: latest.volume,
    yearHigh: number(meta.fiftyTwoWeekHigh), yearLow: number(meta.fiftyTwoWeekLow),
    closeDate, previousCloseDate: prior ? localDate(prior.time) : null,
    priceBasis: 'previous-completed-session',
    // Preserve the true candle timestamp; do not present it as the closing time.
    marketTime: latest.time, marketTimeBasis: 'daily-bar-start',
    sessionCloseTime: periodComplete && periodDate === closeDate ? regular.end : null,
    timezone: meta.exchangeTimezoneName,
    source: 'Yahoo Finance', sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,
    delayed: true, status: 'ok', range, interval: '1d', bars,
    events: result.events || {}, fetchedAt: new Date(nowMs).toISOString(),
  }
}

// This collector-only service intentionally never requests intraday charts.
// Existing /api/chart callers retain their separate live-chart behavior.
export function createDailyCloseService({
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000,
  ttl = 60_000, maxEntries = 1000, graceMinutes = 20,
} = {}) {
  const cache = new Map(), pending = new Map()
  return async function dailyClose(symbol, range = '1y') {
    if (typeof symbol !== 'string' || !symbolPattern.test(symbol) || !['1y', '3y'].includes(range)) throw failure('종목 코드 또는 일별 종가 조회 기간이 올바르지 않습니다.', 400)
    symbol = symbol.toUpperCase()
    const key = `${symbol}:${range}`
    const attemptMs = timeMs(now)
    if (cache.get(key)?.expires > attemptMs) return cache.get(key).value
    if (pending.has(key)) return pending.get(key)
    const request = (async () => {
      let last
      for (const host of hosts) {
        try {
          const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`)
          const params = new URLSearchParams({ interval: '1d', events: 'div,splits' })
          const end = new Date(attemptMs), start = new Date(end)
          const bufferDays = range === '3y' ? 14 : 15
          if (range === '3y') start.setUTCFullYear(start.getUTCFullYear() - 3)
          else start.setUTCDate(start.getUTCDate() - 365)
          // A provider's exact one-year window can start after the completed
          // session's year-ago baseline. Keep a short session/holiday buffer;
          // the requested comparison range remains one year.
          start.setUTCDate(start.getUTCDate() - bufferDays)
          const period1 = Math.floor(start.getTime() / 1000), period2 = Math.floor(end.getTime() / 1000)
          params.set('period1', String(period1))
          params.set('period2', String(period2))
          url.search = params.toString()
          const response = await fetchImpl(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!response.ok) throw new Error(`제공처 HTTP ${response.status}`)
          const body = await response.json(), result = body.chart?.result?.[0]
          if (!result?.meta) throw new Error(body.chart?.error?.description || '조회 가능한 일별 종가가 없습니다.')
          if (typeof result.meta.symbol !== 'string' || result.meta.symbol.toUpperCase() !== symbol) throw new Error('요청 종목과 제공처 종목이 일치하지 않습니다.')
          const value = normalizeDailyClose(result, { now: timeMs(now), graceMinutes, range })
          value.historyWindow = { requestedRange: range, from: new Date(period1 * 1000).toISOString(),
            to: new Date(period2 * 1000).toISOString(), bufferDays }
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value)
          cache.set(key, { expires: timeMs(now) + ttl, value })
          return value
        } catch (error) { last = error }
      }
      const reason = last?.name === 'TimeoutError' || last?.name === 'AbortError' ? '제공처 응답 시간 초과' : last?.message || '제공처 응답 없음'
      throw failure(`실제 종가 조회 실패: ${reason}`, 502)
    })()
    pending.set(key, request)
    try { return await request } finally { pending.delete(key) }
  }
}

export const dailyClose = createDailyCloseService()
