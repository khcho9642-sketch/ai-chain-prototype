import { BIG7_COMPANY_IDS, MODEL_ASSUMPTIONS, PROPAGATION_EDGES, SEGMENTS } from './scenario-data.js'

export const VIEW_MODEL_GRADE = 'C'
export const VIEW_MODEL_METHOD = '경로 기여도 비례배분'
export const VIEW_MODEL_NOTE = '직접·전파 값은 엔진의 가치지수 변화를 경로 신호에 비례 배분한 화면용 설명값이며 실제 현금흐름 또는 인과효과의 분해가 아닙니다.'
const RATE_METHOD = '동일 기준 EV에서 금리만 반영한 값과 CAPEX 경유를 더한 값의 차이'
const RATE_NOTE = '직접효과는 금리만 바꾼 EV의 변화율이고, 전파효과는 같은 기준 EV에서 빅테크 AI CAPEX 경로를 추가했을 때의 변화분입니다. 개별 공급망 경로 간 배분은 C등급 가정입니다.'
export const MAX_RECONCILIATION_RESIDUAL_PCT = 0.001

export const REPRESENTATIVE_COMPANIES = Object.freeze([
  Object.freeze({ segmentId: 'SEG1', companyId: 'ASML' }),
  Object.freeze({ segmentId: 'SEG2', companyId: 'TSM' }),
  Object.freeze({ segmentId: 'SEG3', companyId: '000660.KS' }),
  Object.freeze({ segmentId: 'SEG4', companyId: 'NVDA' }),
  Object.freeze({ segmentId: 'SEG5', companyId: 'SMCI' }),
  Object.freeze({ segmentId: 'SEG6', companyId: 'VRT' }),
  Object.freeze({ segmentId: 'SEG7', companyId: 'EQIX' }),
  Object.freeze({ segmentId: 'SEG8', companyId: 'MSFT' }),
  Object.freeze({ segmentId: 'SEG9', companyId: 'META' }),
])

export const REPRESENTATIVE_COMPANY_IDS = Object.freeze(REPRESENTATIVE_COMPANIES.map(item => item.companyId))

const segmentNames = new Map(SEGMENTS.map(item => [item.id, item.name]))
const round = (value, digits = 4) => Number(value.toFixed(digits))
const sum = values => values.reduce((total, value) => total + value, 0)
const finite = value => typeof value === 'number' && Number.isFinite(value)

function pathImpact(path) {
  return finite(path?.impactPoints) ? path.impactPoints : null
}

export function describePath(path) {
  if (!path || !Array.isArray(path.segments) || !path.segments.length) return null
  const labels = path.segments.map(id => `${id} ${segmentNames.get(id) ?? '미정의 SEG'}`)
  if (path.mediatedBy === 'interestRate') {
    const lag = finite(path.lagMonths) ? (path.lagMonths === 0 ? ' · 즉시' : ` · ${path.lagMonths}개월 뒤`) : ''
    return `금리 → 빅테크 AI CAPEX → ${labels.join(' → ')}${lag}`
  }
  return path.segments.length === 1 ? `직접: ${labels[0]}` : labels.join(' → ')
}

function coefficientSteps(path) {
  if (!Array.isArray(path.channels) || path.channels.length !== path.segments.length) return []
  const steps = []
  // The seed occupies index 0; each later channel describes the hop arriving at that segment.
  for (let i = 1; i < path.segments.length; i++) {
    const from = path.segments[i - 1]
    const to = path.segments[i]
    const channel = path.channels[i]
    const matching = PROPAGATION_EDGES.filter(edge => edge.from === from && edge.to === to &&
      edge.channel === channel && edge.drivers.includes(path.driverId))
    if (matching.length !== 1) continue
    const { weight, lagMonths } = matching[0]
    steps.push({ from, to, channel, weight, lagMonths, grade: VIEW_MODEL_GRADE, source: '시나리오 모형 전파계수표 (PROPAGATION_EDGES)' })
  }
  return steps
}

function enrichPath(path) {
  return {
    ...path,
    hops: Math.max(0, path.segments.length - 1),
    effectKind: path.mediatedBy === 'interestRate' || path.segments.length > 1 ? 'chain' : 'direct',
    oneLinePath: describePath(path),
    grade: VIEW_MODEL_GRADE,
    source: MODEL_ASSUMPTIONS.assumptionSource,
    coefficient: null,
    coefficientAvailable: false,
    coefficientSteps: coefficientSteps(path),
    coefficientNote: '엔진 결과에 회사별 경로 coefficient가 노출되지 않아 화면에서 수치를 만들지 않습니다.',
  }
}

