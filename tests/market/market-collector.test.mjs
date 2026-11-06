import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collect } from '../../scripts/data/collect-market.mjs'

const attemptAt = '2026-11-06T08:00:00.000Z'
const oldFetchedAt = '2026-11-04T23:00:00.000Z'
const now = () => Date.parse(attemptAt)
const logger = { log() {}, error() {} }
const item = symbol => ({ symbol, name: 'Company ' + symbol, chains: [4], group: '해외' })
const closing = (symbol, extra = {}) => ({
  symbol, price: 110, previousClose: 100, change: 10, changePercent: 10,
  currency: 'USD', timezone: 'America/New_York', closeDate: '2026-11-05',
  priceBasis: 'previous-completed-session', fetchedAt: attemptAt,
  marketTime: Date.parse('2026-11-05T14:30:00Z') / 1000, interval: '1d', range: '1y',
  bars: [{ time: Date.parse('2026-11-04T14:30:00Z') / 1000, close: 100 }, { time: Date.parse('2026-11-05T14:30:00Z') / 1000, close: 110 }],
  ...extra,
})
const cap = symbol => ({ symbol, marketCap: 1000, currency: 'USD', sharesOutstanding: 10,
  marketCapAsOf: null, marketCapObservedAt: attemptAt, sharesObservedAt: attemptAt,
  marketCapBasis: 'provider-current', fetchedAt: attemptAt })
const universe = symbols => ({ targets: symbols.map(item), coverage: { companyCount: symbols.length, listedCompanyCount: symbols.length, unmapped: [] } })
const defaults = {
  now, logger, includeHistories: false,
  closeService: async symbol => closing(symbol),
  batchService: async symbols => ({ quotes: symbols.map(cap), errors: [] }),
  chartService: async () => { throw new Error('unexpected chart request') },
}

async function outputFixture(t, previous) {
  const root = await mkdtemp(join(tmpdir(), 'ai-market-collector-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const output = join(root, 'market.json')
  const raw = previous ? JSON.stringify(previous) + '\n' : null
  if (raw) await writeFile(output, raw)
  return { root, output, raw }
}

test('completed daily snapshots retain universe order despite concurrent completion and report honest coverage', async t => {
  const { output } = await outputFixture(t)
  const requested = [], data = await collect(output, {
    ...defaults, universe: universe(['NVDA', 'AAPL', 'NEW.TW']),
    batchService: async symbols => { requested.push(symbols); return { quotes: [cap('NVDA'), cap('NEW.TW')], errors: [{ symbol: 'AAPL', error: 'cap unavailable' }] } },
    closeService: async symbol => {
      if (symbol === 'NVDA') await new Promise(resolve => setTimeout(resolve, 5))
      return closing(symbol)
    },
  })
  assert.deepEqual(requested, [['NVDA', 'AAPL', 'NEW.TW']])
  assert.deepEqual(data.quotes.map(row => row.symbol), ['NVDA', 'AAPL', 'NEW.TW'])
  assert.equal(data.mode, 'scheduled-close')
  assert.equal(data.priceBasis, 'previous-completed-session')
  assert.equal(data.refreshMinutes, null)
  assert.equal(data.generatedAt, attemptAt)
  assert.deepEqual(data.coverage, { companyCount: 3, listedCompanyCount: 3, unmapped: [], targetSymbols: 3, successfulCloses: 3, failedCloses: 0, marketCaps: 2 })
  assert.equal(data.collection.status, 'ok')
  assert.equal(data.quotes[1].marketCap, null)
  assert.equal(data.quotes[1].marketCapStatus, 'unavailable')
  assert.equal(data.quotes[1].marketCapError, 'cap unavailable')
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), data)
})

