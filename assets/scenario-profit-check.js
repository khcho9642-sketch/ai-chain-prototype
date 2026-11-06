import { evaluateCompanyPreview } from './scenario-core.js'
import { DRIVER_DEFINITIONS, SCENARIO_DEFINITIONS } from './scenario-data.js'
import { oneDecimal } from './scenario-format.js'

// An annual operating-profit check at constant units and mix, independent of the
// monthly DCF. The comparison uses the same market-price inputs on both sides.
export function buildProfitCheck(company, request) {
  if (!company || !['hbm_market', 'gpu_dc_rent'].includes(request?.scenarioId)) return null
  const definition = SCENARIO_DEFINITIONS.find(item => item.id === request.scenarioId)
  const prices = definition.controls.filter(control => DRIVER_DEFINITIONS[control.driverId].seeds.some(seed => seed.primitive === 'asp'))
  const inputs = request.inputs
  const id = company.companyId
  const year = company.financialBasis
  const facts = year?.facts
  const income = facts?.operatingIncome
  const sale = [facts?.revenue, facts?.cashFlowBasisRevenue].find(fact => fact?.value > 0 &&
    (!income || fact.accountingStandard === income.accountingStandard))
  const measured = Number.isFinite(income?.value) && sale && year?.scope === 'consolidated'
  const margin = measured ? income.value / sale.value : null
  const a = company.assumptions
  let revenueChangePct = 0
  for (const { id: inputId, driverId } of prices) {
    const shock = inputs[inputId] ?? 0
    if (driverId === 'hbmPrice' && a.hbmPriceMix) {
      revenueChangePct += shock * a.hbmPriceMix.adjustedRevenueShare * a.aspPassThrough
    } else {
      for (const seed of DRIVER_DEFINITIONS[driverId].seeds.filter(seed => seed.primitive === 'asp' && seed.applyToSeed)) {
        const share = (company.segmentWeights[seed.segmentId] ?? 0) * a.scenarioExposureScale
        revenueChangePct += shock * share * seed.weight * (a.driverExposureMultipliers[driverId] ?? 1) * a.aspPassThrough
      }
    }
  }
  revenueChangePct = Math.max(-100, revenueChangePct)
  const mixed = request.scenarioId === 'hbm_market' && Boolean(inputs.hbmSupplyChangePct)
  const dcfEvChangePct = mixed
    ? evaluateCompanyPreview({ ...request, inputs: { ...inputs, hbmSupplyChangePct: 0 } }, [id]).companies[0].valueChangePct
    : company.valueChangePct
  const annualRevenueChange = sale ? sale.value * revenueChangePct / 100 : null
  const annualProfitChange = measured ? annualRevenueChange * margin : null
  // Holding the issuer's positive baseline EV/operating-profit multiple fixed
  // makes the percentage change in EV equal to the percentage change in profit.
  const simpleEvChangePct = measured && income.value > 0 && company.valuation.baselineEnterpriseValueUnits > 0
    ? 100 * annualProfitChange / income.value : null
  const check = { operatingMarginPct: measured ? 100 * margin : null, fiscalYear: year?.fiscalYear, currency: year?.currency,
    revenueFact: sale, operatingIncomeFact: income, revenueChangePct, annualRevenueChange, annualProfitChange,
    simpleEvChangePct, dcfEvChangePct, magnitudeRatio: null }
  if (!prices.some(control => inputs[control.id] != null && inputs[control.id] !== 0)) {
    return { ...check, status: 'no-price-shock', explanation: '판매가격 입력이 0이어서 가격 단독 효과는 0입니다.' }
  }
  if (revenueChangePct === 0) {
    return { ...check, status: 'no-selling-price-path', explanation: '적용한 가격에서 자사 판매가격에 들어오는 순효과는 0입니다. DCF에는 매입 원가와 공급망 주문 경로도 들어가므로 0과의 배수는 산정하지 않습니다.' }
  }
  if (!measured || income.value <= 0) return { ...check, status: 'missing-operating-margin',
    explanation: measured ? '기준 영업이익이 0 이하이므로 고정 영업이익 배수로 EV를 환산할 수 없습니다.' : '동일 결산·회계기준의 연결 매출과 영업이익 자료가 부족합니다.' }
  if (!Number.isFinite(dcfEvChangePct) || simpleEvChangePct === null) return { ...check, status: 'dcf-unavailable',
    explanation: '기준 또는 시나리오 EV를 비교할 수 없어 배수를 산정하지 않습니다.' }
  const smaller = Math.min(Math.abs(simpleEvChangePct), Math.abs(dcfEvChangePct))
  if (smaller > 1e-10) check.magnitudeRatio = Math.max(Math.abs(simpleEvChangePct), Math.abs(dcfEvChangePct)) / smaller
  let explanation = '단순 검산은 최근 연결 영업이익률과 EV/영업이익 배수를 고정합니다. DCF는 같은 가격 입력을 시차·세후 현금흐름·잔존가치에 반영합니다.'
  if (check.magnitudeRatio >= 10 || smaller <= 1e-10 || simpleEvChangePct * dcfEvChangePct < 0) {
    const mature = year.forecast.at(-1)
    const reason = Math.abs(dcfEvChangePct) > Math.abs(simpleEvChangePct)
      ? `단순 검산은 추가 매출에 영업이익률 ${oneDecimal.format(100 * margin)}%를 적용합니다. DCF는 가격 변동분의 세후 ${oneDecimal.format(mature.priceContributionMarginPct)}%를 현금흐름에 반영합니다. 장기 기준 현금흐름률은 매출의 ${oneDecimal.format(mature.fcffMarginPct)}%여서 같은 가격 변화가 기준 EV 대비 크게 나타날 수 있습니다.`
      : '단순 검산은 계약 갱신 후의 연간 영업이익을 같은 배수로 평가합니다. DCF는 실제 반영 시점을 할인하고 해당 기업의 원가·주문 경로를 합산합니다.'
    const scope = company.paths?.some(path => path.primitive !== 'asp' && (path.driverId !== 'hbmSupply'))
      ? ' 이 회사에는 판매가격 이외의 원가 또는 주문 경로도 있습니다.' : ''
    explanation = reason + scope
    if (smaller <= 1e-10) explanation += ' 한쪽 효과가 0이어서 배수 비교를 보류합니다.'
  }
  return { ...check, status: 'available', explanation }
}
