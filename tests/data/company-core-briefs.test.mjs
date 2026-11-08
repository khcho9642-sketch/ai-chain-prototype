import test from 'node:test'
import assert from 'node:assert/strict'
import { catalog } from '../../assets/company-catalog.js'
import { coreBriefs } from '../../assets/company-core-briefs.js'
import { annualTrend, mountCompanyFinancials } from '../../assets/company-financials.js'
import { yearsById } from '../../assets/company-financial-snapshot.js'
import { supplementalFinancials } from '../../assets/company-core-financials.js'
import { MAP_COMPANIES } from '../../assets/home-map-universe.js'

test('core articles and cited operating evidence cover precisely the 51 mapped issuers', () => {
  assert.equal(MAP_COMPANIES.length, 51)
  assert.deepEqual(Object.keys(coreBriefs).sort(), MAP_COMPANIES.map(c => c.id).sort())
  const seenRisks = new Set()
  for (const c of MAP_COMPANIES) {
    const brief = coreBriefs[c.id]
    for (const key of ['business', 'role', 'buyers', 'supply', 'risk']) assert.ok(brief[key]?.trim(), c.id + ' ' + key)
    assert.equal(new URL(brief.source[1]).protocol, 'https:')
    seenRisks.add(brief.risk)
    if (!c.listed) {
      assert.ok(brief.observation[0].length > 40)
      assert.equal(new URL(brief.observation[2]).protocol, 'https:')
    }
  }
  assert.equal(seenRisks.size, MAP_COMPANIES.length)
})

test('the previously verified 46 listed issuers retain comparable cited revenues and unavailable profit', () => {
  const listed = MAP_COMPANIES.filter(c => c.listed)
  assert.equal(listed.length, 48)
  const verified = listed.filter(c => !['C0371', 'C0119'].includes(c.id))
  assert.equal(verified.length, 46)
  for (const c of verified) {
    const company = catalog.companies.find(row => row.id === c.id)
    const years = yearsById[company?.financialId] || supplementalFinancials(c.id)?.years
    assert.ok(annualTrend(years).startsWith('FY'), c.id)
    for (const year of years.slice(0,2)) {
      for (const field of ['revenue', 'operating_income', 'operating_cash_flow']) {
        const fact = year.facts[field]
        if (field === 'revenue' || field === 'operating_cash_flow') {
          assert.ok(Number.isFinite(fact?.value) && fact.url.startsWith('https://'), c.id + ' ' + field)
        } else if (fact && !fact.pending) {
          assert.ok(Number.isFinite(fact.value) && fact.url.startsWith('https://'), c.id + ' ' + field)
        }
      }
    }
  }
  const gds = supplementalFinancials('C0182')
  assert.equal(gds.years[0].scope, 'continuing')
  assert.equal(gds.years[0].facts.operating_income.value, -55750000)
  assert.equal(supplementalFinancials('C0128'), null)
  assert.equal(annualTrend(gds.years).includes('10.76% 증가'), true)
})

for (const { id, name, rolePattern, sourceHostname } of [
  { id: 'C0371', name: 'Qualcomm', rolePattern: /Hexagon NPU/, sourceHostname: 'investor.qualcomm.com' },
  { id: 'C0119', name: 'CXMT', rolePattern: /DDR5/, sourceHostname: 'www.cxmt.com' },
]) {
  test(`${name} has a cited core introduction while missing stored annual financials stay explicit`, async t => {
    const company = catalog.companies.find(c => c.id === id)
    assert.ok(company.selection)
    assert.equal(company.financialId, null)
    assert.equal(supplementalFinancials(company.id), null)
    assert.equal(annualTrend(undefined), '')
    assert.match(coreBriefs[company.id].role, rolePattern)
    assert.equal(new URL(coreBriefs[company.id].source[1]).hostname, sourceHostname)
    const previousDocument = globalThis.document
    globalThis.document = { createElement: tag => ({ tag, textContent: '' }) }
    const host = { nodes: [], replaceChildren(...nodes) { this.nodes = nodes }, append(...nodes) { this.nodes.push(...nodes) } }
    const dispose = mountCompanyFinancials(host, company)
    t.after(() => { dispose(); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(host.nodes.map(node => node.textContent), ['연간 실적 추이', '확인된 연간 재무제표가 없습니다.'])
  })
}

test('annual trend suppresses mismatched scope, currency, nonconsecutive years and missing amounts', () => {
  const [latest, prior] = supplementalFinancials('C0104').years
  for (const changed of [
    { ...prior, scope:'separate' }, { ...prior, currency:'EUR' },
    { ...prior, fiscalYear:2022 }, { ...prior, facts:{ revenue:{ value:null } } },
  ]) assert.equal(annualTrend([latest, changed]), '')
})

test('missing reported operating income does not invent a margin or discard cited revenue trends', () => {
  for (const id of ['C0110','C0142','C0270']) {
    const company = catalog.companies.find(row => row.id === id)
    const years = yearsById[company.financialId]
    assert.ok(years.slice(0,2).every(year => year.facts.operating_income === undefined))
    assert.match(annualTrend(years), /^FY\d{4} 매출은/)
    assert.doesNotMatch(annualTrend(years), /영업이익률/)
  }
})
