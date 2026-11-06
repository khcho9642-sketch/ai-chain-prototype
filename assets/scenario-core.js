import {
  ASSUMPTION_LIMITS,
  BIG7_COMPANY_IDS,
  COMPANIES,
  DRIVER_DEFINITIONS,
  HYPERSCALER_CAPEX_OWNER_IDS,
  MODEL_ASSUMPTIONS,
  PROPAGATION_EDGES,
  SCENARIO_DEFINITIONS,
  SEGMENTS,
} from './scenario-data.js'
import { financialProfile } from './scenario-actuals.js'
import { SCENARIO_FINANCIAL_BASELINES } from './scenario-financial-baselines.js'
import { RATE_CAPEX_FITS } from './scenario-rate-fits.js'

const RATE_CAPEX_DRIVER_LABEL = '금리를 통한 빅테크 AI CAPEX 변화'
const PRIMITIVES = Object.freeze(['revenueVolume', 'asp', 'unitCost', 'capexCashout'])
const segmentById = new Map(SEGMENTS.map(item => [item.id, item]))
const companyById = new Map(COMPANIES.map(item => [item.companyId, item]))
const scenarioById = new Map(SCENARIO_DEFINITIONS.map(item => [item.id, item]))
const years = MODEL_ASSUMPTIONS.forecastYears
const months = MODEL_ASSUMPTIONS.horizonMonths
const rateDirectMonths = 12
const zeroSeries = () => Array(months).fill(0)
const sum = values => values.reduce((total, value) => total + value, 0)
const round = (value, digits = 4) => Number(value.toFixed(digits))
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

function fail(message) {
  throw new TypeError(message)
}

function validateCatalog() {
  if (MODEL_ASSUMPTIONS.horizonMonths !== MODEL_ASSUMPTIONS.forecastYears * 12) fail('평가기간 정의가 일치하지 않습니다.')
  if (SEGMENTS.length !== 9 || new Set(SEGMENTS.map(item => item.id)).size !== 9) fail('SEG 카탈로그는 고유한 9개 항목이어야 합니다.')
  if (SCENARIO_DEFINITIONS.length !== 5 || new Set(SCENARIO_DEFINITIONS.map(item => item.id)).size !== 5) fail('시나리오 카탈로그는 고유한 5개 항목이어야 합니다.')
  if (companyById.size !== COMPANIES.length) fail('중복 회사 ID가 있습니다.')
  for (const company of COMPANIES) {
    if (!segmentById.has(company.primarySegmentId)) fail(`${company.companyId}의 주 SEG가 올바르지 않습니다.`)
    if (company.listingStatus === 'private' ? company.symbol !== null : !company.symbol) fail(`${company.companyId}의 상장 구분과 심볼이 맞지 않습니다.`)
    if (!isFiniteNumber(company.scenarioExposureScale) || company.scenarioExposureScale < 0 || company.scenarioExposureScale > 1) fail(`${company.companyId}의 시나리오 사업 노출도가 올바르지 않습니다.`)
    const weights = Object.entries(company.segmentWeights)
    if (!weights.length || weights.some(([id, weight]) => !segmentById.has(id) || !isFiniteNumber(weight) || weight <= 0)) fail(`${company.companyId}의 SEG 가중치가 올바르지 않습니다.`)
    if (Math.abs(sum(weights.map(([, weight]) => weight)) - 1) > 1e-9) fail(`${company.companyId}의 SEG 가중치 합은 1이어야 합니다.`)
    for (const [driverId, value] of Object.entries(company.driverExposureMultipliers)) {
      if (!DRIVER_DEFINITIONS[driverId] || !isFiniteNumber(value) || value < 0 || value > 2) fail(`${company.companyId}의 driver exposure가 올바르지 않습니다.`)
    }
  }
  if (BIG7_COMPANY_IDS.length !== 7 || new Set(BIG7_COMPANY_IDS).size !== 7 || BIG7_COMPANY_IDS.some(id => !companyById.has(id))) fail('Big7 회사 구성이 올바르지 않습니다.')
  for (const driver of Object.values(DRIVER_DEFINITIONS)) {
    for (const seed of driver.seeds) if (!segmentById.has(seed.segmentId) || !PRIMITIVES.includes(seed.primitive)) fail(`${driver.id} seed가 올바르지 않습니다.`)
  }
  for (const edge of PROPAGATION_EDGES) {
    if (!segmentById.has(edge.from) || !segmentById.has(edge.to) || !edge.drivers.every(id => DRIVER_DEFINITIONS[id])) fail('전파 경로 정의가 올바르지 않습니다.')
    if (edge.primitive && !PRIMITIVES.includes(edge.primitive)) fail('전파 경로 primitive가 올바르지 않습니다.')
    if (edge.toPrimitive && !PRIMITIVES.includes(edge.toPrimitive)) fail('전파 경로 변환 primitive가 올바르지 않습니다.')
  }
}

validateCatalog()

export function buildDefaultScenarioRequest(scenarioId) {
  const definition = scenarioById.get(scenarioId)
  if (!definition) fail(`알 수 없는 시나리오입니다: ${scenarioId}`)
  return {
    scenarioId,
    ...(scenarioId === 'interest_rate' && { rateCapexMode: 'historical' }),
    durationMonths: MODEL_ASSUMPTIONS.durationMonths.defaultValue,
    inputs: Object.fromEntries(definition.controls.map(control => [control.id, control.defaultValue])),
    companyOverrides: {},
  }
}

