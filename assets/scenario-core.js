import {
  ASSUMPTION_LIMITS,
  BIG7_COMPANY_IDS,
  COMPANIES,
  DRIVER_DEFINITIONS,
  MODEL_ASSUMPTIONS,
  PROPAGATION_EDGES,
  SCENARIO_DEFINITIONS,
  SEGMENTS,
} from './scenario-data.js'

const PRIMITIVES = Object.freeze(['revenueVolume', 'asp', 'unitCost', 'capexCashout'])
const segmentById = new Map(SEGMENTS.map(item => [item.id, item]))
const companyById = new Map(COMPANIES.map(item => [item.companyId, item]))
const scenarioById = new Map(SCENARIO_DEFINITIONS.map(item => [item.id, item]))
const years = MODEL_ASSUMPTIONS.forecastYears
const zeroSeries = () => Array.from({ length: years }, () => 0)
const sum = values => values.reduce((total, value) => total + value, 0)
const round = (value, digits = 4) => Number(value.toFixed(digits))
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))

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

  return { scenarioId: definition.id, durationMonths: duration, inputs, companyOverrides }
}

function shockWeightAtMonth(month, lagMonths, durationMonths) {
  const elapsed = month - lagMonths
  if (elapsed <= 0) return 0
  if (elapsed <= durationMonths) return 1
  if (elapsed > durationMonths + MODEL_ASSUMPTIONS.shockFadeMonths) return 0
  return 1 - (elapsed - durationMonths) / MODEL_ASSUMPTIONS.shockFadeMonths
}

function annualEnvelope(lagMonths, durationMonths) {
  return Array.from({ length: years }, (_, yearIndex) => {
    let total = 0
    for (let month = yearIndex * 12 + 1; month <= (yearIndex + 1) * 12; month += 1) total += shockWeightAtMonth(month, lagMonths, durationMonths)
    return total / 12
  })
}

function normalizedDriverInputs(definition, inputs) {
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
      calculation: '(1 + target growth) / (1 + baseline growth) - 1',
    }]
  }
  return definition.controls.map(control => {
    let normalizedShock = inputs[control.id] / 100
    if (control.driverId === 'interestRate') normalizedShock *= -1
    return {
      driverId: control.driverId,
      label: DRIVER_DEFINITIONS[control.driverId].label,
      normalizedShock,
      controlValues: { [control.id]: inputs[control.id] },
      calculation: control.driverId === 'interestRate' ? 'negative demand overlay; discount-rate effect is modeled separately' : 'input percent / 100',
    }
  })
}

function buildDriverPaths(driverId, normalizedShock, durationMonths) {
  const driver = DRIVER_DEFINITIONS[driverId]
  if (!driver || normalizedShock === 0) return []
  const edges = PROPAGATION_EDGES.filter(edge => edge.drivers.includes(driverId))
  const paths = []
  const walk = ({ segmentId, primitive, coefficient, segments, lagMonths, channels, visited, applyCurrent, propagate }) => {
    if (applyCurrent) {
      const envelope = annualEnvelope(lagMonths, durationMonths)
      paths.push({
        pathId: `${driverId}:${primitive}:${segments.join('>')}`,
        driverId,
        primitive,
        segmentId,
        segments,
        lagMonths,
        channels,
        coefficient,
        annualSeries: envelope.map(weight => normalizedShock * coefficient * weight),
      })
    }
    if (!propagate || segments.length - 1 >= MODEL_ASSUMPTIONS.maxPropagationHops) return
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
    channels: ['직접 입력'],
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
      const annualSeries = path.annualSeries.map(value => value * entityWeight)
      annualSeries.forEach((value, index) => { byDriver[driverId][path.primitive][index] += value })
      entityPaths[driverId].push({ ...path, annualSeries, entityWeight })
    }
  }
  return { byDriver, entityPaths }
}

function discountRateSeries(assumptions, request, activeDriverIds) {
  if (!activeDriverIds.includes('interestRate')) return Array.from({ length: years }, () => assumptions.discountRatePct / 100)
  const rateChange = request.inputs.rateChangePctPoints ?? 0
  const envelope = annualEnvelope(0, request.durationMonths)
  return envelope.map(weight => assumptions.discountRatePct / 100 + rateChange / 100 * assumptions.rateDiscountPassThrough * weight)
}