export function decomposeCompany(company) {
  if (!company || typeof company !== 'object') throw new TypeError('company 결과가 필요합니다.')
  const rate = company.rateAttribution
  const method = rate ? RATE_METHOD : VIEW_MODEL_METHOD
  if (company.valueChangePct === null && company.valuation?.comparisonStatus === 'nonpositive-baseline') {
    return {
      ...company, totalPct: null, directPct: null, chainPct: null, residualPct: null,
      rawDirectPct: null, rawChainPct: null, breakdownAvailable: false,
      reconciliationStatus: 'nonpositive-baseline', grade: VIEW_MODEL_GRADE,
      method, breakdownNote: '기준가치가 0 이하라 변화율을 산정할 수 없습니다.',
      paths: [], topPath: null, oneLinePath: null, maxPropagation: { hops: 0, lagMonths: 0 },
    }
  }
  if (!finite(company.valueChangePct)) throw new TypeError('company.valueChangePct는 유한한 숫자여야 합니다.')
  const totalPct = rate ? company.valueChangePct : round(company.valueChangePct)
  const paths = Array.isArray(company.paths) ? company.paths.filter(path => pathImpact(path) !== null).map(enrichPath) : []
  const chainPaths = paths.filter(path => path.effectKind === 'chain')
  // Rate mediation is an EV counterfactual and remains measurable even if individual path scores cancel.
  const rawDirectPct = rate ? rate.directPct : sum(paths.filter(path => path.effectKind === 'direct').map(path => path.impactPoints))
  const rawChainPct = rate ? rate.chainPct : sum(chainPaths.map(path => path.impactPoints))
  const hasInputs = rate ? finite(rawDirectPct) && finite(rawChainPct) : (paths.length > 0 || Math.abs(totalPct) < 1e-12)
  const rawResidualPct = finite(rawDirectPct) && finite(rawChainPct) ? totalPct - rawDirectPct - rawChainPct : null
  const breakdownAvailable = hasInputs && Math.abs(rawResidualPct) <= MAX_RECONCILIATION_RESIDUAL_PCT

  let directPct = null
  let chainPct = null
  if (breakdownAvailable) {
    chainPct = rate ? rawChainPct : round(rawChainPct)
    directPct = rate ? rawDirectPct : round(totalPct - chainPct)
  }

  const preferredPaths = chainPaths.length ? chainPaths : paths
  const topPath = preferredPaths.length
    ? [...preferredPaths].sort((left, right) => Math.abs(right.impactPoints) - Math.abs(left.impactPoints))[0]
    : null
  const maxHops = paths.length ? Math.max(...paths.map(path => path.hops)) : 0
  const maxLagMonths = paths.length ? Math.max(...paths.map(path => path.lagMonths ?? 0)) : 0

  return {
    ...company,
    totalPct,
    directPct,
    chainPct,
    residualPct: finite(rawResidualPct) ? round(rawResidualPct) : null,
    rawDirectPct: rate ? rawDirectPct : round(rawDirectPct),
    rawChainPct: rate ? rawChainPct : round(rawChainPct),
    breakdownAvailable,
    reconciliationStatus: !hasInputs
      ? (rate ? 'unavailable-rate-attribution' : 'unavailable-no-paths')
      : !breakdownAvailable ? 'unavailable-large-residual' : (rate ? 'reconciled-counterfactual' : 'reconciled-with-rounding'),
    grade: VIEW_MODEL_GRADE,
    method,
    breakdownNote: rate ? RATE_NOTE : VIEW_MODEL_NOTE,
    paths,
    topPath,
    oneLinePath: topPath?.oneLinePath ?? null,
    maxPropagation: { hops: maxHops, lagMonths: maxLagMonths },
  }
}

function average(rows, field) {
  const values = rows.map(row => row[field]).filter(finite)
  return values.length && values.length === rows.length ? round(sum(values) / values.length) : null
}

export function buildScenarioView(result) {
  if (!result || !Array.isArray(result.companies)) throw new TypeError('evaluateScenario 결과가 필요합니다.')
  const companies = result.companies.map(decomposeCompany)
  if (new Set(companies.map(company => company.companyId)).size !== companies.length) throw new TypeError('중복 회사 결과가 있습니다.')
  const byId = new Map(companies.map(company => [company.companyId, company]))
  const missingRepresentativeIds = REPRESENTATIVE_COMPANY_IDS.filter(id => !byId.has(id))
  const representativeRows = REPRESENTATIVE_COMPANIES.map(item => {
    const company = byId.get(item.companyId)
    return company ? { ...company, representativeSegmentId: item.segmentId } : null
  }).filter(Boolean)
  const big7Rows = BIG7_COMPANY_IDS.map(id => byId.get(id)).filter(Boolean)
  const reservedIds = new Set([...REPRESENTATIVE_COMPANY_IDS, ...BIG7_COMPANY_IDS])
  const otherRows = companies.filter(company => !reservedIds.has(company.companyId))
  const declining = companies.filter(company => company.totalPct < 0).sort((left, right) => left.totalPct - right.totalPct)
  const propagated = companies.filter(company => company.breakdownAvailable && finite(company.chainPct) && Math.abs(company.chainPct) > 1e-12)
    .sort((left, right) => Math.abs(right.chainPct) - Math.abs(left.chainPct))

  return {
    scenario: result.scenario,
    model: result.model,
    segments: result.segments,
    companies,
    representativeRows,
    big7Rows,
    otherRows,
    missingRepresentativeIds,
    summary: {
      largestDecline: declining[0] ?? null,
      largestPropagation: propagated[0] ?? null,
      representativeAveragePct: missingRepresentativeIds.length ? null : average(representativeRows, 'totalPct'),
      representativeDirectAveragePct: missingRepresentativeIds.length ? null : average(representativeRows, 'directPct'),
      representativeChainAveragePct: missingRepresentativeIds.length ? null : average(representativeRows, 'chainPct'),
      companyCount: companies.length,
      comparableCompanyCount: companies.filter(company => finite(company.totalPct)).length,
      comparableRepresentativeCount: representativeRows.filter(company => finite(company.totalPct)).length,
      representativeCount: representativeRows.length,
      big7Count: big7Rows.length,
      otherCount: otherRows.length,
    },
    maxPropagation: {
      longestPathLagMonths: result.scenario?.longestPathLagMonths ?? null,
      latestShockEndMonth: result.scenario?.latestShockEndMonth ?? null,
      horizonMonths: result.model?.horizonMonths ?? null,
      withinHorizon: result.checks?.latestShockEndWithinForecastHorizon ?? null,
    },
    grade: VIEW_MODEL_GRADE,
    method: result.scenario?.rateCapexTransmission ? RATE_METHOD : VIEW_MODEL_METHOD,
    note: result.scenario?.rateCapexTransmission ? RATE_NOTE : VIEW_MODEL_NOTE,
  }
}
