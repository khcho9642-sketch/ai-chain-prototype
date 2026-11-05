import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateScenario } from '../../assets/scenario-core.js'
import {
  REPRESENTATIVE_COMPANY_IDS,
  VIEW_MODEL_GRADE,
  buildScenarioView,
  decomposeCompany,
  describePath,
} from '../../assets/scenario-view-model.js'

const closeTo = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

test('direct and chain presentation values reconcile exactly while retaining raw residual', () => {
  const row = decomposeCompany({
    companyId: 'TEST', name: 'Test', valueChangePct: -10,
    paths: [
      { pathId: 'd', segments: ['SEG7'], lagMonths: 0, impactPoints: -6.0001 },
      { pathId: 'c', segments: ['SEG8', 'SEG7'], lagMonths: 6, impactPoints: -3.9997 },
    ],
  })
  assert.equal(row.totalPct, -10)
  assert.equal(row.chainPct, -3.9997)
  assert.equal(row.directPct, -6.0003)
  closeTo(row.directPct + row.chainPct, row.totalPct, 1e-12)
  assert.equal(row.residualPct, -0.0002)
  assert.equal(row.breakdownAvailable, true)
  assert.equal(row.grade, 'C')
  assert.match(row.breakdownNote, /실제 현금흐름/)
  assert.equal(row.paths[0].coefficientAvailable, false)
  assert.equal(row.paths[0].coefficient, null)
})

test('mixed-sign paths remain visible instead of being forced into one direction', () => {
  const row = decomposeCompany({
    companyId: 'MIXED', name: 'Mixed', valueChangePct: -2,
    paths: [
      { pathId: 'd', segments: ['SEG8'], lagMonths: 0, impactPoints: 1 },
      { pathId: 'c', segments: ['SEG8', 'SEG9'], lagMonths: 6, impactPoints: -3 },
    ],
  })
  assert.equal(row.directPct, 1)
  assert.equal(row.chainPct, -3)
  assert.equal(row.totalPct, -2)
  assert.match(row.oneLinePath, /SEG8.*SEG9/)
  assert.equal(row.maxPropagation.hops, 1)
})

test('nonzero result without paths is unavailable and a zero result remains a valid zero', () => {
  const unavailable = decomposeCompany({ companyId: 'A', valueChangePct: 1.2, paths: [] })
  assert.equal(unavailable.breakdownAvailable, false)
  assert.equal(unavailable.directPct, null)
  assert.equal(unavailable.chainPct, null)
  assert.equal(unavailable.residualPct, 1.2)
  const zero = decomposeCompany({ companyId: 'B', valueChangePct: 0, paths: [] })
  assert.equal(zero.breakdownAvailable, true)
  assert.equal(zero.directPct, 0)
  assert.equal(zero.chainPct, 0)
})

test('large unexplained residual is not relabeled as direct impact', () => {
  const row = decomposeCompany({
    companyId: 'GAP', valueChangePct: 10,
    paths: [
      { pathId: 'd', segments: ['SEG8'], lagMonths: 0, impactPoints: 2 },
      { pathId: 'c', segments: ['SEG8', 'SEG9'], lagMonths: 6, impactPoints: 3 },
    ],
  })
  assert.equal(row.residualPct, 5)
  assert.equal(row.breakdownAvailable, false)
  assert.equal(row.directPct, null)
  assert.equal(row.chainPct, null)
  assert.equal(row.reconciliationStatus, 'unavailable-large-residual')
})

test('path descriptions use the reviewed nine-segment catalog', () => {
  assert.equal(describePath({ segments: ['SEG3'] }), '직접: SEG3 메모리')
  assert.equal(describePath({ segments: ['SEG9', 'SEG8'] }), 'SEG9 AI 모델 → SEG8 클라우드·GPU 컴퓨팅')
  assert.equal(describePath(null), null)
})

