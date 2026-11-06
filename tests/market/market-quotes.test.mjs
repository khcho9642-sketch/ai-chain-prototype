import test from 'node:test'
import assert from 'node:assert/strict'
import { createBatchQuoteService, createLibraryBatchQuoteService } from '../../server/market-quotes.mjs'

const nowMs = Date.parse('2026-11-06T08:00:00Z')
const response = rows => ({ ok: true, status: 200, json: async () => ({ quoteResponse: { result: rows, error: null } }) })
const quote = symbol => ({ symbol, currency: 'USD', marketCap: 1000, sharesOutstanding: 10, regularMarketPrice: 100, regularMarketTime: nowMs / 1000 })

test('batch quotes deduplicate symbols, bound chunks and project only provenance-safe fields', async () => {
  const urls = []
  const service = createBatchQuoteService({ now: () => nowMs, batchSize: 2, fetchImpl: async url => {
    urls.push(url)
    return response(url.searchParams.get('symbols').split(',').map(symbol => ({ ...quote(symbol), privateField: 'do not publish' })))
  } })
  const data = await service(['nvda', 'NVDA', 'AAPL', 'BRK-B', '^GSPC', 'KRW=X'])
  assert.equal(urls.length, 3)
  assert.deepEqual(urls.map(url => url.searchParams.get('symbols')), ['NVDA,AAPL', 'BRK-B,^GSPC', 'KRW=X'])
  assert.deepEqual(data.quotes.map(row => row.symbol), ['NVDA', 'AAPL', 'BRK-B', '^GSPC', 'KRW=X'])
  assert.deepEqual(data.errors, [])
  assert.equal(data.requestedCount, 5)
  assert.equal(data.quotes[0].marketCap, 1000)
  assert.equal(data.quotes[0].marketCapAsOf, null)
  assert.equal(data.quotes[0].marketCapObservedAt, '2026-11-06T08:00:00.000Z')
  assert.equal(data.quotes[0].marketCapBasis, 'provider-current')
  assert.equal(data.quotes[0].privateField, undefined)
  await service(['NVDA', 'AAPL'])
  assert.equal(urls.length, 3)
})

test('missing and nonpositive values remain null and unmatched symbols are never accepted', async () => {
  const service = createBatchQuoteService({ now: () => nowMs, fetchImpl: async () => response([
    { symbol: 'NVDA', currency: 'GBp', marketCap: 0, sharesOutstanding: NaN, regularMarketPrice: -1, regularMarketTime: Infinity },
    quote('UNREQUESTED'),
  ]) })
  const data = await service(['NVDA', 'AAPL'])
  assert.equal(data.quotes.length, 1)
  assert.equal(data.quotes[0].currency, 'GBp')
  for (const field of ['marketCap', 'sharesOutstanding', 'regularMarketPrice', 'regularMarketTime', 'marketCapObservedAt', 'marketCapBasis']) assert.equal(data.quotes[0][field], null)
  assert.deepEqual(data.errors.map(row => row.symbol), ['AAPL'])
})

test('a failed batch retries the second host without dropping other batches', async () => {
  const urls = []
  const service = createBatchQuoteService({ batchSize: 1, fetchImpl: async url => {
    urls.push(url)
    return url.searchParams.get('symbols') === 'AAPL' ? { ok: false, status: 429 } : response([quote('NVDA')])
  } })
  const data = await service(['AAPL', 'NVDA'])
  assert.deepEqual(data.quotes.map(row => row.symbol), ['NVDA'])
  assert.deepEqual(data.errors, [{ symbol: 'AAPL', error: '일괄 시세 제공처 HTTP 429' }])
  assert.equal(urls.length, 3)
  assert.equal(urls[1].hostname, 'query2.finance.yahoo.com')
})

