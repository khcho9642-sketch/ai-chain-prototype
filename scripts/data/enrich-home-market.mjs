import { focusCompanies } from '../../assets/home-focus.js'
import { historicalMarketCap } from '../../server/market-cap-history.mjs'
import { dailyClose } from '../../server/market-close.mjs'

const currencies = { KRW: 'KRW=X', JPY: 'JPY=X', TWD: 'TWD=X' }
const positive = value => Number.isFinite(value) && value > 0
const reason = error => String(error?.message || '홈 기준일 자료 수집 실패').slice(0, 400)
const localDate = (time, timezone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time * 1000)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

// These are supplemental observed values. Price collection success does not
// depend on provider history or FX availability, and no missing value becomes0.
export async function enrichHomeMarket(snapshot, {
  previous = {}, companies = focusCompanies, capService = historicalMarketCap,
  fxService = dailyClose, now = Date.now, maxAgeHours = 12,
} = {}) {
  const quotes = snapshot.quotes.map(quote => ({ ...quote }))
  const old = new Map((previous.quotes || []).map(quote => [quote.symbol, quote]))
  const selected = new Set(companies.map(company => company.ticker))
  const queue = quotes.filter(quote => selected.has(quote.symbol))
  const nowMs = Number(now())
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const quote = queue.shift(), prior = old.get(quote.symbol) || quote
      const saved = Array.isArray(prior.marketCapHistory) ? prior.marketCapHistory : []
      if (prior.capHistoryStatus === 'ok' && saved.length && Number.isFinite(Date.parse(prior.capHistoryFetchedAt))
        && nowMs - Date.parse(prior.capHistoryFetchedAt) >= 0 && nowMs - Date.parse(prior.capHistoryFetchedAt) < maxAgeHours * 3600000) {
        Object.assign(quote, { marketCapHistory: saved, capHistoryFetchedAt: prior.capHistoryFetchedAt, capHistoryStatus: 'ok', capHistoryError: null })
        continue
      }
      try {
        const result = await capService(quote.symbol)
        if (result.symbol !== quote.symbol || !Array.isArray(result.observations)) throw new Error('과거 시총 종목·배열 오류')
        const conflicts = new Set(result.conflictingDates || [])
        const points = new Map(saved.filter(point => !conflicts.has(point.date)).map(point => [point.date, point]))
        for (const point of result.observations) points.set(point.date, point)
        const history = [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
        Object.assign(quote, { marketCapHistory: history, capHistoryFetchedAt: result.fetchedAt,
          capHistoryStatus: result.status === 'ok' ? 'ok' : history.length ? 'stale' : 'unavailable',
          capHistoryError: result.error || null })
      } catch (error) {
        Object.assign(quote, { marketCapHistory: saved, capHistoryFetchedAt: prior.capHistoryFetchedAt || null,
          capHistoryStatus: saved.length ? 'stale' : 'unavailable', capHistoryError: reason(error) })
      }
    }
  }))
  const fxHistory = {}
  await Promise.all(Object.entries(currencies).map(async ([currency, symbol]) => {
    try {
      let quote = quotes.find(quote => quote.symbol === symbol && quote.priceBasis === 'previous-completed-session' && quote.status === 'ok')
      if (!quote) quote = await fxService(symbol)
      if (quote.symbol !== symbol || quote.currency !== currency || quote.priceBasis !== 'previous-completed-session'
        || quote.interval !== '1d' || !Array.isArray(quote.bars) || !quote.timezone) throw new Error('환율 통화·기준일 오류')
      const points = new Map()
      for (const bar of quote.bars) if (positive(bar.time) && bar.time * 1000 <= nowMs && positive(bar.close)) {
        points.set(localDate(bar.time, quote.timezone), bar.close)
      }
      const observations = [...points].sort(([a], [b]) => a.localeCompare(b)).map(([date, unitsPerUSD]) => ({ date, unitsPerUSD }))
      if (!observations.length) throw new Error('유효 환율 이력 없음')
      fxHistory[currency] = { symbol, source: quote.source, fetchedAt: quote.fetchedAt,
        timezone: quote.timezone, status: 'ok', error: null, observations }
    } catch (error) {
      const prior = previous.fxHistory?.[currency]
      fxHistory[currency] = { ...(prior || { symbol, observations: [], fetchedAt: null }),
        status: prior?.observations?.length ? 'stale' : 'unavailable', error: reason(error) }
    }
  }))
  return { ...snapshot, quotes, fxHistory, homeCoverage: {
    focusCount: companies.length,
    historicalCapCompanies: quotes.filter(quote => selected.has(quote.symbol) && quote.marketCapHistory?.length).length,
    fxCurrencies: Object.keys(fxHistory).filter(currency => fxHistory[currency].status === 'ok'),
  } }
}
