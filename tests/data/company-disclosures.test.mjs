import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { dartCompanies } from '../../assets/company-disclosure-sources.js'
import { createEmptyCompanyDisclosures, validateCompanyDisclosures } from '../../assets/company-disclosures-core.js'
import { collectCompanyDisclosures, parseCompanyRss } from '../../scripts/data/collect-company-disclosures.mjs'

const companies = dartCompanies.slice(0, 2)
const NOW = new Date('2026-10-27T00:00:00.000Z'), NEXT = new Date('2026-10-27T01:00:00.000Z')
const iso = '2026-10-26T00:13:00.000Z'
const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const receipt = (index = 0, day = '20261026') => day + String(index + 1).padStart(6, '0')
function item(company, { id = receipt(), title = '실적발표 및 설명회', issuer = company.dartName, at = iso, extra = '' } = {}) {
  return `<item><title><![CDATA[(유가)${issuer} - ${title}]]></title><link>https://dart.fss.or.kr/api/link.jsp?rcpNo=${id}</link><guid>https://dart.fss.or.kr/api/link.jsp?rcpNo=${id}</guid><pubDate>${new Date(at).toUTCString()}</pubDate><dc:creator>fixture-private-submitter</dc:creator>${extra}</item>`
}
const feed = (company, entries = []) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>DART : (유가)${esc(company.dartName)}의 공시</title>${entries.join('')}</channel></rss>`
const response = body => new Response(body, { headers: { 'content-type': 'text/xml; charset=UTF-8' } })
const matchCompany = url => companies.find(company => company.rssUrl === url)
const opts = extra => ({ companies, previous: createEmptyCompanyDisclosures({ companies }), write: false, now: NOW, pause: async () => {}, ...extra })
const successFetcher = async url => {
  const company = matchCompany(url), index = companies.indexOf(company)
  return response(feed(company, [item(company, { id: receipt(index) })]))
}
const collectBase = extra => collectCompanyDisclosures(opts({ fetcher: successFetcher, ...extra }))

test('empty metadata matches every verified catalog company and rejects arbitrary public fields', () => {
  const empty = createEmptyCompanyDisclosures()
  assert.equal(empty.companies.length, 18)
  assert.equal(validateCompanyDisclosures(empty), empty)
  assert.equal(empty.coverage.historyComplete, false)
  assert.ok(empty.companies.every(company => company.items.length === 0 && company.lastSuccessAt === null))
  for (const mutate of [
    data => { data.secret = 'forbidden' },
    data => { data.companies[0].author = 'forbidden' },
    data => { data.companies[0].corpCode = '00126380' },
    data => { data.companies[0].feedUrl = 'https://evil.example/feed' },
    data => { data.companies.push(data.companies[0]) },
    data => { data.source.url = 'http://dart.fss.or.kr/' },
    data => { data.coverage.historyComplete = true },
  ]) { const data = structuredClone(empty); mutate(data); assert.throws(() => validateCompanyDisclosures(data)) }
})

test('RSS reads CDATA and escaped text, excludes different issuers and never emits submitter or body', () => {
  const company = companies[0]
  const xml = feed(company, [
    item(company, { title: '수주 & 실적 <안내>', extra: '<description><![CDATA[not-public-body]]></description>' }),
    item(company, { id: receipt(2), issuer: company.dartName + '홀딩스' }),
  ])
  const parsed = parseCompanyRss(xml, company, { now: NOW })
  assert.equal(parsed.feedItemCount, 2)
  assert.equal(parsed.excludedItemCount, 1)
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.items[0].title, '수주 & 실적 <안내>')
  assert.equal(parsed.items[0].publishedAt, iso)
  assert.equal(parsed.items[0].sourceUrl, `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt()}`)
  assert.ok(!JSON.stringify(parsed).includes('fixture-private-submitter'))
  assert.ok(!JSON.stringify(parsed).includes('not-public-body'))
  const escaped = feed(company, [item(company)]).replace(`<![CDATA[(유가)${company.dartName} - 실적발표 및 설명회]]>`, `(유가)${esc(company.dartName)} - 실적 &amp; 설명회`)
  assert.equal(parseCompanyRss(escaped, company, { now: NOW }).items[0].title, '실적 & 설명회')
})

test('malformed XML, DTDs, entities, wrong company, unsafe URLs and inconsistent receipt IDs fail closed', () => {
  const company = companies[0], xml = feed(company, [item(company)])
  for (const bad of [
    '<html><title>Access denied</title></html>',
    xml.replace('</channel>', '</item>'),
    '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]>' + xml,
    xml.replace('실적발표 및 설명회', 'title]]>&unknown;<![CDATA['),
    xml.replace('DART : (유가)' + company.dartName, 'DART : (유가)다른회사'),
    xml.replaceAll('https://dart.fss.or.kr/api/link.jsp', 'https://dart.fss.or.kr.evil.example/api/link.jsp'),
    xml.replaceAll('?rcpNo=', '?extra=1&amp;rcpNo='),
    xml.replace('<guid>https://dart.fss.or.kr/api/link.jsp?rcpNo=' + receipt(), '<guid>https://dart.fss.or.kr/api/link.jsp?rcpNo=' + receipt(8)),
    xml.replace('</rss>', ''),
    xml + '<rss/>',
    '<rss><channel>' + 'a'.repeat(2_000_001) + '</channel></rss>',
  ]) assert.throws(() => parseCompanyRss(bad, company, { now: NOW }))
  assert.throws(() => parseCompanyRss(xml, { ...company, rssUrl: 'https://127.0.0.1/' }, { now: NOW }))
})

test('exact duplicate receipts are deduplicated and distinct correction receipts remain distinct', () => {
  const company = companies[0], entry = item(company)
  const result = parseCompanyRss(feed(company, [entry, entry, item(company, { id: receipt(1), title: '[기재정정]실적발표 및 설명회' })]), company, { now: NOW })
  assert.equal(result.feedItemCount, 3)
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].receiptNumber, receipt(1))
  assert.throws(() => parseCompanyRss(feed(company, [entry, item(company, { title: '다른 제목' })]), company, { now: NOW }))
})

test('future timestamps and date/receipt inconsistencies are rejected; older genuine dates can be retained', () => {
  const company = companies[0]
  assert.throws(() => parseCompanyRss(feed(company, [item(company, { id: receipt(0, '20261028'), at: '2026-10-28T00:00:00Z' })]), company, { now: NOW }))
  assert.throws(() => parseCompanyRss(feed(company, [item(company, { id: receipt(0, '20261025') })]), company, { now: NOW }))
  assert.equal(parseCompanyRss(feed(company, [item(company, { id: receipt(0, '20260701'), at: '2026-07-01T00:00:00Z' })]), company, { now: NOW }).items.length, 1)
})

test('successful collection uses only configured HTTPS feeds and updates all success timestamps', async () => {
  const calls = [], pauses = []
  const data = await collectBase({ fetcher: async (url, options) => { calls.push({ url, options }); return successFetcher(url) }, pause: async ms => pauses.push(ms) })
  assert.equal(data.collection.status, 'ok')
  assert.equal(data.collection.lastSuccessAt, NOW.toISOString())
  assert.deepEqual(calls.map(call => call.url), companies.map(company => company.rssUrl))
  assert.ok(calls.every(call => call.options.redirect === 'error' && call.options.signal))
  assert.deepEqual(pauses, [750])
  assert.ok(data.companies.every(company => company.items.length === 1 && company.lastSuccessAt === NOW.toISOString()))
  assert.equal(validateCompanyDisclosures(data, { now: NOW, companies }), data)
})

test('successful empty feeds retain captured records without implying complete history', async () => {
  const previous = await collectBase()
  const data = await collectCompanyDisclosures(opts({ previous, now: NEXT, fetcher: async url => response(feed(matchCompany(url))) }))
  assert.equal(data.collection.status, 'ok')
  assert.equal(data.collection.lastSuccessAt, NEXT.toISOString())
  assert.deepEqual(data.companies.map(company => company.items), previous.companies.map(company => company.items))
  assert.ok(data.companies.every(company => company.feedItemCount === 0 && company.error === null))
  assert.equal(data.coverage.businessDays, 5)
  assert.equal(data.coverage.historyComplete, false)
})

test('partial failure preserves old records and success time; raw network errors are never published', async () => {
  const previous = await collectBase()
  const data = await collectCompanyDisclosures(opts({ previous, now: NEXT, fetcher: async url => url === companies[0].rssUrl ? Promise.reject(new Error('private-auth-token=do-not-publish')) : successFetcher(url) }))
  assert.equal(data.collection.status, 'partial')
  assert.equal(data.collection.lastSuccessAt, NOW.toISOString())
  assert.deepEqual(data.companies[0].items, previous.companies[0].items)
  assert.equal(data.companies[0].lastSuccessAt, NOW.toISOString())
  assert.equal(data.companies[0].lastAttemptAt, NEXT.toISOString())
  assert.equal(data.companies[1].lastSuccessAt, NEXT.toISOString())
  assert.ok(!JSON.stringify(data).includes('private-auth-token'))
  const failed = await collectCompanyDisclosures(opts({ previous: data, now: new Date(NEXT.getTime() + 3600000), fetcher: async () => new Response('body', { status: 503 }) }))
  assert.equal(failed.collection.status, 'error')
  assert.equal(failed.collection.lastSuccessAt, NOW.toISOString())
  assert.ok(failed.companies.every(company => company.error === 'DART RSS HTTP 503'))
})

test('15-minute cooldown avoids repeated requests; force permits an intentional new run', async () => {
  const previous = await collectBase()
  let calls = 0
  const fetcher = async url => { calls++; return successFetcher(url) }
  const near = new Date(NOW.getTime() + 60000)
  const skipped = await collectCompanyDisclosures(opts({ previous, now: near, fetcher }))
  assert.equal(calls, 0)
  assert.deepEqual(skipped, previous)
  await collectCompanyDisclosures(opts({ previous, now: near, fetcher, force: true }))
  assert.equal(calls, companies.length)
})

test('403 or 429 stops remaining requests and keeps unattempted company metadata unchanged', async () => {
  for (const status of [403, 429]) {
    let calls = 0
    const previous = await collectBase()
    const data = await collectCompanyDisclosures(opts({ previous, now: NEXT, fetcher: async () => { calls++; return new Response('blocked', { status }) } }))
    assert.equal(calls, 1)
    assert.equal(data.collection.status, 'error')
    assert.match(data.collection.error, /남은 회사 요청을 중단/)
    assert.deepEqual(data.companies[1], previous.companies[1])
    assert.equal(data.companies[0].lastSuccessAt, NOW.toISOString())
  }
})

test('90-day retention applies on successful checks; failures preserve original historical evidence', async () => {
  const oldNow = new Date('2026-07-01T01:00:00Z')
  const previous = await collectBase({ now: oldNow, fetcher: async url => {
    const company = matchCompany(url)
    return response(feed(company, [item(company, { id: receipt(companies.indexOf(company), '20260701'), at: '2026-07-01T00:00:00Z' })]))
  } })
  const failed = await collectCompanyDisclosures(opts({ previous, fetcher: async () => new Response('error', { status: 503 }) }))
  assert.deepEqual(failed.companies.map(company => company.items), previous.companies.map(company => company.items))
  const pruned = await collectCompanyDisclosures(opts({ previous, fetcher: async url => response(feed(matchCompany(url))) }))
  assert.ok(pruned.companies.every(company => company.items.length === 0))
})

test('invalid response type, redirect, oversized body and future snapshot metadata do not become success', async () => {
  for (const make of [
    () => new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } }),
    () => ({ ok: true, status: 200, url: 'https://evil.example/', text: async () => '' }),
    () => new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/xml' } }),
  ]) {
    const data = await collectCompanyDisclosures(opts({ fetcher: async () => make() }))
    assert.equal(data.collection.status, 'error')
    assert.ok(data.companies.every(company => company.items.length === 0 && company.lastSuccessAt === null))
  }
  const previous = await collectBase()
  previous.collection.lastAttemptAt = new Date(NOW.getTime() + 3600000).toISOString()
  await assert.rejects(collectCompanyDisclosures(opts({ previous, fetcher: successFetcher })))
})

test('collector writes a validated snapshot atomically to the requested project data directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-chain-company-disclosures-'))
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    assert.ok(directory.includes('ai-chain-company-disclosures-'))
    await rm(directory, { recursive: true, force: true })
  })
  const data = await collectCompanyDisclosures(opts({ root: directory, write: true, fetcher: successFetcher }))
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'data', 'company-disclosures.json'), 'utf8')), data)
  const restored = await collectCompanyDisclosures(opts({ root: directory, previous: undefined, write: false, now: new Date(NOW.getTime() + 1000), fetcher: async () => { throw new Error('should not call') } }))
  assert.deepEqual(restored, data)
})
