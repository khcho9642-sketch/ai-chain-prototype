import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectDisclosures, discoverDisclosureLinks, emptyDisclosureSnapshot,
  extractDisclosureDocument, extractKnownDisclosureUrls,
  fetchOfficialDocument, normalizeOfficialUrl, validateDisclosureSnapshot,
} from './collect-ai-disclosures.mjs'

const OPENAI = 'https://openai.com/index/business-growth/'
const ANTHROPIC = 'https://www.anthropic.com/news/business-growth'
const RSS = 'https://openai.com/news/rss.xml'
const NEWS = 'https://www.anthropic.com/news'
const FIRST = new Date('2026-10-24T01:00:00.000Z')
const SECOND = new Date('2026-10-25T01:00:00.000Z')
const THIRD = new Date('2026-10-26T01:00:00.000Z')
const statistics = (urls = [OPENAI]) => ({
  schemaVersion: 1,
  metrics: urls.map((url, i) => ({ id: `metric-${i}`, observations: [{ value: 12, period: '2026-06', sourceUrl: url }] })),
})
const html = (value = 12, extra = '') => `<!doctype html><html><head><title>Business update | Official</title>
<meta property="article:published_time" content="2026-06-01T10:00:00Z"></head>
<body><header>Site menu ${extra}</header><main><h1>Business update</h1><article>
<p>In this publication we report ${value} million users for the stated observation period. This is the complete original scope of the published figure.</p>
<script>window.dynamic = '${extra}'</script><footer>Footer ${extra}</footer></article></main></body></html>`
const response = (body, type = 'text/html') => new Response(body, { status: 200, headers: { 'content-type': type } })
const feed = entries => `<rss version="2.0"><channel>${entries.map(([url, title]) => `<item><title><![CDATA[${title}]]></title><link>${url}</link></item>`).join('')}</channel></rss>`

test('official URLs require exact HTTPS host and supported publication path', () => {
  assert.equal(normalizeOfficialUrl('https://www.openai.com/index/business-growth/?ref=home#stats'), OPENAI)
  assert.equal(normalizeOfficialUrl('https://anthropic.com/news/business-growth/'), ANTHROPIC)
  for (const url of [
    'http://openai.com/index/business-growth/',
    'https://openai.com.evil.example/index/business-growth/',
    'https://openai.com@evil.example/index/business-growth/',
    'https://user:password@openai.com/index/business-growth/',
    'https://openai.com:444/index/business-growth/',
    'https://127.0.0.1/index/business-growth/',
    'https://openai.com/api/usage',
    'https://www.anthropic.com/news/%2F..%2Finternal',
    RSS,
  ]) assert.throws(() => normalizeOfficialUrl(url), undefined, url)
  assert.equal(normalizeOfficialUrl(RSS, { discovery: true }), RSS)
})

test('known sources deduplicate canonical official publication URLs and ignore other sources', () => {
  const fixture = statistics([OPENAI, 'https://www.openai.com/index/business-growth/?ref=2', ANTHROPIC, 'https://www.reuters.com/technology/ai/', 'https://platform.openai.com/docs'])
  assert.deepEqual(extractKnownDisclosureUrls(fixture), [OPENAI, ANTHROPIC])
  assert.throws(() => extractKnownDisclosureUrls({ metrics: [] }))
})

test('hash ignores navigation, scripts, footer and whitespace, but detects changed article content', () => {
  const original = extractDisclosureDocument(html())
  const presentationOnly = extractDisclosureDocument(html(12, 'changing-shell').replace('In this publication', 'In   this\npublication'))
  assert.deepEqual(original, presentationOnly)
  assert.notEqual(original.contentHash, extractDisclosureDocument(html(13)).contentHash)
  assert.equal(original.publishedAt, '2026-06-01')
  assert.deepEqual(Object.keys(original).sort(), ['contentHash', 'publishedAt', 'title'])
  assert.throws(() => extractDisclosureDocument('<title>Just a moment</title><main>Verify you are human. Enable JavaScript and cookies before continuing to this requested resource.</main>'))
})

test('first approved source establishes a baseline without publishing a new candidate or changing metrics', async () => {
  const data = statistics()
  const original = structuredClone(data)
  const previous = emptyDisclosureSnapshot()
  const result = await collectDisclosures(previous, data, { fetcher: async () => response(html()), now: FIRST, discover: false })
  assert.equal(result.collection.status, 'ok')
  assert.equal(result.collection.lastSuccessAt, FIRST.toISOString())
  assert.equal(result.sources[0].checkedAt, FIRST.toISOString())
  assert.equal(result.sources[0].lastChangedAt, FIRST.toISOString())
  assert.equal(result.candidates.length, 0)
  assert.deepEqual(data, original)
  assert.deepEqual(previous, emptyDisclosureSnapshot())
  assert.ok(!JSON.stringify(result).includes('complete original scope'))
  assert.ok(!Object.hasOwn(result.sources[0], 'value'))
})

