import { normalizeHistoricalMarketCaps } from '../../server/market-cap-history.mjs'

const series = ['trailingMarketCap','trailingTotalRevenue','quarterlyTotalRevenue',
  'trailingNetIncomeCommonStockholders','quarterlyNetIncomeCommonStockholders','trailingPeRatio']
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const types = { trailingTotalRevenue:'TTM',quarterlyTotalRevenue:'3M',
  trailingNetIncomeCommonStockholders:'TTM',quarterlyNetIncomeCommonStockholders:'3M' }

export function readCompanySeries(body, ticker, startDate, endDate, fetchedAt) {
  const caps = normalizeHistoricalMarketCaps(body, { symbol:ticker,startDate,endDate,observedAt:fetchedAt })
  const result = { ticker, fetchedAt, caps:caps.observations.slice(-10) }
  for (const type of series.slice(1)) {
    const matches = body.timeseries.result.filter(item => item?.meta?.type?.[0] === type)
    const values = new Map()
    const conflicts = new Set()
    for (const match of matches) {
      if (match.meta?.symbol?.length !== 1 || match.meta.symbol[0]?.toUpperCase() !== ticker) throw Error('재무 응답 종목 불일치')
      for (const item of match[type] || []) {
        const date = item.asOfDate, value = item.reportedValue?.raw, currency = item.currencyCode
        if (!isoDay(date) || date > endDate || date < startDate || !Number.isFinite(value)) continue
        if (type !== 'trailingPeRatio' && (item.periodType !== types[type] || !/^[A-Z]{3}$/.test(currency || ''))) continue
        const point = { date, value, currency:currency || null }
        const prior = values.get(date)
        if (prior && (prior.value !== value || prior.currency !== point.currency)) conflicts.add(date)
        values.set(date,point)
      }
    }
    result[type] = [...values.values()].filter(point => !conflicts.has(point.date))
      .sort((a,b) => a.date.localeCompare(b.date)).slice(type === 'trailingPeRatio' ? -10 : -12)
  }
  return result
}

export async function fetchCompanySeries(ticker, { now = new Date(), fetcher = fetch } = {}) {
  const end = new Date(now), start = new Date(now)
  start.setUTCMonth(start.getUTCMonth() - 32)
  const startDay = start.toISOString().slice(0,10), endDay = end.toISOString().slice(0,10)
  const params = new URLSearchParams({symbol:ticker,type:series.join(','),
    period1:String(Math.floor(+start/1000)),period2:String(Math.floor(+end/1000)+86400)})
  let last
  for (const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
    try {
      const url = 'https://' + host + '/ws/fundamentals-timeseries/v1/finance/timeseries/' + encodeURIComponent(ticker) + '?' + params
      const response = await fetcher(url,{headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'},signal:AbortSignal.timeout(16000)})
      if (!response.ok) throw Error('금융 제공처 HTTP ' + response.status)
      const value = await response.json()
      return readCompanySeries(value,ticker,startDay,endDay,end.toISOString())
    } catch (error) { last = error }
  }
  throw last
}