export function validateScenarioRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('시나리오 요청은 객체여야 합니다.')
  const definition = scenarioById.get(request.scenarioId)
  if (!definition) fail(`알 수 없는 시나리오입니다: ${request.scenarioId}`)
  const allowedTopLevel = new Set(['scenarioId', 'durationMonths', 'inputs', 'companyOverrides'])
  if (definition.id === 'interest_rate') allowedTopLevel.add('rateCapexMode')
  for (const key of Object.keys(request)) if (!allowedTopLevel.has(key)) fail(`지원하지 않는 요청 필드입니다: ${key}`)

  const duration = request.durationMonths ?? MODEL_ASSUMPTIONS.durationMonths.defaultValue
  const durationRule = MODEL_ASSUMPTIONS.durationMonths
  if (!Number.isInteger(duration) || duration < durationRule.min || duration > durationRule.max || (duration - durationRule.min) % durationRule.step !== 0) {
    fail(`durationMonths는 ${durationRule.min}~${durationRule.max} 범위의 ${durationRule.step}개월 단위여야 합니다.`)
  }

  const suppliedInputs = request.inputs ?? {}
  if (!suppliedInputs || typeof suppliedInputs !== 'object' || Array.isArray(suppliedInputs)) fail('inputs는 객체여야 합니다.')
  const controlById = new Map(definition.controls.map(control => [control.id, control]))
  for (const key of Object.keys(suppliedInputs)) if (!controlById.has(key)) fail(`이 시나리오에서 지원하지 않는 입력입니다: ${key}`)
  const inputs = {}
  for (const control of definition.controls) {
    const value = suppliedInputs[control.id] ?? control.defaultValue
    if (!isFiniteNumber(value) || value < control.min || value > control.max) fail(`${control.label}은(는) ${control.min}~${control.max} 범위의 유한한 숫자여야 합니다.`)
    inputs[control.id] = Object.is(value, -0) ? 0 : value
  }

  const suppliedOverrides = request.companyOverrides ?? {}
  if (!suppliedOverrides || typeof suppliedOverrides !== 'object' || Array.isArray(suppliedOverrides)) fail('companyOverrides는 객체여야 합니다.')
  const companyOverrides = {}
  for (const [companyId, override] of Object.entries(suppliedOverrides)) {
    if (!companyById.has(companyId)) fail(`알 수 없는 회사 ID입니다: ${companyId}`)
    if (!override || typeof override !== 'object' || Array.isArray(override)) fail(`${companyId} override는 객체여야 합니다.`)
    const allowedOverride = new Set(['assumptions', 'exposures', 'scenarioExposureScale'])
    for (const key of Object.keys(override)) if (!allowedOverride.has(key)) fail(`${companyId}에서 지원하지 않는 override 필드입니다: ${key}`)
    const normalized = {}
    if (override.scenarioExposureScale !== undefined) {
      if (!isFiniteNumber(override.scenarioExposureScale) || override.scenarioExposureScale < 0 || override.scenarioExposureScale > 1) fail(`${companyId} scenarioExposureScale은 0~1 범위여야 합니다.`)
      normalized.scenarioExposureScale = override.scenarioExposureScale
    }
    if (override.assumptions !== undefined) {
      if (!override.assumptions || typeof override.assumptions !== 'object' || Array.isArray(override.assumptions)) fail(`${companyId} assumptions는 객체여야 합니다.`)
      normalized.assumptions = {}
      for (const [key, value] of Object.entries(override.assumptions)) {
        const limits = ASSUMPTION_LIMITS[key]
        if (!limits) fail(`${companyId}에서 지원하지 않는 가정입니다: ${key}`)
        if (!isFiniteNumber(value) || value < limits[0] || value > limits[1]) fail(`${companyId} ${key}는 ${limits[0]}~${limits[1]} 범위여야 합니다.`)
        normalized.assumptions[key] = value
      }
    }
    if (override.exposures !== undefined) {
      if (!override.exposures || typeof override.exposures !== 'object' || Array.isArray(override.exposures)) fail(`${companyId} exposures는 객체여야 합니다.`)
      normalized.exposures = {}
      for (const [key, value] of Object.entries(override.exposures)) {
        if (!DRIVER_DEFINITIONS[key]) fail(`${companyId}에서 알 수 없는 노출도입니다: ${key}`)
        if (!isFiniteNumber(value) || value < 0 || value > 2) fail(`${companyId} ${key} 노출도는 0~2 범위여야 합니다.`)
        normalized.exposures[key] = value
      }
    }
    companyOverrides[companyId] = normalized
  }

  const validated = { scenarioId: definition.id, durationMonths: duration, inputs, companyOverrides }
  if (definition.id === 'interest_rate') {
    // A pre-v3 caller supplying a numeric common sensitivity still selects its own assumption.
    const mode = request.rateCapexMode ?? (suppliedInputs.rateCapexSensitivity != null ? 'manual' : 'historical')
    if (!['historical', 'manual'].includes(mode)) fail('rateCapexMode는 historical 또는 manual이어야 합니다.')
    validated.rateCapexMode = mode
  }
  return validated
}

function shockWeightAtMonth(month, lagMonths, durationMonths) {
  const elapsed = month - lagMonths
  if (elapsed <= 0) return 0
  if (elapsed <= durationMonths) return 1
  if (elapsed > durationMonths + MODEL_ASSUMPTIONS.shockFadeMonths) return 0
  return 1 - (elapsed - durationMonths) / MODEL_ASSUMPTIONS.shockFadeMonths
}

function driverLevelAtMonth(driverId, shock, month, lagMonths, durationMonths) {
  const duration = driverId === 'interestRate' ? rateDirectMonths : durationMonths
  const weight = shockWeightAtMonth(month, lagMonths, duration)
  if (weight === 0) return 0
  if (driverId !== 'modelGrowth') return shock * weight
  // The input describes annual growth. Accumulate the relative revenue level up
  // to the end of the shock, then fade that attained level back to the baseline.
  const activeMonths = Math.min(month - lagMonths, duration)
  return Math.expm1(Math.log1p(shock) * activeMonths / 12) * weight
}

