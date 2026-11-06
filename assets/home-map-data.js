import { COMPANIES } from './home-map-core.js'

export const MAP_PERIODS = Object.freeze({ '1d': 1, '1w': 7, '1m': 30, '1y': 365 })
const DAY = 86400000
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const stamp = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const utcDate = value => new Date(value).toISOString().slice(0, 10)
const gap = (later, earlier) => (Date.parse(later + 'T00:00:00Z') - Date.parse(earlier + 'T00:00:00Z')) / DAY
const shift = (date, days) => utcDate(Date.parse(date + 'T00:00:00Z') - days * DAY)
const formatters = new Map()

function dateAt(time, timezone) {
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime()) || typeof timezone !== 'string' || !timezone) return null
  try {
    if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}))
    const parts = Object.fromEntries(formatters.get(timezone).formatToParts(new Date(time)).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  } catch { return null }
}

function calendarKey(symbol, quote) {
  if (/\.(KS|KQ)$/.test(symbol) || quote.timezone === 'Asia/Seoul') return 'KR'
  if (quote.timezone === 'America/New_York') return 'US'
  return quote.timezone
}

function readSeries(symbol, quote, snapshot, nowMs) {
  if (!quote || quote.status === 'error' || quote.interval && quote.interval !== '1d' || !Array.isArray(quote.bars)) return null
  const captured = stamp(quote.fetchedAt) || stamp(snapshot.generatedAt)
  const captureDate = dateAt(captured, quote.timezone), today = dateAt(nowMs, quote.timezone)
  if (!captureDate || !today || captured > nowMs + 300000) return null
  const confirmed = quote.priceBasis === 'previous-completed-session'
  if (confirmed && (!validDate(quote.closeDate) || quote.closeDate > today)) return null
  const points = new Map()
  for (const bar of quote.bars) {
    if (!Number.isInteger(bar?.time) || bar.time <= 0 || !positive(bar.close) || bar.time * 1000 > Math.min(nowMs, captured)) continue
    const date = dateAt(bar.time * 1000, quote.timezone)
    if (!date || (confirmed ? date > quote.closeDate : date >= captureDate || date >= today)) continue
    const previous = points.get(date)
    if (!previous || bar.time >= previous.time) points.set(date, {date,time:bar.time,close:bar.close})
  }
  const bars = [...points.values()].sort((a,b) => a.date.localeCompare(b.date))
  if (!bars.length) return null
  return {symbol,quote,bars,points:new Map(bars.map(bar => [bar.date,bar])),calendarKey:calendarKey(symbol,quote),captured}
}

function observedCap(quote, nowMs) {
  if (!positive(quote?.marketCap) || ['error','unavailable'].includes(quote.marketCapStatus)) return {reason:'시가총액 미확보'}
  if (!/^[A-Z]{3}$/.test(quote.marketCapCurrency || '') || ['GBX','ILA'].includes(quote.marketCapCurrency)) return {reason:'시가총액 통화 미확인'}
  const observedAt = quote.marketCapObservedAt || quote.marketCapFetchedAt
  const observedMs = stamp(observedAt)
  if (!Number.isFinite(observedMs) || observedMs > nowMs + 300000) return {reason:'시가총액 관측 시각 미확인'}
  return {value:quote.marketCap,currency:quote.marketCapCurrency,observedAt,observedMs,
    status:quote.marketCapStatus === 'stale' ? 'stale' : 'ok'}
}

