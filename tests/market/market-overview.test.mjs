import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { instruments as actualInstruments } from '../../assets/instruments.js'
import { buildMarketOverview } from '../../assets/market-overview-core.js'

const now = Date.parse('2026-11-01T06:00:00Z')
const chains = [{ id: 1, name: '소부장', color: '#abc' }, { id: 2, name: '칩' }, { id: 3, name: '전력' }]
const instrument = (symbol, memberships = [1]) => ({ symbol, name: symbol + ' 회사', chains: memberships })
const quote = (symbol, changePercent, extra = {}) => ({
  symbol, price: 100, currency: 'USD', changePercent, status: 'ok',
  fetchedAt: '2026-11-01T05:30:00Z', marketTime: '2026-10-30T20:00:00Z', timezone: 'America/New_York',
  source: 'Yahoo Finance', sourceUrl: `https://finance.yahoo.com/quote/${symbol}/`, ...extra,
})
const build = options => buildMarketOverview({ chains, now, ...options })

test('overview deduplicates dynamic AI catalog and excludes indices, FX and unknown symbols', () => {
  const instruments = [instrument('A'), instrument('A'), instrument('B', [2]), instrument('^IXIC', [0]), instrument('KRW=X', [0]), instrument('OTHER', [])]
  const result = build({ instruments, quotes: [quote('A', 2), quote('B', -1), quote('^IXIC', 10), quote('KRW=X', 10), quote('UNKNOWN', 99)] })
  assert.equal(result.totalCount, 2)
  assert.equal(result.displayedCount, 2)
  assert.deepEqual(result.rows.map(row => row.symbol), ['A', 'B'])
  assert.equal(result.breadth.averageChangePercent, 0.5)
  assert.equal(build({ instruments: [...instruments, instrument('C')], quotes: [] }).totalCount, 3)
})

test('secondary filters and group averages include every member while breadth stays deduplicated', () => {
  const instruments = [instrument('A', [999, 2, 1, 2]), instrument('B', [1]), instrument('C', [2])]
  const result = build({ instruments, quotes: [quote('A', 3), quote('B', 1), quote('C', 2)], chain: 1 })
  assert.equal(result.totalCount, 3)
  assert.equal(result.displayedCount, 2)
  assert.deepEqual(result.rows[0].chains, [2, 1])
  assert.equal(result.rows[0].primaryChain, 2)
  assert.equal(result.groups.find(group => group.id === 1).totalCount, 2)
  assert.equal(result.groups.find(group => group.id === 1).validCount, 2)
  assert.equal(result.groups.find(group => group.id === 1).averageChangePercent, 2)
  assert.equal(result.groups.find(group => group.id === 2).totalCount, 1)
  assert.equal(result.groups.reduce((sum, group) => sum + group.totalCount, 0), 3)
  const selectedSecond = build({ instruments, quotes: [quote('A', 3), quote('B', 1), quote('C', 2)], chain: 2 })
  const second = selectedSecond.groups.find(group => group.id === 2)
  assert.equal(selectedSecond.displayedCount, 2)
  assert.equal(second.totalCount, 2)
  assert.equal(second.validCount, 2)
  assert.equal(second.averageChangePercent, 2.5)
  assert.equal(result.breadth.averageChangePercent, 2)
})

test('a real zero change is neutral and missing or invalid numbers never become zero', () => {
  const values = [0, null, undefined, NaN, Infinity, '2', -Infinity]
  const instruments = values.map((_, index) => instrument('A' + index))
  const result = build({ instruments, quotes: values.map((value, index) => quote('A' + index, value)) })
  assert.equal(result.breadth.validCount, 1)
  assert.equal(result.breadth.unchanged, 1)
  assert.equal(result.breadth.averageChangePercent, 0)
  assert.equal(result.breadth.missingCount, 6)
  assert.equal(result.rows[0].changePercent, 0)
  assert.ok(result.rows.slice(1).every(row => row.changePercent === null && !row.valid && row.reason))
  assert.deepEqual(result.gainers, [])
  assert.deepEqual(result.losers, [])
})

