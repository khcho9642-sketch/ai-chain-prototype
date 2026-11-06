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
  evaluateCompanyPreview,
  evaluateScenario,
  validateScenarioRequest,
} from '../../assets/scenario-core.js'

import { financialProfile } from '../../assets/scenario-actuals.js'
import { RATE_CAPEX_FITS } from '../../assets/scenario-rate-fits.js'
import { SCENARIO_FINANCIAL_BASELINES, SCENARIO_FINANCIAL_AS_OF } from '../../assets/scenario-financial-baselines.js'

const segment = (result, id) => result.segments.find(item => item.segmentId === id)
const company = (result, id) => result.companies.find(item => item.companyId === id)
const bridgeYear = (result, id, year = 1) => segment(result, id).valuation.operatingBridge[year - 1]
const closeTo = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

test('visible companies during a drag exactly match the committed result across scenarios', () => {
  const ids = ['NVDA', '000660.KS']
  for (const definition of SCENARIO_DEFINITIONS) {
    const request = buildDefaultScenarioRequest(definition.id)
    Object.assign(request.inputs, definition.presets.upside.inputs)
    if (definition.id === 'interest_rate') request.inputs.rateChangePctPoints = -0.83
    request.companyOverrides.NVDA = { scenarioExposureScale: 0.68 }
    const preview = evaluateCompanyPreview(request, ids)
    const full = evaluateScenario(request)
    for (const [i, id] of ids.entries()) {
      const fullRow = structuredClone(company(full, id))
      if (definition.id === 'interest_rate') {
        assert.equal('chainStandalonePct' in preview.companies[i].effectAttribution, false)
        assert.ok(Number.isFinite(fullRow.rateAttribution.chainStandalonePct))
        delete fullRow.effectAttribution.chainStandalonePct
        assert.ok(!Object.hasOwn(preview.companies[i], 'rateCapexSensitivityBand'))
        assert.ok(fullRow.rateCapexSensitivityBand)
        delete fullRow.rateCapexSensitivityBand
      }
      assert.deepEqual(preview.companies[i], fullRow)
    }
    assert.deepEqual(preview.scenario.rateCapexTransmission, full.scenario.rateCapexTransmission)
  }
})

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
    assert.equal(result.model.actualCompanyFinancialsUsed, true)
    assert.equal(result.model.actualFinancialCompanyCount, 38)
    assert.equal(result.model.illustrativeFinancialCompanyCount, 3)
    assert.equal(result.model.currentPricesUsed, false)
    assert.equal(result.big7.scenarioValueIndex, 100)
    assert.equal(result.universe.scenarioValueIndex, 100)
    assert.ok(result.segments.every(item => item.scenarioValueIndex === 100))
    assert.ok(result.companies.every(item => item.scenarioValueIndex === 100))
    assert.equal(result.checks.zeroShockIdentity, true)
    assert.equal(result.checks.finiteResults, true)
    assert.equal(result.checks.positiveBaselineFcff, false)
    assert.equal(result.checks.terminalShockApplied, true)
    assert.equal(result.scenario.persistence, 'permanent')
    assert.equal(result.checks.allPathsBeginWithinForecastHorizon, true)
  }
})

test('CAPEX means change from baseline budget: cash outflow for cloud and supplier volume for the chain', () => {
  const result = evaluateScenario({
    scenarioId: 'hyperscaler_capex',
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
    scenarioId: 'hbm_market',
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
    scenarioId: 'hbm_market',
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
    scenarioId: 'gpu_dc_rent',
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
    scenarioId: 'model_growth',
    inputs: { modelBaselineGrowthPct: 100, modelTargetGrowthPct: 50 },
  })
  closeTo(result.scenario.drivers[0].normalizedShock, -0.25)
  assert.ok(segment(result, 'SEG9').scenarioValueIndex < 100)
  assert.ok(segment(result, 'SEG8').scenarioValueIndex < 100)
  assert.ok(result.segments.every(item => item.coverage.status === 'modeled'))
})

