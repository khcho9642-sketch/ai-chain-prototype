// Compare the fixed catalog's peers using collected daily closes. No network calls.
export const comparisonPeriods = Object.freeze({ '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365 })

const DAY = 86400000
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const dateMs = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10)
const calendarGap = (a, b) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY
const unique = values => [...new Set(values)]

function localDateFormatter(timezone) {
  if (typeof timezone !== 'string' || !timezone) return null
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    return time => {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(time * 1000)).map(p => [p.type, p.value]))
      return `${parts.year}-${parts.month}-${parts.day}`
    }
  } catch { return null }
}

function readPeer(instrument, quote, nowMs, maxSnapshotAgeHours) {
  const peer = {
    symbol: instrument.symbol, name: instrument.name || instrument.symbol,
    currency: quote?.currency || null, source: quote?.source || null,
    fetchedAt: quote?.fetchedAt || null, status: quote?.status || null,
    timezone: quote?.timezone || null, included: false, reason: null,
    returnPercent: null, startClose: null, endClose: null,
    firstDate: null, lastDate: null, validBarCount: 0, rejectedBarCount: 0,
    stale: false, warnings: [],
  }
  const points = new Map()
  if (!quote) { peer.reason = '시세 수집값 없음'; return { peer, points } }
  const explicitDaily = Array.isArray(quote.bars1year) ? quote.bars1year : quote.histories?.['1y']
  const bars = Array.isArray(explicitDaily) ? explicitDaily : quote.bars
  if (!Array.isArray(bars) || !bars.length) { peer.reason = '일봉 이력 없음'; return { peer, points } }
  if (!Array.isArray(explicitDaily) && quote.interval && quote.interval !== '1d') {
    peer.reason = '일봉이 아닌 이력'; return { peer, points }
  }
  const localDate = localDateFormatter(quote.timezone)
  if (!localDate) { peer.reason = '거래소 시간대 없음 또는 오류'; return { peer, points } }
  // Sorting also makes duplicate local dates deterministic: the latest observation wins.
  for (const bar of [...bars].sort((a, b) => (a?.time || 0) - (b?.time || 0))) {
    // A started daily session may be partial, but a future session cannot be observed.
    if (!positive(bar?.time) || !positive(bar?.close) || !Number.isFinite(new Date(bar.time * 1000).getTime()) || bar.time * 1000 > nowMs) {
      peer.rejectedBarCount++; continue
    }
    points.set(localDate(bar.time), bar.close)
  }
  const dates = [...points.keys()].sort()
  peer.firstDate = dates[0] || null
  peer.lastDate = dates.at(-1) || null
  peer.validBarCount = dates.length
  if (dates.length < 2) { peer.reason = '유효 종가가 2거래일 미만'; return { peer, points } }
  peer.included = true
  const fetchedMs = dateMs(quote.fetchedAt)
  if (Number.isFinite(fetchedMs) && nowMs - fetchedMs > maxSnapshotAgeHours * 3600000) {
    peer.stale = true; peer.warnings.push('수집 후 시간이 지난 스냅샷')
  }
  if (!Number.isFinite(fetchedMs)) peer.warnings.push('수집 시각 미제공')
  if (quote.status && quote.status !== 'ok') {
    peer.stale = true; peer.warnings.push('조회 실패 또는 이전 수집값')
  }
  const today = new Date(nowMs).toISOString().slice(0, 10)
  if (calendarGap(today, peer.lastDate) > 7) {
    peer.stale = true; peer.warnings.push('마지막 유효 종가가 7일 초과 경과')
  }
  if (peer.rejectedBarCount) peer.warnings.push(`결측·0·음수 등 비정상 관측값 ${peer.rejectedBarCount}개 제외`)
  return { peer, points }
}

/**
 * quotes may be a snapshot's quotes array (or a Map/object indexed by symbol).
 * All available groups share exactly the same local trading dates and base date.
 * The index equals mean(close_t / close_base) * 100, with a fixed peer set.
 * This is an equal-initial-weight price basket, not a daily rebalanced index.
 */
