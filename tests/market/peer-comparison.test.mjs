import test from 'node:test'
import assert from 'node:assert/strict'
import { buildComparison, comparisonPeriods } from '../../assets/peer-comparison-core.js'

const now = '2026-01-10T22:00:00Z'
const unix = date => Date.parse(date) / 1000
const bars = values => values.map(([date, close]) => ({ time: unix(`${date}T20:00:00Z`), close }))
const q = (symbol, values, extra = {}) => ({ symbol, timezone: 'America/New_York', currency: 'USD', source: 'fixture', status: 'ok', fetchedAt: now, interval: '1d', bars: bars(values), ...extra })
const instrument = (symbol, chains = [1]) => ({ symbol, name: symbol, chains })
const chains = [{ id: 1, name: '메모리' }, { id: 2, name: '파운드리' }]
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const build = (quotes, instruments = quotes.map(item => instrument(item.symbol)), extra = {}) => buildComparison({ quotes, instruments, chains, now, ...extra })

test('averages normalized cumulative returns, not nominal prices or daily rebalanced returns', () => {
  const result = build([
    q('A', [['2026-01-02', 100], ['2026-01-05', 200], ['2026-01-06', 200]]),
    q('B', [['2026-01-02', 1000], ['2026-01-05', 1000], ['2026-01-06', 2000]]),
  ])
  assert.deepEqual(result.groups[0].series.map(point => point.index), [100, 150, 200])
  approx(result.groups[0].returnPercent, 100)
  assert.equal(result.methodology.dailyRebalanced, false)
  assert.equal(result.methodology.fxAdjusted, false)
  assert.equal(result.methodology.dividendsReinvested, false)
})

test('normalizes each timestamp to the quote exchange timezone before intersecting dates', () => {
  const result = build([
    q('KR', [], { timezone: 'Asia/Seoul', bars: [{ time: unix('2026-01-01T20:00:00Z'), close: 100 }, { time: unix('2026-01-02T20:00:00Z'), close: 110 }] }),
    q('US', [['2026-01-02', 200], ['2026-01-03', 220]]),
  ])
  assert.deepEqual(result.dates, ['2026-01-02', '2026-01-03'])
  approx(result.groups[0].returnPercent, 10)
})

test('all groups use the same intersection and never interpolate a missing trading day', () => {
  const result = build([
    q('A', [['2026-01-02', 100], ['2026-01-05', 130], ['2026-01-06', 120]]),
    q('B', [['2026-01-02', 200], ['2026-01-06', 180]]),
  ], [instrument('A', [1]), instrument('B', [2])])
  assert.deepEqual(result.dates, ['2026-01-02', '2026-01-06'])
  for (const group of result.groups) assert.deepEqual(group.series.map(point => point.date), result.dates)
  approx(result.groups[0].returnPercent, 20)
  approx(result.groups[1].returnPercent, -10)
})

test('missing quotes and invalid close histories are explicit exclusions, never zero return peers', () => {
  const result = build([
    q('A', [['2026-01-02', 100], ['2026-01-06', 120]]),
    q('BAD', [['2026-01-02', 0], ['2026-01-03', -1], ['2026-01-04', null], ['2026-01-05', '100'], ['2026-01-06', NaN]]),
  ], [instrument('A'), instrument('BAD'), instrument('MISSING')])
  const group = result.groups[0]
  assert.equal(group.peerCount, 3)
  assert.equal(group.includedCount, 1)
  assert.equal(group.excludedCount, 2)
  approx(group.coverage, 1 / 3)
  approx(group.returnPercent, 20)
  assert.equal(group.peers.find(peer => peer.symbol === 'MISSING').reason, '시세 수집값 없음')
  assert.equal(group.peers.find(peer => peer.symbol === 'BAD').reason, '유효 종가가 2거래일 미만')
  assert.equal(result.metadata.rejectedBarCount, 5)
})