test('stale, error and missing quotes preserve available observation data without affecting returns', () => {
  const result = build({ instruments: ['A', 'B', 'C', 'D'].map(symbol => instrument(symbol)), quotes: [
    quote('A', 4), quote('B', 999, { status: 'stale' }), quote('C', -999, { status: 'error' }),
  ] })
  assert.equal(result.breadth.validCount, 1)
  assert.equal(result.breadth.missingCount, 3)
  assert.equal(result.breadth.staleCount, 1)
  assert.equal(result.breadth.errorCount, 1)
  assert.equal(result.breadth.noQuoteCount, 1)
  assert.equal(result.breadth.averageChangePercent, 4)
  for (const row of result.rows.slice(1, 3)) {
    assert.equal(row.price, 100)
    assert.equal(row.marketTime, '2026-10-30T20:00:00Z')
    assert.equal(row.changePercent, null)
    assert.ok(row.reason)
  }
  assert.equal(result.rows[3].price, null)
  assert.equal(result.rows[3].status, 'missing')
  assert.deepEqual(result.groupRanking, [])
})

test('deduplicates quotes by newest fetchedAt rather than input order, and ties use the last quote', () => {
  const newer = quote('A', 3)
  const older = quote('A', 100, { fetchedAt: '2026-10-31T05:00:00Z' })
  const invalid = quote('A', 200, { fetchedAt: 'invalid' })
  for (const quotes of [[newer, older, invalid], [older, invalid, newer]]) {
    assert.equal(build({ instruments: [instrument('A')], quotes }).rows[0].changePercent, 3)
  }
  assert.equal(build({ instruments: [instrument('A')], quotes: [newer, quote('A', 5)] }).rows[0].changePercent, 5)
})

test('future or invalid observation and collection timestamps are excluded; an older valid quote cannot hide a newer future quote', () => {
  const instruments = ['A', 'B', 'C', 'D', 'E'].map(symbol => instrument(symbol))
  const result = build({ instruments, quotes: [
    quote('A', 3, { marketTime: '2026-11-02T00:00:00Z' }),
    quote('B', 4, { fetchedAt: '2026-11-02T00:00:00Z' }),
    quote('C', 5, { marketTime: null }), quote('D', 6, { fetchedAt: 'invalid' }),
    quote('E', 7), quote('E', 999, { fetchedAt: '2026-11-02T00:00:00Z' }),
  ] })
  assert.equal(result.breadth.validCount, 0)
  assert.equal(result.breadth.averageChangePercent, null)
  assert.ok(result.rows.every(row => row.changePercent === null && row.reason))
  assert.deepEqual(result.groupRanking, [])
})

test('dates remain visible across markets and old but explicitly ok observations are not called completed or freshly collected', () => {
  const result = build({ instruments: [instrument('A'), instrument('B')], quotes: [
    quote('A', 2, { fetchedAt: '2026-10-30T23:00:00Z', marketTime: '2026-10-30T20:00:00Z' }),
    quote('B', 4, { marketTime: '2026-10-29T06:00:00Z', timezone: 'Asia/Seoul' }),
  ] })
  assert.equal(result.breadth.validCount, 2)
  assert.notEqual(result.rows[0].marketTime, result.rows[1].marketTime)
  assert.equal(result.rows[0].fetchedAt, '2026-10-30T23:00:00Z')
  assert.equal(result.breadth.staleCount, 0)
})

test('groups need three valid companies to rank and compute equal-weight means with valid n/N', () => {
  const instruments = [instrument('A'), instrument('B'), instrument('C'), instrument('D'), instrument('E', [2]), instrument('F', [2])]
  const result = build({ instruments, quotes: [quote('A', 6), quote('B', -3), quote('C', 0), quote('E', 50), quote('F', 60)] })
  const first = result.groups.find(group => group.id === 1), second = result.groups.find(group => group.id === 2)
  assert.equal(first.totalCount, 4)
  assert.equal(first.validCount, 3)
  assert.equal(first.averageChangePercent, 1)
  assert.equal(first.advancers, 1)
  assert.equal(first.decliners, 1)
  assert.equal(first.unchanged, 1)
  assert.equal(second.averageChangePercent, 55)
  assert.equal(second.rankEligible, false)
  assert.deepEqual(result.groupRanking.map(group => group.id), [1])
})

