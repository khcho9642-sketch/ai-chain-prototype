// This module only projects the stored snapshot. It never requests prices or
// decides whether a market is currently open.
export const INDEX_STRIP_INDICES = Object.freeze([
  { symbol: '^IXIC', name: '나스닥', flag: '🇺🇸', ai: false },
  { symbol: '^GSPC', name: 'S&P 500', flag: '🇺🇸', ai: false },
  { symbol: '^KS11', name: '코스피', flag: '🇰🇷', ai: false },
  { symbol: '688825.SS', name: 'CXMT', flag: '🇨🇳', ai: true, currency: 'CNY' },
  { symbol: '^KQ11', name: '코스닥', flag: '🇰🇷', ai: false },
].map(Object.freeze))

const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const timestamp = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))
  ? Date.parse(value) : NaN
const savedString = value => typeof value === 'string' && value.trim() ? value : null
const savedTimestamp = value => Number.isFinite(timestamp(value)) ? value : null

function milliseconds(value) {
  const result = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value)
  if (!Number.isFinite(result) || !Number.isFinite(new Date(result).getTime())) throw new RangeError('지수 기준 시각이 올바르지 않습니다.')
  return result
}

function localDate(time, timezone) {
  if (!Number.isFinite(time) || typeof timezone !== 'string' || !timezone.trim()) return null
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  } catch { return null }
}

function sourceUrl(value, source, symbol) {
  if (typeof value === 'string') {
    try {
      const parsed = new URL(value)
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return value
    } catch {}
  }
  return source === 'Yahoo Finance' ? `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/` : null
}

function emptyCard(identity, snapshot, quote) {
  const source = savedString(quote?.source) || savedString(snapshot?.source)
  return {
    ...identity,
    available: false, closeConfirmed: false,
    price: null, previousClose: null, change: null, changePercent: null,
    closeDate: null, previousCloseDate: null,
    timezone: savedString(quote?.timezone),
    source, sourceUrl: sourceUrl(quote?.sourceUrl, source, identity.symbol),
    fetchedAt: savedTimestamp(quote?.fetchedAt),
    lastAttemptAt: savedTimestamp(quote?.lastAttemptAt),
    snapshotGeneratedAt: savedTimestamp(snapshot?.generatedAt),
    collectionStatus: savedString(quote?.status),
    status: 'unavailable', stale: false,
    error: savedString(quote?.error), reason: '저장된 종가 자료가 없습니다.',
    priceBasis: null,
  }
}

function returnsFrom(price, previousClose) {
  if (!positive(previousClose)) return { previousClose: null, change: null, changePercent: null }
  const change = price - previousClose
  const changePercent = change / previousClose * 100
  // Extremely small denominators must not leak Infinity into presentation.
  return finite(change) && finite(changePercent)
    ? { previousClose, change, changePercent }
    : { previousClose: null, change: null, changePercent: null }
}