test('calendar range filters shared points without silently changing the peer denominator', () => {
  const result = build([
    q('A', [['2025-11-01', 100], ['2025-12-01', 110], ['2026-01-01', 120], ['2026-01-06', 132]]),
    q('B', [['2025-11-01', 100], ['2025-12-01', 90], ['2026-01-01', 80], ['2026-01-06', 88]]),
  ], undefined, { days: '1mo' })
  assert.equal(result.days, 30)
  assert.deepEqual(result.dates, ['2026-01-01', '2026-01-06'])
  assert.equal(result.groups[0].includedCount, 2)
  assert.equal(result.metadata.requestedStartDate, '2025-12-07')
  approx(result.groups[0].returnPercent, 10)
  assert.deepEqual(comparisonPeriods, { '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365 })
})

test('a completely missing group is unavailable while other valid groups still compare', () => {
  const result = build([q('A', [['2026-01-02', 100], ['2026-01-06', 110]])], [instrument('A', [1]), instrument('B', [2])])
  assert.equal(result.groups[0].available, true)
  assert.equal(result.groups[1].available, false)
  assert.equal(result.groups[1].returnPercent, null)
  assert.equal(result.groups[1].rank, null)
  assert.equal(result.groups[1].unavailableReason, '유효 이력이 있는 피어 없음')
  assert.equal(result.ranking.length, 1)
})

test('fewer than two global common dates yields no invented performance or ranking', () => {
  const result = build([
    q('A', [['2026-01-02', 100], ['2026-01-05', 110]]),
    q('B', [['2026-01-05', 100], ['2026-01-06', 120]]),
  ], [instrument('A', [1]), instrument('B', [2])])
  assert.equal(result.metadata.commonDatesAvailable, false)
  assert.equal(result.ranking.length, 0)
  for (const group of result.groups) {
    assert.equal(group.available, false)
    assert.equal(group.returnPercent, null)
    assert.deepEqual(group.series, [])
  }
})

test('stale source status and old fetchedAt remain visible even with valid price history', () => {
  const result = build([q('A', [['2026-01-02', 100], ['2026-01-06', 110]], { fetchedAt: '2026-01-08T00:00:00Z', status: 'stale' })])
  assert.equal(result.groups[0].available, true)
  assert.equal(result.groups[0].stale, true)
  assert.equal(result.metadata.stale, true)
  assert.equal(result.groups[0].peers[0].fetchedAt, '2026-01-08T00:00:00Z')
  assert.ok(result.metadata.warnings.length)
})

test('overlapping catalog membership counts a company once in each relevant group, not twice globally', () => {
  const quote = q('A', [['2026-01-02', 100], ['2026-01-06', 110]])
  const inputs = [instrument('A', [1, 2]), instrument('A', [1, 2])]
  const before = JSON.stringify({ quote, inputs })
  const result = build([quote], inputs)
  assert.equal(result.metadata.totalUniquePeers, 1)
  assert.deepEqual(result.groups.map(group => group.includedCount), [1, 1])
  assert.equal(JSON.stringify({ quote, inputs }), before)
})

test('uses collected close rather than spot price or adjusted close fields and preserves currencies', () => {
  const result = build([
    q('A', [['2026-01-02', 100], ['2026-01-06', 110]], { price: 10000, currency: 'KRW' }),
    q('B', [['2026-01-02', 1], ['2026-01-06', 1.1]], { price: 0.001, currency: 'USD' }),
  ])
  approx(result.groups[0].returnPercent, 10)
  assert.deepEqual(result.groups[0].peers.map(peer => peer.currency), ['KRW', 'USD'])
  assert.equal(result.methodology.priceField, 'close')
  assert.equal(result.methodology.adjustedCloseUsed, false)
})

test('ranks available group period returns descending and retains original group display order', () => {
  const result = build([
    q('A', [['2026-01-02', 100], ['2026-01-06', 90]]),
    q('B', [['2026-01-02', 100], ['2026-01-06', 125]]),
  ], [instrument('A', [1]), instrument('B', [2])])
  assert.deepEqual(result.ranking.map(group => group.id), [2, 1])
  assert.deepEqual(result.groups.map(group => group.id), [1, 2])
  assert.deepEqual(result.groups.map(group => group.rank), [2, 1])
})

test('does not treat invalid timezone or weekly histories as daily observations', () => {
  const result = build([
    q('A', [['2026-01-02', 100], ['2026-01-06', 110]]),
    q('TZ', [['2026-01-02', 100], ['2026-01-06', 110]], { timezone: 'Invalid/Zone' }),
    q('WEEK', [['2026-01-02', 100], ['2026-01-06', 110]], { interval: '1wk' }),
  ])
  assert.equal(result.groups[0].excludedCount, 2)
  assert.equal(result.groups[0].peers.find(peer => peer.symbol === 'TZ').reason, '거래소 시간대 없음 또는 오류')
  assert.equal(result.groups[0].peers.find(peer => peer.symbol === 'WEEK').reason, '일봉이 아닌 이력')
})

test('supports explicit daily bars1year, latest duplicate quote metadata, and provenance', () => {
  const previous = q('A', [['2026-01-02', 100], ['2026-01-06', 300]], { fetchedAt: '2026-01-09T00:00:00Z' })
  const latest = q('A', [], { bars1year: bars([['2026-01-02', 100], ['2026-01-06', 110]]) })
  const result = build([previous, latest], [instrument('A')], { generatedAt: now, source: 'test source' })
  approx(result.groups[0].returnPercent, 10)
  assert.equal(result.metadata.source, 'test source')
  assert.equal(result.metadata.generatedAt, now)
  assert.equal(result.metadata.latestFetchedAt, now)
})

test('excludes future observations while preserving past performance and an already started partial daily session', () => {
  const result = build([
    q('A', [['2026-01-08', 100], ['2026-01-10', 110], ['2026-01-11', 1000], ['2026-01-12', 2000]]),
  ])
  assert.deepEqual(result.dates, ['2026-01-08', '2026-01-10'])
  assert.equal(result.endDate, '2026-01-10')
  assert.equal(result.groups[0].peers[0].endClose, 110)
  approx(result.groups[0].returnPercent, 10)
  assert.equal(result.metadata.rejectedBarCount, 2)
  assert.equal(result.groups[0].peers[0].validBarCount, 2)
  // Session-start timestamps <= now are permitted; their close may still change.
  assert.equal(result.metadata.partialSessionPossible, true)
  assert.ok(result.groups[0].peers[0].warnings.some(warning => warning.includes('2개 제외')))
})

test('rejects invalid range or clock rather than quietly returning a misleading result', () => {
  assert.throws(() => buildComparison({ days: 0 }), RangeError)
  assert.throws(() => buildComparison({ days: 'unknown' }), RangeError)
  assert.throws(() => buildComparison({ now: 'no date' }), RangeError)
})