test('rate input is percentage points and changes WACC throughout the valuation', () => {
  const result = evaluateScenario({
    scenarioId: 'interest_rate',
    inputs: { rateChangePctPoints: 1 },
  })
  assert.ok(result.segments.every(item => item.scenarioValueIndex < 100))
  const dataCenter = segment(result, 'SEG7')
  assert.ok(dataCenter.valuation.scenarioDiscountRatesPct[0] > dataCenter.assumptions.discountRatePct)
  assert.equal(dataCenter.valuation.scenarioDiscountRatesPct.at(-1), dataCenter.valuation.scenarioDiscountRatesPct[0])
  assert.equal(dataCenter.valuation.terminalShockApplied, true)
})

test('eight-year horizon contains each onset and leaves a divergent terminal unvalued', () => {
  const result = evaluateScenario({
    scenarioId: 'model_growth',
    inputs: { modelBaselineGrowthPct: 50, modelTargetGrowthPct: 100 },
  })
  assert.equal(result.model.forecastYears, 8)
  assert.equal(result.model.horizonMonths, 96)
  assert.ok(result.scenario.longestPathLagMonths < result.model.horizonMonths)
  assert.equal(result.checks.allPathsBeginWithinForecastHorizon, true)
  assert.ok(result.checks.nonconvergentCompanyCount > 0)
  assert.equal(result.universe.valueChangePct, null)
  assert.ok(result.companies.every(item => !item.valuation.terminalValueNormalizedToBaseline))
})