function observedFx(snapshot, currency, cap, nowMs) {
  if (currency === 'USD') return {rate:1,date:utcDate(cap.observedMs),fetchedAt:null,status:'ok',source:'USD',sourceUrl:null}
  const entry = snapshot.fxHistory?.[currency]
  if (!entry || entry.currency && entry.currency !== currency
    || entry.baseCurrency && entry.baseCurrency !== 'USD'
    || entry.quoteConvention && entry.quoteConvention !== 'currency-per-USD'
    || ['error','unavailable'].includes(entry.status)) return null
  const points = Array.isArray(entry) ? entry : entry.observations
  if (!Array.isArray(points)) return null
  const fetchedMs = stamp(entry.fetchedAt)
  if (Number.isFinite(fetchedMs) && fetchedMs > nowMs + 300000) return null
  const asOf = dateAt(cap.observedMs, entry.timezone || 'UTC')
  if (!asOf) return null
  const byDate = new Map(), conflicts = new Set()
  for (const point of points) {
    if (!validDate(point?.date) || point.date > asOf || gap(asOf,point.date) > 7 || !positive(point.unitsPerUSD)) continue
    const ownObserved = stamp(point.observedAt)
    if (Number.isFinite(ownObserved) && ownObserved > cap.observedMs) continue
    // A later-fetched same-day daily fixing may have closed after the cap was
    // observed. Without its own timestamp, use only a provably earlier date.
    if (point.date === asOf && !(Number.isFinite(ownObserved) && ownObserved <= cap.observedMs)
      && !(Number.isFinite(fetchedMs) && fetchedMs <= cap.observedMs)) continue
    const previous = byDate.get(point.date)
    if (previous !== undefined && previous !== point.unitsPerUSD) conflicts.add(point.date)
    else byDate.set(point.date,point.unitsPerUSD)
  }
  for (const date of conflicts) byDate.delete(date)
  const date = [...byDate.keys()].sort().at(-1)
  if (!date) return null
  return {rate:byDate.get(date),date,fetchedAt:entry.fetchedAt || null,status:entry.status === 'stale' ? 'stale' : 'ok',source:entry.source || null,sourceUrl:entry.sourceUrl || null}
}

function returnsFor(series, calendar) {
  const latest = series.bars.at(-1), returns = {}, returnReasons = {}, returnDates = {}
  const previousDate = calendar[calendar.indexOf(latest.date)-1]
  for (const [period,days] of Object.entries(MAP_PERIODS)) {
    let baseDate
    if (period === '1d') baseDate = previousDate
    else {
      const target = shift(latest.date,days)
      baseDate = calendar.filter(date => date <= target).at(-1)
      if (baseDate && gap(target,baseDate) > 7) baseDate = null
    }
    const base = baseDate && series.points.get(baseDate)
    const value = base ? (latest.close / base.close - 1) * 100 : null
    returns[period] = Number.isFinite(value) ? value : null
    returnReasons[period] = returns[period] === null ? period === '1d' ? '직전 거래일 종가 미확보' : '기간 시작 종가 미확보' : null
    returnDates[period] = {startDate:returns[period] === null ? null : baseDate,endDate:latest.date}
  }
  return {returns,returnReasons,returnDates,previousDate}
}

/** Actual snapshot projection for both map views. No network and no synthetic
 * cap/day fallback. The layout's cap unit remains USD billions. */
