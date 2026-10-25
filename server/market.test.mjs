import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { once } from 'node:events'
import { chart, createChartService, normalize, ranges } from './market.mjs'
import { createSiteServer } from '../scripts/serve.mjs'
import { build } from '../scripts/build.mjs'

function fixture({ range = '1d', symbol = 'NVDA' } = {}) {
  return {
    meta: { symbol, shortName: 'NVIDIA', currency: 'USD', regularMarketPrice: 110, regularMarketTime: 1704326400,
      chartPreviousClose: range === '1d' ? 100 : 50, regularMarketDayHigh: 112, regularMarketDayLow: 107,
      regularMarketVolume: 300, exchangeTimezoneName: 'America/New_York' },
    timestamp: [1704240000, 1704326400],
    indicators: { quote: [{ open: [108, 109], high: [111, 112], low: [107, 108], close: [109, 110], volume: [100, 200] }] },
    events: { dividends: { sample: { amount: 0.01 } } },
  }
}
const responseFor = result => ({ ok: true, json: async () => ({ chart: { result: [result], error: null } }) })

test('long charts use one-day metadata for yesterday close and daily open', () => {
  const history = fixture({ range: '5y' }), daily = fixture()
  const quote = normalize(history, '5y', daily)
  assert.equal(quote.previousClose, 100)
  assert.equal(quote.change, 10)
  assert.equal(quote.changePercent, 10)
  assert.equal(quote.open, 108)
  assert.equal(quote.interval, '1wk')
  assert.equal(quote.events.dividends.sample.amount, 0.01)
  assert.equal(normalize(history, '5y').previousClose, null)
  assert.equal(normalize(history, '5y').change, null)
})

test('explicit previous close takes precedence and unavailable values stay null', () => {
  const result = fixture()
  result.meta.previousClose = 105
  result.indicators.quote[0].close = [null, 110]
  result.indicators.quote[0].open = [null, Infinity]
  delete result.meta.regularMarketVolume
  const quote = normalize(result)
  assert.equal(quote.previousClose, 105)
  assert.equal(quote.change, 5)
  assert.equal(quote.bars.length, 1)
  assert.equal(quote.bars[0].open, null)
  assert.equal(quote.open, null)
  assert.equal(quote.volume, null)
  result.meta.previousClose = 0
  assert.equal(normalize(result).changePercent, null)
})

test('all supported ranges request the correct interval and separate one-day baseline', async () => {
  const urls = []
  const service = createChartService({ fetchImpl: async url => {
    urls.push(url)
    return responseFor(fixture({ range: url.searchParams.get('range') }))
  } })
  for (const range of Object.keys(ranges)) {
    const quote = await service('NVDA', range)
    assert.equal(quote.range, range)
    assert.equal(quote.previousClose, 100)
  }
  assert.equal(urls.length, 6)
  assert.ok(urls.every(url => url.searchParams.get('interval') === ranges[url.searchParams.get('range')]))
})

test('same-symbol concurrent requests share history and one-day calls; cache expires', async () => {
  let time = 1704326400000, calls = 0
  const service = createChartService({ now: () => time, fetchImpl: async url => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 5))
    return responseFor(fixture({ range: url.searchParams.get('range') }))
  } })
  const [first, duplicate, day] = await Promise.all([service('nvda', '1y'), service('NVDA', '1y'), service('NVDA', '1d')])
  assert.equal(calls, 2)
  assert.deepEqual(first, duplicate)
  assert.equal(day.previousClose, 100)
  await service('NVDA', '1y')
  assert.equal(calls, 2)
  time += 60_001
  const fresh = await service('NVDA', '1y')
  assert.equal(calls, 4)
  assert.notEqual(fresh.fetchedAt, first.fetchedAt)
})

test('invalid inputs are rejected before any external request', async () => {
  let calls = 0
  const service = createChartService({ fetchImpl: async () => { calls++; throw new Error('must not fetch') } })
  for (const [symbol, range] of [['../.env', '1d'], ['', '1d'], ['NVDA', '__proto__'], ['NVDA', 'constructor'], ['NVDA', '10y'], [null, '1d']]) {
    await assert.rejects(service(symbol, range), error => error.status === 400)
  }
  assert.equal(calls, 0)
  await assert.rejects(chart('../.env'), error => error.status === 400)
})