export function buildComparison({
  quotes = [], instruments = [], chains = [], days = 90,
  generatedAt = null, source = null, now = Date.now(), maxSnapshotAgeHours = 6,
} = {}) {
  const periodDays = comparisonPeriods[days] || Number(days)
  if (!Number.isFinite(periodDays) || periodDays < 1) throw new RangeError('days must be a positive number or a supported period')
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now)
  if (!Number.isFinite(nowMs)) throw new RangeError('now must be a valid date')
  const quoteValues = quotes instanceof Map ? [...quotes.values()] : Array.isArray(quotes) ? quotes : Object.values(quotes || {})
  const quoteMap = new Map()
  for (const quote of quoteValues) {
    if (!quote?.symbol) continue
    const prior = quoteMap.get(quote.symbol)
    if (!prior || (dateMs(quote.fetchedAt) || 0) >= (dateMs(prior.fetchedAt) || 0)) quoteMap.set(quote.symbol, quote)
  }
  const normalizedChains = (chains.length ? chains : Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `${i + 1} 고리` })))
    .map(chain => typeof chain === 'object' ? chain : { id: chain, name: `${chain} 고리` })
    .filter(chain => Number(chain.id) > 0)
  const chainIds = new Set(normalizedChains.map(chain => Number(chain.id)))
  const catalog = [...new Map(instruments.filter(item => item?.symbol && item.chains?.some(id => chainIds.has(Number(id))))
    .map(item => [item.symbol, item])).values()]
  const observations = new Map(catalog.map(item => [item.symbol, readPeer(item, quoteMap.get(item.symbol), nowMs, maxSnapshotAgeHours)]))
  const eligible = [...observations.values()].filter(item => item.peer.included)
  let allSharedDates = eligible.length ? [...eligible[0].points.keys()].filter(date => eligible.every(item => item.points.has(date))).sort() : []
  const endDate = allSharedDates.at(-1) || null
  const requestedStartDate = endDate ? shiftDate(endDate, periodDays) : null
  const dates = requestedStartDate ? allSharedDates.filter(date => date >= requestedStartDate) : []
  const startDate = dates[0] || null
  const usableDates = dates.length >= 2
  const latestObservedDate = eligible.length ? eligible.map(item => item.peer.lastDate).sort().at(-1) : null
  const groups = normalizedChains.map(chain => {
    const members = catalog.filter(item => item.chains.some(id => Number(id) === Number(chain.id)))
    const peers = members.map(item => {
      const { peer, points } = observations.get(item.symbol)
      const result = { ...peer, warnings: [...peer.warnings] }
      if (result.included && usableDates) {
        result.startClose = points.get(startDate)
        result.endClose = points.get(endDate)
        result.returnPercent = (result.endClose / result.startClose - 1) * 100
      }
      return result
    })
    const includedPeers = peers.filter(peer => peer.included)
    const excludedPeers = peers.filter(peer => !peer.included)
    const available = includedPeers.length > 0 && usableDates
    const series = available ? dates.map(date => {
      const index = includedPeers.reduce((sum, peer) => sum + observations.get(peer.symbol).points.get(date) / peer.startClose, 0) / includedPeers.length * 100
      return { date, index, returnPercent: index - 100 }
    }) : []
    const warnings = []
    if (excludedPeers.length) warnings.push(`전체 ${peers.length}개 피어 중 ${excludedPeers.length}개 제외`)
    if (includedPeers.some(peer => peer.stale)) warnings.push('이전 수집값 또는 오래된 종가 포함')
    if (startDate && requestedStartDate && calendarGap(startDate, requestedStartDate) > 7) warnings.push('요청 기간보다 공통 이력이 짧음')
    if (endDate && latestObservedDate && calendarGap(latestObservedDate, endDate) > 3) warnings.push(`공통 종료일이 일부 종목 최신일보다 ${calendarGap(latestObservedDate, endDate)}일 이전`)
    return {
      id: chain.id, name: chain.name || `${chain.id} 고리`, peers, includedPeers, excludedPeers,
      peerCount: peers.length, includedCount: includedPeers.length, excludedCount: excludedPeers.length,
      coverage: peers.length ? includedPeers.length / peers.length : 0,
      available, unavailableReason: available ? null : !peers.length ? '등록된 피어 없음' : !includedPeers.length ? '유효 이력이 있는 피어 없음' : '공통 거래일이 2일 미만',
      series, returnPercent: series.at(-1)?.returnPercent ?? null, rank: null,
      stale: includedPeers.some(peer => peer.stale), warnings,
    }
  })
  const ranking = groups.filter(group => group.available).sort((a, b) => b.returnPercent - a.returnPercent || Number(a.id) - Number(b.id))
  ranking.forEach((group, index) => { group.rank = index && Math.abs(group.returnPercent - ranking[index - 1].returnPercent) < 1e-10 ? ranking[index - 1].rank : index + 1 })
  const warnings = []
  if (!usableDates) warnings.push('모든 비교 대상에 공통인 거래일이 2일 미만이어서 수익률을 계산할 수 없습니다.')
  if (eligible.some(item => item.peer.stale)) warnings.push('오래된 수집값이 포함되어 있습니다. 수집 시각과 종가 기준일을 확인하세요.')
  if (groups.some(group => group.excludedCount)) warnings.push('결측 피어를 0%로 간주하지 않으며, 표시된 유효 피어만 평균에 포함합니다.')
  if (startDate && requestedStartDate && calendarGap(startDate, requestedStartDate) > 7) warnings.push('일부 피어의 이력 제한으로 실제 공통 비교 기간이 짧아졌습니다.')
  return {
    days: periodDays, dates, startDate, endDate, groups, ranking,
    methodology: {
      name: '피어 동일비중 누적 가격수익률', indexBase: 100,
      formula: '평균(각 종목의 해당일 종가 / 공통 기준일 종가) × 100',
      priceField: 'close', adjustedCloseUsed: false, dividendsReinvested: false,
      fxAdjusted: false, localCurrency: true, dailyRebalanced: false,
      missingDays: '모든 유효 피어의 현지 거래일 교집합 · 보간 없음',
      description: '수집된 현지통화 종가의 가격수익률입니다. 배당 재투자와 원화 환산 수익률은 반영하지 않습니다. 기준일에 각 피어에 동일 금액을 배분한 뒤 보유한 비교입니다.',
      universeCaveat: '현재 등록된 피어 목록을 과거 구간에도 적용하며, 과거 시점의 산업 구성 전체를 재현한 지수는 아닙니다. 여러 고리에 속한 기업은 각 고리에 포함됩니다.',
      sessionCaveat: '최신 일봉은 장중 값일 수 있습니다. 같은 현지 날짜라도 국가별 거래 종료 시각이 다릅니다.',
    },
    metadata: {
      source: source || unique(quoteValues.map(quote => quote?.source).filter(Boolean)).join(', ') || null,
      generatedAt, requestedStartDate, observedStartDate: allSharedDates[0] || null,
      latestObservedDate, commonPointCount: dates.length, commonDatesAvailable: usableDates,
      totalUniquePeers: catalog.length, includedUniquePeers: eligible.length,
      excludedUniquePeers: catalog.length - eligible.length,
      availableGroupCount: groups.filter(group => group.available).length,
      stale: eligible.some(item => item.peer.stale),
      oldestFetchedAt: eligible.map(item => item.peer.fetchedAt).filter(value => Number.isFinite(dateMs(value))).sort((a, b) => dateMs(a) - dateMs(b))[0] || null,
      latestFetchedAt: eligible.map(item => item.peer.fetchedAt).filter(value => Number.isFinite(dateMs(value))).sort((a, b) => dateMs(b) - dateMs(a))[0] || null,
      rejectedBarCount: [...observations.values()].reduce((sum, item) => sum + item.peer.rejectedBarCount, 0),
      partialSessionPossible: true, asynchronousMarkets: true, warnings,
    },
  }
}
