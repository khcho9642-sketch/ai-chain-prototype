import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistoricalMarketCapService, normalizeHistoricalMarketCaps } from '../../server/market-cap-history.mjs'

const observedAt = '2026-11-06T08:00:00.000Z'
const scope = { symbol: 'NVDA', startDate: '2026-07-01', endDate: '2026-11-06', observedAt }
const record = (asOfDate, value, currencyCode = 'USD') => ({ asOfDate, currencyCode, reportedValue: { raw: value } })
const row = (type, points, symbol = 'NVDA') => ({ meta: { symbol: [symbol], type: [type] }, [type]: points })
const body = (...rows) => ({ timeseries: { error: null, result: rows } })
const response = value => ({ ok: true, json: async () => value })

test('dated provider caps retain source dates and currencies without filling missing trading days', () => {
  const normalized = normalizeHistoricalMarketCaps(body(
    row('monthlyMarketCap', [record('2026-07-31', 200), record('2026-10-31', 300)]),
    row('trailingMarketCap', [record('2026-11-04', 350)]),
  ), scope)
  assert.deepEqual(normalized.observations.map(({ date, value, currency, basis }) => ({ date, value, currency, basis })), [
    { date: '2026-07-31', value: 200, currency: 'USD', basis: 'provider-dated' },
    { date: '2026-10-31', value: 300, currency: 'USD', basis: 'provider-dated' },
    { date: '2026-11-04', value: 350, currency: 'USD', basis: 'provider-dated' },
  ])
  assert.ok(!normalized.observations.some(point => point.date === '2026-11-05'))
  assert.equal(normalized.observations[0].observedAt, observedAt)
})

test('invalid, future, out-of-range, missing-currency and conflicting-date observations are unavailable', () => {
  const normalized = normalizeHistoricalMarketCaps(body(
    row('monthlyMarketCap', [record('2026-06-30', 100), record('2026-11-07', 300), record('2026-02-30', 100),
      record('2026-10-01', 0), record('2026-10-02', -1), record('2026-10-03', Infinity),
      record('2026-10-04', 100, 'GBp'), record('2026-10-05', 100, 'GBX'), record('2026-10-06', 100, null),
      record('2026-07-31', 200)]),
    row('quarterlyMarketCap', [record('2026-07-31', 201)]),
  ), scope)
  assert.deepEqual(normalized.observations, [])
  assert.deepEqual(normalized.conflictingDates, ['2026-07-31'])
  assert.equal(normalized.status, 'unavailable')
})

test('same exact observation across period types deduplicates; unexpected issuer cannot pass', () => {
  const normalized = normalizeHistoricalMarketCaps(body(row('quarterlyMarketCap', [record('2026-07-31', 200)]),
    row('trailingMarketCap', [record('2026-07-31', 200)])), scope)
  assert.equal(normalized.observations.length, 1)
  assert.equal(normalized.observations[0].series, 'trailingMarketCap')
  assert.throws(() => normalizeHistoricalMarketCaps(body(row('monthlyMarketCap', [record('2026-07-31', 200)], 'AAPL')), scope), /일치/)
  assert.throws(() => normalizeHistoricalMarketCaps({ timeseries: { error: { code: 'Denied' }, result: [] } }, scope), /형식/)
})

test('four historical cap types share one upstream request, cache and single flight with explicit query dates', async () => {
  const calls = []
  const service = createHistoricalMarketCapService({ now: () => Date.parse(observedAt), fetchImpl: async url => {
    calls.push(url); await new Promise(resolve => setTimeout(resolve, 3));
    return response(body(row('monthlyMarketCap', [record('2026-07-31', 200)])))
  } })
  const options = { startDate: '2026-07-01', endDate: '2026-11-06' }
  const [first, duplicate] = await Promise.all([service('nvda', options), service('NVDA', options)])
  assert.deepEqual(first, duplicate)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('type'), 'trailingMarketCap,monthlyMarketCap,quarterlyMarketCap,annualMarketCap')
  assert.equal(calls[0].searchParams.get('period1'), String(Date.parse('2026-07-01T00:00:00Z') / 1000))
  assert.equal(calls[0].searchParams.get('period2'), String(Date.parse('2026-11-07T00:00:00Z') / 1000))
  await service('NVDA', options)
  assert.equal(calls.length, 1)
})

test('unavailable history stays empty; malformed request never calls upstream', async () => {
  let calls = 0
  const service = createHistoricalMarketCapService({ now: () => Date.parse(observedAt), fetchImpl: async () => { calls++; return response(body()) } })
  assert.equal((await service('NVDA')).status, 'unavailable')
  for (const [symbol, options] of [['../secret', {}], ['NVDA', { startDate: '2026-02-30' }], ['NVDA', { endDate: '2026-11-07' }]]) {
    await assert.rejects(service(symbol, options), TypeError)
  }
  assert.equal(calls, 1)
})

test('failed provider and mismatched symbol responses retry one alternate host without caching failure', async () => {
  const hosts = []
  const service = createHistoricalMarketCapService({ now: () => Date.parse(observedAt), fetchImpl: async url => {
    hosts.push(url.hostname)
    return response(body(row('monthlyMarketCap', [record('2026-07-31', 200)], hosts.length === 1 ? 'AAPL' : 'NVDA')))
  } })
  assert.equal((await service('NVDA')).status, 'ok')
  assert.deepEqual(hosts, ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'])
})

test('provider timeout is bounded and reported without inventing observations', async () => {
  const service = createHistoricalMarketCapService({ now: () => Date.parse(observedAt), timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(response(body())), 500)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    }) })
  await assert.rejects(service('NVDA'), /응답 시간 초과/)
})
