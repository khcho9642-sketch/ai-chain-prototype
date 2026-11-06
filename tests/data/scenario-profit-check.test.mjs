import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDefaultScenarioRequest, evaluateCompanyPreview } from '../../assets/scenario-core.js'
import { buildProfitCheck } from '../../assets/scenario-profit-check.js'

const hynix = '000660.KS'

function result(companyId, inputs, { scenario = 'hbm_market', override } = {}) {
  const request = buildDefaultScenarioRequest(scenario)
  Object.assign(request.inputs, inputs)
  if (override) request.companyOverrides[companyId] = override
  const [company] = evaluateCompanyPreview(request, [companyId]).companies
  return { company, check: buildProfitCheck(company, request) }
}

function close(actual, expected) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-9,
    `expected ${actual} to equal ${expected}`)
}

test('price-only producer check uses actual consolidated operating income, mix and price realization', () => {
  const hbmShare = 33e9 * 0.632 * 1421.4 / 97_146_675e6
  for (const shock of [10, -10]) {
    const { company, check } = result(hynix, { hbmPriceChangePct: shock })
    assert.equal(check.status, 'available')
    assert.equal(check.fiscalYear, 2025)
    assert.equal(check.currency, 'KRW')
    close(check.operatingMarginPct, 100 * 47_206_300e6 / 97_146_700e6)
    close(check.annualRevenueChange, 97_146_700e6 * hbmShare * shock / 100)
    close(check.annualProfitChange, 47_206_300e6 * hbmShare * shock / 100)
    close(check.simpleEvChangePct, hbmShare * shock)
    close(check.dcfEvChangePct, company.effectAttribution.directPct)
    close(check.magnitudeRatio, 4.900062507)
    assert.equal(company.effectAttribution.chainPct, 0)
  }
  const half = result(hynix, { hbmPriceChangePct: 10 }, { override: { assumptions: { aspPassThrough: 0.5 } } }).check
  close(half.simpleEvChangePct, hbmShare * 5)
})

test('adding HBM supply changes the full DCF but leaves both price-only comparators intact', () => {
  const price = result(hynix, { hbmPriceChangePct: 10 })
  const mixed = result(hynix, { hbmPriceChangePct: 10, hbmSupplyChangePct: 20 })
  assert.notEqual(mixed.company.valueChangePct, price.company.valueChangePct)
  assert.deepEqual(mixed.check, price.check)
  const supply = result(hynix, { hbmSupplyChangePct: 10 })
  assert.equal(supply.check.status, 'no-price-shock')
  close(supply.check.dcfEvChangePct, 0)
})

test('buyer has a measurable cost effect, zero selling-price effect and an undefined multiple', () => {
  const { company, check } = result('NVDA', { hbmPriceChangePct: 10 })
  assert.equal(check.status, 'no-selling-price-path')
  assert.equal(check.simpleEvChangePct, 0)
  assert.equal(check.magnitudeRatio, null)
  assert.equal(company.effectAttribution.directPct, 0)
  assert.ok(company.effectAttribution.chainPct < 0)
  close(check.dcfEvChangePct, company.effectAttribution.chainPct)
})

test('tenfold gaps report the valuation mechanism while price-free drivers have no price check', () => {
  const { check } = result(hynix, { hbmPriceChangePct: 10 }, { override: { assumptions: { fcffMarginPct: 2 } } })
  assert.ok(check.magnitudeRatio > 10)
  assert.match(check.explanation, /세후/)
  assert.match(check.explanation, /영업이익률/)
  assert.equal(result(hynix, { capexChangePct: 10 }, { scenario: 'hyperscaler_capex' }).check, null)
})

test('rent uses seller exposure, operating margin and the issuer reporting currency', () => {
  const { company, check } = result('EQIX', { gpuRentChangePct: 10, dcRentChangePct: 10 }, { scenario: 'gpu_dc_rent' })
  assert.equal(check.status, 'available')
  assert.equal(check.currency, 'USD')
  close(check.revenueChangePct, 3.0375)
  close(check.simpleEvChangePct, check.revenueChangePct)
  close(check.dcfEvChangePct, company.valueChangePct)
})

test('missing or incompatible income records suppress the profit multiple and permit a compatible revenue bridge', () => {
  const { company } = result(hynix, { hbmPriceChangePct: 10 })
  const request = { scenarioId: 'hbm_market', inputs: { hbmPriceChangePct: 10 } }
  const facts = company.financialBasis.facts
  const withFacts = replacements => buildProfitCheck({
    ...company, financialBasis: { ...company.financialBasis, facts: { ...facts, ...replacements } },
  }, request)
  assert.equal(withFacts({ operatingIncome: undefined }).annualProfitChange, null)
  assert.equal(withFacts({ operatingIncome: { ...facts.operatingIncome, value: -1 } }).simpleEvChangePct, null)
  const incompatible = { ...facts.revenue, accountingStandard: 'other' }
  assert.equal(withFacts({ revenue: incompatible, cashFlowBasisRevenue: undefined }).status, 'missing-operating-margin')
  const bridged = withFacts({ revenue: incompatible, cashFlowBasisRevenue: facts.revenue })
  assert.equal(bridged.status, 'available')
  assert.equal(bridged.revenueFact, facts.revenue)
})
