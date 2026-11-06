import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { buildMarketDisplaySnapshot } from '../../scripts/data/market-display.mjs'
import { build, publicSnapshotFiles } from '../../scripts/build.mjs'
import { SECTORS } from '../../assets/home-map-core.js'
import { buildActualMap } from '../../assets/home-map-data.js'
import { buildSectorReturns } from '../../assets/home-performance.js'
import { buildRippleSnapshot } from '../../assets/ripple-core.js'

const generatedAt = '2026-11-05T23:00:00.000Z'
const now = Date.parse('2026-11-06T09:00:00Z')
const root = fileURLToPath(new URL('../../', import.meta.url))
const companies = ['AAA', 'BBB', 'CCC'].map((ticker, index) => ({
  id: ticker, ticker, name: ticker + ' fixture', country: 'US', sectorId: SECTORS[index * 4].id,
  sector: SECTORS[index * 4].name, listed: true,
}))

function fixture() {
  const dates = []
  for (let time = Date.parse('2026-11-05T12:00:00Z'); dates.length < 100; time -= 86400000) {
    if (![0, 6].includes(new Date(time).getUTCDay())) dates.unshift(new Date(time).toISOString().slice(0, 10))
  }
  dates.unshift('2025-11-05')
  const quotes = companies.map((company, index) => {
    let close = 50 + index * 10
    const bars = dates.map((date, position) => {
      const change = position === dates.length - 1 ? 8 - index : position % 10 === 0 ? 3 : 0.5
      const open = close
      close *= 1 + change / 100
      return { time: Date.parse(date + 'T14:30:00Z') / 1000, close, open,
        high: close * 1.01, low: open * .99, volume: 1e6 + position }
    })
    return {
      symbol: company.ticker, name: company.name, currency: 'USD', timezone: 'America/New_York',
      price: bars.at(-1).close, previousClose: bars.at(-2).close,
      closeDate: dates.at(-1), previousCloseDate: dates.at(-2), marketTime: bars.at(-1).time,
      interval: '1d', range: '1y', priceBasis: 'previous-completed-session',
      source: 'Yahoo Finance', sourceUrl: 'https://finance.yahoo.com/quote/' + company.ticker + '/',
      fetchedAt: generatedAt, status: index === 2 ? 'stale' : 'ok', error: index === 2 ? 'fixture provider failure' : null,
      marketCap: (index + 1) * 1e11, marketCapCurrency: 'USD', marketCapStatus: 'ok',
      marketCapObservedAt: generatedAt, marketCapBasis: 'provider-current',
      marketCapHistory: dates.map(date => ({ date, value: (index + 1) * 1e10, currency: 'USD', basis: 'provider-dated' })),
      capHistoryFetchedAt: generatedAt, capHistoryStatus: 'ok',
      bars, bars1year: bars,
      histories: { '1d': bars.slice(-1), '5d': bars.slice(-5), '5y': bars },
      historyFetchedAt: { '1d': generatedAt, '5d': generatedAt, '5y': generatedAt },
      historyErrors: { '1d': 'fixture saved range' },
    }
  })
  return { schemaVersion: 1, generatedAt, source: 'Yahoo Finance', mode: 'scheduled-close',
    priceBasis: 'previous-completed-session', coverage: { companyCount: 586, targetSymbols: quotes.length },
    fxHistory: { JPY: { currency: 'JPY', baseCurrency: 'USD', quoteConvention: 'currency-per-USD',
      fetchedAt: generatedAt, source: 'Yahoo Finance', status: 'stale',
      observations: dates.map(date => ({ date, unitsPerUSD: 150 })) } }, quotes,
  }
}