test('401 authenticates once, including a cookie on a 404 response, and never publishes credentials', async () => {
  const calls = [], cookie = 'A3=secret-cookie', crumb = 'secret-crumb'
  const service = createBatchQuoteService({ now: () => nowMs, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (url.hostname === 'fc.yahoo.com') return { ok: false, status: 404, headers: { getSetCookie: () => [cookie + '; Path=/; Secure'] } }
    if (url.pathname.endsWith('getcrumb')) { assert.equal(options.headers.Cookie, cookie); return { ok: true, text: async () => crumb } }
    if (!url.searchParams.has('crumb')) return { ok: false, status: 401 }
    assert.equal(url.searchParams.get('crumb'), crumb)
    assert.equal(options.headers.Cookie, cookie)
    return response([quote('NVDA')])
  } })
  const data = await service(['NVDA'])
  assert.equal(calls.length, 4)
  assert.equal(data.quotes.length, 1)
  assert.equal(JSON.stringify(data).includes('secret'), false)
})

test('repeated authorization failure has bounded retries and sanitized errors', async () => {
  let authCalls = 0, quoteCalls = 0
  const service = createBatchQuoteService({ fetchImpl: async url => {
    if (url.hostname === 'fc.yahoo.com') { authCalls++; return { headers: { getSetCookie: () => ['A3=secret; Secure'] } } }
    if (url.pathname.endsWith('getcrumb')) return { ok: true, text: async () => 'secret-token' }
    quoteCalls++; return { ok: false, status: 401 }
  } })
  const data = await service(['NVDA', 'AAPL'])
  assert.equal(authCalls, 1)
  assert.equal(quoteCalls, 3)
  assert.equal(data.quotes.length, 0)
  assert.equal(data.errors.length, 2)
  assert.equal(JSON.stringify(data).includes('secret'), false)
})

test('an unavailable crumb and transport exceptions never leak auth URLs or raw error messages', async () => {
  const service = createBatchQuoteService({ fetchImpl: async url => {
    if (url.hostname === 'fc.yahoo.com') return { headers: { getSetCookie: () => ['A3=secret; Secure'] } }
    if (url.pathname.endsWith('getcrumb')) return { ok: true, text: async () => '<html>secret-token</html>' }
    if (url.hostname.startsWith('query2')) throw new Error('https://provider.invalid/?crumb=secret-token')
    return { ok: false, status: 403 }
  } })
  const data = await service(['NVDA'])
  assert.equal(data.errors.length, 1)
  assert.equal(JSON.stringify(data).includes('secret'), false)
  assert.equal(JSON.stringify(data).includes('crumb='), false)
})

test('validation happens before network access, empty input is free, and invalid batch size rejects', async () => {
  let calls = 0
  const service = createBatchQuoteService({ fetchImpl: async () => { calls++; throw new Error('must not call') } })
  for (const symbols of ['NVDA', ['../.env'], [''], [null], [{}], ['NVDA\nCookie: bad']]) await assert.rejects(service(symbols), TypeError)
  assert.equal((await service([])).requestedCount, 0)
  assert.equal(calls, 0)
  assert.throws(() => createBatchQuoteService({ batchSize: 51 }), RangeError)
})

test('same request shares one in-flight quote call and expired successful cache is refetched', async () => {
  let time = nowMs, calls = 0
  const service = createBatchQuoteService({ now: () => time, ttl: 100, fetchImpl: async () => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 1))
    return response([quote('NVDA')])
  } })
  const [one, two] = await Promise.all([service(['NVDA']), service(['NVDA'])])
  assert.deepEqual(one, two)
  assert.equal(calls, 1)
  time += 101
  await service(['NVDA'])
  assert.equal(calls, 2)
})

test('failed authentication stops remaining batches for this call while preserving earlier success and permitting later recovery', async () => {
  const calls = [], symbols = ['NVDA', 'AAPL', 'MSFT', 'AMD', 'TSM', 'ASML']
  let recovered = false
  const service = createBatchQuoteService({ now: () => nowMs, batchSize: 2, fetchImpl: async url => {
    calls.push(url)
    if (url.hostname === 'fc.yahoo.com') return { status: 404, headers: { getSetCookie: () => ['A3=secret-cookie; Secure'] } }
    if (url.pathname.endsWith('getcrumb')) return { ok: false, status: 406 }
    const requested = url.searchParams.get('symbols').split(',')
    if (!recovered && !requested.includes('NVDA')) return { ok: false, status: 401 }
    return response(requested.map(quote))
  } })
  const failed = await service(symbols)
  assert.deepEqual(failed.quotes.map(row => row.symbol), ['NVDA', 'AAPL'])
  assert.deepEqual(failed.errors.map(row => row.symbol), ['MSFT', 'AMD', 'TSM', 'ASML'])
  assert.equal(new Set(failed.errors.map(row => row.error)).size, 1)
  assert.equal(calls.filter(url => url.pathname.endsWith('/quote')).length, 2)
  assert.equal(calls.filter(url => url.hostname === 'fc.yahoo.com').length, 1)
  assert.equal(calls.length, 5)
  assert.doesNotMatch(JSON.stringify(failed), /secret-cookie/)
  recovered = true
  const success = await service(symbols)
  assert.deepEqual(success.quotes.map(row => row.symbol), symbols)
  assert.deepEqual(success.errors, [])
  assert.equal(calls.length, 7)
})