test('upstream HTTP failure retries the second host', async () => {
  const hosts = []
  const service = createChartService({ fetchImpl: async url => {
    hosts.push(url.hostname)
    return url.hostname.startsWith('query1') ? { ok: false, status: 429 } : responseFor(fixture())
  } })
  const quote = await service('NVDA')
  assert.equal(quote.price, 110)
  assert.deepEqual(hosts, ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'])
})

test('provider errors and invalid bars never become successful cached results', async () => {
  let broken = true, calls = 0
  const service = createChartService({ fetchImpl: async () => {
    calls++
    if (broken) return responseFor({ ...fixture(), timestamp: [null] })
    return responseFor(fixture())
  } })
  await assert.rejects(service('NVDA'), error => error.status === 502 && error.message.includes('필수 시세'))
  assert.equal(calls, 2)
  broken = false
  assert.equal((await service('NVDA')).price, 110)
  assert.equal(calls, 3)
  const missing = createChartService({ fetchImpl: async () => ({ ok: true, json: async () => ({ chart: { result: null, error: { description: 'No data found' } } }) }) })
  await assert.rejects(missing('NOTATICKER'), error => error.status === 502 && error.message.includes('No data found'))
})

test('closed intraday metadata still supplies yearly quotes without inventing one-day bars', async () => {
  const service = createChartService({ fetchImpl: async url => {
    const result = fixture({ range: url.searchParams.get('range'), symbol: 'GC=F' })
    if (url.searchParams.get('range') === '1d') {
      delete result.timestamp
      delete result.indicators
    }
    return responseFor(result)
  } })
  const history = await service('GC=F', '1y')
  assert.equal(history.price, 110)
  assert.equal(history.previousClose, 100)
  assert.equal(history.change, 10)
  assert.equal(history.bars.length, 2)
  assert.equal(history.open, null)
  const intraday = await service('GC=F', '1d')
  assert.equal(intraday.price, 110)
  assert.equal(intraday.previousClose, 100)
  assert.deepEqual(intraday.bars, [])
  assert.equal(intraday.open, null)
  assert.equal(normalize({ meta: fixture().meta }, '1d').bars.length, 0)
})

test('external calls receive an abort timeout and failures report a provider timeout', async () => {
  let calls = 0
  const service = createChartService({ timeoutMs: 5, fetchImpl: async (_url, { signal }) => {
    calls++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(responseFor(fixture())), 1000)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    })
  } })
  await assert.rejects(service('NVDA'), error => error.status === 502 && error.message.includes('시간 초과'))
  assert.equal(calls, 2)
})

test('build publishes only the public site; server handles API errors without exposing source files', async t => {
  const source = await mkdtemp(join(tmpdir(), 'ai-chain-test-'))
  t.after(async () => {
    const target = resolve(source), parent = resolve(tmpdir())
    if (!target.startsWith(parent + sep)) throw new Error('Unsafe temporary cleanup path')
    await rm(target, { recursive: true, force: true })
  })
  await mkdir(join(source, 'assets'))
  await mkdir(join(source, 'data'))
  await mkdir(join(source, 'design'))
  await writeFile(join(source, 'index.html'), '<!doctype html><title>AI CHAIN</title>')
  await writeFile(join(source, 'assets', 'market.js'), 'console.log("public")')
  await writeFile(join(source, 'assets', 'market.css'), 'body { color: black }')
  await writeFile(join(source, 'assets', 'private.txt'), 'PRIVATE')
  await writeFile(join(source, 'data', 'market.json'), JSON.stringify({ quotes: [] }))
  await writeFile(join(source, 'design', 'notes.md'), 'PRIVATE')
  await writeFile(join(source, '.env'), 'PRIVATE')
  const output = await build(source)
  assert.deepEqual((await readdir(output)).sort(), ['assets', 'data', 'index.html'])
  assert.deepEqual((await readdir(join(output, 'assets'))).sort(), ['market.css', 'market.js'])
  const server = createSiteServer({ root: output, chartService: async (symbol, range) => {
    if (symbol === 'FAIL') throw Object.assign(new Error('제공처 연결 실패'), { status: 502 })
    if (!symbol || !Object.hasOwn(ranges, range)) throw Object.assign(new Error('입력 오류'), { status: 400 })
    return { symbol, range, price: 110 }
  } })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const origin = `http://127.0.0.1:${server.address().port}`
  assert.match(await (await fetch(origin)).text(), /AI CHAIN/)
  assert.equal((await fetch(`${origin}/assets/market.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.deepEqual(await (await fetch(`${origin}/data/market.json`)).json(), { quotes: [] })
  const snapshot = await fetch(`${origin}/api/snapshot`)
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(snapshot.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await snapshot.json(), { quotes: [] })
  const snapshotHead = await fetch(`${origin}/api/snapshot`, { method: 'HEAD' })
  assert.equal(snapshotHead.status, 200)
  assert.equal(await snapshotHead.text(), '')
  const snapshotPost = await fetch(`${origin}/api/snapshot`, { method: 'POST' })
  assert.equal(snapshotPost.status, 405)
  assert.equal(snapshotPost.headers.get('allow'), 'GET, HEAD')
  assert.equal(typeof (await snapshotPost.json()).error, 'string')
  for (const path of ['/design/notes.md', '/.git/config', '/.env', '/server/market.mjs', '/assets/private.txt', '/assets/%2e%2e%2f.env']) {
    const response = await fetch(origin + path)
    assert.equal(response.status, 404, path)
    assert.ok(!(await response.text()).includes('PRIVATE'))
  }
  const success = await fetch(`${origin}/api/chart?symbol=NVDA&range=1d`)
  assert.equal(success.status, 200)
  assert.deepEqual(await success.json(), { symbol: 'NVDA', range: '1d', price: 110 })
  for (const [path, options, status] of [
    ['/api/chart', {}, 400], ['/api/chart?symbol=A&symbol=B', {}, 400],
    ['/api/chart?symbol=A&range=1d&range=5y', {}, 400], ['/api/chart?symbol=NVDA', { method: 'POST' }, 405],
    ['/api/missing', {}, 404], ['/api/chart?symbol=FAIL', {}, 502],
  ]) {
    const response = await fetch(origin + path, options)
    assert.equal(response.status, status, path)
    assert.equal(typeof (await response.json()).error, 'string')
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), '<!doctype html><title>AI CHAIN</title>')
})