function rateCapexTransmissionFor(request) {
  if (request.scenarioId !== 'interest_rate') return null
  const { rateChangePctPoints, rateCapexSensitivity } = request.inputs
  const historical = request.rateCapexMode === 'historical'
  const ownerChangesPct = Object.fromEntries(RATE_CAPEX_FITS.map(fit => [fit.companyId, historical
    ? 100 * Math.expm1(fit.logBeta * rateChangePctPoints / 100)
    : -rateChangePctPoints * rateCapexSensitivity || 0]))
  const totalCapex = sum(RATE_CAPEX_FITS.map(fit => fit.cashCapexUsd))
  const derivedCapexChangePct = historical
    ? sum(RATE_CAPEX_FITS.map(fit => ownerChangesPct[fit.companyId] * fit.cashCapexUsd / totalCapex))
    : -rateChangePctPoints * rateCapexSensitivity || 0
  return {
    version: 2,
    mode: request.rateCapexMode,
    ownerChangesPct,
    rateChangePctPoints,
    rateCapexSensitivity: historical ? null : rateCapexSensitivity,
    derivedCapexChangePct,
    budgetLagMonths: 0,
    grade: 'C',
  }
}

function normalizedDriverInputs(definition, inputs, rateCapexTransmission) {
  if (rateCapexTransmission) {
    const { rateChangePctPoints, derivedCapexChangePct } = rateCapexTransmission
    return [
      {
        driverId: 'interestRate', label: DRIVER_DEFINITIONS.interestRate.label,
        normalizedShock: -rateChangePctPoints * MODEL_ASSUMPTIONS.rateDirectDemandPerPctPoint / 100 || 0,
        controlValues: { rateChangePctPoints },
        calculation: 'negative demand overlay; discount-rate effect is modeled separately',
      },
      {
        driverId: 'hyperscalerCapex', label: RATE_CAPEX_DRIVER_LABEL,
        normalizedShock: derivedCapexChangePct / 100, mediatedBy: 'interestRate',
        controlValues: { capexChangePct: derivedCapexChangePct },
        calculation: rateCapexTransmission.mode === 'historical'
          ? 'cash CAPEX weighted company regressions on year-over-year EFFR; whole-company association used as AI budget proxy'
          : '-(rate change in percentage points) × assumed CAPEX sensitivity / 100',
      },
    ]
  }
  if (definition.id === 'model_growth') {
    const baseline = inputs.modelBaselineGrowthPct / 100
    const target = inputs.modelTargetGrowthPct / 100
    return [{
      driverId: 'modelGrowth',
      label: DRIVER_DEFINITIONS.modelGrowth.label,
      normalizedShock: (1 + target) / (1 + baseline) - 1,
      controlValues: {
        modelBaselineGrowthPct: inputs.modelBaselineGrowthPct,
        modelTargetGrowthPct: inputs.modelTargetGrowthPct,
      },
      calculation: 'monthly level gap = ((1 + target growth) / (1 + baseline growth)) ^ (active months / 12) - 1; attained gap fades linearly to baseline',
    }]
  }
  return definition.controls.map(control => {
    const normalizedShock = inputs[control.id] / 100
    return {
      driverId: control.driverId,
      label: DRIVER_DEFINITIONS[control.driverId].label,
      normalizedShock,
      controlValues: { [control.id]: inputs[control.id] },
      calculation: 'input percent / 100',
    }
  })
}

function buildDriverPaths(driverId, normalizedShock, durationMonths, mediatedBy = null, maxHops = MODEL_ASSUMPTIONS.maxPropagationHops) {
  const driver = DRIVER_DEFINITIONS[driverId]
  if (!driver || normalizedShock === 0) return []
  const edges = PROPAGATION_EDGES.filter(edge => edge.drivers.includes(driverId))
  const paths = []
  const walk = ({ segmentId, primitive, coefficient, segments, lagMonths, channels, visited, applyCurrent, propagate }) => {
    if (applyCurrent) {
      const monthlySeries = Array.from({ length: months }, (_, i) =>
        coefficient * driverLevelAtMonth(driverId, normalizedShock, i + 1, lagMonths, durationMonths))
      paths.push({
        pathId: `${driverId}:${primitive}:${segments.join('>')}`,
        ...(mediatedBy && { mediatedBy }),
        driverId,
        primitive,
        segmentId,
        segments,
        lagMonths,
        channels,
        coefficient,
        monthlySeries,
      })
    }
    if (!propagate || segments.length - 1 >= maxHops) return
    for (const edge of edges) {
      if (edge.from !== segmentId || visited.has(edge.to) || edge.primitive && edge.primitive !== primitive) continue
      walk({
        segmentId: edge.to,
        primitive: edge.toPrimitive ?? primitive,
        coefficient: coefficient * edge.weight,
        segments: [...segments, edge.to],
        lagMonths: lagMonths + edge.lagMonths,
        channels: [...channels, edge.channel],
        visited: new Set([...visited, edge.to]),
        applyCurrent: true,
        propagate: true,
      })
    }
  }
  for (const item of driver.seeds) walk({
    segmentId: item.segmentId,
    primitive: item.primitive,
    coefficient: item.weight,
    segments: [item.segmentId],
    lagMonths: item.lagMonths,
    channels: [mediatedBy ? '금리 변화에서 빅테크 AI CAPEX 예산' : '직접 입력'],
    visited: new Set([item.segmentId]),
    applyCurrent: item.applyToSeed,
    propagate: item.propagate,
  })
  return paths
}

