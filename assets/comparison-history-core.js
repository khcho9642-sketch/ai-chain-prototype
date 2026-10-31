import { instruments } from './instruments.js'

export const MAX_COMPARISON_HISTORY_BYTES = 4_000_000
export const comparisonHistoryCatalog = catalog => catalog.filter(item => item?.chains?.some(id => Number(id) > 0))
const source = 'Yahoo Finance'
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const timestamp = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))
const fail = message => { throw new Error('비교 일봉 스냅샷 오류: ' + message) }
const ownKeys = (value, allowed, label) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(label + '에 허용하지 않은 필드')
}

export function validateComparisonHistorySnapshot(value, { catalog = instruments, now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now)
  if (!Number.isFinite(nowMs)) fail('검증 시각')
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('객체가 아님')
  ownKeys(value, ['schemaVersion', 'range', 'interval', 'generatedAt', 'source', 'quotes'], '스냅샷')
  if (value.schemaVersion !== 1 || value.range !== '3y' || value.interval !== '1d' || value.source !== source) fail('형식 또는 일봉 기간')
  if (!timestamp(value.generatedAt) || Date.parse(value.generatedAt) > nowMs + 300_000) fail('생성 시각')
  const expected = new Map(comparisonHistoryCatalog(catalog).map(item => [item.symbol, item]))
  if (!Array.isArray(value.quotes) || value.quotes.length > expected.size) fail('AI 피어 목록')
  const seen = new Set()
  for (const quote of value.quotes) {
    if (!quote || typeof quote !== 'object' || Array.isArray(quote)) fail('종목 객체')
    ownKeys(quote, ['symbol', 'name', 'currency', 'timezone', 'range', 'interval', 'source', 'sourceUrl', 'fetchedAt', 'status', 'bars', 'error'], '종목')
    if (!expected.has(quote.symbol) || seen.has(quote.symbol)) fail('알 수 없거나 중복된 종목')
    seen.add(quote.symbol)
    if (quote.name !== expected.get(quote.symbol).name) fail('종목 이름')
    if (quote.range !== '3y' || quote.interval !== '1d' || quote.source !== source) fail('종목의 일봉 기간 또는 출처')
    if (quote.sourceUrl !== 'https://finance.yahoo.com/quote/' + encodeURIComponent(quote.symbol) + '/') fail('출처 링크')
    if (!['ok', 'stale', 'error'].includes(quote.status)) fail('수집 상태')
    if (!Array.isArray(quote.bars) || quote.bars.length > 1_200) fail('일봉 배열')
    if (quote.status === 'error') {
      if (quote.bars.length || quote.fetchedAt !== null || quote.currency !== null || quote.timezone !== null) fail('실패 상태의 관측값')
    } else {
      if (quote.bars.length < 2 || !timestamp(quote.fetchedAt) || Date.parse(quote.fetchedAt) > nowMs + 300_000) fail('종가 또는 실제 수집 시각')
      if (typeof quote.currency !== 'string' || !/^[A-Za-z]{3}$/.test(quote.currency)) fail('통화')
      if (typeof quote.timezone !== 'string' || !quote.timezone) fail('거래소 시간대')
      try { new Intl.DateTimeFormat('en', { timeZone: quote.timezone }).format() } catch { fail('거래소 시간대') }
    }
    if (quote.status === 'ok' ? quote.error !== null : typeof quote.error !== 'string' || !quote.error || quote.error.length > 500) fail('실패 사유')
    let prior = 0
    for (const bar of quote.bars) {
      if (!bar || typeof bar !== 'object' || Array.isArray(bar)) fail('종가 객체')
      ownKeys(bar, ['time', 'close'], '종가')
      if (!Number.isInteger(bar.time) || !positive(bar.time) || !positive(bar.close) || bar.time <= prior || bar.time * 1000 > nowMs + 300_000) fail('종가·시각·정렬')
      prior = bar.time
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength >= MAX_COMPARISON_HISTORY_BYTES) fail('공개 응답 크기 제한')
  return value
}
