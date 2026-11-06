import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDailyClose, createDailyCloseService } from '../../server/market-close.mjs'

const seconds = date => Date.parse(date) / 1000
function fixture({ symbol = 'NVDA', timezone = 'America/New_York', rows = [
  ['2026-11-04T14:30:00Z', 100], ['2026-11-05T14:30:00Z', 110], ['2026-11-06T14:30:00Z', 999],
], session = ['2026-11-06T14:30:00Z', '2026-11-06T21:00:00Z'] } = {}) {
  return {
    meta: {
      symbol, currency: 'USD', exchangeTimezoneName: timezone, dataGranularity: '1d',
      regularMarketPrice: 999, previousClose: 888, shortName: 'NVIDIA',
      currentTradingPeriod: session && { regular: { start: seconds(session[0]), end: seconds(session[1]) } },
    },
    timestamp: rows.map(([date]) => seconds(date)),
    indicators: { quote: [{
      open: rows.map(([, close]) => close - 2), high: rows.map(([, close]) => close + 3),
      low: rows.map(([, close]) => close - 3), close: rows.map(([, close]) => close),
      volume: rows.map((_, i) => 1000 + i),
    }] },
    events: { dividends: { sample: { amount: 0.01 } } },
  }
}
const responseFor = result => ({ ok: true, json: async () => ({ chart: { result: [result], error: null } }) })

test('in-progress daily candle never becomes a closing price or previous-close baseline', () => {
  const quote = normalizeDailyClose(fixture(), { now: '2026-11-06T18:00:00Z' })
  assert.equal(quote.price, 110)
  assert.equal(quote.previousClose, 100)
  assert.equal(quote.change, 10)
  assert.equal(quote.changePercent, 10)
  assert.equal(quote.closeDate, '2026-11-05')
  assert.equal(quote.previousCloseDate, '2026-11-04')
  assert.equal(quote.priceBasis, 'previous-completed-session')
  assert.equal(quote.marketTime, seconds('2026-11-05T14:30:00Z'))
  assert.equal(quote.marketTimeBasis, 'daily-bar-start')
  assert.equal(quote.sessionCloseTime, null)
  assert.equal(quote.open, 108)
  assert.equal(quote.volume, 1001)
  assert.equal(quote.bars.length, 2)
  assert.equal(quote.fetchedAt, '2026-11-06T18:00:00.000Z')
})

test('current session is accepted only after its close plus the provider-delay allowance', () => {
  const raw = fixture()
  assert.equal(normalizeDailyClose(raw, { now: '2026-11-06T21:19:59Z' }).closeDate, '2026-11-05')
  const quote = normalizeDailyClose(raw, { now: '2026-11-06T21:20:00Z' })
  assert.equal(quote.closeDate, '2026-11-06')
  assert.equal(quote.price, 999)
  assert.equal(quote.previousClose, 110)
  assert.equal(quote.sessionCloseTime, seconds('2026-11-06T21:00:00Z'))
  assert.equal(quote.events.dividends.sample.amount, 0.01)
})

test('weekends and market holidays retain the latest actual session without inventing calendar days', () => {
  const weekend = normalizeDailyClose(fixture(), { now: '2026-11-08T16:00:00Z' })
  assert.equal(weekend.closeDate, '2026-11-06')
  const holiday = fixture({ rows: [['2026-11-25T14:30:00Z', 120]], session: ['2026-11-27T14:30:00Z', '2026-11-27T18:00:00Z'] })
  const quote = normalizeDailyClose(holiday, { now: '2026-11-26T20:00:00Z' })
  assert.equal(quote.closeDate, '2026-11-25')
  assert.equal(quote.previousClose, null)
  assert.equal(quote.changePercent, null)
})

test('an ongoing overnight session is excluded even when its candle starts on the previous local date', () => {
  const raw = fixture({ symbol: 'GC=F', rows: [
    ['2026-11-03T23:00:00Z', 90], ['2026-11-04T23:00:00Z', 100], ['2026-11-05T23:00:00Z', 999],
  ], session: ['2026-11-05T23:00:00Z', '2026-11-06T22:00:00Z'] })
  const during = normalizeDailyClose(raw, { now: '2026-11-06T18:00:00Z' })
  assert.equal(during.closeDate, '2026-11-04')
  assert.equal(during.price, 100)
  assert.equal(during.previousClose, 90)
  assert.equal(during.bars.length, 2)
  assert.equal(normalizeDailyClose(raw, { now: '2026-11-06T22:19:59Z' }).price, 100)
  const complete = normalizeDailyClose(raw, { now: '2026-11-06T22:20:00Z' })
  assert.equal(complete.closeDate, '2026-11-05')
  assert.equal(complete.price, 999)
  assert.equal(complete.sessionCloseTime, seconds('2026-11-06T22:00:00Z'))
})