function weightedAssumptions(segmentWeights, override = {}) {
  const keys = [
    'baseGrowthPct', 'fcffMarginPct', 'capexToRevenuePct', 'discountRatePct', 'terminalGrowthPct',
    'volumePassThrough', 'aspPassThrough', 'unitCostPassThrough', 'capexPassThrough', 'rateDiscountPassThrough',
  ]
  const result = Object.fromEntries(keys.map(key => [key, sum(Object.entries(segmentWeights).map(([segmentId, weight]) => segmentById.get(segmentId).illustrativeAssumptions[key] * weight))]))
  for (const [key, value] of Object.entries(override)) result[key] = value
  if (result.terminalGrowthPct >= result.discountRatePct - 0.5) fail('terminalGrowthPct는 discountRatePct보다 최소 0.5%p 낮아야 합니다.')
  return result
}

function buildPrimitiveBundle(segmentWeights, exposureScale, exposureMultipliers, pathsByDriver) {
  const byDriver = {}
  const entityPaths = {}
  for (const [driverId, paths] of Object.entries(pathsByDriver)) {
    const multiplier = exposureMultipliers[driverId] ?? 1
    byDriver[driverId] = Object.fromEntries(PRIMITIVES.map(primitive => [primitive, zeroSeries()]))
    entityPaths[driverId] = []
    for (const path of paths) {
      const segmentWeight = segmentWeights[path.segmentId] ?? 0
      if (!segmentWeight) continue
      const entityWeight = segmentWeight * exposureScale * multiplier
      const monthlySeries = path.monthlySeries.map(value => value * entityWeight)
      monthlySeries.forEach((value, index) => { byDriver[driverId][path.primitive][index] += value })
      entityPaths[driverId].push({ ...path, monthlySeries, entityWeight })
    }
  }
  return { byDriver, entityPaths }
}

function discountRateSeries(assumptions, request, activeDriverIds) {
  const rateChange = activeDriverIds.includes('interestRate') ? request.inputs.rateChangePctPoints : 0
  return Array.from({ length: months }, (_, i) => (assumptions.discountRatePct +
    rateChange * assumptions.rateDiscountPassThrough * shockWeightAtMonth(i + 1, 0, rateDirectMonths)) / 100)
}

function projectDcf(assumptions, primitiveBundle, request, activeDriverIds) {
  const { startingRevenue, forecast } = assumptions.financialBasis
  const baseRate = assumptions.discountRatePct / 100
  const monthlyBaseFactor = (1 + baseRate) ** (1 / 12)
  const terminalGrowth = assumptions.terminalGrowthPct / 100
  const rates = discountRateSeries(assumptions, request, activeDriverIds)
  const signals = activeDriverIds.map(id => primitiveBundle.byDriver[id])
  const monthly = { baselineFcff: [], scenarioFcff: [], annualizedDiscountRatesPct: [], revenueVolumePct: [], aspPct: [] }
  const baseline = []
  const scenario = []
  let annualRevenue = startingRevenue
  let baseDiscountFactor = 1
  let scenarioDiscountFactor = 1
  let basePresentValue = 0
  let scenarioPresentValue = 0

  for (let year = 0; year < years; year += 1) {
    const profile = forecast[year]
    annualRevenue *= 1 + profile.baseGrowthPct / 100
    const annualBaseCash = annualRevenue * profile.fcffMarginPct / 100
    const monthlyRevenue = annualRevenue / 12
    const monthlyCash = annualBaseCash / 12
    const afterTaxRetention = profile.priceContributionMarginPct / 100
    const annualOpeningFactor = scenarioDiscountFactor
    baseline.push({ year: year + 1, revenue: annualRevenue, fcff: annualBaseCash, discountRate: baseRate })
    const totals = { year: year + 1, revenue: 0, fcff: annualBaseCash, revenueVolumeDelta: 0, aspDelta: 0,
      incrementalUnitCost: 0, incrementalCapexCashout: 0 }

    for (let index = year * 12; index < (year + 1) * 12; index += 1) {
      let volumeSignal = 0
      let priceSignal = 0
      let costSignal = 0
      let capexSignal = 0
      for (const driver of signals) {
        volumeSignal += driver.revenueVolume[index]
        priceSignal += driver.asp[index]
        costSignal += driver.unitCost[index]
        capexSignal += driver.capexCashout[index]
      }
      const volumeDelta = Math.max(-1, volumeSignal * assumptions.volumePassThrough)
      const priceDelta = Math.max(-1, priceSignal * assumptions.aspPassThrough)
      const volumeRevenue = monthlyRevenue * volumeDelta
      const salesAtBasePrice = monthlyRevenue + volumeRevenue
      const priceRevenue = salesAtBasePrice * priceDelta
      // An increase in selling price at fixed quantity does not replicate past capacity spending.
      // Apply price and unit costs to the same quantity and retain their after-tax cash effects.
      // Charge the separate investment shock against its own baseline spending.
      const costDelta = salesAtBasePrice * profile.costOfRevenueSharePct / 100 *
        costSignal * assumptions.unitCostPassThrough * afterTaxRetention
      const capexDelta = monthlyRevenue * profile.capexToRevenuePct / 100 * capexSignal * assumptions.capexPassThrough
      const cashDelta = volumeRevenue * profile.volumeContributionMarginPct / 100 +
        priceRevenue * afterTaxRetention - costDelta - capexDelta
      const scenarioCash = monthlyCash + cashDelta
      const rate = rates[index]
      if (rate <= -1) fail('월 할인계수를 계산하려면 연환산 할인율이 −100%를 초과해야 합니다.')
      baseDiscountFactor *= monthlyBaseFactor
      scenarioDiscountFactor *= (1 + rate) ** (1 / 12)
      basePresentValue += monthlyCash / baseDiscountFactor
      scenarioPresentValue += scenarioCash / scenarioDiscountFactor

      monthly.baselineFcff.push(monthlyCash)
      monthly.scenarioFcff.push(scenarioCash)
      monthly.annualizedDiscountRatesPct.push(rate * 100)
      monthly.revenueVolumePct.push(volumeDelta * 100)
      monthly.aspPct.push(priceDelta * 100)
      totals.revenue += salesAtBasePrice + priceRevenue
      totals.fcff += cashDelta
      totals.revenueVolumeDelta += volumeDelta / 12
      totals.aspDelta += priceDelta / 12
      totals.incrementalUnitCost += costDelta
      totals.incrementalCapexCashout += capexDelta
    }
    totals.discountRate = scenarioDiscountFactor / annualOpeningFactor - 1
    scenario.push(totals)
  }

  // Value annual blocks of growing FCFF, with the same 12 equal month-end payments
  // used in the explicit period. The Gordon denominator uses the long-run WACC only.
  const withinYearFactor = sum(Array.from({ length: 12 }, (_, i) => monthlyBaseFactor ** i)) / 12
  const terminalValue = baseline.at(-1).fcff * (1 + terminalGrowth) * withinYearFactor / (baseRate - terminalGrowth)
  const baselineEnterpriseValue = basePresentValue + terminalValue / baseDiscountFactor
  const scenarioEnterpriseValue = scenarioPresentValue + terminalValue / scenarioDiscountFactor
  return {
    baselineEnterpriseValue,
    scenarioEnterpriseValue,
    scenarioValueIndex: baselineEnterpriseValue > 0 ? scenarioEnterpriseValue / baselineEnterpriseValue * 100 : null,
    baseline,
    scenario,
    monthly,
    baselineTerminalValue: terminalValue,
    scenarioTerminalValue: terminalValue,
    terminalShockApplied: false,
  }
}