test('display projection retains saved closes, every chart range and provenance without changing the archive', () => {
  const source = fixture(), before = JSON.stringify(source)
  const display = buildMarketDisplaySnapshot(source)
  assert.equal(JSON.stringify(source), before)
  assert.equal(display.generatedAt, source.generatedAt)
  assert.equal(display.displayOnly, true)
  assert.equal(display.collectionStopped, true)
  assert.equal(display.displayBasis, 'stored-closes')
  assert.equal(display.quotes.length, source.quotes.length)
  assert.deepEqual(display.coverage, source.coverage)
  assert.deepEqual(display.fxHistory, source.fxHistory)
  for (let index = 0; index < source.quotes.length; index++) {
    const saved = source.quotes[index], compact = display.quotes[index]
    for (const key of ['price', 'previousClose', 'closeDate', 'previousCloseDate', 'fetchedAt', 'status', 'error',
      'marketCap', 'marketCapCurrency', 'marketCapObservedAt', 'marketCapStatus', 'marketCapHistory', 'historyErrors', 'historyFetchedAt']) {
      assert.deepEqual(compact[key], saved[key])
    }
    assert.deepEqual(compact.bars, saved.bars.map(({ time, close }) => ({ time, close })))
    assert.deepEqual(compact.bars1year, compact.bars)
    assert.deepEqual(Object.keys(compact.histories), Object.keys(saved.histories))
    for (const range of Object.keys(saved.histories)) {
      assert.deepEqual(compact.histories[range], saved.histories[range].map(({ time, close }) => ({ time, close })))
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(display)) < Buffer.byteLength(before) * .65)
})

test('invalid and missing saved values remain missing rather than becoming zero-valued observations', () => {
  const input = { quotes: [{ symbol: 'EMPTY', bars: [null, { time: 1, close: null, open: 123 },
    { time: 2 }, { time: 3, close: 0 }, { close: 4 }, 'invalid'],
    histories: { broken: null, empty: [], unavailable: 'not collected' } }, null] }
  const display = buildMarketDisplaySnapshot(input)
  assert.deepEqual(display.quotes[0].bars, [null, { time: 1, close: null }, { time: 2 }, { time: 3, close: 0 }, { close: 4 }, 'invalid'])
  assert.deepEqual(display.quotes[0].histories, input.quotes[0].histories)
  assert.equal(display.quotes[1], null)
  assert.equal(Object.hasOwn(display.quotes[0], 'fetchedAt'), false)
  assert.throws(() => buildMarketDisplaySnapshot({ quotes: 'not-an-array' }), /저장된 시세/)
})

test('map returns, equal/cap weighted cards and co-movement are identical to the complete stored archive', () => {
  const original = fixture(), compact = buildMarketDisplaySnapshot(original)
  for (const period of ['1d', '1w', '1m', '1y']) {
    assert.deepEqual(buildActualMap({ snapshot: compact, companies, period, now }),
      buildActualMap({ snapshot: original, companies, period, now }))
  }
  for (const period of ['1d', '1w', '1m', '3mo', '1y']) {
    assert.deepEqual(buildSectorReturns({ snapshot: compact, companies, period, now }),
      buildSectorReturns({ snapshot: original, companies, period, now }))
  }
  const ripple = buildRippleSnapshot({ marketSnapshot: original, companies, now })
  assert.equal(ripple.triggers.length, 3)
  assert.deepEqual(buildRippleSnapshot({ marketSnapshot: compact, companies, now }), ripple)
})

test('a build generates the display file from the existing archive and leaves source data unchanged', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'market-display-build-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  await mkdir(join(temporary, 'data'))
  await mkdir(join(temporary, 'assets'))
  await writeFile(join(temporary, 'index.html'), '<html><head></head><body></body></html>')
  for (const name of publicSnapshotFiles.filter(name => !['market.json', 'market-display.json', 'ripple.json'].includes(name))) {
    await copyFile(join(root, 'data', name), join(temporary, 'data', name))
  }
  const source = JSON.stringify(fixture())
  const archive = join(temporary, 'data', 'market.json')
  await writeFile(archive, source)
  const output = await build(temporary)
  const saved = JSON.parse(await readFile(join(output, 'data', 'market-display.json'), 'utf8'))
  assert.deepEqual(saved, buildMarketDisplaySnapshot(JSON.parse(source)))
  assert.equal(await readFile(archive, 'utf8'), source)
  await assert.rejects(readFile(join(temporary, 'data', 'market-display.json')), { code: 'ENOENT' })
  assert.equal(await readFile(join(output, 'data', 'market.json'), 'utf8'), source)
})
