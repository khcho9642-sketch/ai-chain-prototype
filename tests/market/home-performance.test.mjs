import test from 'node:test'
import assert from 'node:assert/strict'
import { SECTORS } from '../../assets/home-map-core.js'
import { buildComparison } from '../../assets/peer-comparison-core.js'
import { buildSectorReturns } from '../../assets/home-performance.js'

const now = Date.parse('2026-11-10T12:00:00Z')
const sectorId = SECTORS[0].id
const company = ticker => ({ ticker, name: ticker, sectorId })
const companies = [company('AAA'), company('BBB')]
const seconds = date => Date.parse(date + 'T14:30:00Z') / 1000
const cap = (date, value, currency = 'USD', extra = {}) => ({
  date, value, currency, basis: 'provider-dated', series: 'trailingMarketCap', source: 'Yahoo Finance',
  sourceUrl: 'https://finance.yahoo.com/', observedAt: '2026-11-10T10:00:00Z', ...extra,
})
function quote(symbol, prices = [100, 110], dates = ['2026-11-02', '2026-11-03'], extra = {}) {
  return { symbol, name: symbol, timezone: 'America/New_York', currency: 'USD',
    fetchedAt: '2026-11-10T10:00:00Z', source: 'Yahoo Finance', status: 'ok',
    priceBasis: 'previous-completed-session', closeDate: dates.at(-1), interval: '1d', range: '1y',
    bars: dates.map((date, index) => ({ time: seconds(date), close: prices[index] })),
    marketCapHistory: [cap(dates[0], 100)], ...extra }
}
const snapshot = (quotes, extra = {}) => ({ schemaVersion: 1, generatedAt: '2026-11-10T10:00:00Z', source: 'Yahoo Finance', quotes, ...extra })
const model = (quotes, options = {}) => buildSectorReturns({ snapshot: snapshot(quotes), companies, period: '1d', now, ...options })
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

test('default result preserves all existing sectors and gracefully handles missing snapshots', () => {
  const result = buildSectorReturns({ companies })
  assert.deepEqual(result.sectors.map(({ sectorId, name, color }) => ({ sectorId, name, color })), SECTORS.map(({ id, name, color }) => ({ sectorId: id, name, color })))
  assert.equal(result.sectors[0].total, 2)
  assert.equal(result.sectors[0].eq, null)
  assert.equal(result.sectors[0].cap, null)
  assert.ok(result.warnings.length)
  assert.doesNotThrow(() => buildSectorReturns({ snapshot: { quotes: [] }, companies }))
})

test('equal weights match the existing fixed-peer calculation on the same dates and universe', () => {
  const dates = ['2026-08-07', '2026-09-01', '2026-11-05']
  const quotes = [quote('AAA', [100, 110, 120], dates), quote('BBB', [200, 180, 220], dates)]
  const input = snapshot(quotes)
  const result = buildSectorReturns({ snapshot: input, companies, period: '3mo', now })
  const reference = buildComparison({ quotes, instruments: companies.map(c => ({ symbol: c.ticker, name: c.name, chains: [1] })), chains: [{ id: 1, name: SECTORS[0].name }], days: 90, requireFullPeriod: true, now })
  close(result.sectors[0].eq, reference.groups[0].returnPercent)
  assert.equal(result.startDate, reference.startDate)
  assert.equal(result.endDate, reference.endDate)
  close(result.sectors[0].eq, 15)
})

test('capitalization weights use exact beginning-date observations, ignoring reversed current caps', () => {
  const quotes = [quote('AAA', [100, 110], undefined, { marketCap: 1, marketCapHistory: [cap('2026-11-02', 900)] }),
    quote('BBB', [100, 100], undefined, { marketCap: 900000, marketCapHistory: [cap('2026-11-02', 100)] })]
  const sector = model(quotes).sectors[0]
  close(sector.eq, 5)
  close(sector.cap, 9)
  assert.equal(sector.eqCount, 2)
  assert.equal(sector.capCount, 2)
  assert.equal(sector.capMissing, false)
  assert.equal(sector.divergence, '대형주 쏠림')
})

test('start-date FX makes mixed market caps comparable and no raw currencies are summed', () => {
  const quotes = [quote('AAA', [100, 110], undefined, { marketCapHistory: [cap('2026-11-02', 100)] }),
    quote('BBB', [100, 100], undefined, { currency: 'KRW', marketCapHistory: [cap('2026-11-02', 1000000, 'KRW')] })]
  const input = snapshot(quotes, { fxHistory: { KRW: { currency: 'KRW', observations: [{ date: '2026-11-02', unitsPerUSD: 1000 }] } } })
  const sector = model(quotes, { snapshot: input }).sectors[0]
  close(sector.cap, 10 / 11)
  assert.equal(sector.capCount, 2)
  assert.equal(sector.peers[1].capUSD, 1000)
})