function isChainPath(path) {
  return Boolean(path.mediatedBy) || path.segments.length > 1
}

// Reprice the same firm with each path switched on. Direct paths are applied
// first, so the group split is independent of the order within each group.
function attributeEffects(assumptions, bundle, request, driverIds, fullIndex) {
  const paths = []
  const isRate = request.scenarioId === 'interest_rate'
  const effectAttribution = { directPct: null, chainPct: null,
    ...(isRate && { rateDiscountPct: null, rateDirectDemandPct: null }) }
  if (fullIndex === null) return { effectAttribution, paths, contributions: [] }

  const contributions = driverIds.map(driverId => {
    const mediated = isRate && driverId === 'hyperscalerCapex'
    return {
      driverId, label: mediated ? RATE_CAPEX_DRIVER_LABEL : DRIVER_DEFINITIONS[driverId].label,
      ...(mediated && { mediatedBy: 'interestRate' }), valueIndexPoints: 0,
    }
  })
  const byDriver = Object.fromEntries(driverIds.map(id => [id, Object.fromEntries(
    PRIMITIVES.map(primitive => [primitive, zeroSeries()]),
  )]))
  const prefix = { byDriver }
  let previous = 100
  let directIndex = 100
  const append = (path, next) => {
    const impactPoints = next - previous
    previous = next
    if (!isChainPath(path)) directIndex = next
    contributions.find(item => item.driverId === path.driverId).valueIndexPoints += impactPoints
    paths.push({ ...path, calculationOrder: paths.length + 1, impactPoints, attributionMethod: MODEL_ASSUMPTIONS.pathAttributionMethod })
  }

  // Policy-rate discounting applies even with no operating exposure.
  if (isRate && request.inputs.rateChangePctPoints !== 0) {
    append({
      pathId: 'interestRate:discountRate', driverId: 'interestRate',
      primitive: 'discountRate', segments: [], channels: [], lagMonths: 0,
    }, projectDcf(assumptions, prefix, request, driverIds).scenarioValueIndex)
  }
  const applicable = driverIds.flatMap(id => bundle.entityPaths[id]).filter(path => path.entityWeight !== 0)
  const ordered = [...applicable.filter(path => !isChainPath(path)), ...applicable.filter(isChainPath)]
  for (const [index, path] of ordered.entries()) {
    const { driverId, primitive, monthlySeries, pathId, segments, channels, lagMonths, mediatedBy } = path
    const values = byDriver[driverId][primitive]
    for (let month = 0; month < values.length; month++) values[month] += monthlySeries[month]
    const next = index === ordered.length - 1 ? fullIndex : projectDcf(assumptions, prefix, request, driverIds).scenarioValueIndex
    append({ driverId, primitive, pathId, segments, channels, lagMonths, ...(mediatedBy && { mediatedBy }) }, next)
  }
  effectAttribution.directPct = directIndex - 100
  effectAttribution.chainPct = fullIndex - directIndex
  if (isRate) {
    effectAttribution.rateDiscountPct = paths.find(path => path.pathId === 'interestRate:discountRate')?.impactPoints ?? 0
    effectAttribution.rateDirectDemandPct = effectAttribution.directPct - effectAttribution.rateDiscountPct
  }
  return { effectAttribution, paths, contributions }
}

function buildEquityBridge(projection, netDebtToEvPct, listingStatus) {
  if (listingStatus === 'private') return { equityValueRatio: null, scenarioEquityValueIndex: null, quoteLinkStatus: 'not-applicable-private' }
  if (projection.scenarioValueIndex === null) return { equityValueRatio: null, scenarioEquityValueIndex: null, quoteLinkStatus: 'unavailable-nonpositive-baseline' }
  if (netDebtToEvPct === undefined) return { equityValueRatio: null, scenarioEquityValueIndex: null, quoteLinkStatus: 'missing-same-date-net-debt-to-ev' }
  const enterpriseValueRatio = projection.scenarioEnterpriseValue / projection.baselineEnterpriseValue
  const debtRatio = netDebtToEvPct / 100
  const scenarioEquity = enterpriseValueRatio - debtRatio
  if (scenarioEquity <= 0 || 1 - debtRatio <= 0) return { equityValueRatio: null, scenarioEquityValueIndex: null, quoteLinkStatus: 'unavailable-nonpositive-equity' }
  const equityValueRatio = scenarioEquity / (1 - debtRatio)
  return { equityValueRatio: round(equityValueRatio, 6), scenarioEquityValueIndex: round(equityValueRatio * 100), quoteLinkStatus: 'ready-for-observed-price-ratio-only' }
}

