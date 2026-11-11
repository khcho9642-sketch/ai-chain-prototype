import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalog, findCompanyByTicker } from '../../assets/company-catalog.js'
import { SECTORS } from '../../assets/home-map-core.js'
import { MAP_COMPANIES } from '../../assets/home-map-universe.js'
import { instruments } from '../../assets/instruments.js'
import { buildCompanyRelease } from '../../scripts/data/publish-company-catalog.mjs'

const source = { label: '사업보고서', url: 'https://www.sec.gov/edgar/search/' }
const metric = { label: '매출', value: null, currency: 'USD', scope: '연결', unit: '백만', period: 'FY2025', sourceUrl: source.url }

function input() {
  const companies = structuredClone(catalog.companies).map(c => ({ ...c, public:true }))
  const selections = MAP_COMPANIES.map(c => ({companyId:c.id, reason:c.role, order:c.sourceOrder}))
  return { status:'approved', approvedAt:'2026-11-07', reviewer:'검토자', companies, selections, editions:[] }
}

function edition(overrides = {}) {
  return {
    companyId: 'C0051', status: 'published', asOf: '2026-10-31', publishedAt: '2026-11-01', updatedAt: '2026-11-02',
    reviewer: '검토자', conclusion: '결론', problem: '문제', solution: '해결', verification: '실적 검증',
    outlook: '불확실성과 다음 지표', sources: [source], metrics: [metric], ...overrides,
  }
}

test('594 issuer scope uses the approved 58-company roster including the optical-communications core without duplicating issuers', () => {
  const core = catalog.companies.filter(c => c.selection)
  assert.equal(catalog.companies.length, 594)
  assert.equal(core.length, 58)
  assert.equal(catalog.companies.filter(c=>c.listed).length, 544)
  assert.equal(core.filter(c => c.listed).length, 54)
  assert.equal(new Set(core.map(c => c.sectorId)).size, 10)
  assert.deepEqual(SECTORS.map(s=>core.filter(c=>c.sectorId===s.id).length), [6,5,6,6,5,7,4,7,5,7])
  assert.equal(core.filter(c => !c.listed && !c.listings.length).length, 4)
  for (const selected of MAP_COMPANIES) {
    const row = core.find(c=>c.id===selected.id)
    assert.equal(row.listings[0]?.ticker || null, selected.primaryTicker)
    assert.equal(row.sectorId, selected.sectorId)
    assert.equal(row.selection.order, selected.sourceOrder)
    assert.ok(row.selection.reason && row.overview && row.product && row.sources.length)
  }
  assert.equal(new Set(catalog.companies.map(c => c.id)).size, catalog.companies.length)
  const qualcomm = findCompanyByTicker('QCOM')
  assert.equal(qualcomm.id, 'C0371')
  assert.equal(qualcomm.sectorId, 'ai-chips')
  assert.ok(qualcomm.selection)
  assert.equal(catalog.companies.filter(c => c.listings.some(l => l.ticker === 'QCOM')).length, 1)
  const cxmt = findCompanyByTicker('688825.SS')
  assert.equal(cxmt.id, 'C0119')
  assert.equal(cxmt.sectorId, 'memory')
  assert.ok(cxmt.selection)
  assert.equal(catalog.companies.filter(c => c.listings.some(l => l.ticker === '688825.SS')).length, 1)
  assert.equal(findCompanyByTicker('042700.KS').id, 'C0582')
  assert.equal(findCompanyByTicker('042700.KS').sectorId, 'semiconductor-equipment')
  assert.equal(findCompanyByTicker(' asx '), findCompanyByTicker('3711.tw'))
  assert.equal(findCompanyByTicker('2330.TW'), findCompanyByTicker('TSM'))
  for(const ticker of ['AAPL','TSLA']){
    const row=findCompanyByTicker(ticker)
    assert.equal(row.selection,null)
    assert.ok(row.tags.includes('자체 설계 칩'))
    assert.notEqual(row.sectorId,'ai-chips')
  }
  assert.equal(findCompanyByTicker('TSLA').id,'SCN038')
  assert.ok(!catalog.companies.some(c=>c.id==='C0435' || c.name.toLowerCase()==='xai'))
  const discussion = new Set(instruments.filter(x => x.chains.some(id => id > 0)).map(x => x.symbol))
  assert.ok(catalog.companies.every(c => !c.discussionTicker || discussion.has(c.discussionTicker)))
  assert.ok(catalog.companies.every(c => c.product && c.overview && c.sourceStatus === (c.sources.length ? 'linked' : 'pending')))
  assert.equal(findCompanyByTicker('GC=F'), undefined)
})