test('real scenario view keeps 41 unique companies, nine reps and nonduplicated section counts', () => {
  const result = evaluateScenario({
    scenarioId: 'hbm_market', durationMonths: 12,
    inputs: { hbmPriceChangePct: 15, hbmSupplyChangePct: -10 },
  })
  const view = buildScenarioView(result)
  assert.equal(view.companies.length, 41)
  assert.equal(new Set(view.companies.map(company => company.companyId)).size, 41)
  assert.deepEqual(view.representativeRows.map(company => company.companyId), REPRESENTATIVE_COMPANY_IDS)
  assert.equal(view.representativeRows.length, 9)
  assert.equal(view.big7Rows.length, 7)
  assert.equal(view.otherRows.length, 28)
  assert.equal(view.missingRepresentativeIds.length, 0)
  assert.equal(view.grade, VIEW_MODEL_GRADE)
  const manualAverage = view.representativeRows.reduce((total, company) => total + company.totalPct, 0) / 9
  closeTo(view.summary.representativeAveragePct, manualAverage)
  for (const company of view.companies.filter(company => company.breakdownAvailable)) {
    closeTo(company.directPct + company.chainPct, company.totalPct, 1e-12)
  }
})

test('largest propagation is null when every chain path is zero and populated otherwise', () => {
  const rate = buildScenarioView(evaluateScenario({
    scenarioId: 'interest_rate', durationMonths: 12,
    inputs: { rateChangePctPoints: 1 },
  }))
  assert.equal(rate.summary.largestPropagation, null)
  assert.ok(rate.companies.every(company => company.chainPct === 0))

  const capex = buildScenarioView(evaluateScenario({
    scenarioId: 'hyperscaler_capex', durationMonths: 12,
    inputs: { capexChangePct: 20 },
  }))
  assert.ok(capex.summary.largestPropagation)
  assert.ok(Math.abs(capex.summary.largestPropagation.chainPct) > 0)
})

test('CAPEX transmission reports catalog weights and individual lags only for an exact path match', () => {
  const view = buildScenarioView(evaluateScenario({
    scenarioId: 'hyperscaler_capex', durationMonths: 12, inputs: { capexChangePct: 20 },
  }))
  const nvidia = view.companies.find(company => company.companyId === 'NVDA')
  const path = nvidia.paths.find(path => path.pathId === 'hyperscalerCapex:revenueVolume:SEG8>SEG5>SEG4')
  assert.deepEqual(path.coefficientSteps.map(({ from, to, channel, weight, lagMonths }) =>
    [from, to, channel, weight, lagMonths]), [
    ['SEG8', 'SEG5', '컴퓨팅 수요에서 서버·네트워크 장비', 0.55, 6],
    ['SEG5', 'SEG4', '장비 수요에서 AI 칩 수요', 0.55, 6],
  ])
  assert.ok(path.coefficientSteps.every(step => step.grade === 'C' && step.source.includes('PROPAGATION_EDGES')))
  assert.equal(path.coefficient, null)
  const mismatchedPath = { ...path, channels: ['직접 입력', 'unmapped', 'unmapped'] }
  assert.deepEqual(decomposeCompany({ ...nvidia, paths: [mismatchedPath] }).paths[0].coefficientSteps, [])
})

test('six-month rate scenario changes direct allocation because rate has no propagation paths', () => {
  const view = duration => buildScenarioView(evaluateScenario({
    scenarioId: 'interest_rate', durationMonths: duration,
    inputs: { rateChangePctPoints: 1 },
  }))
  const twelve = view(12)
  const six = view(6)
  const eqix12 = twelve.companies.find(company => company.companyId === 'EQIX')
  const eqix6 = six.companies.find(company => company.companyId === 'EQIX')
  assert.equal(eqix12.chainPct, 0)
  assert.equal(eqix6.chainPct, 0)
  assert.ok(Math.abs(eqix6.directPct) < Math.abs(eqix12.directPct))
})

test('a nonpositive baseline keeps the company visible and the nine-company average unavailable', () => {
  const companies = REPRESENTATIVE_COMPANY_IDS.map(companyId => ({ companyId, valueChangePct: -1, paths: [] }))
  companies[0] = { ...companies[0], valueChangePct: null, valuation: { comparisonStatus: 'nonpositive-baseline' } }
  const view = buildScenarioView({ companies })
  const row = view.representativeRows[0]
  assert.equal(row.totalPct, null)
  assert.equal(row.breakdownAvailable, false)
  assert.equal(view.representativeRows.length, 9)
  assert.equal(view.summary.comparableRepresentativeCount, 8)
  assert.equal(view.summary.representativeAveragePct, null)
  assert.ok(view.summary.largestDecline.totalPct < 0)
})