test('exchange-local dates handle Korea versus the US and do not use UTC calendar boundaries', () => {
  const rows = [['2026-11-04T00:00:00Z', 90], ['2026-11-05T00:00:00Z', 100], ['2026-11-06T00:00:00Z', 105]]
  const korea = fixture({ symbol: '005930.KS', timezone: 'Asia/Seoul', rows, session: ['2026-11-06T00:00:00Z', '2026-11-06T06:30:00Z'] })
  assert.equal(normalizeDailyClose(korea, { now: '2026-11-06T07:00:00Z' }).closeDate, '2026-11-06')
  assert.equal(normalizeDailyClose(fixture(), { now: '2026-11-06T07:00:00Z' }).closeDate, '2026-11-05')
  const afterMidnightUtc = fixture({ rows: [['2026-11-04T14:30:00Z', 90], ['2026-11-05T14:30:00Z', 100], ['2026-11-06T00:00:00Z', 110]], session: null })
  assert.equal(normalizeDailyClose(afterMidnightUtc, { now: '2026-11-06T01:00:00Z' }).closeDate, '2026-11-04')
})

test('missing, malformed, or mismatched session metadata conservatively excludes today', () => {
  for (const session of [null, ['2026-11-09T14:30:00Z', '2026-11-09T21:00:00Z'], ['2026-11-06T22:00:00Z', '2026-11-06T21:00:00Z']]) {
    assert.equal(normalizeDailyClose(fixture({ session }), { now: '2026-11-06T23:00:00Z' }).closeDate, '2026-11-05')
  }
})

test('DST and early closes follow actual supplied session boundaries rather than hardcoded local hours', () => {
  const raw = fixture({ rows: [['2026-11-25T14:30:00Z', 100], ['2026-11-27T14:30:00Z', 110]], session: ['2026-11-27T14:30:00Z', '2026-11-27T18:00:00Z'] })
  assert.equal(normalizeDailyClose(raw, { now: '2026-11-27T18:19:59Z' }).closeDate, '2026-11-25')
  assert.equal(normalizeDailyClose(raw, { now: '2026-11-27T18:20:00Z' }).closeDate, '2026-11-27')
  const dst = fixture({ rows: [['2026-10-29T13:30:00Z', 100], ['2026-10-30T13:30:00Z', 110]], session: ['2026-10-30T13:30:00Z', '2026-10-30T20:00:00Z'] })
  assert.equal(normalizeDailyClose(dst, { now: '2026-10-30T20:20:00Z' }).closeDate, '2026-10-30')
})

test('invalid observations and future sessions are rejected; duplicates deterministically use the latest observation', () => {
  const raw = fixture({ rows: [['2026-11-05T14:30:00Z', 100], ['2026-11-04T14:30:00Z', 90], ['2026-11-05T14:31:00Z', 110], ['2026-11-09T14:30:00Z', 1000]] })
  raw.timestamp.push(null, Infinity, seconds('2026-11-03T14:30:00Z'))
  raw.indicators.quote[0].close.push(1, 2, NaN)
  const quote = normalizeDailyClose(raw, { now: '2026-11-06T18:00:00Z' })
  assert.deepEqual(quote.bars.map(bar => bar.close), [90, 110])
  assert.equal(quote.previousClose, 90)
  assert.equal(quote.price, 110)
  assert.ok(Math.abs(quote.changePercent - (110 / 90 - 1) * 100) < 1e-10)
  for (const close of [0, -1, null, NaN, Infinity]) {
    const invalid = fixture({ rows: [['2026-11-05T14:30:00Z', close]] })
    assert.throws(() => normalizeDailyClose(invalid, { now: '2026-11-06T18:00:00Z' }), /확정/)
  }
})

test('missing or invalid symbol, timezone, daily interval, and clock never create a plausible close', () => {
  for (const [field, value] of [['symbol', ''], ['symbol', '../private'], ['exchangeTimezoneName', ''], ['exchangeTimezoneName', 'invalid/timezone'], ['dataGranularity', '5m']]) {
    const raw = fixture(); raw.meta[field] = value
    assert.throws(() => normalizeDailyClose(raw, { now: '2026-11-06T18:00:00Z' }))
  }
  assert.throws(() => normalizeDailyClose(fixture(), { now: NaN }))
  assert.throws(() => normalizeDailyClose(fixture(), { graceMinutes: -1 }))
})