test('library transport batches with a timeout signal, normalizes Date values and accepts only requested symbols', async () => {
  const calls = []
  const service = createLibraryBatchQuoteService({ now: () => nowMs, batchSize: 2, quoteImpl: async (symbols, options, moduleOptions) => {
    calls.push({ symbols, options, moduleOptions })
    return [...symbols.filter(symbol => symbol !== 'MISSING').map(symbol => ({
      ...quote(symbol), regularMarketTime: new Date(nowMs), privateField: 'hidden',
    })), quote('UNREQUESTED')]
  } })
  const data = await service(['nvda', 'NVDA', '005930.KS', '2330.TW', 'MISSING'])
  assert.deepEqual(calls.map(row => row.symbols), [['NVDA', '005930.KS'], ['2330.TW', 'MISSING']])
  assert.ok(calls.every(row => row.moduleOptions.fetchOptions.signal instanceof AbortSignal && row.moduleOptions.validateResult === false))
  assert.deepEqual(data.quotes.map(row => row.symbol), ['NVDA', '005930.KS', '2330.TW'])
  assert.ok(data.quotes.every(row => row.regularMarketTime === nowMs / 1000 && !row.privateField))
  assert.deepEqual(data.errors.map(row => row.symbol), ['MISSING'])
  assert.equal(data.quotes[0].marketCap, 1000)
  assert.equal(data.quotes[0].marketCapBasis, 'provider-current')
})

test('library authentication failures stop remaining batches without leaking raw errors and retry on a later call', async () => {
  let calls = 0, recovered = false
  const service = createLibraryBatchQuoteService({ batchSize: 1, quoteImpl: async symbols => {
    calls++
    if (!recovered) throw new Error('HTTP401 crumb=secret-cookie-token')
    return symbols.map(quote)
  } })
  const failed = await service(['NVDA', 'AAPL', 'TSM'])
  assert.equal(calls, 1)
  assert.equal(failed.quotes.length, 0)
  assert.equal(failed.errors.length, 3)
  assert.ok(failed.errors.every(row => row.error === '일괄 시세 제공처 인증 실패'))
  assert.doesNotMatch(JSON.stringify(failed), /secret|crumb=/)
  recovered = true
  assert.equal((await service(['NVDA', 'AAPL', 'TSM'])).quotes.length, 3)
  assert.equal(calls, 4)
})

test('library requests have a hard timeout even if an adapter does not settle', async () => {
  let signal
  const service = createLibraryBatchQuoteService({ timeoutMs: 5, quoteImpl: async (_symbols, _options, moduleOptions) => {
    signal = moduleOptions.fetchOptions.signal
    return new Promise(() => {})
  } })
  const data = await service(['NVDA'])
  assert.equal(signal.aborted, true)
  assert.equal(data.quotes.length, 0)
  assert.match(data.errors[0].error, /시간 초과/)
})

test('library validates before querying and shares successful cache and in-flight requests', async () => {
  let calls = 0
  const service = createLibraryBatchQuoteService({ quoteImpl: async symbols => {
    calls++; await new Promise(resolve => setTimeout(resolve, 1)); return symbols.map(quote)
  } })
  await assert.rejects(service(['../secret']), TypeError)
  await assert.rejects(service('NVDA'), TypeError)
  assert.equal((await service([])).requestedCount, 0)
  assert.equal(calls, 0)
  const [first, second] = await Promise.all([service(['NVDA']), service(['NVDA'])])
  assert.deepEqual(first, second)
  await service(['NVDA'])
  assert.equal(calls, 1)
})
