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

test('rate sensitivity zero reproduces direct-only EV; a nonzero coefficient adds incremental supplier EV', () => {
  const scenario = rateCapexSensitivity => buildScenarioView(evaluateScenario({
    scenarioId: 'interest_rate', durationMonths: 12, inputs: { rateChangePctPoints: 1, rateCapexSensitivity },
  }))
  const rateOnly = scenario(0)
  const combined = scenario(5)
  assert.equal(rateOnly.summary.largestPropagation, null)
  assert.ok(combined.summary.largestPropagation)
  for (const company of combined.companies.filter(row => Number.isFinite(row.totalPct))) {
    const control = rateOnly.companies.find(row => row.companyId === company.companyId)
    assert.equal(company.breakdownAvailable, true)
    closeTo(company.directPct, control.totalPct, 1e-12)
    closeTo(company.directPct + company.chainPct, company.totalPct, 1e-12)
  }
  for (const [id, hops, lag] of [['NVDA', 2, 12], ['000660.KS', 3, 18]]) {
    const supplier = combined.companies.find(company => company.companyId === id)
    const directOnly = rateOnly.companies.find(company => company.companyId === id)
    closeTo(supplier.directPct, directOnly.totalPct)
    assert.ok(supplier.chainPct < 0)
    closeTo(supplier.chainPct, supplier.totalPct - directOnly.totalPct)
    assert.equal(supplier.topPath.hops, hops)
    assert.equal(supplier.topPath.lagMonths, lag)
    assert.match(supplier.oneLinePath, /금리 → 빅테크 AI CAPEX → SEG8.*SEG5.*SEG4/)
    assert.ok(supplier.oneLinePath.endsWith(`${lag}개월 뒤`))
  }
  const cloud = combined.companies.find(company => company.companyId === 'MSFT')
  assert.ok(cloud.paths.some(path => path.segments.length === 1 && path.hops === 0 && path.effectKind === 'chain'))
  assert.ok(cloud.paths.some(path => path.driverId === 'interestRate' && path.effectKind === 'direct'))
  assert.equal(cloud.chainPct, cloud.rateAttribution.chainPct)
  assert.equal(cloud.directPct, cloud.rateAttribution.directPct)
  assert.equal(cloud.reconciliationStatus, 'reconciled-counterfactual')
})