test('daily service makes only a daily history request, shares concurrent work, and rejects mismatched symbols', async () => {
  const urls = []
  const service = createDailyCloseService({ now: () => Date.parse('2026-11-06T18:00:00Z'), fetchImpl: async url => {
    urls.push(url); return responseFor(fixture())
  } })
  const [quote, duplicate] = await Promise.all([service('nvda'), service('NVDA')])
  assert.deepEqual(quote, duplicate)
  await service('NVDA')
  assert.equal(urls.length, 1)
  assert.equal(urls[0].searchParams.has('range'), false)
  assert.equal(Number(urls[0].searchParams.get('period1')), seconds('2025-10-22T18:00:00Z'))
  assert.equal(Number(urls[0].searchParams.get('period2')), seconds('2026-11-06T18:00:00Z'))
  assert.equal(urls[0].searchParams.get('interval'), '1d')
  assert.equal(urls[0].searchParams.get('events'), 'div,splits')
  assert.equal(quote.range, '1y')
  assert.deepEqual(quote.historyWindow, {requestedRange:'1y',from:'2025-10-22T18:00:00.000Z',to:'2026-11-06T18:00:00.000Z',bufferDays:15})
  const mismatch = createDailyCloseService({ fetchImpl: async () => responseFor(fixture({ symbol: 'AAPL' })) })
  await assert.rejects(mismatch('NVDA'), error => error.status === 502 && error.message.includes('일치'))
})

test('daily service fails over to the second host and never fetches an invalid symbol', async () => {
  const seen = []
  const service = createDailyCloseService({ now: () => Date.parse('2026-11-06T18:00:00Z'), fetchImpl: async url => {
    seen.push(url.hostname)
    return url.hostname.startsWith('query1') ? { ok: false, status: 429 } : responseFor(fixture())
  } })
  assert.equal((await service('NVDA')).price, 110)
  assert.deepEqual(seen, ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'])
  for (const symbol of ['../.env', '', null, 'https://example.com']) await assert.rejects(service(symbol), error => error.status === 400)
  assert.equal(seen.length, 2)
})

test('one-year requests include 380 calendar days through a leap year without promoting incomplete candles', async () => {
  const nowMs=Date.parse('2028-02-29T18:00:00Z'),urls=[]
  const raw=fixture({rows:[['2027-02-26T14:30:00Z',50],['2028-02-28T14:30:00Z',100],['2028-02-29T14:30:00Z',999]],
    session:['2028-02-29T14:30:00Z','2028-02-29T21:00:00Z']})
  const service=createDailyCloseService({now:()=>nowMs,fetchImpl:async url=>{urls.push(url);return responseFor(raw)}})
  const quote=await service('NVDA')
  const start=Number(urls[0].searchParams.get('period1')),end=Number(urls[0].searchParams.get('period2'))
  assert.equal((end-start)/86400,380)
  assert.equal(start,seconds('2027-02-14T18:00:00Z'))
  assert.equal(quote.closeDate,'2028-02-28')
  assert.deepEqual(quote.bars.map(bar=>bar.close),[50,100])
})

test('three-year completed closes request exact daily periods and use a distinct cache entry', async () => {
  const nowMs = Date.parse('2026-11-06T18:00:00Z'), urls = []
  const service = createDailyCloseService({ now: () => nowMs, fetchImpl: async url => {
    urls.push(url); return responseFor(fixture())
  } })
  const long = await service('NVDA', '3y')
  assert.equal(long.range, '3y')
  assert.equal(long.interval, '1d')
  assert.equal(long.closeDate, '2026-11-05')
  assert.equal(long.bars.length, 2)
  assert.equal(urls[0].searchParams.has('range'), false)
  assert.equal(urls[0].searchParams.get('interval'), '1d')
  assert.equal(Number(urls[0].searchParams.get('period1')), seconds('2023-10-23T18:00:00Z'))
  assert.equal(Number(urls[0].searchParams.get('period2')), nowMs / 1000)
  await service('NVDA', '3y')
  assert.equal(urls.length, 1)
  assert.equal((await service('NVDA', '1y')).range, '1y')
  assert.equal(urls.length, 2)
  await assert.rejects(service('NVDA', '1d'), error => error.status === 400)
  assert.equal(urls.length, 2)
})

test('failed daily fetches are not cached and timeouts remain explicit', async () => {
  let broken = true, count = 0
  const service = createDailyCloseService({ now: () => Date.parse('2026-11-06T18:00:00Z'), fetchImpl: async () => {
    count++; return responseFor(broken ? {} : fixture())
  } })
  await assert.rejects(service('NVDA'), error => error.status === 502)
  broken = false
  assert.equal((await service('NVDA')).price, 110)
  assert.equal(count, 3)
  const timeout = createDailyCloseService({ timeoutMs: 1, fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(responseFor(fixture())), 1000)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  }) })
  await assert.rejects(timeout('NVDA'), error => error.status === 502 && error.message.includes('시간 초과'))
})
