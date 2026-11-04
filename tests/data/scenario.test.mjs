import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSUMPTION_LIMITS,
  BIG7_COMPANY_IDS,
  COMPANIES,
  DRIVER_LABELS,
  MODEL_ASSUMPTIONS,
  SCENARIO_DEFINITIONS,
  SEGMENTS,
} from '../../assets/scenario-data.js'
import {
  buildDefaultScenarioRequest,
  evaluateScenario,
  validateScenarioRequest,
} from '../../assets/scenario-core.js'

const segment = (result, id) => result.segments.find(item => item.segmentId === id)
const company = (result, id) => result.companies.find(item => item.companyId === id)
const bridgeYear = (result, id, year = 1) => segment(result, id).valuation.operatingBridge[year - 1]
const closeTo = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

test('catalog exposes five scenarios, nine segments, bounds and unique consolidated companies', () => {
  assert.equal(SCENARIO_DEFINITIONS.length, 5)
  assert.equal(SEGMENTS.length, 9)
  assert.deepEqual(SEGMENTS.map(item => item.id), ['SEG1', 'SEG2', 'SEG3', 'SEG4', 'SEG5', 'SEG6', 'SEG7', 'SEG8', 'SEG9'])
  assert.equal(new Set(COMPANIES.map(item => item.companyId)).size, COMPANIES.length)
  assert.deepEqual(BIG7_COMPANY_IDS, ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'])
  assert.ok(BIG7_COMPANY_IDS.every(id => COMPANIES.some(item => item.companyId === id && item.listingStatus === 'listed')))
  assert.deepEqual(ASSUMPTION_LIMITS.netDebtToEvPct, [-50, 90])
  assert.equal(DRIVER_LABELS.hyperscalerCapex, 'CAPEX 변화')
  const samsung = COMPANIES.find(item => item.companyId === '005930.KS')
  assert.deepEqual(samsung.segmentIds, ['SEG2', 'SEG3'])
  closeTo(Object.values(samsung.segmentWeights).reduce((a, b) => a + b, 0), 1)
  assert.ok(COMPANIES.filter(item => item.isBig7).every(item => item.nonScenarioSharePct > 0))
})

test('default inputs are a computed zero-shock identity for all five scenarios', () => {
  for (const definition of SCENARIO_DEFINITIONS) {
    const result = evaluateScenario(buildDefaultScenarioRequest(definition.id))
    assert.equal(result.model.actualCompanyFinancialsUsed, false)
    assert.equal(result.model.currentPricesUsed, false)
    assert.equal(result.big7.scenarioValueIndex, 100)
    assert.equal(result.universe.scenarioValueIndex, 100)
    assert.ok(result.segments.every(item => item.scenarioValueIndex === 100))
    assert.ok(result.companies.every(item => item.scenarioValueIndex === 100))
    assert.equal(result.checks.zeroShockIdentity, true)
    assert.equal(result.checks.finiteResults, true)
    assert.equal(result.checks.positiveBaselineFcff, true)
    assert.equal(result.checks.terminalShockApplied, false)
    assert.equal(result.checks.latestShockEndWithinForecastHorizon, true)
  }
})

test('CAPEX means change from baseline budget: cash outflow for cloud and supplier volume for the chain', () => {
  const result = evaluateScenario({
    scenarioId: 'hyperscaler_capex', durationMonths: 12,
    inputs: { capexChangePct: 20 },
  })
  assert.ok(segment(result, 'SEG8').scenarioValueIndex < 100)
  assert.ok(bridgeYear(result, 'SEG8').incrementalCapexCashoutUnits > 0)
  assert.equal(bridgeYear(result, 'SEG8').revenueVolumePct, 0)
  assert.ok(bridgeYear(result, 'SEG8', 2).revenueVolumePct > 0)
  assert.ok(segment(result, 'SEG5').scenarioValueIndex > 100)
  assert.ok(bridgeYear(result, 'SEG5', 2).revenueVolumePct > 0)
  assert.equal(bridgeYear(result, 'SEG5', 2).incrementalCapexCashoutUnits, 0)
  assert.ok(segment(result, 'SEG1').paths.some(path => path.segments.join('>') === 'SEG8>SEG5>SEG4>SEG3>SEG1'))
  assert.ok(result.segments.every(item => item.coverage.status === 'modeled'))
})

test('HBM price and supply use separate ASP, unit-cost and volume primitives', () => {
  const price = evaluateScenario({
    scenarioId: 'hbm_market', durationMonths: 12,
    inputs: { hbmPriceChangePct: 20, hbmSupplyChangePct: 0 },
  })
  assert.ok(segment(price, 'SEG3').scenarioValueIndex > 100)
  assert.ok(bridgeYear(price, 'SEG3').aspPct > 0)
  assert.equal(bridgeYear(price, 'SEG3').incrementalUnitCostUnits, 0)
  assert.ok(segment(price, 'SEG4').scenarioValueIndex < 100)
  assert.ok(bridgeYear(price, 'SEG4', 2).incrementalUnitCostUnits > 0)
  assert.equal(bridgeYear(price, 'SEG4', 2).aspPct, 0)
  assert.equal(company(price, '285A.T').scenarioValueIndex, 100)
  assert.ok(price.segments.every(item => item.coverage.status === 'modeled'))

  const supply = evaluateScenario({
    scenarioId: 'hbm_market', durationMonths: 12,
    inputs: { hbmPriceChangePct: 0, hbmSupplyChangePct: 20 },
  })
  assert.ok(segment(supply, 'SEG3').scenarioValueIndex > 100)
  assert.ok(segment(supply, 'SEG4').scenarioValueIndex > 100)
  assert.ok(bridgeYear(supply, 'SEG3').revenueVolumePct > 0)
  assert.equal(bridgeYear(supply, 'SEG3').aspPct, 0)
  assert.equal(bridgeYear(supply, 'SEG3').incrementalUnitCostUnits, 0)
})

test('GPU and data-center rents separate provider ASP from customer unit cost and reach all segments', () => {
  const result = evaluateScenario({
    scenarioId: 'gpu_dc_rent', durationMonths: 12,
    inputs: { gpuRentChangePct: 20, dcRentChangePct: 15 },
  })
  assert.ok(bridgeYear(result, 'SEG8').aspPct > 0)
  assert.ok(bridgeYear(result, 'SEG7').aspPct > 0)
  assert.ok(bridgeYear(result, 'SEG9', 2).incrementalUnitCostUnits > 0)
  assert.ok(segment(result, 'SEG1').paths.length > 0)
  assert.ok(result.segments.every(item => item.coverage.status === 'modeled'))
})

test('model growth input compares baseline to target as a relative revenue change', () => {
  const result = evaluateScenario({
    scenarioId: 'model_growth', durationMonths: 12,
    inputs: { modelBaselineGrowthPct: 100, modelTargetGrowthPct: 50 },
  })
  closeTo(result.scenario.drivers[0].normalizedShock, -0.25)
  assert.ok(segment(result, 'SEG9').scenarioValueIndex < 100)
  assert.ok(segment(result, 'SEG8').scenarioValueIndex < 100)
  assert.ok(result.segments.every(item => item.coverage.status === 'modeled'))
})

test('rate input is percentage points and changes annual WACC only while active', () => {
  const result = evaluateScenario({
    scenarioId: 'interest_rate', durationMonths: 12,
    inputs: { rateChangePctPoints: 1 },
  })
  assert.ok(result.segments.every(item => item.scenarioValueIndex < 100))
  const dataCenter = segment(result, 'SEG7')
  assert.ok(dataCenter.valuation.scenarioDiscountRatesPct[0] > dataCenter.assumptions.discountRatePct)
  assert.equal(dataCenter.valuation.scenarioDiscountRatesPct.at(-1), dataCenter.assumptions.discountRatePct)
  assert.equal(dataCenter.valuation.terminalShockApplied, false)
})

test('eight-year horizon contains maximum shock tail and terminal value is baseline-normalized', () => {
  const result = evaluateScenario({
    scenarioId: 'model_growth', durationMonths: 36,
    inputs: { modelBaselineGrowthPct: 50, modelTargetGrowthPct: 100 },
  })
  assert.equal(result.model.forecastYears, 8)
  assert.equal(result.model.horizonMonths, 96)
  assert.ok(result.scenario.latestShockEndMonth <= result.model.horizonMonths)
  assert.equal(result.checks.latestShockEndWithinForecastHorizon, true)
  assert.ok(result.companies.every(item => item.valuation.terminalValueNormalizedToBaseline))
})

test('multi-segment roles do not duplicate companies and Big7 remains equal weighted', () => {
  const result = evaluateScenario({
    scenarioId: 'hbm_market', durationMonths: 12,
    inputs: { hbmPriceChangePct: 10, hbmSupplyChangePct: -10 },
  })
  assert.equal(result.companies.filter(item => item.companyId === '005930.KS').length, 1)
  assert.equal(result.companies.length, new Set(result.companies.map(item => item.companyId)).size)
  assert.ok(result.checks.segmentMembershipCount > result.checks.companyConsolidatedCount)
  assert.equal(result.big7.members.length, 7)
  closeTo(result.big7.scenarioValueIndex,
    result.big7.members.reduce((total, item) => total + item.scenarioValueIndex, 0) / 7)
  assert.ok(result.big7.members.every(item => item.nonScenarioSharePct > 0))
})

test('company overrides are explicit, and observed-price ratio needs same-date net debt', () => {
  const baseRequest = {
    scenarioId: 'hyperscaler_capex', durationMonths: 12,
    inputs: { capexChangePct: 20 },
  }
  const missing = evaluateScenario(baseRequest)
  assert.equal(company(missing, 'MSFT').valuation.equityValueRatio, null)
  assert.equal(company(missing, 'MSFT').valuation.quoteLinkStatus, 'missing-same-date-net-debt-to-ev')

  const overridden = evaluateScenario({
    ...baseRequest,
    companyOverrides: {
      MSFT: {
        assumptions: {
          baseGrowthPct: 6, fcffMarginPct: 18, capexToRevenuePct: 25,
          discountRatePct: 8, terminalGrowthPct: 2.5, netDebtToEvPct: 20,
        },
        exposures: { hyperscalerCapex: 1.5 },
        scenarioExposureScale: 0.60,
      },
    },
  })
  const msft = company(overridden, 'MSFT')
  assert.equal(msft.assumptions.baseGrowthPct, 6)
  assert.equal(msft.assumptions.capexToRevenuePct, 25)
  assert.equal(msft.assumptions.driverExposureMultipliers.hyperscalerCapex, 1.5)
  const expectedEquityRatio = (msft.valuation.enterpriseValueRatio - 0.2) / 0.8
  closeTo(msft.valuation.equityValueRatio, expectedEquityRatio, 1e-6)
  assert.equal(msft.valuation.quoteLinkStatus, 'ready-for-observed-price-ratio-only')
  assert.equal(company(overridden, 'OPENAI').valuation.quoteLinkStatus, 'not-applicable-private')
})

test('driver attribution reconciles while path allocation is labeled interpretive', () => {
  const result = evaluateScenario({
    scenarioId: 'hbm_market', durationMonths: 18,
    inputs: { hbmPriceChangePct: 15, hbmSupplyChangePct: -10 },
  })
  for (const item of [...result.segments, ...result.companies]) {
    closeTo(item.driverContributions.reduce((total, driver) => total + driver.valueIndexPoints, 0), item.valueChangePct, 2e-4)
    assert.ok(item.paths.every(path => /interpretive/.test(path.attributionMethod)))
  }
})

test('invalid ranges, unknown fields and invalid terminal or equity assumptions fail', () => {
  assert.throws(() => validateScenarioRequest({ scenarioId: 'unknown' }), /알 수 없는 시나리오/)
  assert.throws(() => evaluateScenario({ scenarioId: 'interest_rate', durationMonths: 12, inputs: { rateChangePctPoints: Infinity } }), /유한한 숫자/)
  assert.throws(() => evaluateScenario({ scenarioId: 'interest_rate', durationMonths: 7, inputs: { rateChangePctPoints: 0 } }), /6개월 단위/)
  assert.throws(() => evaluateScenario({ scenarioId: 'model_growth', inputs: { modelBaselineGrowthPct: 50, modelTargetGrowthPct: 50 }, companyOverrides: { FAKE: {} } }), /알 수 없는 회사/)
  assert.throws(() => evaluateScenario({
    scenarioId: 'model_growth', inputs: { modelBaselineGrowthPct: 50, modelTargetGrowthPct: 50 },
    companyOverrides: { META: { assumptions: { discountRatePct: 4, terminalGrowthPct: 4 } } },
  }), /최소 0.5%p/)
  assert.throws(() => evaluateScenario({
    scenarioId: 'hbm_market', inputs: { hbmPriceChangePct: 0, hbmSupplyChangePct: 0 },
    companyOverrides: { NVDA: { exposures: { hbmPrice: -1 } } },
  }), /0~2/)
  assert.throws(() => evaluateScenario({
    scenarioId: 'interest_rate', inputs: { rateChangePctPoints: 0 },
    companyOverrides: { NVDA: { assumptions: { netDebtToEvPct: 95 } } },
  }), /-50~90/)
})

test('model revenue contraction and recovery preserve growth-rate arithmetic', () => {
  const contraction = evaluateScenario({ scenarioId: 'model_growth', durationMonths: 12, inputs: { modelBaselineGrowthPct: 50, modelTargetGrowthPct: -20 } })
  closeTo(contraction.scenario.drivers[0].normalizedShock, 0.8 / 1.5 - 1)
  assert.ok(segment(contraction, 'SEG9').scenarioValueIndex < 100)
  const recovery = evaluateScenario({ scenarioId: 'model_growth', durationMonths: 12, inputs: { modelBaselineGrowthPct: -20, modelTargetGrowthPct: 0 } })
  closeTo(recovery.scenario.drivers[0].normalizedShock, 0.25)
  assert.ok(segment(recovery, 'SEG9').scenarioValueIndex > 100)
})