function projectQuote(identity, snapshot, quote, nowMs) {
  const card = emptyCard(identity, snapshot, quote)
  if (!quote) return card
  if (['error', 'unavailable'].includes(quote.status)) return { ...card, reason: '저장된 종가를 확인할 수 없습니다.' }
  const capturedAt = timestamp(quote.fetchedAt) || timestamp(snapshot?.generatedAt)
  const capturedDate = localDate(capturedAt, quote.timezone)
  const today = localDate(nowMs, quote.timezone)
  const staleAfterHours = positive(snapshot?.staleAfterHours) ? snapshot.staleAfterHours : 96
  const stale = quote.status === 'stale' || Number.isFinite(capturedAt) && nowMs - capturedAt > staleAfterHours * 3600000
  const unconfirmed = reason => ({ ...card, status: 'unconfirmed', stale, reason })
  if (!today || !capturedDate) return unconfirmed('종가의 현지 시간대 또는 수집 시각을 확인할 수 없습니다.')
  if (capturedAt > nowMs + 300000) return unconfirmed('저장된 수집 시각이 기준 시각보다 미래입니다.')

  if (quote.priceBasis === 'previous-completed-session') {
    if (!positive(quote.price) || !validDate(quote.closeDate) || quote.closeDate > today || quote.closeDate > capturedDate) {
      return unconfirmed('확정 종가의 값 또는 기준일을 확인할 수 없습니다.')
    }
    const previousDate = validDate(quote.previousCloseDate) && quote.previousCloseDate < quote.closeDate ? quote.previousCloseDate : null
    const invalidPreviousDate = quote.previousCloseDate != null && !previousDate
    return {
      ...card, available: true, closeConfirmed: true, price: quote.price,
      ...returnsFrom(quote.price, invalidPreviousDate ? null : quote.previousClose),
      closeDate: quote.closeDate, previousCloseDate: previousDate,
      status: stale ? 'stale' : 'ok', stale, reason: null,
      priceBasis: 'previous-completed-session',
    }
  }

  // An old intraday value does not become a closing price merely by ageing.
  // Explicit year-history arrays are daily series; otherwise the source must
  // identify bars as daily. The capture day's legacy candle stays excluded.
  const explicit = Array.isArray(quote.bars1year) ? quote.bars1year : quote.histories?.['1y']
  const bars = Array.isArray(explicit) ? explicit : quote.interval === '1d' ? quote.bars : null
  if (!Array.isArray(bars)) return unconfirmed('저장된 확정 일별 종가가 없습니다.')
  const points = new Map()
  for (const bar of bars) {
    if (!Number.isInteger(bar?.time) || bar.time <= 0 || !positive(bar.close)
      || bar.time * 1000 > Math.min(nowMs, capturedAt)) continue
    const date = localDate(bar.time * 1000, quote.timezone)
    if (!date || date >= capturedDate || date >= today) continue
    const previous = points.get(date)
    if (!previous || bar.time > previous.time) points.set(date, { date, time: bar.time, close: bar.close })
  }
  const completed = [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
  const latest = completed.at(-1), previous = completed.at(-2)
  if (!latest) return unconfirmed('수집일 이전의 확정 일별 종가가 없습니다.')
  return {
    ...card, available: true, closeConfirmed: true, price: latest.close,
    ...returnsFrom(latest.close, previous?.close),
    closeDate: latest.date, previousCloseDate: previous?.date || null,
    status: stale ? 'stale' : 'ok', stale, reason: null,
    priceBasis: 'derived-completed-daily-bars',
  }
}

/**
 * Fixed five-card projection with no network or timers.
 *
 * Cards always retain identity, source/sourceUrl, original fetchedAt,
 * lastAttemptAt, snapshotGeneratedAt, collectionStatus, error and a reason for
 * unavailable/unconfirmed values. Available cards expose a positive stored
 * price, closeDate, timezone, previousClose/change/changePercent (or null),
 * closeConfirmed:true and a priceBasis describing their confirmation route.
 * status is ok/stale/unavailable/unconfirmed; neither status nor marketTime
 * denotes a currently open/closed market. Duplicate entries prefer usable
 * closes and then the latest valid source collection timestamp.
 */
export function buildIndexCards(snapshot, { now = Date.now() } = {}) {
  const nowMs = milliseconds(now)
  const quotes = Array.isArray(snapshot?.quotes) ? snapshot.quotes : []
  return INDEX_STRIP_INDICES.map(identity => {
    const candidates = quotes.filter(quote => typeof quote?.symbol === 'string' && quote.symbol.toUpperCase() === identity.symbol)
      .map(quote => projectQuote(identity, snapshot, quote, nowMs))
    candidates.sort((a, b) => Number(b.available) - Number(a.available)
      || (timestamp(b.fetchedAt) || 0) - (timestamp(a.fetchedAt) || 0))
    return candidates[0] || emptyCard(identity, snapshot, null)
  })
}
