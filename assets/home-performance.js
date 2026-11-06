import { SECTORS } from './home-map-core.js'
import { focusCompanies } from './home-focus.js'
import { buildComparison } from './peer-comparison-core.js'

const DAY = 86400000
const PERIODS = Object.freeze({ '1d': 1, '1w': 7, '1m': 30, '1mo': 30, '3m': 90, '3mo': 90, '1y': 365 })
const FX_SYMBOLS = Object.freeze({ KRW: 'KRW=X', JPY: 'JPY=X', TWD: 'TWD=X', EUR: 'EUR=X', HKD: 'HKD=X' })
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN

function milliseconds(now) {
  const value = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now)
  return Number.isFinite(value) ? value : Date.now()
}

function localDateFormatter(timezone) {
  if (typeof timezone !== 'string' || !timezone) return null
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    return seconds => {
      if (!Number.isFinite(seconds) || !Number.isFinite(new Date(seconds * 1000).getTime())) return null
      const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(part => [part.type, part.value]))
      return `${parts.year}-${parts.month}-${parts.day}`
    }
  } catch { return null }
}

// Historical legacy files can contain an unfinished candle on their capture day.
// Their age does not make that old partial candle a verified closing observation.
function completedQuote(quote, snapshot, nowMs) {
  const dateOf = localDateFormatter(quote?.timezone)
  const explicit = Array.isArray(quote?.bars1year) ? quote.bars1year : quote?.histories?.['1y']
  const bars = Array.isArray(explicit) ? explicit : quote?.bars
  if (!quote || !dateOf || !Array.isArray(bars) || (!Array.isArray(explicit) && quote.interval && quote.interval !== '1d')) {
    return { ...quote, bars: [], bars1year: [], interval: '1d' }
  }
  const today = dateOf(nowMs / 1000)
  const confirmed = quote.priceBasis === 'previous-completed-session'
  const capture = timestamp(quote.fetchedAt) || timestamp(snapshot?.generatedAt)
  const captureDate = Number.isFinite(capture) ? dateOf(capture / 1000) : null
  const validCloseDate = confirmed && validDate(quote.closeDate) && quote.closeDate <= today
  const points = new Map()
  for (const bar of bars) {
    if (!positive(bar?.time) || !positive(bar?.close) || bar.time * 1000 > nowMs) continue
    const date = dateOf(bar.time)
    if (!date || (confirmed ? !validCloseDate || date > quote.closeDate : !captureDate || date >= captureDate)) continue
    const previous = points.get(date)
    if (!previous || bar.time >= previous.time) points.set(date, { ...bar })
  }
  const closed = [...points.values()].sort((a, b) => a.time - b.time)
  return { ...quote, bars: closed, bars1year: closed, interval: '1d' }
}

function exactHistoricalCap(quote, date) {
  const records = (Array.isArray(quote?.marketCapHistory) ? quote.marketCapHistory : []).filter(record =>
    record?.date === date && positive(record.value) && /^[A-Z]{3}$/.test(record.currency || '')
    && !['GBX', 'ILA'].includes(record.currency)
    && ['provider-dated', 'provider-period-end'].includes(record.basis))
  if (!records.length) return { value: null, reason: '기간 시작일 시총 미확보' }
  const identities = new Set(records.map(record => `${record.currency}:${record.value}`))
  if (identities.size !== 1) return { value: null, reason: '기간 시작일 시총 자료 충돌' }
  return { value: records[0].value, currency: records[0].currency, reason: null }
}

function exactFx(snapshot, normalizedQuotes, currency, date) {
  if (currency === 'USD') return 1
  const entry = snapshot?.fxHistory?.[currency]
  const observations = Array.isArray(entry) ? entry : entry?.observations
  if ((!entry?.currency || entry.currency === currency) && (!entry?.baseCurrency || entry.baseCurrency === 'USD')
    && (!entry?.quoteConvention || entry.quoteConvention === 'currency-per-USD') && Array.isArray(observations)) {
    const values = observations.filter(row => row?.date === date && positive(row.unitsPerUSD)).map(row => row.unitsPerUSD)
    if (new Set(values).size === 1) return values[0]
    if (new Set(values).size > 1) return null
  }
  const symbol = FX_SYMBOLS[currency]
  const quote = symbol && normalizedQuotes.get(symbol)
  // These exact symbols are quoted as local-currency units per one USD.
  if (!quote || quote.currency !== currency || quote.priceBasis !== 'previous-completed-session') return null
  const dateOf = localDateFormatter(quote.timezone)
  const values = quote.bars.filter(bar => dateOf(bar.time) === date && positive(bar.close)).map(bar => bar.close)
  return new Set(values).size === 1 ? values[0] : null
}