function buildEntityResult({ id, name, listingStatus = null, segmentWeights, exposureScale, exposureMultipliers,
  assumptionOverrides, request, selectedDriverIds, pathsByDriver }) {
  const assumptions = weightedAssumptions(segmentWeights, assumptionOverrides)
  const financialBasis = financialProfile(SCENARIO_FINANCIAL_BASELINES[id], assumptions, assumptionOverrides, companyById.get(id)?.primarySegmentId ?? id)
  assumptions.financialBasis = financialBasis
  const actual = financialBasis.status === 'actual'
  const marginBasis = { historical: 'fcf-proxy', sector: 'sector-margin', user: 'user-margin' }[financialBasis.fieldSources.fcffMarginPct]
  const primitiveBundle = buildPrimitiveBundle(segmentWeights, exposureScale, exposureMultipliers, pathsByDriver)
  const projection = projectDcf(assumptions, primitiveBundle, request, selectedDriverIds)
  const comparable = projection.scenarioValueIndex !== null
  const { effectAttribution, paths, contributions } = attributeEffects(assumptions, primitiveBundle, request, selectedDriverIds, projection.scenarioValueIndex)
  const difference = comparable ? projection.scenarioValueIndex - 100 : null
  const equityBridge = buildEquityBridge(projection, assumptionOverrides.netDebtToEvPct, listingStatus)
  return {
    id,
    name,
    financialBasis,
    effectAttribution,
    ...(request.scenarioId === 'interest_rate' && { rateAttribution: effectAttribution }),
    baselineValueIndex: comparable ? 100 : null,
    scenarioValueIndex: comparable ? round(projection.scenarioValueIndex) : null,
    valueChangePct: difference,
    driverContributions: contributions,
    paths,
    assumptions: {
      baseGrowthPct: round(financialBasis.firstYearGrowthPct),
      fcffMarginPct: round(financialBasis.firstYearCashMarginPct),
      capexToRevenuePct: round(financialBasis.firstYearCapexToRevenuePct),
      discountRatePct: round(assumptions.discountRatePct),
      terminalGrowthPct: round(assumptions.terminalGrowthPct),
      volumePassThrough: round(assumptions.volumePassThrough),
      aspPassThrough: round(assumptions.aspPassThrough),
      unitCostPassThrough: round(assumptions.unitCostPassThrough),
      capexPassThrough: round(assumptions.capexPassThrough),
      rateDiscountPassThrough: round(assumptions.rateDiscountPassThrough),
      scenarioExposureScale: round(exposureScale),
      nonScenarioSharePct: round((1 - exposureScale) * 100),
      driverExposureMultipliers: Object.fromEntries(selectedDriverIds.map(driverId => [driverId, exposureMultipliers[driverId] ?? 1])),
      netDebtToEvPct: assumptionOverrides.netDebtToEvPct ?? null,
      netDebtSource: assumptionOverrides.netDebtToEvPct === undefined ? null : 'user-supplied-same-valuation-date-assumption',
      source: MODEL_ASSUMPTIONS.assumptionSource,
      interpretation: financialBasis.forecastMethod,
    },
    valuation: {
      basis: actual ? `reported-revenue-${marginBasis}-dcf` : 'illustrative-normalized-8y-fcff-dcf',
      comparisonStatus: comparable ? 'available' : 'nonpositive-baseline',
      cashFlowMeasure: financialBasis.fieldSources.fcffMarginPct === 'historical' ? 'fcf-proxy' : 'illustrative-fcff',
      startingRevenue: financialBasis.startingRevenue,
      currency: financialBasis.currency,
      normalizedStartingRevenue: actual ? null : financialBasis.startingRevenue,
      horizonMonths: MODEL_ASSUMPTIONS.horizonMonths,
      baselineEnterpriseValueUnits: round(projection.baselineEnterpriseValue),
      scenarioEnterpriseValueUnits: round(projection.scenarioEnterpriseValue),
      enterpriseValueRatio: comparable ? round(projection.scenarioValueIndex / 100, 6) : null,
      ...equityBridge,
      baselineRevenue: projection.baseline.map(item => round(item.revenue)),
      baselineFcff: projection.baseline.map(item => round(item.fcff)),
      scenarioFcff: projection.scenario.map(item => round(item.fcff)),
      scenarioDiscountRatesPct: projection.scenario.map(item => round(item.discountRate * 100)),
      monthly: projection.monthly,
      terminalValueAtMonth96: projection.scenarioTerminalValue,
      operatingBridge: projection.scenario.map(item => ({
        year: item.year,
        revenueVolumePct: round(item.revenueVolumeDelta * 100),
        aspPct: round(item.aspDelta * 100),
        incrementalUnitCostUnits: round(item.incrementalUnitCost),
        incrementalCapexCashoutUnits: round(item.incrementalCapexCashout),
      })),
      terminalShockApplied: projection.terminalShockApplied,
      terminalValueNormalizedToBaseline: projection.scenarioTerminalValue === projection.baselineTerminalValue,
    },
  }
}