function projectDcf(assumptions, primitiveBundle, request, activeDriverIds) {
  const baseGrowth = assumptions.baseGrowthPct / 100
  const baseMargin = assumptions.fcffMarginPct / 100
  const capexRatio = assumptions.capexToRevenuePct / 100
  const baseDiscountRate = assumptions.discountRatePct / 100
  const terminalGrowth = assumptions.terminalGrowthPct / 100
  const startingRevenue = MODEL_ASSUMPTIONS.normalizedStartingRevenue

  let baseRevenue = startingRevenue
  let baseDiscountFactor = 1
  let basePresentValue = 0
  const baseline = []
  for (let index = 0; index < years; index += 1) {
    baseRevenue *= 1 + baseGrowth
    const fcff = baseRevenue * baseMargin
    baseDiscountFactor *= 1 + baseDiscountRate
    basePresentValue += fcff / baseDiscountFactor
    baseline.push({ year: index + 1, revenue: baseRevenue, fcff, discountRate: baseDiscountRate })
  }
  const baseTerminalFcff = baseRevenue * (1 + terminalGrowth) * baseMargin
  const baseTerminalValue = baseTerminalFcff / (baseDiscountRate - terminalGrowth)
  const baselineEnterpriseValue = basePresentValue + baseTerminalValue / baseDiscountFactor

  const rates = discountRateSeries(assumptions, request, activeDriverIds)
  let scenarioDiscountFactor = 1
  let scenarioPresentValue = 0
  const scenario = []
  for (let index = 0; index < years; index += 1) {
    const primitiveSignals = Object.fromEntries(PRIMITIVES.map(primitive => [primitive,
      sum(activeDriverIds.map(driverId => primitiveBundle.byDriver[driverId]?.[primitive]?.[index] ?? 0)),
    ]))
    const revenueVolumeDelta = clamp(primitiveSignals.revenueVolume * assumptions.volumePassThrough, -0.85, 1.50)
    const aspDelta = clamp(primitiveSignals.asp * assumptions.aspPassThrough, -0.85, 1.50)
    const scenarioRevenue = baseline[index].revenue * (1 + revenueVolumeDelta) * (1 + aspDelta)
    const incrementalUnitCost = baseline[index].revenue * primitiveSignals.unitCost * assumptions.unitCostPassThrough
    const incrementalCapexCashout = baseline[index].revenue * capexRatio * primitiveSignals.capexCashout * assumptions.capexPassThrough
    const fcffBeforeBridge = scenarioRevenue * baseMargin
    const fcff = fcffBeforeBridge - incrementalUnitCost - incrementalCapexCashout
    const discountRate = rates[index]
    if (discountRate <= terminalGrowth + 0.005) fail('시나리오 할인율이 터미널 성장률에 너무 가깝습니다.')
    scenarioDiscountFactor *= 1 + discountRate
    scenarioPresentValue += fcff / scenarioDiscountFactor
    scenario.push({
      year: index + 1,
      revenue: scenarioRevenue,
      fcff,
      discountRate,
      revenueVolumeDelta,
      aspDelta,
      incrementalUnitCost,
      incrementalCapexCashout,
      primitiveSignals,
    })
  }
  // All operating primitives are temporary overlays. Terminal FCFF and terminal value normalize to the baseline path.
  const scenarioTerminalValue = baseTerminalValue
  const scenarioEnterpriseValue = scenarioPresentValue + scenarioTerminalValue / scenarioDiscountFactor
  const scenarioValueIndex = scenarioEnterpriseValue / baselineEnterpriseValue * 100
  return {
    baselineEnterpriseValue,
    scenarioEnterpriseValue,
    scenarioValueIndex,
    baseline,
    scenario,
    baselineTerminalValue: baseTerminalValue,
    scenarioTerminalValue,
    terminalShockApplied: false,
  }
}

const factorial = value => value <= 1 ? 1 : value * factorial(value - 1)

function attributeDrivers(assumptions, primitiveBundle, request, selectedDriverIds) {
  const count = selectedDriverIds.length
  const cache = new Map()
  const valueForMask = mask => {
    if (!cache.has(mask)) {
      const active = selectedDriverIds.filter((_, index) => mask & (1 << index))
      cache.set(mask, projectDcf(assumptions, primitiveBundle, request, active).scenarioValueIndex)
    }
    return cache.get(mask)
  }
  const contributions = selectedDriverIds.map((driverId, driverIndex) => {
    let valueIndexPoints = 0
    for (let mask = 0; mask < (1 << count); mask += 1) {
      if (mask & (1 << driverIndex)) continue
      const members = selectedDriverIds.reduce((total, _, index) => total + Number(Boolean(mask & (1 << index))), 0)
      const weight = factorial(members) * factorial(count - members - 1) / factorial(count)
      valueIndexPoints += weight * (valueForMask(mask | (1 << driverIndex)) - valueForMask(mask))
    }
    return { driverId, label: DRIVER_DEFINITIONS[driverId].label, valueIndexPoints }
  })
  return { contributions, totalValueIndex: valueForMask((1 << count) - 1) }
}