test('partial close failures preserve the prior actual close date and fetch time', async t => {
  const old = closing('AAPL', { price: 90, closeDate: '2026-11-04', fetchedAt: oldFetchedAt })
  const { output } = await outputFixture(t, { schemaVersion: 1, quotes: [old] })
  const data = await collect(output, {
    ...defaults, universe: universe(['NVDA', 'AAPL']),
    closeService: async symbol => { if (symbol === 'AAPL') throw new Error('provider offline'); return closing(symbol) },
  })
  const fallback = data.quotes[1]
  assert.equal(fallback.status, 'stale')
  assert.equal(fallback.price, 90)
  assert.equal(fallback.closeDate, '2026-11-04')
  assert.equal(fallback.fetchedAt, oldFetchedAt)
  assert.equal(fallback.lastAttemptAt, attemptAt)
  assert.equal(fallback.error, 'provider offline')
  assert.equal(data.coverage.successfulCloses, 1)
  assert.equal(data.coverage.failedCloses, 1)
  assert.equal(data.collection.status, 'partial')
})

test('pre-migration intraday prices are never relabeled as completed closes on failure', async t => {
  const histories = { '1d': [{ time: 5, close: 99 }] }
  const old = { symbol: 'AAPL', price: 99, previousClose: 98, fetchedAt: oldFetchedAt, marketTime: 5, bars: [{ time: 5, close: 99 }], histories }
  const { output } = await outputFixture(t, { schemaVersion: 1, quotes: [old] })
  const data = await collect(output, {
    ...defaults, universe: universe(['NVDA', 'AAPL']),
    closeService: async symbol => { if (symbol === 'AAPL') throw new Error('no close'); return closing(symbol) },
  })
  const rejected = data.quotes[1]
  assert.equal(rejected.status, 'error')
  for (const field of ['price', 'previousClose', 'change', 'changePercent', 'closeDate', 'fetchedAt', 'marketTime']) assert.equal(rejected[field], null)
  assert.deepEqual(rejected.bars, [])
  assert.deepEqual(rejected.histories, histories)
  assert.equal(rejected.marketCap, 1000)
})

test('total close failure leaves prior snapshot bytes intact even when caps succeed', async t => {
  const { root, output, raw } = await outputFixture(t, { schemaVersion: 1, generatedAt: oldFetchedAt, quotes: [closing('NVDA')] })
  await assert.rejects(collect(output, {
    ...defaults, universe: universe(['NVDA', 'AAPL']), closeService: async () => { throw new Error('all offline') },
  }), /전체 종가 수집 실패/)
  assert.equal(await readFile(output, 'utf8'), raw)
  assert.deepEqual(await readdir(root), ['market.json'])
})

test('cap failures keep old value and its observation times, while absent values stay unavailable', async t => {
  const oldCap = {
    marketCap: 800, marketCapCurrency: 'USD', marketCapAsOf: '2026-11-04',
    marketCapFetchedAt: oldFetchedAt, marketCapObservedAt: oldFetchedAt,
    sharesObservedAt: oldFetchedAt, marketCapBasis: 'provider-current', sharesOutstanding: 8,
  }
  const { output } = await outputFixture(t, { quotes: [closing('NVDA', oldCap)] })
  const data = await collect(output, {
    ...defaults, universe: universe(['NVDA', 'AAPL']),
    batchService: async () => { throw new Error('batch offline') },
  })
  const previous = data.quotes[0], missing = data.quotes[1]
  for (const [field, value] of Object.entries(oldCap)) assert.equal(previous[field], value, field)
  assert.equal(previous.marketCapStatus, 'stale')
  assert.equal(previous.marketCapError, 'batch offline')
  assert.equal(previous.status, 'ok')
  assert.equal(missing.marketCap, null)
  assert.equal(missing.marketCapStatus, 'unavailable')
  assert.equal(data.coverage.marketCaps, 0)
})