test('gainers and losers contain only valid known AI rows, sorted and capped at five each', () => {
  const instruments = Array.from({ length: 15 }, (_, i) => instrument('A' + i))
  const result = build({ instruments, quotes: instruments.map((item, i) => quote(item.symbol, i - 7)) })
  assert.deepEqual(result.gainers.map(row => row.changePercent), [7, 6, 5, 4, 3])
  assert.deepEqual(result.losers.map(row => row.changePercent), [-7, -6, -5, -4, -3])
  assert.equal(result.breadth.unchanged, 1)
  assert.equal(result.breadth.advancers, 7)
  assert.equal(result.breadth.decliners, 7)
})

test('invalid prices and an invalid comparison clock cannot produce a colored return', () => {
  const instruments = [instrument('A'), instrument('B'), instrument('C')]
  const result = build({ instruments, quotes: [quote('A', 3, { price: 0 }), quote('B', 3, { price: null }), quote('C', 3, { price: '100' })] })
  assert.equal(result.breadth.validCount, 0)
  assert.ok(result.rows.every(row => row.price === null && row.changePercent === null))
  assert.equal(build({ instruments: [instrument('A')], quotes: [quote('A', 3)], now: NaN }).rows[0].valid, false)
})

test('derives unnamed groups if metadata is absent, handles empty input, and does not mutate inputs', () => {
  const instruments = [instrument('A', [2, 1])], quotes = [quote('A', 2)], original = structuredClone({ instruments, quotes, chains })
  const input = { instruments, quotes, chains }
  for (const list of [instruments, quotes, chains]) {
    for (const item of list) { if (Array.isArray(item.chains)) Object.freeze(item.chains); Object.freeze(item) }
    Object.freeze(list)
  }
  const result = build(input)
  assert.deepEqual(input, original)
  assert.equal(result.rows[0].primaryChain, 2)
  assert.equal(buildMarketOverview({ instruments, quotes, now }).groups[0].id, 2)
  assert.equal(buildMarketOverview().breadth.averageChangePercent, null)
  assert.equal(buildMarketOverview().totalCount, 0)
})

test('committed quote contract preserves epoch-second marketTime and computes dynamic valid catalog counts', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../../data/market.json', import.meta.url), 'utf8'))
  const realChains = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: String(i + 1) }))
  const symbols = new Set(actualInstruments.filter(item => item.chains.some(id => id > 0 && id <= 8)).map(item => item.symbol))
  const isNumber = value => typeof value === 'number' && Number.isFinite(value)
  const timestamps = snapshot.quotes.flatMap(item => [Date.parse(item.fetchedAt), typeof item.marketTime === 'number' ? item.marketTime * 1000 : Date.parse(item.marketTime)]).filter(Number.isFinite)
  const comparisonNow = Math.max(now, ...timestamps) + 1000
  const expected = snapshot.quotes.filter(item => symbols.has(item.symbol) && item.status === 'ok'
    && isNumber(item.price) && item.price > 0 && isNumber(item.changePercent)
    && typeof item.fetchedAt === 'string' && Number.isFinite(Date.parse(item.fetchedAt))
    && isNumber(item.marketTime) && item.marketTime > 0)
  assert.ok(expected.length > 0, 'the committed dataset must exercise actual numeric marketTime values')
  const result = buildMarketOverview({ quotes: snapshot.quotes, instruments: actualInstruments, chains: realChains, now: comparisonNow })
  assert.equal(result.totalCount, symbols.size)
  assert.equal(result.breadth.validCount, new Set(expected.map(item => item.symbol)).size)
  const original = expected[0], row = result.rows.find(item => item.symbol === original.symbol)
  assert.equal(row.marketTime, original.marketTime)
  assert.equal(row.changePercent, original.changePercent)
  assert.equal(row.valid, true)
  const futureTime = comparisonNow / 1000 + 1
  const future = build({ instruments: [instrument('A')], quotes: [quote('A', 2, { marketTime: futureTime })], now: comparisonNow }).rows[0]
  assert.equal(future.marketTime, futureTime)
  assert.equal(future.changePercent, null)
  assert.equal(future.valid, false)
})
