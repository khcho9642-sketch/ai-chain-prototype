import { SECTORS } from './home-map-core.js'
import { focusCompanies } from './home-focus.js'

export const RIPPLE_RULES = Object.freeze({ lookbackTradingDays: 60, thresholdPercent: 2, minSamples: 5, minSyncRate: 50, maxTriggers: 3, maxNeighbors: 3 })
export const RIPPLE_NOTE = '같은 날 함께 움직인 종목 · 인과관계 아님 · 동조율 = 최근 60거래일 중 트리거 ±2% 이상인 날 같은 방향 비율'
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const finite = value => typeof value === 'number' && Number.isFinite(value)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const round = (value, digits = 6) => Number(value.toFixed(digits))
const sectorOrder = new Map(SECTORS.map((sector, index) => [sector.id, index + 1]))
const marketNames = { KR: '한국', US: '미국', ETC: '기타' }
const formatters = new Map()

export function rippleSelectionKey(companies = focusCompanies) {
  return JSON.stringify(companies.map(company => [company.ticker, company.sectorId, company.name])
    .sort((a, b) => a[0].localeCompare(b[0])))
}

export function rippleMatchesSelection(value, companies = focusCompanies) {
  if (value?.selectionKey !== rippleSelectionKey(companies) || value?.coverage?.targetCompanies !== companies.length) return false
  const approved = new Map(companies.map(company => [company.ticker, company.sectorId]))
  return (value.ripples || []).every(ripple => [ripple.trigger, ...ripple.upstream, ...ripple.downstream]
    .every(company => approved.get(company.ticker) === company.sectorId))
}

function milliseconds(value) {
  const actual = typeof value === 'function' ? value() : value
  const result = actual instanceof Date ? actual.getTime() : typeof actual === 'string' ? Date.parse(actual) : Number(actual)
  if (!Number.isFinite(result) || !Number.isFinite(new Date(result).getTime())) throw new RangeError('파급 계산 기준 시각 오류')
  return result
}