function emptyResult(snapshot, companies, period, warning) {
  return {
    period, generatedAt: snapshot?.generatedAt || null, startDate: null, endDate: null, closeDates: [],
    sectors: SECTORS.map(sector => {
      const total = companies.filter(company => company.sectorId === sector.id || company.sector === sector.name).length
      return { ...sector, sectorId: sector.id, eq: null, cap: null, capMissing: total > 0,
        eqCount: 0, capCount: 0, total, startDate: null, endDate: null, gap: null, divergence: null,
        capReason: '기간 시작일 시총 미확보', peers: [] }
    }),
    coverage: { companyCount: companies.length, eqCount: 0, capCount: 0, availableSectors: 0, capAvailableSectors: 0 },
    warnings: [warning],
  }
}

/**
 * Fixed-universe, same-date local-currency price returns. Capitalizations must be
 * verified observations dated exactly at the comparison start, converted to USD
 * at that same date. Current caps, nearest quarter values and inferred shares
 * never enter the calculation. No network calls are made here.
 */
export function buildSectorReturns({ snapshot, companies = focusCompanies, period = '3mo', now = Date.now() } = {}) {
  const selected = Array.isArray(companies) ? companies : []
  const days = PERIODS[period]
  if (!days) return emptyResult(snapshot, selected, period, '지원하지 않는 수익률 기간입니다.')
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.quotes)) {
    return emptyResult(snapshot, selected, period, '수집된 종가를 확인하고 있습니다.')
  }
  const nowMs = milliseconds(now)
  const normalizedQuotes = new Map()
  for (const quote of snapshot.quotes) {
    if (typeof quote?.symbol !== 'string') continue
    const prior = normalizedQuotes.get(quote.symbol)
    if (!prior || (timestamp(quote.fetchedAt) || 0) >= (timestamp(prior.fetchedAt) || 0)) {
      normalizedQuotes.set(quote.symbol, completedQuote(quote, snapshot, nowMs))
    }
  }
  const chains = SECTORS.map((sector, index) => ({ id: index + 1, name: sector.name }))
  const valid = selected.map(company => {
    const index = SECTORS.findIndex(sector => company.sectorId === sector.id || company.sector === sector.name)
    return { ...company, symbol: company.ticker || company.symbol, chains: index >= 0 ? [index + 1] : [] }
  }).filter(company => typeof company.symbol === 'string' && company.chains.length)
  const comparison = buildComparison({
    quotes: [...normalizedQuotes.values()], instruments: valid, chains,
    // A previous trading session can be several calendar days before Monday.
    days: period === '1d' ? 365 : days, requireFullPeriod: period !== '1d',
    generatedAt: snapshot.generatedAt, source: snapshot.source, now: nowMs,
  })
  const dates = period === '1d' ? comparison.dates.slice(-2) : comparison.dates
  const startDate = dates.length >= 2 ? dates[0] : null
  const endDate = dates.length >= 2 ? dates.at(-1) : null
  const pointMaps = new Map([...normalizedQuotes].map(([symbol, quote]) => {
    const dateOf = localDateFormatter(quote.timezone)
    return [symbol, new Map((quote.bars || []).map(bar => [dateOf?.(bar.time), bar.close]))]
  }))
  const sectors = SECTORS.map((sector, index) => {
    const group = comparison.groups[index]
    const peers = group.peers.map(peer => {
      const points = pointMaps.get(peer.symbol), first = startDate && points?.get(startDate), last = endDate && points?.get(endDate)
      const change = peer.included && positive(first) && positive(last) ? (last / first - 1) * 100 : null
      const returnPercent = Number.isFinite(change) ? change : null
      const quote = normalizedQuotes.get(peer.symbol)
      const cap = returnPercent !== null && startDate ? exactHistoricalCap(quote, startDate) : { value: null, reason: '유효 종가 이력 없음' }
      const fx = positive(cap.value) ? exactFx(snapshot, normalizedQuotes, cap.currency, startDate) : null
      const usd = positive(fx) ? cap.value / fx : null
      return { symbol: peer.symbol, name: peer.name, returnPercent, included: returnPercent !== null,
        startClose: positive(first) ? first : null, endClose: positive(last) ? last : null,
        capUSD: positive(usd) ? usd : null,
        capReason: !positive(cap.value) ? cap.reason : !positive(fx) ? '기간 시작일 환율 미확보' : !positive(usd) ? '유효 시총 미확보' : null,
        stale: peer.stale, warnings: peer.warnings }
    })
    const eligible = peers.filter(peer => peer.included)
    const weighted = eligible.filter(peer => positive(peer.capUSD))
    const eqValue = eligible.length ? eligible.reduce((sum, peer) => sum + peer.returnPercent / eligible.length, 0) : null
    const eq = Number.isFinite(eqValue) ? eqValue : null
    const maxCap = weighted.length ? Math.max(...weighted.map(peer => peer.capUSD)) : null
    const divisor = weighted.reduce((sum, peer) => sum + peer.capUSD / maxCap, 0)
    const capValue = divisor > 0 ? weighted.reduce((sum, peer) => sum + peer.returnPercent * (peer.capUSD / maxCap) / divisor, 0) : null
    const cap = Number.isFinite(capValue) ? capValue : null
    const gap = eq !== null && cap !== null && eligible.length === weighted.length ? eq - cap : null
    const divergence = gap !== null && Math.abs(gap) + 1e-10 >= 3 ? gap < 0 ? '대형주 쏠림' : '중소형↑' : null
    const missingReasons = [...new Set(peers.filter(peer => !positive(peer.capUSD)).map(peer => peer.capReason).filter(Boolean))]
    return { ...sector, sectorId: sector.id, eq, cap, capMissing: weighted.length < peers.length,
      eqCount: eq === null ? 0 : eligible.length, capCount: cap === null ? 0 : weighted.length, total: peers.length,
      startDate, endDate, gap, divergence, capReason: missingReasons.join(' · ') || null, peers }
  })
  const closeDates = [...new Set(valid.map(company => {
    const quote = normalizedQuotes.get(company.symbol), last = quote?.bars?.at(-1)
    return last && localDateFormatter(quote.timezone)?.(last.time)
  }).filter(Boolean))].sort()
  const warnings = [...comparison.metadata.warnings]
  if (comparison.metadata.stale) warnings.push('이전 수집값 포함 · 종가 기준일과 수집 시각을 확인하세요.')
  if (sectors.some(sector => sector.capMissing)) warnings.push('기간 시작일 시총 또는 같은 날짜 환율이 없는 종목은 시총가중에서 제외합니다.')
  if (sectors.some(sector => sector.eqCount && sector.eqCount !== sector.capCount)) warnings.push('가중 방식별 구성 종목이 다른 섹터에는 쏠림 태그를 표시하지 않습니다.')
  if (valid.length !== selected.length) warnings.push('섹터·종목 연결이 확인되지 않은 기업은 계산에서 제외합니다.')
  if (startDate && endDate && period !== '1d') {
    const observedDays = (Date.parse(endDate) - Date.parse(startDate)) / DAY
    if (Math.abs(observedDays - days) > 7) warnings.push(`실제 공통 관측기간 ${observedDays}일 · 요청 ${days}일`)
  }
  return {
    period, generatedAt: snapshot.generatedAt || null, startDate, endDate, closeDates, sectors,
    coverage: { companyCount: valid.length, eqCount: sectors.reduce((sum, sector) => sum + sector.eqCount, 0),
      capCount: sectors.reduce((sum, sector) => sum + sector.capCount, 0),
      availableSectors: sectors.filter(sector => sector.eq !== null).length,
      capAvailableSectors: sectors.filter(sector => sector.cap !== null).length },
    warnings: [...new Set(warnings)],
  }
}