test('rate-level DCF components take precedence even if the path allocation is unavailable', () => {
  const row = decomposeCompany({ companyId: 'RATE', valueChangePct: -1, paths: [], rateAttribution: { directPct: -0.25, chainPct: -0.75 } })
  assert.equal(row.breakdownAvailable, true)
  assert.equal(row.directPct, -0.25)
  assert.equal(row.chainPct, -0.75)
  assert.equal(row.oneLinePath, null)
  const bad = decomposeCompany({ ...row, rateAttribution: { directPct: -0.5, chainPct: -0.75 } })
  assert.equal(bad.breakdownAvailable, false)
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

test('shortening the budget period keeps direct rate EV fixed and reduces the CAPEX-mediated effect', () => {
  const view = duration => buildScenarioView(evaluateScenario({
    scenarioId: 'interest_rate', durationMonths: duration,
    inputs: { rateChangePctPoints: 1 },
  }))
  const twelve = view(12)
  const six = view(6)
  const eqix12 = twelve.companies.find(company => company.companyId === 'EQIX')
  const eqix6 = six.companies.find(company => company.companyId === 'EQIX')
  assert.ok(Math.abs(eqix6.chainPct) < Math.abs(eqix12.chainPct))
  closeTo(eqix6.directPct, eqix12.directPct, 1e-12)
})

test('only the four budget setters change their own outlay and earn returns from that spending', () => {
  for (const capexChangePct of [-20, 20]) {
    const view = buildScenarioView(evaluateScenario({ scenarioId: 'hyperscaler_capex', inputs: { capexChangePct } }))
    const budgetSetters = view.companies.filter(row => row.capexRole === 'budget-owner')
    assert.deepEqual(budgetSetters.map(row => row.companyId).sort(), ['AMZN', 'GOOGL', 'META', 'MSFT'])
    for (const row of view.companies) {
      if (row.capexRole === 'budget-owner') {
        assert.equal(Math.sign(row.valuation.operatingBridge[0].incrementalCapexCashoutUnits), Math.sign(capexChangePct))
      } else {
        assert.ok(row.valuation.operatingBridge.every(year => year.incrementalCapexCashoutUnits === 0))
        closeTo(row.directPct, 0, 1e-10)
      }
    }
    const coreWeave = view.companies.find(row => row.companyId === 'CRWV')
    assert.equal(coreWeave.capexRole, 'no-covered-customer-path')
    assert.equal(coreWeave.totalPct, 0)
  }
})

test('Alphabet direct CAPEX equals discounted budget and own capacity cash flows alone', () => {
  const view = buildScenarioView(evaluateScenario({ scenarioId: 'hyperscaler_capex', durationMonths: 12, inputs: { capexChangePct: 20 } }))
  const row = view.companies.find(item => item.companyId === 'GOOGL')
  const exposure = row.segmentWeights.SEG8 * row.assumptions.scenarioExposureScale
  const effectiveBudgetShock = 0.20 * exposure
  const { volumePassThrough, capexPassThrough, discountRatePct } = row.assumptions
  const { baselineRevenue, baselineEnterpriseValueUnits } = row.valuation
  const weight = m => m <= 0 ? 0 : Math.min(1, Math.max(0, (24 - m) / 12))
  let directPV = 0
  for (let month = 1; month <= 96; month++) {
    const year = Math.floor((month - 1) / 12)
    const profile = row.financialBasis.forecast[year]
    const spending = effectiveBudgetShock * weight(month) * capexPassThrough * profile.capexToRevenuePct / 100
    const capacity = effectiveBudgetShock * 0.35 * weight(month - 12) * volumePassThrough * profile.volumeContributionMarginPct / 100
    directPV += baselineRevenue[year] / 12 * (capacity - spending) / (1 + discountRatePct / 100) ** (month / 12)
  }
  closeTo(row.directPct, 100 * directPV / baselineEnterpriseValueUnits, 1e-9)
  assert.ok(row.chainPct > 0)
  closeTo(row.directPct + row.chainPct, row.totalPct, 1e-12)
})

test('historical rate mode applies each individual owner shock to its own budget', () => {
  const result = evaluateScenario({ scenarioId: 'interest_rate', inputs: { rateChangePctPoints: 1 }, durationMonths: 12 })
  const { ownerChangesPct } = result.scenario.rateCapexTransmission
  for (const owner of result.companies.filter(row => row.capexRole === 'budget-owner')) {
    const expectedOutlay = owner.valuation.baselineRevenue[0] * owner.financialBasis.forecast[0].capexToRevenuePct / 100 *
      owner.segmentWeights.SEG8 * owner.assumptions.scenarioExposureScale * owner.assumptions.capexPassThrough * ownerChangesPct[owner.id] / 100
    closeTo(owner.valuation.operatingBridge[0].incrementalCapexCashoutUnits, expectedOutlay, 0.001)
  }
  assert.ok(ownerChangesPct.MSFT > 0 && ownerChangesPct.AMZN < 0)
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

test('sector explorer marks only actual direct origins and distinguishes the rate-wide shock and neutral state', async () => {
  const { renderExplorer, sectorConclusion } = await import('../../assets/scenario-explorer.js')
  const display = { renderBar: () => '', scale: 2 }
  const origins = html => [...html.matchAll(/<button[^>]+data-explore-sector="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
    .filter(match => match[2].includes('충격 시작')).map(match => match[1])
  for (const [gpuRentChangePct, dcRentChangePct, expected] of [[10, 0, ['SEG8']], [0, 10, ['SEG7']], [10, -10, ['SEG7', 'SEG8']], [0, 0, []]]) {
    const view = buildScenarioView(evaluateScenario({ scenarioId: 'gpu_dc_rent', durationMonths: 12, inputs: { gpuRentChangePct, dcRentChangePct } }))
    const html = renderExplorer(view, display)
    assert.deepEqual(origins(html), expected)
    if (!expected.length) {
      assert.match(html, /현재 입력에서 기업가치 변화가 없습니다/)
      assert.match(sectorConclusion(view), /9개 섹터 지수가 모두 기준 100/)
    }
  }
  const rate = buildScenarioView(evaluateScenario({ scenarioId: 'interest_rate', durationMonths: 12, inputs: { rateChangePctPoints: 1 } }))
  const html = renderExplorer(rate, display)
  assert.deepEqual(origins(html), [])
  assert.match(html, /금리 · 9개 섹터에 직접 적용 · 빅테크 AI CAPEX 경유 전파/)
  const off = buildScenarioView(evaluateScenario({ scenarioId: 'interest_rate', durationMonths: 12, inputs: { rateChangePctPoints: 1, rateCapexSensitivity: 0 } }))
  assert.match(renderExplorer(off, display), /CAPEX 민감도 0 · 전파효과 0%/)
  const neutral = buildScenarioView(evaluateScenario({ scenarioId: 'interest_rate', durationMonths: 12, inputs: { rateChangePctPoints: 0 } }))
  assert.match(renderExplorer(neutral, display), /금리 변화 0%p · CAPEX 경유 전파 0%/)
  assert.match(html, /9개 섹터 가치 변화/)
  assert.match(html, /공개 재무 없음 · 섹터 가정/)
  for (const companyId of ['OPENAI', 'ANTHROPIC', 'DEEPSEEK']) assert.ok(html.includes(`data-company-id="${companyId}"`))
  assert.match(sectorConclusion(rate), /9개 섹터 지수가 하락/)
})

test('explorer reuses the same company valuation in every membership and ranks available companies by absolute change', async () => {
  const { renderExplorer } = await import('../../assets/scenario-explorer.js')
  const view = buildScenarioView(evaluateScenario({ scenarioId: 'hbm_market', durationMonths: 12, inputs: { hbmPriceChangePct: 10, hbmSupplyChangePct: 0 } }))
  const both = []
  // One row cannot be compared. It is still a member but should not enter the ranking.
  const unavailable = view.companies.find(company => company.companyId === 'MU')
  unavailable.totalPct = null
  const expectedRanking = view.companies.filter(company => Number.isFinite(company.totalPct) && company.totalPct !== 0)
    .sort((a, b) => Math.abs(b.totalPct) - Math.abs(a.totalPct)).slice(0, 8).map(company => company.companyId)
  for (const selectedSegmentId of ['SEG2', 'SEG3']) {
    const renderedCompanies = []
    renderExplorer(view, { selectedSegmentId, scale: 2, renderBar(company, scale) {
      renderedCompanies.push(company)
      assert.equal(scale, 2)
      return ''
    } })
    const count = view.segments.find(segment => segment.segmentId === selectedSegmentId).memberCompanyIds.length
    const sector = renderedCompanies.slice(0, count)
    if (selectedSegmentId === 'SEG3') assert.ok(sector.includes(unavailable))
    both.push(sector.find(company => company.companyId === '005930.KS'))
    assert.deepEqual(renderedCompanies.slice(count).map(company => company.companyId), expectedRanking)
  }
  assert.equal(both[0], view.companies.find(company => company.companyId === '005930.KS'))
  assert.equal(both[1], both[0])
})
