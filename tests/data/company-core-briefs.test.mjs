import test from 'node:test'
import assert from 'node:assert/strict'
import { catalog } from '../../assets/company-catalog.js'
import { coreBriefs } from '../../assets/company-core-briefs.js'
import { annualTrend } from '../../assets/company-financials.js'
import { yearsById } from '../../assets/company-financial-snapshot.js'
import { supplementalFinancials } from '../../assets/company-core-financials.js'
import { MAP_COMPANIES } from '../../assets/home-map-universe.js'

test('core articles and cited operating evidence cover precisely the 49 mapped issuers', () => {
  assert.equal(MAP_COMPANIES.length, 49)
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
  assert.equal(seenRisks.size, 49)
})

test('all 46 listed core companies have comparable cited revenues while preserving unavailable profit', () => {
  const listed = MAP_COMPANIES.filter(c => c.listed)
  assert.equal(listed.length, 46)
  for (const c of listed) {
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