function pathEconomicScore(path, assumptions) {
  const coefficient = {
    revenueVolume: assumptions.volumePassThrough,
    asp: assumptions.aspPassThrough,
    unitCost: -assumptions.unitCostPassThrough,
    capexCashout: -assumptions.capexToRevenuePct / 100 * assumptions.capexPassThrough,
  }[path.primitive]
  return path.annualSeries.reduce((total, value, index) => total + value * coefficient / (1 + index * 0.25), 0)
}

function attributePaths(driverContribution, paths, assumptions) {
  if (!paths.length || Math.abs(driverContribution) < 1e-12) return []
  const scored = paths.map(path => ({ path, score: pathEconomicScore(path, assumptions) }))
  const totalScore = sum(scored.map(item => item.score))
  if (Math.abs(totalScore) < 1e-12) return []
  return scored.map(({ path, score }) => ({
    pathId: path.pathId,
    driverId: path.driverId,
    primitive: path.primitive,
    segments: path.segments,
    lagMonths: path.lagMonths,
    channels: path.channels,
    impactPoints: driverContribution * score / totalScore,
    attributionMethod: MODEL_ASSUMPTIONS.pathAttributionMethod,
  }))
}

function buildEquityBridge(projection, netDebtToEvPct, listingStatus) {
  if (listingStatus === 'private') return { equityValueRatio: null, scenarioEquityValueIndex: null, quoteLinkStatus: 'not-applicable-private' }
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
  const primitiveBundle = buildPrimitiveBundle(segmentWeights, exposureScale, exposureMultipliers, pathsByDriver)
  const attribution = attributeDrivers(assumptions, primitiveBundle, request, selectedDriverIds)
  const projection = projectDcf(assumptions, primitiveBundle, request, selectedDriverIds)
  const contributions = attribution.contributions.map(item => ({ ...item }))
  const difference = projection.scenarioValueIndex - 100
  if (contributions.length) contributions[contributions.length - 1].valueIndexPoints += difference - sum(contributions.map(item => item.valueIndexPoints))
  const paths = contributions.flatMap(item => attributePaths(item.valueIndexPoints, primitiveBundle.entityPaths[item.driverId] ?? [], assumptions))
    .sort((left, right) => Math.abs(right.impactPoints) - Math.abs(left.impactPoints))
  const equityBridge = buildEquityBridge(projection, assumptionOverrides.netDebtToEvPct, listingStatus)
  return {
    id,
    name,
    baselineValueIndex: 100,
    scenarioValueIndex: round(projection.scenarioValueIndex),
    valueChangePct: round(projection.scenarioValueIndex - 100),
    driverContributions: contributions.map(item => ({ ...item, valueIndexPoints: round(item.valueIndexPoints) })),
    paths: paths.map(path => ({ ...path, impactPoints: round(path.impactPoints) })),
    assumptions: {
      baseGrowthPct: round(assumptions.baseGrowthPct),
      fcffMarginPct: round(assumptions.fcffMarginPct),
      capexToRevenuePct: round(assumptions.capexToRevenuePct),
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
      interpretation: 'normalized mature-state profile; not current reported profitability',
    },
    valuation: {
      basis: MODEL_ASSUMPTIONS.valuationBasis,
      normalizedStartingRevenue: MODEL_ASSUMPTIONS.normalizedStartingRevenue,
      horizonMonths: MODEL_ASSUMPTIONS.horizonMonths,
      baselineEnterpriseValueUnits: round(projection.baselineEnterpriseValue),
      scenarioEnterpriseValueUnits: round(projection.scenarioEnterpriseValue),
      enterpriseValueRatio: round(projection.scenarioEnterpriseValue / projection.baselineEnterpriseValue, 6),
      ...equityBridge,
      baselineFcff: projection.baseline.map(item => round(item.fcff)),
      scenarioFcff: projection.scenario.map(item => round(item.fcff)),
      scenarioDiscountRatesPct: projection.scenario.map(item => round(item.discountRate * 100)),
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

export function evaluateScenario(unvalidatedRequest) {
  const request = validateScenarioRequest(unvalidatedRequest)
  const definition = scenarioById.get(request.scenarioId)
  const drivers = normalizedDriverInputs(definition, request.inputs)
  const selectedDriverIds = drivers.map(item => item.driverId)
  const pathsByDriver = Object.fromEntries(drivers.map(item => [item.driverId, buildDriverPaths(item.driverId, item.normalizedShock, request.durationMonths)]))

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

  const companies = COMPANIES.map(company => {
    const override = request.companyOverrides[company.companyId] ?? {}
    const exposureMultipliers = { ...company.driverExposureMultipliers, ...(override.exposures ?? {}) }
    const entity = buildEntityResult({
      id: company.companyId,
      name: company.name,
      listingStatus: company.listingStatus,
      segmentWeights: company.segmentWeights,
      exposureScale: override.scenarioExposureScale ?? company.scenarioExposureScale,
      exposureMultipliers,
      assumptionOverrides: override.assumptions ?? {},
      request,
      selectedDriverIds,
      pathsByDriver,
    })
    return {
      companyId: company.companyId,
      symbol: company.symbol,
      name: company.name,
      listingStatus: company.listingStatus,
      primarySegmentId: company.primarySegmentId,
      segmentIds: company.segmentIds,
      segmentWeights: company.segmentWeights,
      isBig7: company.isBig7,
      ...entity,
    }
  })

  const big7Members = BIG7_COMPANY_IDS.map(companyId => companies.find(company => company.companyId === companyId))
  const big7ValueIndex = sum(big7Members.map(company => company.scenarioValueIndex)) / big7Members.length
  const universeValueIndex = sum(companies.map(company => company.scenarioValueIndex)) / companies.length
  const allEntityIndices = [...segments, ...companies].map(item => item.scenarioValueIndex)
  const allDriverShocksZero = drivers.every(item => Math.abs(item.normalizedShock) < 1e-12)
  const baselineFcffPositive = companies.every(company => company.valuation.baselineFcff.every(value => value > 0))
  const membershipCount = sum(COMPANIES.map(company => company.segmentIds.length))
  const longestPathLagMonths = Math.max(0, ...Object.values(pathsByDriver).flat().map(path => path.lagMonths))
  const latestShockEndMonth = longestPathLagMonths + request.durationMonths + MODEL_ASSUMPTIONS.shockFadeMonths

  return {
    model: {
      id: MODEL_ASSUMPTIONS.modelId,
      version: MODEL_ASSUMPTIONS.modelVersion,
      valuationBasis: MODEL_ASSUMPTIONS.valuationBasis,
      forecastYears: MODEL_ASSUMPTIONS.forecastYears,
      horizonMonths: MODEL_ASSUMPTIONS.horizonMonths,
      actualCompanyFinancialsUsed: false,
      currentPricesUsed: false,
      terminalShockApplied: false,
      terminalValueNormalizedToBaseline: true,
      assumptionSource: MODEL_ASSUMPTIONS.assumptionSource,
      baselineInterpretation: 'normalized mature-state profile; not current reported profitability',
      pathAttributionMethod: MODEL_ASSUMPTIONS.pathAttributionMethod,
      unmodeledMitigants: MODEL_ASSUMPTIONS.unmodeledMitigants,
      limitation: MODEL_ASSUMPTIONS.limitation,
    },
    scenario: {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      durationMonths: request.durationMonths,
      fadeMonths: MODEL_ASSUMPTIONS.shockFadeMonths,
      inputValues: request.inputs,
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
      baselineValueIndex: 100,
      scenarioValueIndex: round(big7ValueIndex),
      valueChangePct: round(big7ValueIndex - 100),
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
      baselineValueIndex: 100,
      scenarioValueIndex: round(universeValueIndex),
      valueChangePct: round(universeValueIndex - 100),
    },
    checks: {
      zeroShockIdentity: !allDriverShocksZero || allEntityIndices.every(value => Math.abs(value - 100) < 1e-9) && Math.abs(big7ValueIndex - 100) < 1e-9,
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
      '회사별 기준 재무, 사업 노출도와 전파계수는 역할별 설명용 가정이며 실제 기업 수치로 보정되지 않았습니다.',
      '비상장 AI 모델 기업의 양(+) FCFF는 현재 흑자를 뜻하지 않고 정상상태 가정에 불과합니다.',
      'SEG 지수는 독립 프로필 결과이며 서로 더해 전체 기업가치를 만들 수 없습니다.',
      '경로별 impactPoints는 모델 내 driver 기여를 신호 크기로 배분한 설명값이며 개별 경로의 인과 추정치가 아닙니다.',
      '상장사 관측시가 환산은 같은 평가시점의 순차입금/EV 가정을 사용한 equityValueRatio가 준비된 경우에만 가능합니다.',
      '비상장사는 관측 가능한 거래소 시가가 없어 가격 환산 대상이 아닙니다.',
    ],
  }
}