test('legacy detailed charts retain the old failed range and its timestamp without extra requests for new coverage', async t => {
  const oldBars = [{ time: 5, close: 90 }], calls = []
  const { output } = await outputFixture(t, { quotes: [closing('NVDA', {
    histories: { '1d': oldBars }, historyFetchedAt: { '1d': oldFetchedAt },
  })] })
  const data = await collect(output, {
    ...defaults, universe: universe(['NVDA', 'NEW.TW']), includeHistories: true,
    chartService: async (symbol, range) => {
      calls.push([symbol, range])
      if (range === '1d') throw new Error('intraday unavailable')
      return { bars: [{ time: 10, close: 110 }], fetchedAt: attemptAt }
    },
  })
  assert.deepEqual(calls, [['NVDA', '1d'], ['NVDA', '5d'], ['NVDA', '5y']])
  assert.deepEqual(data.quotes[0].histories['1d'], oldBars)
  assert.equal(data.quotes[0].historyFetchedAt['1d'], oldFetchedAt)
  assert.equal(data.quotes[0].historyErrors['1d'], 'intraday unavailable')
  assert.equal(data.quotes[0].historyFetchedAt['5d'], attemptAt)
  assert.deepEqual(data.quotes[1].histories, {})
})

test('oversized new payload never replaces the previous file and leaves no temporary file', async t => {
  const { root, output, raw } = await outputFixture(t, { quotes: [closing('NVDA')] })
  await assert.rejects(collect(output, { ...defaults, universe: universe(['NVDA']), maxBytes: 100 }), /크기 제한/)
  assert.equal(await readFile(output, 'utf8'), raw)
  assert.deepEqual(await readdir(root), ['market.json'])
})

test('malformed or duplicate target universes reject before provider calls or file writes', async t => {
  const { output } = await outputFixture(t)
  let calls = 0
  const providers = {
    ...defaults,
    closeService: async symbol => { calls++; return closing(symbol) },
    batchService: async () => { calls++; return { quotes: [], errors: [] } },
  }
  const invalid = [
    { targets: [], coverage: {} },
    { targets: [item('NVDA'), item('NVDA')], coverage: {} },
    { targets: [item('../evil')], coverage: {} },
    { targets: [item('nvda')], coverage: {} },
    { targets: [{ symbol: 'NVDA', name: null }], coverage: {} },
  ]
  for (const value of invalid) await assert.rejects(collect(output, { ...providers, universe: value }), /원장/)
  assert.equal(calls, 0)
})

test('a provider response for a different symbol cannot become a successful close', async t => {
  const { output } = await outputFixture(t)
  const data = await collect(output, {
    ...defaults, universe: universe(['NVDA', 'AAPL']),
    closeService: async symbol => closing(symbol === 'NVDA' ? 'UNEXPECTED' : symbol),
  })
  assert.equal(data.quotes[0].status, 'error')
  assert.equal(data.quotes[0].price, null)
  assert.equal(data.quotes[1].status, 'ok')
})

test('failed refresh preserves actual minor currency units instead of overwriting them with master currency', async t => {
  const old = closing('LSE.L', { currency: 'GBp', exchange: 'LSE', timezone: 'Europe/London', fetchedAt: oldFetchedAt })
  const { output } = await outputFixture(t, { quotes: [old] })
  const data = await collect(output, {
    ...defaults, universe: { targets: [item('NVDA'), { ...item('LSE.L'), currency: 'GBP', exchange: 'London' }], coverage: {} },
    closeService: async symbol => { if (symbol === 'LSE.L') throw new Error('offline'); return closing(symbol) },
  })
  const preserved = data.quotes[1]
  assert.equal(preserved.price, old.price)
  assert.equal(preserved.currency, 'GBp')
  assert.equal(preserved.exchange, 'LSE')
  assert.equal(preserved.timezone, 'Europe/London')
  assert.equal(preserved.fetchedAt, oldFetchedAt)
})

test('an older provider close cannot replace a more recent successful trading date', async t => {
  const old = closing('AAPL', { closeDate: '2026-11-06', price: 120, fetchedAt: oldFetchedAt })
  const { output } = await outputFixture(t, { quotes: [old] })
  const data = await collect(output, { ...defaults, universe: universe(['NVDA', 'AAPL']) })
  assert.equal(data.quotes[1].closeDate, '2026-11-06')
  assert.equal(data.quotes[1].price, 120)
  assert.equal(data.quotes[1].status, 'stale')
  assert.equal(data.quotes[1].fetchedAt, oldFetchedAt)
  assert.match(data.quotes[1].error, /이전 성공값보다/)
})
