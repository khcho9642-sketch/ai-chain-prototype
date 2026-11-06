import test from 'node:test'
import assert from 'node:assert/strict'
import { catalog, findCompanyByTicker } from '../../assets/company-catalog.js'
import { COMPANIES, SECTORS } from '../../assets/home-map-core.js'
import { instruments } from '../../assets/instruments.js'
import { buildCompanyRelease } from '../../scripts/data/publish-company-catalog.mjs'

const source = { label: '사업보고서', url: 'https://www.sec.gov/edgar/search/' }
const metric = { label: '매출', value: null, currency: 'USD', scope: '연결', unit: '백만', period: 'FY2025', sourceUrl: source.url }

function input() {
  const companies = Array.from({ length: 500 }, (_, i) => ({
    id: 'test-' + i, name: '샘플' + i, englishName: 'Issuer ' + i, country: '한국',
    sectorId: SECTORS[i % SECTORS.length].id, listed: false, listings: [],
    product: '샘플 제품', overview: '샘플 회사', public: true, sources: [source],
  }))
  const selections = companies.slice(0, 46).map((c, i) => ({ companyId: c.id, reason: '선정 근거', order: i }))
  return { status: 'approved', approvedAt: '2026-11-06', reviewer: '검토자', companies, selections, editions: [] }
}

function edition(overrides = {}) {
  return {
    companyId: 'test-0', status: 'published', asOf: '2026-10-31', publishedAt: '2026-11-01', updatedAt: '2026-11-02',
    reviewer: '검토자', conclusion: '결론', problem: '문제', solution: '해결', verification: '실적 검증',
    outlook: '불확실성과 다음 지표', sources: [source], metrics: [metric], ...overrides,
  }
}

test('preview follows the local DB issuer cohort and reconciles public market map symbols', () => {
  if (catalog.mode !== 'preview') return
  const core = catalog.companies.filter(c => c.selection)
  assert.equal(core.length, 46)
  assert.equal(new Set(core.map(c => c.financialId)).size, 46)
  assert.equal(new Set(core.map(c => c.sectorId)).size, 9)
  assert.equal(core.filter(c => !c.listed && !c.listings.length).length, 3)
  assert.ok(core.every(c => c.analysis === null && c.selection.reason && c.overview && c.product))
  assert.equal(new Set(catalog.companies.map(c => c.id)).size, catalog.companies.length)
  assert.equal(findCompanyByTicker('042700.KS').id, 'C0582')
  assert.equal(findCompanyByTicker('042700.KS').sectorId, 'semiconductor-equipment')
  assert.equal(findCompanyByTicker(' asx '), findCompanyByTicker('3711.tw'))
  assert.equal(findCompanyByTicker('2330.TW'), findCompanyByTicker('TSM'))
  assert.ok(COMPANIES.every(c => findCompanyByTicker(c.ticker)))
  const discussion = new Set(instruments.filter(x => x.chains.some(id => id > 0)).map(x => x.symbol))
  assert.ok(catalog.companies.every(c => !c.discussionTicker || discussion.has(c.discussionTicker)))
  assert.ok(catalog.companies.every(c => c.sources.length && c.overview.length > c.product.length))
  assert.equal(findCompanyByTicker('GC=F'), undefined)
})

test('an approved release validates issuer counts, publication flags and sector identities', () => {
  const out = buildCompanyRelease(input())
  assert.equal(out.companies.length, 500)
  for (const change of [
    r => { r.status = 'draft' }, r => { r.companies.pop() }, r => { r.selections.pop() },
    r => { r.companies[0].id = r.companies[1].id }, r => { r.companies[0].sectorId = '8' },
    r => { r.selections[0].companyId = 'missing' }, r => { r.companies[0].public = 'true' },
    r => { r.companies[0].secondarySectorIds = [r.companies[0].sectorId] },
    r => { r.companies[0].listed = true; r.companies[0].listings = [{ ticker: 'AAPL', exchange: 'NASDAQ', currency: 'USD' }]; r.companies[0].discussionTicker = 'AAPL' },
    r => { for (const c of r.companies) c.sectorId = SECTORS[0].id },
  ]) {
    const data = input()
    change(data)
    assert.throws(() => buildCompanyRelease(data))
  }
})

test('publishing rejects missing text, invalid dates, unsourced metrics and unsupported URLs', () => {
  for (const bad of [
    { sources: [] }, { solution: ' ' }, { asOf: '2026-02-30' }, { reviewer: '' },
    { metrics: [{ ...metric, value: '미공개' }] }, { metrics: [{ ...metric, sourceUrl: '' }] },
    { metrics: [{ ...metric, value: 12, currency: '' }] }, { metrics: [{ ...metric, unit: '' }] },
    { metrics: [{ ...metric, period: '' }] }, { sources: [{ label: '공시', url: 'javascript:alert(1)' }] },
    { sources: [{ label: '공시', url: 'http://example.org/filing' }] },
    { companyId: 'test-499' },
  ]) {
    assert.throws(() => buildCompanyRelease({ ...input(), editions: [edition(bad)] }))
  }
})

test('only the latest public edition is serialized and a revision in review retains that edition', () => {
  const data = input()
  data.companies.push({ id: 'private', public: false, notes: 'HIDDEN' })
  data.companies[0].internalNotes = 'HIDDEN'
  data.companies[0].sources = [{ ...source, internalNotes: 'HIDDEN' }]
  data.editions = [
    edition({ status: 'draft', problem: 'HIDDEN' }),
    edition({ updatedAt: '2026-11-05', conclusion: '최신 발행본', internalNotes: 'HIDDEN' }),
    edition(),
  ]
  const projected = buildCompanyRelease(data)
  const article = projected.companies[0].analysis
  assert.equal(article.conclusion, '최신 발행본')
  assert.equal(article.metrics[0].value, null)
  data.editions = [edition({ status: 'review', conclusion: 'HIDDEN' })]
  const revised = buildCompanyRelease(data, projected)
  assert.deepEqual(revised.companies[0].analysis, article)
  assert.equal(revised.companies[1].analysis, null)
  assert.ok(!JSON.stringify(revised).includes('HIDDEN'))
})