test('Nscale is added once as an unlisted cloud issuer without turning the proposed NSCL symbol into a quote lookup', () => {
  const nscale = catalog.companies.find(c => c.id === 'C0587')
  assert.equal(catalog.companies.filter(c => c.id === 'C0587' || c.name.toLowerCase() === 'nscale').length, 1)
  assert.equal(nscale.sectorId, 'cloud-gpu')
  assert.equal(nscale.country, '영국')
  assert.equal(nscale.selection.order, 52)
  assert.equal(nscale.listed, false)
  assert.deepEqual(nscale.listings, [])
  assert.deepEqual(nscale.listingCodes, [])
  for (const field of ['financialId', 'discussionTicker', 'dartSymbol']) assert.equal(nscale[field], null)
  assert.equal(findCompanyByTicker('NSCL'), undefined)
  assert.equal(findCompanyByTicker(' nScL '), undefined)
  assert.ok(nscale.sources.some(s => s.url === 'https://www.nscale.com/service-overview'))
})

test('optical communications contains 25 reclassified issuers and seven source-backed additions while networking semiconductors stay put', () => {
  const optical = catalog.companies.filter(company => company.sectorId === 'optical-communications')
  assert.equal(optical.length, 32)
  assert.equal(catalog.companies.filter(company => company.sectorId === 'ai-equipment').length, 48)
  const moved = ['C0520','C0110','C0293','C0116','C0153','C0160','C0102','C0176','C0446','C0179','C0044','C0470','C0008','C0215','C0208','C0516','C0252','C0165','C0294','C0482','C0167','C0342','C0557','C0559','C0539']
  assert.ok(moved.every(id => optical.some(company => company.id === id)))
  assert.deepEqual(optical.filter(company => /^C05(?:8[8-9]|9[0-4])$/.test(company.id)).map(company => company.listings[0].ticker),
    ['AXTI','010170.KQ','046970.KQ','062970.KQ','688498.SS','3081.TWO','2455.TW'])
  assert.equal(catalog.companies.find(company => company.id === 'C0117').sectorId, 'ai-equipment')
  for (const ticker of ['ANET','CSCO','2345.TW']) assert.equal(findCompanyByTicker(ticker).sectorId, 'ai-equipment')
  for (const ticker of ['AVGO','MRVL']) assert.equal(findCompanyByTicker(ticker).sectorId, 'ai-chips')
})

test('the original 586 issuer IDs stay intact with the SpaceX-to-Tesla exception and eight separate additions', () => {
  const master = JSON.parse(readFileSync(new URL('../../research/market/company-universe.json', import.meta.url), 'utf8'))
  assert.equal(master.companies.length, 586)
  assert.equal(new Set(master.companies.map(c => c.id)).size, 586)
  assert.ok(master.companies.some(c => c.id === 'C0435'))
  assert.ok(!master.companies.some(c => c.id === 'C0587' || c.id === 'SCN038'))
  const preservedIds = master.companies.map(c => c.id === 'C0435' ? 'SCN038' : c.id)
  assert.deepEqual(catalog.companies.map(c => c.id).sort(), [...preservedIds, ...Array.from({length:8},(_,index)=>'C'+String(587+index).padStart(4,'0'))].sort())
})

test('an approved release validates issuer counts, publication flags and sector identities', () => {
  const out = buildCompanyRelease(input())
  assert.equal(out.companies.length, 594)
  for (const change of [
    r => { r.status = 'draft' }, r => { r.companies.pop() }, r => { r.selections.pop() },
    r => { r.companies[0].id = r.companies[1].id }, r => { r.companies[0].sectorId = '8' },
    r => { r.selections[0].companyId = 'missing' }, r => { r.companies[0].public = 'true' },
    r => { r.selections[0].companyId = 'C0041' },
    r => { r.companies.find(c=>c.id==='C0051').listings.reverse() },
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
    { companyId: 'C0041' },
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
  const article = projected.companies.find(c=>c.id==='C0051').analysis
  assert.equal(article.conclusion, '최신 발행본')
  assert.equal(article.metrics[0].value, null)
  data.editions = [edition({ status: 'review', conclusion: 'HIDDEN' })]
  const revised = buildCompanyRelease(data, projected)
  assert.deepEqual(revised.companies.find(c=>c.id==='C0051').analysis, article)
  assert.equal(revised.companies.find(c=>c.id==='C0041').analysis, null)
  assert.ok(!JSON.stringify(revised).includes('HIDDEN'))
})