test('confirmed USD FX quote histories can supply the exact conversion date', () => {
  const quotes = [quote('AAA', [100, 110], undefined, { marketCapHistory: [cap('2026-11-02', 1000, 'JPY')] }),
    quote('BBB', [100, 100], undefined, { marketCapHistory: [cap('2026-11-02', 100)] }),
    quote('JPY=X', [100, 110], undefined, { currency: 'JPY', timezone: 'UTC' })]
  const sector = model(quotes).sectors[0]
  close(sector.cap, 10 / 11)
  assert.equal(sector.peers[0].capUSD, 10)
})

test('missing exact start cap or FX excludes only affected weighted peers and suppresses cohort-dependent tags', () => {
  const quotes = [quote('AAA', [100, 110], undefined, { marketCap: 100000, marketCapHistory: [cap('2026-11-01', 900)] }),
    quote('BBB', [100, 100], undefined, { marketCapHistory: [cap('2026-11-02', 100)] })]
  const sector = model(quotes).sectors[0]
  close(sector.eq, 5)
  assert.equal(sector.cap, 0)
  assert.equal(sector.capMissing, true)
  assert.equal(sector.capCount, 1)
  assert.equal(sector.gap, null)
  assert.equal(sector.divergence, null)
  assert.match(sector.peers[0].capReason, /시작일 시총/)
  quotes[0].marketCapHistory = [cap('2026-11-02', 900, 'KRW')]
  const input = snapshot(quotes, { fxHistory: { KRW: { observations: [{ date: '2026-11-01', unitsPerUSD: 1000 }] } } })
  const withoutFx = model(quotes, { snapshot: input }).sectors[0]
  assert.equal(withoutFx.capCount, 1)
  assert.match(withoutFx.peers[0].capReason, /환율/)
})

test('the three percentage-point threshold includes the boundary but not a smaller difference', () => {
  const run = weight => model([quote('AAA', [100, 110], undefined, { marketCapHistory: [cap('2026-11-02', weight)] }), quote('BBB', [100, 100], undefined, { marketCapHistory: [cap('2026-11-02', 10 - weight)] })]).sectors[0]
  assert.equal(run(8).divergence, '대형주 쏠림')
  assert.equal(run(7.999).divergence, null)
  assert.equal(run(2).divergence, '중소형↑')
})

test('one-day means previous actual common trading session across a weekend', () => {
  const dates = ['2026-11-05', '2026-11-06', '2026-11-09']
  const result = model([quote('AAA', [100, 110, 121], dates), quote('BBB', [100, 100, 100], dates)])
  assert.equal(result.startDate, '2026-11-06')
  assert.equal(result.endDate, '2026-11-09')
  close(result.sectors[0].eq, 5)
})

test('legacy capture-day candles remain excluded even when that capture is several days old', () => {
  const dates = ['2026-11-04', '2026-11-05', '2026-11-06']
  const legacy = quote('AAA', [100, 110, 999], dates, { fetchedAt: '2026-11-06T16:00:00Z' })
  delete legacy.priceBasis
  delete legacy.closeDate
  const result = model([legacy], { companies: [company('AAA')] })
  assert.equal(result.startDate, '2026-11-04')
  assert.equal(result.endDate, '2026-11-05')
  close(result.sectors[0].eq, 10)
  assert.deepEqual(result.closeDates, ['2026-11-05'])
})

test('a declared completed closeDate excludes appended later partial or future candles', () => {
  const dates = ['2026-11-04', '2026-11-05', '2026-11-06']
  const closed = quote('AAA', [100, 110, 999], dates, { closeDate: '2026-11-05' })
  const result = model([closed], { companies: [company('AAA')] })
  assert.equal(result.endDate, '2026-11-05')
  close(result.sectors[0].eq, 10)
})

test('zero returns remain numbers while invalid, conflicting and current-only cap values remain missing', () => {
  const quotes = [quote('AAA', [100, 100], undefined, { marketCapHistory: [cap('2026-11-02', 1), cap('2026-11-02', 2)] }),
    quote('BBB', [100, 100], undefined, { marketCap: 1000, marketCapHistory: [cap('2026-11-02', 100, 'USD', { basis: 'provider-current' }), cap('2026-11-02', 0), cap('2026-11-02', Infinity)] })]
  const sector = model(quotes).sectors[0]
  assert.equal(sector.eq, 0)
  assert.equal(sector.cap, null)
  assert.equal(sector.capCount, 0)
  assert.match(sector.peers[0].capReason, /충돌/)
  assert.equal(sector.divergence, null)
})