function coverageForSegment(segmentId, selectedDriverIds, request) {
  const covered = selectedDriverIds.filter(driverId => buildDriverPaths(driverId, 1, request.durationMonths).some(path => path.segmentId === segmentId))
  return {
    status: covered.length === selectedDriverIds.length ? 'modeled' : covered.length ? 'partial' : 'not-modeled',
    coveredDriverIds: covered,
    missingDriverIds: selectedDriverIds.filter(driverId => !covered.includes(driverId)),
  }
}

function prepareScenario(unvalidatedRequest) {
  const request = validateScenarioRequest(unvalidatedRequest)
  const definition = scenarioById.get(request.scenarioId)
  const rateCapexTransmission = rateCapexTransmissionFor(request)
  const drivers = normalizedDriverInputs(definition, request.inputs, rateCapexTransmission)
  const selectedDriverIds = drivers.map(item => item.driverId)
  const pathsByDriver = Object.fromEntries(drivers.map(item => [item.driverId, buildDriverPaths(item.driverId, item.normalizedShock, request.durationMonths, item.mediatedBy)]))
  let budgetPaths
  if (pathsByDriver.hyperscalerCapex) {
    // Only the four budget setters incur their own outlay and operate the new capacity.
    // Companies supplying other segments see orders generated by the combined budget.
    const ownerSeeds = pathsByDriver.hyperscalerCapex.filter(path => path.segments.length === 1)
    const supplierPaths = pathsByDriver.hyperscalerCapex.filter(path => path.segments.length > 1)
    const byOwner = Object.fromEntries(HYPERSCALER_CAPEX_OWNER_IDS.map(id => {
      const change = rateCapexTransmission?.ownerChangesPct?.[id]
      const seeds = isFiniteNumber(change) && change !== rateCapexTransmission?.derivedCapexChangePct
        ? buildDriverPaths('hyperscalerCapex', change / 100, request.durationMonths, 'interestRate', 0)
        : ownerSeeds
      return [id, [...seeds, ...supplierPaths]]
    }))
    budgetPaths = { byOwner, supplierPaths }
  }
  return { request, definition, rateCapexTransmission, drivers, selectedDriverIds, pathsByDriver, budgetPaths }
}

function valueCompany(company, { request, selectedDriverIds, pathsByDriver, budgetPaths }) {
  const override = request.companyOverrides[company.companyId] ?? {}
  const exposureMultipliers = { ...company.driverExposureMultipliers, ...(override.exposures ?? {}) }
  const entity = buildEntityResult({
    id: company.companyId, name: company.name, listingStatus: company.listingStatus,
    segmentWeights: company.segmentWeights,
    exposureScale: override.scenarioExposureScale ?? company.scenarioExposureScale,
    exposureMultipliers, assumptionOverrides: override.assumptions ?? {},
    request, selectedDriverIds, pathsByDriver: budgetPaths ? {
      ...pathsByDriver, hyperscalerCapex: budgetPaths.byOwner[company.companyId] ?? budgetPaths.supplierPaths,
    } : pathsByDriver,
  })
  return {
    companyId: company.companyId, symbol: company.symbol, name: company.name,
    listingStatus: company.listingStatus, primarySegmentId: company.primarySegmentId,
    segmentIds: company.segmentIds, segmentWeights: company.segmentWeights, isBig7: company.isBig7,
    ...(budgetPaths && { capexRole: budgetPaths.byOwner[company.companyId] ? 'budget-owner'
      : company.segmentIds.every(id => id === 'SEG8') ? 'no-covered-customer-path' : 'supply-chain' }),
    ...entity,
  }
}

// A moving slider needs only the visible rows; use the same DCF and attributed paths as the full report.
export function evaluateCompanyPreview(request, companyIds) {
  const context = prepareScenario(request)
  return {
    scenario: {
      id: context.definition.id, durationMonths: context.request.durationMonths,
      ...(context.rateCapexTransmission && { directDurationMonths: rateDirectMonths }),
      ...(context.rateCapexTransmission && { rateCapexTransmission: context.rateCapexTransmission }),
    },
    companies: companyIds.map(id => valueCompany(companyById.get(id), context)),
  }
}