test('multi-segment roles do not duplicate companies and Big7 remains equal weighted', () => {
  const result = evaluateScenario({
    scenarioId: 'hbm_market',
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
    scenarioId: 'hyperscaler_capex',
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

test('each repriced HBM path reconciles to its direct or transmitted effect', () => {
  const result = evaluateScenario({
    scenarioId: 'hbm_market',
    inputs: { hbmPriceChangePct: 15, hbmSupplyChangePct: -10 },
  })
  for (const item of [...result.segments, ...result.companies]) {
    closeTo(item.driverContributions.reduce((total, driver) => total + driver.valueIndexPoints, 0), item.valueChangePct, 1e-10)
    const pathSum = paths => paths.reduce((total, path) => total + path.impactPoints, 0)
    closeTo(pathSum(item.paths.filter(path => path.segments.length === 1)), item.effectAttribution.directPct, 1e-10)
    closeTo(pathSum(item.paths.filter(path => path.segments.length > 1)), item.effectAttribution.chainPct, 1e-10)
  }
})

test('invalid ranges, unknown fields and invalid terminal or equity assumptions fail', () => {
  assert.throws(() => validateScenarioRequest({ scenarioId: 'unknown' }), /알 수 없는 시나리오/)
  assert.throws(() => evaluateScenario({ scenarioId: 'interest_rate', inputs: { rateChangePctPoints: Infinity } }), /유한한 숫자/)
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


test('latest consolidated accounts anchor revenue and first-year cash flow in original currency units', () => {
  const result = evaluateScenario(buildDefaultScenarioRequest('interest_rate'))
  const nvidia = company(result, 'NVDA')
  const history = SCENARIO_FINANCIAL_BASELINES.NVDA.years
  const { facts, currency } = history[0]
  const basis = nvidia.financialBasis
  const { revenue, operatingCashFlow, capitalExpenditure } = facts
  const capex = Math.abs(capitalExpenditure.value)
  assert.equal(basis.status, 'actual')
  assert.equal(basis.startingRevenue, revenue.value)
  assert.equal(basis.asOfDate, SCENARIO_FINANCIAL_AS_OF)
  assert.equal(basis.currency, currency)
  assert.equal(basis.fiscalYear, history[0].fiscalYear)
  assert.equal(basis.scope, 'consolidated')
  assert.equal(basis.marginMethod, 'cfo-minus-capex')
  const growthPeriod = history.find(year => year.fiscalYear === basis.growthStartFiscalYear)
  const historicalGrowth = 100 * ((revenue.value / growthPeriod.facts.revenue.value) ** (1 / basis.growthYears) - 1)
  closeTo(basis.historicalGrowthPct, historicalGrowth)
  assert.ok(basis.historicalGrowthPct > ASSUMPTION_LIMITS.baseGrowthPct[1])
  assert.equal(basis.firstYearGrowthPct, ASSUMPTION_LIMITS.baseGrowthPct[1])
  closeTo(basis.historicalCashMarginPct, (operatingCashFlow.value - capex) / revenue.value * 100)
  closeTo(basis.firstYearCashMarginPct, basis.historicalCashMarginPct)
  closeTo(basis.firstYearCapexToRevenuePct, capex / revenue.value * 100)
  assert.equal(nvidia.valuation.cashFlowMeasure, 'fcf-proxy')
  assert.equal(nvidia.valuation.normalizedStartingRevenue, null)
  const firstRevenue = revenue.value * (1 + basis.firstYearGrowthPct / 100)
  closeTo(nvidia.valuation.baselineRevenue[0], firstRevenue, firstRevenue * 1e-12)
  const baseCash = firstRevenue * (operatingCashFlow.value - capex) / revenue.value
  closeTo(nvidia.valuation.baselineFcff[0], baseCash, Math.abs(baseCash) * 1e-12)
  assert.deepEqual(nvidia.valuation.baselineFcff, nvidia.valuation.scenarioFcff)
  assert.ok(nvidia.valuation.operatingBridge.every(year => year.incrementalCapexCashoutUnits === 0))
  for (const field of ['fcffMarginPct', 'baseGrowthPct', 'capexToRevenuePct']) {
    const mature = Object.entries(nvidia.segmentWeights).reduce((total, [id, weight]) => total + weight * segment(result, id).assumptions[field], 0)
    closeTo(basis.forecast[1][field], (basis.forecast[0][field] + mature) / 2)
    for (const year of basis.forecast.slice(2)) closeTo(year[field], mature)
  }
  const skHynix = company(result, '000660.KS')
  assert.equal(skHynix.valuation.currency, 'KRW')
  assert.equal(skHynix.valuation.startingRevenue, SCENARIO_FINANCIAL_BASELINES['000660.KS'].years[0].facts.revenue.value)
})

test('missing gross capex stays missing and private profiles keep explicit illustrative units', () => {
  const result = evaluateScenario(buildDefaultScenarioRequest('gpu_dc_rent'))
  const dlr = company(result, 'DLR')
  assert.equal(dlr.financialBasis.status, 'actual')
  assert.equal(dlr.financialBasis.historicalCapexToRevenuePct, null)
  assert.equal(dlr.financialBasis.historicalCashMarginPct, null)
  assert.ok(dlr.financialBasis.facts.freeCashFlow)
  assert.equal(dlr.financialBasis.fieldSources.fcffMarginPct, 'sector')
  assert.equal(dlr.financialBasis.fieldSources.capexToRevenuePct, 'sector')
  assert.equal(dlr.financialBasis.marginMethod, 'sector')
  assert.equal(dlr.financialBasis.marginFallbackReason, 'missing-gross-capex')
  assert.equal(dlr.valuation.basis, 'reported-revenue-sector-margin-dcf')
  const privateCompany = company(result, 'OPENAI')
  assert.equal(privateCompany.financialBasis.status, 'illustrative')
  assert.equal(privateCompany.financialBasis.fiscalYear, null)
  assert.equal(privateCompany.financialBasis.sourceGrade, 'C')
  assert.equal(privateCompany.valuation.currency, null)
  assert.equal(privateCompany.valuation.startingRevenue, 100)
  assert.equal(privateCompany.valuation.basis, 'illustrative-normalized-8y-fcff-dcf')
  assert.ok(result.segments.every(item => item.valuation.startingRevenue === 100))
})

test('cash ratios use the same accounting basis while growth and starting revenue retain canonical values', () => {
  const result = evaluateScenario(buildDefaultScenarioRequest('interest_rate'))
  for (const id of ['TSM', 'ASX']) {
    const { financialBasis: basis } = company(result, id)
    assert.equal(basis.status, 'actual')
    assert.ok(basis.facts.capitalExpenditure.value < 0)
    assert.notEqual(basis.facts.revenue.accountingStandard, basis.facts.capitalExpenditure.accountingStandard)
    const { revenue, operatingCashFlow, capitalExpenditure, cashFlowBasisRevenue } = basis.facts
    assert.equal(basis.cashFlowRevenueFactKey, 'cashFlowBasisRevenue')
    assert.equal(cashFlowBasisRevenue.accountingStandard, capitalExpenditure.accountingStandard)
    assert.equal(cashFlowBasisRevenue.accountingStandard, operatingCashFlow.accountingStandard)
    assert.equal(basis.marginFallbackReason, null)
    assert.equal(basis.capexFallbackReason, null)
    closeTo(basis.historicalCashMarginPct, (operatingCashFlow.value - Math.abs(capitalExpenditure.value)) / cashFlowBasisRevenue.value * 100)
    closeTo(basis.historicalCapexToRevenuePct, Math.abs(capitalExpenditure.value) / cashFlowBasisRevenue.value * 100)
    assert.equal(basis.startingRevenue, revenue.value)
    assert.equal(basis.fieldSources.baseGrowthPct, 'historical')
    assert.equal(basis.fieldSources.fcffMarginPct, 'historical')
    assert.equal(basis.fieldSources.capexToRevenuePct, 'historical')
    assert.equal(basis.growthYears, 3)
    assert.equal(basis.growthStartRevenueFact.accountingStandard, cashFlowBasisRevenue.accountingStandard)
    assert.equal(basis.growthStartRevenueFact.provider, cashFlowBasisRevenue.provider)
    assert.deepEqual(basis.growthEndRevenueFact, cashFlowBasisRevenue)
    closeTo(basis.historicalGrowthPct, ((cashFlowBasisRevenue.value / basis.growthStartRevenueFact.value) ** (1 / basis.growthYears) - 1) * 100)
    const record = structuredClone(SCENARIO_FINANCIAL_BASELINES[id])
    delete record.years[0].facts.cashFlowBasisRevenue
    const withoutComparableRevenue = financialProfile(record, basis.forecast.at(-1))
    assert.equal(withoutComparableRevenue.marginFallbackReason, 'incompatible-accounting-standards')
    assert.equal(withoutComparableRevenue.capexFallbackReason, 'incompatible-accounting-standards')
    assert.equal(withoutComparableRevenue.historicalCashMarginPct, null)
    assert.equal(withoutComparableRevenue.historicalCapexToRevenuePct, null)
    assert.equal(withoutComparableRevenue.cashFlowRevenueFactKey, null)
  }
})

test('cash-flow proxy deducts only incremental capex and respects forecast overrides', () => {
  const request = { scenarioId: 'hyperscaler_capex', inputs: { capexChangePct: 20 } }
  const actual = company(evaluateScenario(request), 'MSFT')
  const customRatio = 35
  const adjusted = company(evaluateScenario({
    ...request,
    companyOverrides: { MSFT: { assumptions: { capexToRevenuePct: customRatio } } },
  }), 'MSFT')
  const { forecast, historicalCapexToRevenuePct, fieldSources } = adjusted.financialBasis
  assert.equal(fieldSources.capexToRevenuePct, 'user')
  assert.equal(fieldSources.fcffMarginPct, 'historical')
  assert.ok(forecast.every(year => year.capexToRevenuePct === customRatio))
  assert.equal(actual.financialBasis.firstYearCapexToRevenuePct, historicalCapexToRevenuePct)
  assert.deepEqual(actual.valuation.baselineFcff, adjusted.valuation.baselineFcff)
  const baseIncrement = actual.valuation.operatingBridge[0].incrementalCapexCashoutUnits
  const newIncrement = adjusted.valuation.operatingBridge[0].incrementalCapexCashoutUnits
  assert.ok(baseIncrement > 0)
  closeTo(newIncrement / baseIncrement, customRatio / historicalCapexToRevenuePct)
  closeTo(adjusted.valuation.scenarioFcff[0] - actual.valuation.scenarioFcff[0], baseIncrement - newIncrement, 0.01)
})

test('negative observed cash margins remain in the forecast and a nonpositive baseline cannot produce ratios', () => {
  const request = { scenarioId: 'interest_rate', inputs: { rateChangePctPoints: 1 } }
  const base = company(evaluateScenario(request), 'CRWV')
  assert.ok(base.financialBasis.historicalCashMarginPct < 0)
  assert.equal(base.financialBasis.firstYearCashMarginPct, base.financialBasis.historicalCashMarginPct)
  assert.ok(base.valuation.baselineFcff[0] < 0)
  const result = evaluateScenario({
    ...request,
    companyOverrides: { CRWV: { assumptions: { discountRatePct: 25, terminalGrowthPct: -1, baseGrowthPct: -5, netDebtToEvPct: 20 } } },
  })
  const unavailable = company(result, 'CRWV')
  assert.ok(unavailable.valuation.baselineEnterpriseValueUnits <= 0)
  assert.equal(unavailable.valuation.baselineTerminalValuePvSharePct, null)
  assert.equal(unavailable.valuation.comparisonStatus, 'nonpositive-baseline')
  assert.equal(unavailable.valueChangePct, null)
  for (const field of ['directPct', 'chainPct', 'rateDiscountPct', 'rateDirectDemandPct', 'chainStandalonePct']) {
    assert.equal(unavailable.rateAttribution[field], null)
  }
  assert.equal(unavailable.scenarioValueIndex, null)
  assert.equal(unavailable.valuation.enterpriseValueRatio, null)
  assert.equal(unavailable.valuation.equityValueRatio, null)
  assert.equal(unavailable.valuation.quoteLinkStatus, 'unavailable-nonpositive-baseline')
  assert.deepEqual(unavailable.driverContributions, [])
  assert.deepEqual(unavailable.paths, [])
  assert.equal(result.universe.valuedCompanyCount, result.universe.companyCount - 1)
  assert.equal(result.universe.scenarioValueIndex, null)
  assert.ok(Number.isFinite(result.big7.scenarioValueIndex))
})

test('standalone CAPEX matches repricing without discount and direct demand across owners and suppliers', () => {
  const ids = ['NVDA', '000660.KS', 'MSFT', 'AMZN']
  const request = { scenarioId: 'interest_rate', inputs: { rateChangePctPoints: 1 } }
  const full = evaluateScenario(request)
  const companyOverrides = Object.fromEntries(ids.map(id => [id, {
    exposures: { interestRate: 0 }, assumptions: { rateDiscountPassThrough: 0 },
  }]))
  const independent = evaluateCompanyPreview({ ...request, companyOverrides }, ids)
  for (const row of independent.companies) {
    const { chainPct, chainStandalonePct } = company(full, row.id).effectAttribution
    closeTo(chainStandalonePct, row.valueChangePct, 1e-9)
    assert.ok(Math.abs(chainPct - chainStandalonePct) > 1e-9)
  }
})

test('model revenue contraction and recovery preserve growth-rate arithmetic', () => {
  const contraction = evaluateScenario({ scenarioId: 'model_growth', inputs: { modelBaselineGrowthPct: 50, modelTargetGrowthPct: -20 } })
  closeTo(contraction.scenario.drivers[0].normalizedShock, 0.8 / 1.5 - 1)
  assert.ok(segment(contraction, 'SEG9').scenarioValueIndex < 100)
  const recovery = evaluateScenario({ scenarioId: 'model_growth', inputs: { modelBaselineGrowthPct: -20, modelTargetGrowthPct: 0 } })
  closeTo(recovery.scenario.drivers[0].normalizedShock, 0.25)
  assert.ok(segment(recovery, 'SEG9').valuation.monthly.revenueVolumePct.at(-1) > 0)
  assert.equal(segment(recovery, 'SEG9').valuation.comparisonStatus, 'nonconvergent-terminal')
})

const rateScenario = (rateChangePctPoints, rateCapexSensitivity, companyOverrides = {}) =>
  evaluateScenario({ scenarioId: 'interest_rate', inputs: { rateChangePctPoints, rateCapexSensitivity }, companyOverrides })

test('significant-only rates use the full investment denominator and remove unsupported own-budget paths', () => {
  const request = { scenarioId: 'interest_rate', rateCapexMode: 'historical-significant', inputs: { rateChangePctPoints: 1 } }
  const full = evaluateScenario(request)
  const transmission = full.scenario.rateCapexTransmission
  assert.equal(transmission.mode, request.rateCapexMode)
  const significant = RATE_CAPEX_FITS.filter(fit => fit.low95Pct > 0 || fit.high95Pct < 0)
  assert.deepEqual(significant.map(fit => fit.companyId), ['AMZN'])
  const amazon = significant[0]
  const allCash = RATE_CAPEX_FITS.reduce((cash, fit) => cash + fit.cashCapexUsd, 0)
  const amazonChange = 100 * Math.expm1(amazon.logBeta / 100)
  closeTo(transmission.derivedCapexChangePct, amazonChange * amazon.cashCapexUsd / allCash, 1e-9)
  assert.deepEqual(transmission.ownerChangesPct, { MSFT: 0, AMZN: amazonChange, GOOGL: 0, META: 0 })
  for (const id of ['MSFT', 'GOOGL', 'META']) {
    assert.ok(!company(full, id).paths.some(path => path.mediatedBy === 'interestRate' && path.segments.length === 1))
  }
  const requestWith = rateCapexMode => ({ ...request, rateCapexMode })
  for (const mode of ['invalid', 'toString', ['historical-significant']]) assert.throws(() => validateScenarioRequest(requestWith(mode)), /rateCapexMode/)
  assert.equal(validateScenarioRequest(requestWith(null)).rateCapexMode, 'historical')
  assert.equal(validateScenarioRequest({ ...requestWith(null), inputs: { rateCapexSensitivity: 5 } }).rateCapexMode, 'manual')
  assert.throws(() => validateScenarioRequest({ ...request, scenarioId: 'hyperscaler_capex' }), /지원하지 않는 요청 필드/)
  assert.throws(() => validateScenarioRequest({ ...request, rateCapexFits: [] }), /지원하지 않는 요청 필드/)

  // Inject a different fitted snapshot without changing shared data or opening a user-input field.
  const rateCapexFits = RATE_CAPEX_FITS.map((fit, i) => ({
    ...fit, low95Pct: i === 0 ? 0 : -25, high95Pct: i === 1 ? 0 : 25,
  }))
  const allCross = evaluateScenario(request, { rateCapexFits })
  assert.equal(allCross.scenario.rateCapexTransmission.derivedCapexChangePct, 0)
  assert.ok(Object.values(allCross.scenario.rateCapexTransmission.ownerChangesPct).every(change => change === 0))
  for (const id of ['NVDA', '000660.KS']) {
    assert.equal(company(allCross, id).effectAttribution.chainPct, 0)
    assert.ok(company(allCross, id).effectAttribution.directPct < 0)
    assert.ok(!company(allCross, id).paths.some(path => path.mediatedBy === 'interestRate'))
  }
})

test('fitted CAPEX limits reprice each company at simultaneous owner-specific budgets for rate hikes and cuts', () => {
  for (const rate of [1, -0.75]) {
    const request = { scenarioId: 'interest_rate', rateCapexMode: 'historical', inputs: { rateChangePctPoints: rate },
      companyOverrides: { NVDA: { scenarioExposureScale: 0.52 }, CRWV: { assumptions: { discountRatePct: 25, terminalGrowthPct: -1 } } } }
    const full = evaluateScenario(request)
    const significant = evaluateScenario({ ...request, rateCapexMode: 'historical-significant' })
    const byBudget = {}
    for (const side of ['lower', 'upper']) {
      const useLow = rate > 0 ? side === 'lower' : side === 'upper'
      const rateCapexFits = RATE_CAPEX_FITS.map(fit => ({
        ...fit, logBeta: 100 * Math.log1p((useLow ? fit.low95Pct : fit.high95Pct) / 100),
      }))
      byBudget[side] = evaluateScenario(request, { rateCapexFits })
    }
    const lowerBudget = byBudget.lower.scenario.rateCapexTransmission.derivedCapexChangePct
    const upperBudget = byBudget.upper.scenario.rateCapexTransmission.derivedCapexChangePct
    assert.ok(lowerBudget < full.scenario.rateCapexTransmission.derivedCapexChangePct && upperBudget > full.scenario.rateCapexTransmission.derivedCapexChangePct)
    for (const item of full.companies) {
      const band = item.rateCapexSensitivityBand
      assert.equal(band.point.totalPct, item.valueChangePct)
      assert.equal(band.point.chainPct, item.effectAttribution.chainPct)
      for (const side of ['lower', 'upper']) {
        const reference = company(byBudget[side], item.companyId)
        const endpoint = band[side]
        closeTo(endpoint.derivedCapexChangePct, byBudget[side].scenario.rateCapexTransmission.derivedCapexChangePct, 1e-12)
        for (const [actual, expected] of [
          [endpoint.directPct, reference.effectAttribution.directPct], [endpoint.chainPct, reference.effectAttribution.chainPct],
          [endpoint.totalPct, reference.valueChangePct], [endpoint.chainStandalonePct, reference.effectAttribution.chainStandalonePct],
        ]) {
          if (expected === null) assert.equal(actual, null)
          else closeTo(actual, expected, 1e-10)
        }
        assert.deepEqual(company(significant, item.companyId).rateCapexSensitivityBand[side], endpoint)
      }
    }
  }
  for (const item of rateScenario(0).companies) assert.deepEqual(item.rateCapexSensitivityBand.lower, item.rateCapexSensitivityBand.upper)
  assert.ok(rateScenario(1, 5).companies.every(item => !Object.hasOwn(item, 'rateCapexSensitivityBand')))
})

test('a rate-only request uses fitted company budgets; an explicit common sensitivity preserves manual behavior', () => {
  const estimated = rateScenario(1).scenario.rateCapexTransmission
  assert.equal(estimated.mode, 'historical')
  closeTo(estimated.derivedCapexChangePct, -5.03805, 0.00001)
  assert.ok(estimated.ownerChangesPct.MSFT > 0 && estimated.ownerChangesPct.AMZN < -14)
  assert.equal(rateScenario(1, 0).scenario.rateCapexTransmission.derivedCapexChangePct, 0)
  assert.equal(rateScenario(0).scenario.rateCapexTransmission.derivedCapexChangePct, 0)
})

test('rate-sensitive CAPEX uses the existing budget shock exactly once with existing supplier lags', () => {
  const full = rateScenario(1, 5)
  const rateOnly = rateScenario(1, 0)
  const capexOnly = evaluateScenario({ scenarioId: 'hyperscaler_capex', inputs: { capexChangePct: -5 } })
  assert.deepEqual(full.scenario.rateCapexTransmission, {
    version: 2, mode: 'manual', ownerChangesPct: { MSFT: -5, AMZN: -5, GOOGL: -5, META: -5 },
    rateChangePctPoints: 1, rateCapexSensitivity: 5, derivedCapexChangePct: -5, budgetLagMonths: 0, grade: 'C',
  })
  assert.deepEqual(full.scenario.drivers.map(driver => [driver.driverId, driver.normalizedShock]), [
    ['interestRate', -0.01], ['hyperscalerCapex', -0.05],
  ])
  assert.equal(full.scenario.drivers[1].mediatedBy, 'interestRate')
  assert.equal(capexOnly.scenario.rateCapexTransmission, undefined)
  assert.equal(capexOnly.scenario.drivers.length, 1)
  for (const [id, expectedPath, lag] of [
    ['NVDA', 'SEG8>SEG5>SEG4', 12], ['000660.KS', 'SEG8>SEG5>SEG4>SEG3', 18],
  ]) {
    const supplier = company(full, id)
    const direct = company(rateOnly, id)
    const capex = company(capexOnly, id)
    assert.ok(supplier.paths.some(path => path.mediatedBy === 'interestRate' && path.segments.join('>') === expectedPath && path.lagMonths === lag))
    assert.ok(capex.paths.every(path => !path.mediatedBy))
    assert.deepEqual(supplier.valuation.scenarioDiscountRatesPct, direct.valuation.scenarioDiscountRatesPct)
    supplier.valuation.operatingBridge.forEach((year, i) => {
      closeTo(year.revenueVolumePct - direct.valuation.operatingBridge[i].revenueVolumePct, capex.valuation.operatingBridge[i].revenueVolumePct, 0.00015)
    })
    const incrementalEv = supplier.valuation.scenarioEnterpriseValueUnits - direct.valuation.scenarioEnterpriseValueUnits
    closeTo(supplier.rateAttribution.chainPct, 100 * incrementalEv / supplier.valuation.baselineEnterpriseValueUnits, 1e-10)
    assert.ok(supplier.rateAttribution.directPct < 0 && supplier.rateAttribution.chainPct < 0)
  }
  const cloudSeed = segment(full, 'SEG8').paths.find(path => path.primitive === 'capexCashout')
  assert.deepEqual(cloudSeed.segments, ['SEG8'])
  assert.equal(cloudSeed.mediatedBy, 'interestRate')
  assert.equal(cloudSeed.lagMonths, 0)
  for (const [group, fullRows] of [['segments', full.segments], ['companies', full.companies]]) {
    fullRows.forEach((row, index) => {
      assert.equal(row.rateAttribution.directPct, rateOnly[group][index].valueChangePct)
      closeTo(row.rateAttribution.directPct + row.rateAttribution.chainPct, row.valueChangePct, 1e-12)
      assert.ok(row.paths.filter(path => path.driverId === 'hyperscalerCapex').every(path => path.mediatedBy === 'interestRate'))
      assert.equal(rateOnly[group][index].rateAttribution.chainPct, 0)
    })
  }
})

test('rate direction, zero shock and sensitivity change conditional CAPEX', () => {
  const base = rateScenario(1, 5)
  const cut = rateScenario(-1, 5)
  const stronger = rateScenario(1, 10)
  const none = rateScenario(0, 10)
  assert.equal(cut.scenario.rateCapexTransmission.derivedCapexChangePct, 5)
  assert.equal(none.scenario.rateCapexTransmission.derivedCapexChangePct, 0)
  assert.equal(none.checks.zeroShockIdentity, true)
  assert.ok([...none.companies, ...none.segments].every(row => row.valueChangePct === 0 && row.rateAttribution.chainPct === 0))
  assert.equal(rateScenario(3, 10).scenario.rateCapexTransmission.derivedCapexChangePct, -30)
  assert.equal(rateScenario(-2, 10).scenario.rateCapexTransmission.derivedCapexChangePct, 20)
  for (const id of ['NVDA', '000660.KS']) {
    const normal = company(base, id).rateAttribution
    assert.ok(company(cut, id).rateAttribution.chainPct > 0)
    assert.equal(company(stronger, id).rateAttribution.directPct, normal.directPct)
    assert.ok(company(stronger, id).rateAttribution.chainPct < normal.chainPct)
  }
})

test('sensitivity is an explicit assumption while company CAPEX exposure still scales the derived shock', () => {
  const input = SCENARIO_DEFINITIONS.find(item => item.id === 'interest_rate').controls.find(control => control.id === 'rateCapexSensitivity')
  assert.equal(input.role, 'assumption')
  assert.equal(input.defaultValue, 5)
  for (const bad of [-0.1, 10.1, Infinity]) assert.throws(() => rateScenario(1, bad), /0~10/)
  assert.throws(() => evaluateScenario({ scenarioId: 'interest_rate', inputs: { capexChangePct: -5 } }), /지원하지 않는 입력/)
  assert.throws(() => rateScenario(1, 5, { NVDA: { exposures: { rateCapexSensitivity: 1 } } }), /알 수 없는 노출도/)
  const custom = rateScenario(1, 5, { NVDA: { exposures: { hyperscalerCapex: 0 } } })
  assert.deepEqual(company(custom, 'NVDA').rateAttribution, company(rateScenario(1, 0), 'NVDA').rateAttribution)
  assert.ok(company(custom, '000660.KS').rateAttribution.chainPct < 0)
})