test('changed content creates one needs-review candidate and unchanged checks keep change time', async () => {
  const base = await collectDisclosures(null, statistics(), { fetcher: async () => response(html()), now: FIRST, discover: false })
  const changed = await collectDisclosures(base, statistics(), { fetcher: async () => response(html(13)), now: SECOND, discover: false })
  assert.equal(changed.candidates.length, 1)
  assert.equal(changed.candidates[0].status, 'needs-review')
  assert.equal(changed.candidates[0].detectedAt, SECOND.toISOString())
  assert.equal(changed.sources[0].lastChangedAt, SECOND.toISOString())
  changed.candidates[0].status = 'reviewed'
  const same = await collectDisclosures(changed, statistics(), { fetcher: async () => response(html(13)), now: THIRD, discover: false })
  assert.equal(same.candidates.length, 1)
  assert.equal(same.candidates[0].status, 'reviewed')
  assert.equal(same.sources[0].checkedAt, THIRD.toISOString())
  assert.equal(same.sources[0].lastChangedAt, SECOND.toISOString())
})

test('partial failure preserves prior successful hash, checkedAt, change time and full-run success time', async () => {
  const data = statistics([OPENAI, ANTHROPIC])
  const base = await collectDisclosures(null, data, { fetcher: async () => response(html()), now: FIRST, discover: false })
  const result = await collectDisclosures(base, data, {
    fetcher: async url => url === OPENAI ? response(html(13)) : new Response('unavailable', { status: 503 }),
    now: SECOND, discover: false,
  })
  const prior = base.sources.find(s => s.url === ANTHROPIC)
  const failed = result.sources.find(s => s.url === ANTHROPIC)
  assert.equal(result.collection.status, 'partial')
  assert.equal(result.collection.checkedSourceCount, 1)
  assert.equal(result.collection.attemptedSourceCount, 2)
  assert.equal(result.collection.lastSuccessAt, FIRST.toISOString())
  assert.equal(result.collection.lastAttemptAt, SECOND.toISOString())
  for (const field of ['contentHash', 'title', 'checkedAt', 'lastChangedAt']) assert.equal(failed[field], prior[field])
  assert.equal(failed.lastAttemptAt, SECOND.toISOString())
  assert.equal(failed.error, '공식 발표자료 HTTP 503')
  assert.equal(result.sources.find(s => s.url === OPENAI).checkedAt, SECOND.toISOString())
  assert.equal(result.candidates.length, 1)
})

test('failed first download remains unchecked and sanitizes raw network exceptions', async () => {
  const result = await collectDisclosures(null, statistics(), {
    fetcher: async () => { throw new Error('request failed secret-token=very-private-value') },
    now: FIRST, discover: false,
  })
  assert.equal(result.collection.status, 'error')
  assert.equal(result.collection.lastSuccessAt, null)
  assert.equal(result.sources[0].checkedAt, null)
  assert.equal(result.sources[0].contentHash, null)
  assert.equal(result.candidates.length, 0)
  assert.ok(!JSON.stringify(result).includes('very-private-value'))
})

test('RSS CDATA and news anchors discover same-publisher relevant articles with a bounded count', () => {
  const rss = feed([
    ['https://openai.com/index/revenue-update/', 'Revenue &amp; user growth'],
    ['https://openai.com/index/revenue-update/?source=rss', 'Revenue again'],
    ['https://openai.com/index/art-exhibition/', 'Art exhibition'],
    ['https://openai.com/index/enterprise-update/', 'Enterprise update'],
    ['https://openai.com.evil.example/index/business/', 'Business update'],
    [ANTHROPIC, 'Business elsewhere'],
  ])
  assert.deepEqual(discoverDisclosureLinks(rss, { url: RSS, type: 'rss', limit: 1 }), [{ url: 'https://openai.com/index/revenue-update/', title: 'Revenue & user growth' }])
  const links = discoverDisclosureLinks('<a href="/news/new-customers"><span>New enterprise customers</span></a><a href="https://evil.example/news/business">Business</a>', { url: NEWS, type: 'html' })
  assert.deepEqual(links, [{ url: 'https://www.anthropic.com/news/new-customers', title: 'New enterprise customers' }])
  assert.throws(() => discoverDisclosureLinks('<html><title>Just a moment</title></html>', { url: RSS, type: 'rss' }))
  assert.throws(() => discoverDisclosureLinks('<title>Access denied</title>', { url: NEWS, type: 'html' }))
})