export function buildActualMap({ snapshot, companies = COMPANIES, period = '1d', now = Date.now() } = {}) {
  if (!Object.hasOwn(MAP_PERIODS,period)) throw new RangeError('지원하지 않는 지도 수익률 기간입니다.')
  const catalogue = Array.isArray(companies) ? companies : []
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now)
  if (!Number.isFinite(nowMs)) throw new RangeError('지도 기준 시각이 올바르지 않습니다.')
  const safeSnapshot = snapshot?.schemaVersion === 1 && Array.isArray(snapshot.quotes) ? snapshot : {quotes:[]}
  const quotes = new Map()
  for (const quote of safeSnapshot.quotes) {
    if (typeof quote?.symbol !== 'string') continue
    const previous = quotes.get(quote.symbol)
    if (!previous || (stamp(quote.fetchedAt) || 0) >= (stamp(previous.fetchedAt) || 0)) quotes.set(quote.symbol,quote)
  }
  const series = new Map(), calendars = new Map()
  for (const [symbol,quote] of quotes) {
    // Market indicators and crypto may have different continuous-session rules.
    if (!/^[A-Z0-9.-]{1,24}$/.test(symbol) || /-USD$/.test(symbol) || quote.group === '시장') continue
    const value = readSeries(symbol,quote,safeSnapshot,nowMs)
    if (!value) continue
    series.set(symbol,value)
    if (!calendars.has(value.calendarKey)) calendars.set(value.calendarKey,new Set())
    for (const bar of value.bars) calendars.get(value.calendarKey).add(bar.date)
  }
  for (const [key,dates] of calendars) calendars.set(key,[...dates].sort())
  const coverage = {catalogCount:catalogue.length,pricedCount:0,renderableCount:0,returnableCount:0,
    missingCap:0,missingFx:0,missingPrice:0,missingReturn:0,staleCount:0,exclusions:[],returnExclusions:[]}
  const projected = []
  const exclude = (company,reason) => coverage.exclusions.push({ticker:company.ticker,name:company.name,reason})
  for (const company of catalogue) {
    const quote = quotes.get(company.ticker), actual = series.get(company.ticker)
    if (actual) coverage.pricedCount++
    const cap = observedCap(quote,nowMs)
    if (!positive(cap.value)) { coverage.missingCap++; exclude(company,cap.reason); continue }
    if (!actual) { coverage.missingPrice++; exclude(company,'확정 종가 미확보'); continue }
    const fx = observedFx(safeSnapshot,cap.currency,cap,nowMs)
    const capUSD = fx ? cap.value / fx.rate : null
    if (!positive(capUSD)) { coverage.missingFx++; exclude(company,'시총 관측일 기준 환율 미확보'); continue }
    const calendar = calendars.get(actual.calendarKey), latest = actual.bars.at(-1)
    const {returns,returnReasons,returnDates,previousDate} = returnsFor(actual,calendar)
    const stale = quote.status === 'stale' || cap.status === 'stale' || fx.status === 'stale'
      || latest.date < calendar.at(-1) || nowMs-actual.captured > 96*3600000 || nowMs-cap.observedMs > 96*3600000
    const {cap:syntheticCap,day:syntheticDay,returns:syntheticReturns,...identity} = company
    projected.push({...identity,cap:capUSD/1e9,capUSD,capCurrency:cap.currency,capObservedAt:cap.observedAt,
      capStatus:cap.status,capBasis:quote.marketCapBasis || 'provider-current',
      capSource:quote.source || null,capSourceUrl:quote.sourceUrl || null,
      fxDate:fx.date,fxFetchedAt:fx.fetchedAt,fxStatus:fx.status,fxSource:fx.source,fxSourceUrl:fx.sourceUrl,
      price:latest.close,currency:quote.currency || null,previousClose:actual.points.get(previousDate)?.close ?? null,
      closeDate:latest.date,previousCloseDate:previousDate || null,marketTime:latest.time,marketTimeBasis:'daily-bar-start',
      timezone:quote.timezone,source:quote.source || null,sourceUrl:quote.sourceUrl || null,fetchedAt:quote.fetchedAt || null,
      status:stale?'stale':'ok',stale,error:quote.error || null,
      capError:quote.marketCapError || null,returns,returnReasons,returnDates,day:returns['1d']})
    if (returns[period] === null) {
      coverage.missingReturn++
      coverage.returnExclusions.push({ticker:company.ticker,name:company.name,reason:returnReasons[period]})
    } else coverage.returnableCount++
    if (stale) coverage.staleCount++
  }
  coverage.renderableCount = projected.length
  const warnings = []
  if (!projected.length) warnings.push('실제 시총과 확정 종가가 확보된 기업이 없습니다.')
  if (coverage.exclusions.length) warnings.push('시총·통화·환율·확정 종가 미확보 기업은 지도에서 제외합니다.')
  if (coverage.missingReturn) warnings.push('선택 기간의 종가가 없는 기업은 중립색으로 표시하고 버블에서 제외합니다.')
  if (coverage.staleCount) warnings.push('이전 관측값 포함 · 개별 기준일과 시총 관측 시각을 확인하세요.')
  return {companies:projected,coverage,dates:[...new Set(projected.map(company=>company.closeDate))].sort(),
    capDates:[...new Set(projected.map(company=>utcDate(stamp(company.capObservedAt))))].sort(),
    fxDates:[...new Set(projected.map(company=>company.fxDate))].sort(),generatedAt:snapshot?.generatedAt || null,
    period,status:!projected.length?'unavailable':coverage.exclusions.length||coverage.missingReturn||coverage.staleCount?'partial':'ok',warnings}
}