export function evaluateScenario(unvalidatedRequest) {
  const context = prepareScenario(unvalidatedRequest)
  const { request, definition, rateCapexTransmission, drivers, selectedDriverIds, pathsByDriver } = context

  const segments = SEGMENTS.map(segment => {
    const entity = buildEntityResult({
      id: segment.id,
      name: segment.name,
      segmentWeights: { [segment.id]: 1 },
      exposureScale: 1,
      exposureMultipliers: {},
      assumptionOverrides: {},
      request,
      selectedDriverIds,
      pathsByDriver,
    })
    return {
      segmentId: segment.id,
      name: segment.name,
      description: segment.description,
      memberCompanyIds: COMPANIES.filter(company => company.segmentIds.includes(segment.id)).map(company => company.companyId),
      coverage: coverageForSegment(segment.id, selectedDriverIds, request),
      ...entity,
    }
  })

  const companies = COMPANIES.map(company => valueCompany(company, context))

  const big7Members = BIG7_COMPANY_IDS.map(companyId => companies.find(company => company.companyId === companyId))
  const equalWeightIndex = members => members.every(item => Number.isFinite(item.scenarioValueIndex))
    ? sum(members.map(item => item.scenarioValueIndex)) / members.length : null
  const big7ValueIndex = equalWeightIndex(big7Members)
  const universeValueIndex = equalWeightIndex(companies)
  const actualFinancialCompanyCount = companies.filter(item => item.financialBasis.status === 'actual').length
  const allEntityIndices = [...segments, ...companies].map(item => item.scenarioValueIndex)
  const allDriverShocksZero = drivers.every(item => Math.abs(item.normalizedShock) < 1e-12)
  const baselineFcffPositive = companies.every(company => company.valuation.baselineFcff.every(value => value > 0))
  const membershipCount = sum(COMPANIES.map(company => company.segmentIds.length))
  const longestPathLagMonths = Math.max(0, ...Object.values(pathsByDriver).flat().map(path => path.lagMonths))
  const latestShockEndMonth = Math.max(longestPathLagMonths + request.durationMonths,
    rateCapexTransmission ? rateDirectMonths : 0) + MODEL_ASSUMPTIONS.shockFadeMonths

  return {
    model: {
      id: MODEL_ASSUMPTIONS.modelId,
      version: MODEL_ASSUMPTIONS.modelVersion,
      valuationBasis: MODEL_ASSUMPTIONS.valuationBasis,
      forecastYears: MODEL_ASSUMPTIONS.forecastYears,
      horizonMonths: MODEL_ASSUMPTIONS.horizonMonths,
      actualCompanyFinancialsUsed: actualFinancialCompanyCount > 0,
      actualFinancialCompanyCount,
      illustrativeFinancialCompanyCount: companies.length - actualFinancialCompanyCount,
      currentPricesUsed: false,
      terminalShockApplied: false,
      terminalValueNormalizedToBaseline: true,
      assumptionSource: MODEL_ASSUMPTIONS.assumptionSource,
      baselineInterpretation: 'reported consolidated annual revenue when available; financial cash-flow proxy transitions to mature sector assumptions',
      pathAttributionMethod: MODEL_ASSUMPTIONS.pathAttributionMethod,
      unmodeledMitigants: MODEL_ASSUMPTIONS.unmodeledMitigants,
      limitation: MODEL_ASSUMPTIONS.limitation,
    },
    scenario: {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      durationMonths: request.durationMonths,
      ...(rateCapexTransmission && { directDurationMonths: rateDirectMonths }),
      fadeMonths: MODEL_ASSUMPTIONS.shockFadeMonths,
      inputValues: request.inputs,
      ...(rateCapexTransmission && { rateCapexTransmission }),
      inputs: drivers,
      drivers,
      longestPathLagMonths,
      latestShockEndMonth,
    },
    segments,
    companies,
    big7: {
      name: 'Big7',
      method: MODEL_ASSUMPTIONS.aggregation.big7,
      valuedCompanyCount: big7Members.filter(item => Number.isFinite(item.scenarioValueIndex)).length,
      baselineValueIndex: big7ValueIndex === null ? null : 100,
      scenarioValueIndex: big7ValueIndex === null ? null : round(big7ValueIndex),
      valueChangePct: big7ValueIndex === null ? null : round(big7ValueIndex - 100),
      members: big7Members.map(company => ({
        companyId: company.companyId,
        symbol: company.symbol,
        name: company.name,
        scenarioValueIndex: company.scenarioValueIndex,
        valueChangePct: company.valueChangePct,
        scenarioExposureScale: company.assumptions.scenarioExposureScale,
        nonScenarioSharePct: company.assumptions.nonScenarioSharePct,
      })),
    },
    universe: {
      method: 'equal-weighted unique company results; not market-cap weighted',
      companyCount: companies.length,
      valuedCompanyCount: companies.filter(item => Number.isFinite(item.scenarioValueIndex)).length,
      baselineValueIndex: universeValueIndex === null ? null : 100,
      scenarioValueIndex: universeValueIndex === null ? null : round(universeValueIndex),
      valueChangePct: universeValueIndex === null ? null : round(universeValueIndex - 100),
    },
    checks: {
      zeroShockIdentity: !allDriverShocksZero || [...segments, ...companies].every(item =>
        item.valuation.baselineEnterpriseValueUnits === item.valuation.scenarioEnterpriseValueUnits &&
        (item.valuation.comparisonStatus === 'nonpositive-baseline' || Math.abs(item.scenarioValueIndex - 100) < 1e-9)),
      finiteResults: allEntityIndices.every(Number.isFinite) && Number.isFinite(big7ValueIndex),
      positiveBaselineFcff: baselineFcffPositive,
      uniqueCompanies: companyById.size === COMPANIES.length,
      companyConsolidatedCount: companies.length,
      segmentMembershipCount: membershipCount,
      multipleSegmentMembershipsAreTagsNotCompanyDuplicates: companies.length === new Set(companies.map(company => company.companyId)).size,
      big7MemberCount: big7Members.length,
      allSelectedDriversCoverAllSegments: segments.every(item => item.coverage.status === 'modeled'),
      latestShockEndWithinForecastHorizon: latestShockEndMonth <= MODEL_ASSUMPTIONS.horizonMonths,
      terminalShockApplied: false,
    },
    warnings: [
      MODEL_ASSUMPTIONS.limitation,
      '재무 DB가 있는 회사는 결산 매출에서 시작합니다. 영업현금흐름과 설비투자액이 모두 있으면 두 금액의 차이를 현금흐름 대용치로 사용합니다.',
      '사업 노출도, 충격 전파계수, 할인율과 장기 가정은 설명용 설정입니다.',
      '비상장 AI 모델 기업의 양(+) FCFF는 현재 흑자를 뜻하지 않고 정상상태 가정에 불과합니다.',
      'SEG 지수는 독립 프로필 결과이며 서로 더해 전체 기업가치를 만들 수 없습니다.',
      '경로별 기여도는 직접 경로부터 차례로 추가해 재평가한 EV 차이입니다. 경로 간 상호작용은 뒤에 적용된 경로에 포함됩니다.',
      '상장사 관측시가 환산은 같은 평가시점의 순차입금/EV 가정을 사용한 equityValueRatio가 준비된 경우에만 가능합니다.',
      '비상장사는 관측 가능한 거래소 시가가 없어 가격 환산 대상이 아닙니다.',
    ],
  }
}