test('new discovered source becomes a review candidate; external feed links are never requested', async () => {
  const next = 'https://openai.com/index/new-business/'
  const requested = []
  const result = await collectDisclosures(null, statistics(), {
    now: FIRST,
    fetcher: async url => {
      requested.push(url)
      if (url === RSS) return response(feed([[next, 'New business growth'], ['https://evil.example/business', 'Revenue update']]), 'application/rss+xml')
      if (url === NEWS) return response('<a href="/news/aurora">Introducing Aurora</a>')
      if ([OPENAI, next].includes(url)) return response(html())
      throw new Error('unexpected URL')
    },
  })
  assert.equal(result.collection.status, 'ok')
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].url, next)
  assert.equal(result.candidates[0].status, 'needs-review')
  assert.equal(result.discovery.length, 2)
  assert.deepEqual(new Set(requested), new Set([RSS, NEWS, OPENAI, next]))
})

test('invalid discovery response preserves previous discovery check time', async () => {
  const base = emptyDisclosureSnapshot()
  base.discovery = [{ url: RSS, checkedAt: FIRST.toISOString(), foundCount: 2 }]
  base.collection.lastSuccessAt = FIRST.toISOString()
  const result = await collectDisclosures(base, statistics(), {
    now: SECOND,
    fetcher: async url => url === RSS ? response('<title>Just a moment</title>')
      : url === NEWS ? response('<a href="/news/aurora">Introducing Aurora</a>') : response(html()),
  })
  assert.equal(result.collection.status, 'partial')
  const failed = result.discovery.find(d => d.url === RSS)
  assert.equal(failed.checkedAt, FIRST.toISOString())
  assert.equal(failed.lastAttemptAt, SECOND.toISOString())
  assert.equal(result.collection.lastSuccessAt, FIRST.toISOString())
})

test('redirect to an external address is rejected before making a second request', async () => {
  const calls = []
  await assert.rejects(fetchOfficialDocument(OPENAI, {
    fetcher: async (url, options) => {
      calls.push(url)
      assert.equal(options.redirect, 'manual')
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/internal' } })
    },
  }))
  assert.deepEqual(calls, [OPENAI])
})

test('permitted relative redirects work and a silently followed external response is rejected', async () => {
  const next = 'https://openai.com/index/new-business/'
  const calls = []
  const result = await fetchOfficialDocument(OPENAI, {
    fetcher: async url => {
      calls.push(url)
      return url === OPENAI ? new Response(null, { status: 301, headers: { location: '/index/new-business/' } }) : response(html())
    },
  })
  assert.deepEqual(calls, [OPENAI, next])
  assert.equal(result.finalUrl, next)
  const external = response(html())
  Object.defineProperty(external, 'url', { value: 'https://evil.example/article' })
  await assert.rejects(fetchOfficialDocument(OPENAI, { fetcher: async () => external }))
})

test('daily cadence uses the Korean calendar day and force explicitly retries', async () => {
  let calls = 0
  const fetcher = async () => { calls += 1; return response(html()) }
  const beforeMidnight = new Date('2026-10-25T14:59:00.000Z')
  const base = await collectDisclosures(null, statistics(), { fetcher, now: beforeMidnight, discover: false })
  const skipped = await collectDisclosures(base, statistics(), { fetcher, now: new Date('2026-10-25T14:59:30.000Z'), discover: false })
  assert.deepEqual(skipped, base)
  assert.equal(calls, 1)
  const nextDay = await collectDisclosures(base, statistics(), { fetcher, now: new Date('2026-10-25T15:00:00.000Z'), discover: false })
  assert.equal(calls, 2)
  await collectDisclosures(nextDay, statistics(), { fetcher, now: new Date('2026-10-25T15:01:00.000Z'), discover: false, force: true })
  assert.equal(calls, 3)
})

test('response size and content type limits reject unsupported payloads', async () => {
  await assert.rejects(fetchOfficialDocument(OPENAI, { fetcher: async () => new Response('small', { headers: { 'content-length': '3000001', 'content-type': 'text/html' } }) }), /크기 제한/)
  await assert.rejects(fetchOfficialDocument(OPENAI, { fetcher: async () => response('{"value":123}', 'application/json') }), /지원하지 않는/)
})

test('article fetch concurrency is capped without dropping sources', async () => {
  let active = 0, peak = 0
  const urls = Array.from({ length: 7 }, (_, i) => `https://openai.com/index/business-${i}/`)
  const result = await collectDisclosures(null, statistics(urls), {
    now: FIRST, discover: false, concurrency: 2,
    fetcher: async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1
      return response(html())
    },
  })
  assert.equal(peak, 2)
  assert.equal(result.sources.length, 7)
  assert.equal(result.collection.status, 'ok')
})

test('stored snapshots cannot inject non-official article URLs', () => {
  const invalid = emptyDisclosureSnapshot()
  invalid.sources.push({ url: 'https://evil.example/article', contentHash: null })
  assert.throws(() => validateDisclosureSnapshot(invalid))
})