function localDate(seconds, timezone) {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    if (typeof timezone !== 'string' || !timezone) throw new Error('거래소 시간대 미확인')
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    formatters.set(timezone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

// Market means the traded listing's session, not the issuer's home country.
export function rippleMarket(ticker, quote = {}) {
  if (/^\d{6}\.(?:KS|KQ)$/.test(ticker) || quote.timezone === 'Asia/Seoul') return 'KR'
  if (quote.timezone === 'America/New_York' || /^(?:NASDAQ|NYSE|NAS|NMS|NGM|NCM|NYQ|ASE|PCX)$/i.test(quote.exchange || '')) return 'US'
  return 'ETC'
}

function equity(ticker, quote) {
  return typeof ticker === 'string' && /^[A-Z0-9.-]{1,24}$/.test(ticker) && !/-USD$/.test(ticker) && quote.group !== '시장'
}

function readSeries(ticker, quote, snapshot, nowMs) {
  if (!quote || quote.interval && quote.interval !== '1d') return null
  if (!Array.isArray(quote.bars) || !quote.bars.length) return null
  const capturedMs = timestamp(quote.fetchedAt) ? Date.parse(quote.fetchedAt) : Date.parse(snapshot.generatedAt)
  if (!Number.isFinite(capturedMs) || capturedMs > nowMs + 300000) return null
  const completed = quote.priceBasis === 'previous-completed-session'
  let captureDay, today
  try { captureDay = localDate(capturedMs / 1000, quote.timezone); today = localDate(nowMs / 1000, quote.timezone) }
  catch { return null }
  if (completed && (!validDate(quote.closeDate) || quote.closeDate > today)) return null
  const points = new Map()
  for (const bar of quote.bars) {
    if (!Number.isInteger(bar?.time) || bar.time <= 0 || !positive(bar.close) || bar.time * 1000 > Math.min(nowMs, capturedMs)) continue
    const date = localDate(bar.time, quote.timezone)
    // A legacy daily candle captured during a session never becomes an official
    // close simply because the file is read on a later day.
    if (date > today || (completed ? date > quote.closeDate : date >= captureDay || date >= today)) continue
    const prior = points.get(date)
    if (!prior || bar.time >= prior.time) points.set(date, { date, time: bar.time, close: bar.close })
  }
  const bars = [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (bars.length < 2) return null
  const market = rippleMarket(ticker, quote)
  return { ticker, quote, bars, market, calendarKey: market === 'ETC' ? 'ETC:' + quote.timezone : market, returns: [] }
}

function returnsFor(series, calendar) {
  const previousDate = new Map(calendar.map((date, index) => [date, calendar[index - 1]]))
  const result = []
  for (let index = 1; index < series.bars.length; index++) {
    const current = series.bars[index], previous = series.bars[index - 1]
    // Missing company observations may not turn a two-session move into a 1d move.
    if (previousDate.get(current.date) !== previous.date) continue
    result.push({ date: current.date, changePct: (current.close / previous.close - 1) * 100, close: current.close, previousClose: previous.close })
  }
  return result
}

function matchingDate(trigger, candidate, triggerDate, calendars) {
  if (trigger.market === 'US' && candidate.market === 'KR') return calendars.get('KR')?.find(date => date > triggerDate) || null
  // Korean close first, then the same local calendar date's US session.
  return triggerDate
}

function syncRate(trigger, candidate, calendars) {
  const sessionDates = calendars.get(trigger.calendarKey).filter(date => date <= trigger.returns.at(-1).date).slice(-RIPPLE_RULES.lookbackTradingDays)
  const sessionSet = new Set(sessionDates)
  const window = trigger.returns.filter(row => sessionSet.has(row.date))
  const events = window.filter(row => Math.abs(row.changePct) + 1e-10 >= RIPPLE_RULES.thresholdPercent)
  const target = new Map(candidate.returns.map(row => [row.date, row]))
  let samples = 0, matching = 0
  for (const event of events) {
    const date = matchingDate(trigger, candidate, event.date, calendars)
    const observation = date && target.get(date)
    if (!observation) continue
    samples++
    if (Math.sign(event.changePct) === Math.sign(observation.changePct)) matching++
  }
  return { syncRate: samples >= RIPPLE_RULES.minSamples ? round(matching / samples * 100, 4) : null,
    samples, triggerEvents: events.length, matchingSamples: matching, missingSamples: events.length - samples,
    insufficientSamples: samples < RIPPLE_RULES.minSamples,
    windowStart: sessionDates[0] || null, windowEnd: sessionDates.at(-1) || null }
}

function node(company, series, observation, sync = null) {
  return {
    ticker: company.ticker, name: company.name, sectorId: company.sectorId,
    sectorOrder: sectorOrder.get(company.sectorId), market: series.market, date: observation.date,
    changePct: round(observation.changePct), syncRate: sync?.syncRate ?? null,
    samples: sync?.samples || 0, triggerEvents: sync?.triggerEvents || 0,
    matchingSamples: sync?.matchingSamples || 0, missingSamples: sync?.missingSamples || 0,
    insufficientSamples: sync?.insufficientSamples ?? false,
    windowStart: sync?.windowStart || null, windowEnd: sync?.windowEnd || null,
    stale: series.quote.status !== 'ok', source: 'Yahoo Finance',
    sourceUrl: 'https://finance.yahoo.com/quote/' + encodeURIComponent(company.ticker) + '/',
    fetchedAt: series.quote.fetchedAt || null,
  }
}

function label(market, date) { return marketNames[market] + ' ' + date.slice(5).replace('-', '.') + ' 종가' }

export function createUnavailableRippleSnapshot({ sourceSnapshotGeneratedAt = null, now = Date.now(), companyCount = focusCompanies.length, selectionKey = rippleSelectionKey(), reason = 'insufficient-closed-history' } = {}) {
  return validateRippleSnapshot({ schemaVersion: 1, generatedAt: new Date(milliseconds(now)).toISOString(),
    sourceSnapshotGeneratedAt, selectionKey, source: 'Yahoo Finance', priceBasis: 'previous-completed-session', ...RIPPLE_RULES,
    status: 'unavailable', reason, triggers: [], ripples: [],
    coverage: { targetCompanies: companyCount, usableCompanies: 0, unavailable: [], legacySnapshot: true,
      calendarMethod: 'observed-equity-session-union', sampleDenominator: 'paired-observed-event-sessions' }, notes: [RIPPLE_NOTE] })
}

export function buildRippleSnapshot({ marketSnapshot, companies = focusCompanies, now = Date.now() } = {}) {
  const nowMs = milliseconds(now)
  if (marketSnapshot && Array.isArray(marketSnapshot.quotes) && !marketSnapshot.quotes.length && !timestamp(marketSnapshot.generatedAt)) {
    return createUnavailableRippleSnapshot({ now: nowMs, companyCount: companies?.length || 0, selectionKey: rippleSelectionKey(companies) })
  }
  if (!marketSnapshot || !Array.isArray(marketSnapshot.quotes) || !timestamp(marketSnapshot.generatedAt)
    || Date.parse(marketSnapshot.generatedAt) > nowMs + 300000) throw new Error('파급 계산에 유효한 종가 스냅샷이 필요합니다.')
  if (!Array.isArray(companies) || !companies.length || new Set(companies.map(company => company.ticker)).size !== companies.length
    || !companies.every(company => /^[A-Z0-9.-]{1,24}$/.test(company.ticker || '') && company.name && sectorOrder.has(company.sectorId))) throw new Error('파급 대상 회사 목록 오류')
  const quotes = new Map(marketSnapshot.quotes.filter(quote => quote?.symbol).map(quote => [quote.symbol, quote]))
  const seriesBySymbol = new Map(), calendars = new Map()
  for (const [ticker, quote] of quotes) {
    if (!equity(ticker, quote)) continue
    const series = readSeries(ticker, quote, marketSnapshot, nowMs)
    if (!series) continue
    seriesBySymbol.set(ticker, series)
    if (!calendars.has(series.calendarKey)) calendars.set(series.calendarKey, new Set())
    for (const bar of series.bars) calendars.get(series.calendarKey).add(bar.date)
  }
  for (const [key, dates] of calendars) calendars.set(key, [...dates].sort())
  for (const series of seriesBySymbol.values()) series.returns = returnsFor(series, calendars.get(series.calendarKey))
  const usable = companies.filter(company => seriesBySymbol.get(company.ticker)?.returns.length)
  const unavailable = companies.filter(company => !usable.includes(company)).map(company => ({ ticker: company.ticker, reason: '확정 종가 또는 연속 거래일 자료 부족' }))
  const candidates = usable.map(company => {
    const series = seriesBySymbol.get(company.ticker), observation = series.returns.at(-1)
    return { company, series, observation }
  }).filter(({ series, observation }) => observation.date === calendars.get(series.calendarKey).at(-1)
    && Math.abs(observation.changePct) + 1e-10 >= RIPPLE_RULES.thresholdPercent)
    .sort((a, b) => Math.abs(b.observation.changePct) - Math.abs(a.observation.changePct) || a.company.ticker.localeCompare(b.company.ticker))
    .slice(0, RIPPLE_RULES.maxTriggers)
  const triggers = [], ripples = []
  for (const { company, series, observation } of candidates) {
    const trigger = node(company, series, observation), upstream = [], downstream = []
    const pendingMarkets = []
    if (series.market === 'US' && usable.some(item => seriesBySymbol.get(item.ticker).market === 'KR') && !calendars.get('KR')?.some(date => date > observation.date)) pendingMarkets.push('KR')
    if (series.market === 'KR' && usable.some(item => seriesBySymbol.get(item.ticker).market === 'US') && !calendars.get('US')?.includes(observation.date)) pendingMarkets.push('US')
    for (const target of usable) {
      if (target.ticker === company.ticker) continue
      const targetSeries = seriesBySymbol.get(target.ticker)
      const date = matchingDate(series, targetSeries, observation.date, calendars)
      const row = date && targetSeries.returns.find(point => point.date === date)
      if (!row || Math.sign(row.changePct) !== Math.sign(observation.changePct)) continue
      const sync = syncRate(series, targetSeries, calendars)
      if (sync.syncRate !== null && sync.syncRate < RIPPLE_RULES.minSyncRate) continue
      const targetNode = node(target, targetSeries, row, sync)
      if (targetNode.sectorOrder <= trigger.sectorOrder) upstream.push(targetNode)
      else downstream.push(targetNode)
    }
    const sort = (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.ticker.localeCompare(b.ticker)
    upstream.sort(sort); downstream.sort(sort)
    const krDate = series.market === 'US' ? calendars.get('KR')?.find(date => date > observation.date) : observation.date
    let comparisonLabel = label(series.market, observation.date)
    if (series.market === 'US') comparisonLabel += pendingMarkets.includes('KR') ? ' → 한국 종가 반영 전' : krDate ? ' → ' + label('KR', krDate) : ''
    if (series.market === 'KR') comparisonLabel += pendingMarkets.includes('US') ? ' → 미국 종가 반영 전' : calendars.get('US')?.includes(observation.date) ? ' → ' + label('US', observation.date) : ''
    triggers.push(trigger)
    ripples.push({ asOf: observation.date, trigger, upstream: upstream.slice(0, RIPPLE_RULES.maxNeighbors), downstream: downstream.slice(0, RIPPLE_RULES.maxNeighbors),
      comparisonLabel, pendingKoreanClose: pendingMarkets.includes('KR'), pendingMarkets })
  }
  return validateRippleSnapshot({
    schemaVersion: 1, generatedAt: new Date(nowMs).toISOString(), sourceSnapshotGeneratedAt: marketSnapshot.generatedAt,
    selectionKey: rippleSelectionKey(companies),
    source: 'Yahoo Finance', priceBasis: 'previous-completed-session', ...RIPPLE_RULES,
    status: !usable.length ? 'unavailable' : unavailable.length ? 'partial' : 'ok',
    reason: !usable.length ? 'insufficient-closed-history' : !triggers.length ? 'no-large-moves' : null,
    triggers, ripples, coverage: { targetCompanies: companies.length, usableCompanies: usable.length, unavailable,
      legacySnapshot: marketSnapshot.mode !== 'scheduled-close', calendarMethod: 'observed-equity-session-union',
      sampleDenominator: 'paired-observed-event-sessions' },
    notes: [RIPPLE_NOTE, '동조율은 날짜가 대응되는 관측값만 분모에 포함합니다. 표본 5개 미만은 —로 표시합니다.',
      '상류·하류는 섹터 순서에 따른 위치이며 실제 납품 관계를 확인한 결과가 아닙니다.'],
  })
}

export function validateRippleSnapshot(value) {
  if (!value || value.schemaVersion !== 1 || value.source !== 'Yahoo Finance' || value.priceBasis !== 'previous-completed-session'
    || !timestamp(value.generatedAt) || !(timestamp(value.sourceSnapshotGeneratedAt) || value.sourceSnapshotGeneratedAt === null && value.status === 'unavailable') || !Array.isArray(value.triggers)
    || !Array.isArray(value.ripples) || value.triggers.length > 3 || value.ripples.length !== value.triggers.length
    || !['ok', 'partial', 'unavailable'].includes(value.status)
    || value.status === 'unavailable' && value.triggers.length
    || !value.coverage || !Number.isInteger(value.coverage.targetCompanies) || value.coverage.targetCompanies < 0
    || !Number.isInteger(value.coverage.usableCompanies) || value.coverage.usableCompanies < 0
    || value.coverage.usableCompanies > value.coverage.targetCompanies || !Array.isArray(value.coverage.unavailable)) throw new Error('파급 스냅샷 형식 오류')
  for (const key of ['lookbackTradingDays','thresholdPercent','minSamples','minSyncRate','maxTriggers','maxNeighbors']) if (value[key] !== RIPPLE_RULES[key]) throw new Error('파급 계산 기준 오류')
  const seen = new Set()
  function validateNode(item, neighbor) {
    if (!item || !/^[A-Z0-9.-]{1,24}$/.test(item.ticker || '') || typeof item.name !== 'string' || !item.name
      || !sectorOrder.has(item.sectorId) || item.sectorOrder !== sectorOrder.get(item.sectorId)
      || !['KR','US','ETC'].includes(item.market) || !validDate(item.date) || !finite(item.changePct)
      || !Number.isInteger(item.samples) || item.samples < 0 || !Number.isInteger(item.triggerEvents) || item.triggerEvents < item.samples
      || !(item.syncRate === null || finite(item.syncRate) && item.syncRate >= 0 && item.syncRate <= 100)
      || item.syncRate !== null && item.samples < 5 || neighbor && item.syncRate !== null && item.syncRate < 50) throw new Error('파급 종목·동조율 오류')
  }
  for (let index = 0; index < value.ripples.length; index++) {
    const ripple = value.ripples[index]
    validateNode(ripple.trigger, false)
    validateNode(value.triggers[index], false)
    if (Math.abs(ripple.trigger.changePct) + 1e-10 < RIPPLE_RULES.thresholdPercent
      || ripple.asOf !== ripple.trigger.date || typeof ripple.pendingKoreanClose !== 'boolean' || typeof ripple.comparisonLabel !== 'string'
      || seen.has(ripple.trigger.ticker) || value.triggers[index].ticker !== ripple.trigger.ticker || value.triggers[index].date !== ripple.trigger.date
      || value.triggers[index].changePct !== ripple.trigger.changePct || value.triggers[index].market !== ripple.trigger.market
      || !Array.isArray(ripple.upstream) || !Array.isArray(ripple.downstream) || ripple.upstream.length > 3 || ripple.downstream.length > 3
      || !Array.isArray(ripple.pendingMarkets) || ripple.pendingMarkets.some(market => !['KR','US'].includes(market))) throw new Error('파급 목록 오류')
    seen.add(ripple.trigger.ticker)
    const neighbors = new Set()
    for (const item of [...ripple.upstream, ...ripple.downstream]) {
      validateNode(item, true)
      if (item.ticker === ripple.trigger.ticker || neighbors.has(item.ticker) || Math.sign(item.changePct) !== Math.sign(ripple.trigger.changePct)) throw new Error('파급 방향·중복 오류')
      neighbors.add(item.ticker)
    }
  }
  return value
}
