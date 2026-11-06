// The scenario chapter deliberately uses normalized, illustrative operating profiles.
// None of the values below are reported company financials, consensus estimates or prices.

export const DRIVER_LABELS = Object.freeze({
  interestRate: '금리',
  hyperscalerCapex: 'CAPEX 변화',
  hbmPrice: 'HBM 가격',
  hbmSupply: 'HBM 공급',
  gpuRent: 'GPU 임대료',
  dcRent: '데이터센터 임대료',
  modelGrowth: 'AI 모델 매출 성장률',
})

export const ASSUMPTION_LIMITS = Object.freeze({
  baseGrowthPct: Object.freeze([-5, 30]),
  fcffMarginPct: Object.freeze([1, 45]),
  capexToRevenuePct: Object.freeze([1, 40]),
  discountRatePct: Object.freeze([4, 25]),
  terminalGrowthPct: Object.freeze([-1, 5]),
  volumePassThrough: Object.freeze([0, 2]),
  aspPassThrough: Object.freeze([0, 2]),
  unitCostPassThrough: Object.freeze([0, 2]),
  capexPassThrough: Object.freeze([0, 2]),
  rateDiscountPassThrough: Object.freeze([0, 1]),
  netDebtToEvPct: Object.freeze([-50, 90]),
})

export const MODEL_ASSUMPTIONS = Object.freeze({
  modelId: 'financial-actuals-value-chain-v3',
  modelVersion: 3,
  valuationBasis: 'monthly-dcf-with-incremental-operating-cashflows',
  asOfDate: '2026-11-05',
  calibrationStatus: '연결 재무비율·전사 CAPEX 회귀 반영, AI 거래 노출도·시차 C등급',
  normalizedStartingRevenue: 100,
  forecastYears: 8,
  horizonMonths: 96,
  shockFadeMonths: 12,
  rateDirectDemandPerPctPoint: 1,
  maxPropagationHops: 8,
  durationMonths: Object.freeze({ min: 6, max: 36, step: 6, defaultValue: 12 }),
  driverLabels: DRIVER_LABELS,
  assumptionLimits: ASSUMPTION_LIMITS,
  assumptionSource: 'illustrative-role-assumption',
  aggregation: Object.freeze({
    companies: 'one consolidated result per company',
    segments: 'standalone segment profiles; segment indices are not additive',
    big7: 'equal-weighted normalized company indices; not market-cap weighted',
  }),
  pathAttributionMethod: 'Sequential DCF repricing: direct paths first, then supply-chain paths in catalog order; interactions assigned to the path added',
  unmodeledMitigants: Object.freeze([
    '재고 버퍼, 장기계약 가격전가, 대체 공급처와 회사별 병목 용량은 실증 입력이 없어 별도 계수화하지 않았습니다.',
    '전파계수와 시차는 설명용 비례 가정이며 실제 고객·공급자 계약 또는 거래관계를 뜻하지 않습니다.',
  ]),
  limitation: '재무자료가 있는 기업은 연간 실적을 출발점으로 계산합니다. 미래 성장, 할인율과 전파 민감도에는 가정이 포함됩니다.',
})

const segment = (id, name, description, assumptions) => Object.freeze({
  id,
  name,
  description,
  illustrativeAssumptions: Object.freeze({
    ...assumptions,
    source: MODEL_ASSUMPTIONS.assumptionSource,
  }),
})

export const SEGMENTS = Object.freeze([
  segment('SEG1', '반도체 소부장', '반도체 소재·부품·전공정 및 후공정 장비', {
    baseGrowthPct: 8, fcffMarginPct: 14, discountRatePct: 9.0, terminalGrowthPct: 3.0,
    capexToRevenuePct: 9, volumePassThrough: 0.55, aspPassThrough: 0.35,
    unitCostPassThrough: 0.10, capexPassThrough: 0.50, rateDiscountPassThrough: 0.35,
  }),
  segment('SEG2', '파운드리·패키징', '반도체 위탁생산·첨단 패키징·테스트', {
    baseGrowthPct: 9, fcffMarginPct: 18, discountRatePct: 8.5, terminalGrowthPct: 3.0,
    capexToRevenuePct: 18, volumePassThrough: 0.45, aspPassThrough: 0.35,
    unitCostPassThrough: 0.10, capexPassThrough: 0.75, rateDiscountPassThrough: 0.35,
  }),
  segment('SEG3', '메모리', 'HBM·DRAM·NAND·메모리 모듈과 SSD', {
    baseGrowthPct: 8, fcffMarginPct: 16, discountRatePct: 9.0, terminalGrowthPct: 3.0,
    capexToRevenuePct: 16, volumePassThrough: 0.60, aspPassThrough: 0.55,
    unitCostPassThrough: 0.18, capexPassThrough: 0.80, rateDiscountPassThrough: 0.40,
  }),
  segment('SEG4', 'AI 칩', 'GPU·NPU·AI ASIC·반도체 IP와 설계', {
    baseGrowthPct: 12, fcffMarginPct: 24, discountRatePct: 10.0, terminalGrowthPct: 3.0,
    capexToRevenuePct: 7, volumePassThrough: 0.65, aspPassThrough: 0.45,
    unitCostPassThrough: 0.15, capexPassThrough: 0.45, rateDiscountPassThrough: 0.45,
  }),
  segment('SEG5', 'AI 장비', 'AI 서버·스토리지·네트워크·광통신 장비', {
    baseGrowthPct: 10, fcffMarginPct: 14, discountRatePct: 9.5, terminalGrowthPct: 3.0,
    capexToRevenuePct: 5, volumePassThrough: 0.55, aspPassThrough: 0.40,
    unitCostPassThrough: 0.12, capexPassThrough: 0.40, rateDiscountPassThrough: 0.40,
  }),
  segment('SEG6', '전력·냉각', '데이터센터 전력 공급·배전·UPS·냉각', {
    baseGrowthPct: 9, fcffMarginPct: 12, discountRatePct: 8.5, terminalGrowthPct: 2.8,
    capexToRevenuePct: 6, volumePassThrough: 0.50, aspPassThrough: 0.40,
    unitCostPassThrough: 0.10, capexPassThrough: 0.50, rateDiscountPassThrough: 0.35,
  }),
  segment('SEG7', '데이터센터', '물리 데이터센터 소유·임대·운영·개발', {
    baseGrowthPct: 7, fcffMarginPct: 14, discountRatePct: 8.0, terminalGrowthPct: 2.5,
    capexToRevenuePct: 22, volumePassThrough: 0.35, aspPassThrough: 0.45,
    unitCostPassThrough: 0.08, capexPassThrough: 1.00, rateDiscountPassThrough: 0.55,
  }),
  segment('SEG8', '클라우드·GPU 컴퓨팅', 'GPU 클라우드·IaaS·PaaS·HPC 서비스', {
    baseGrowthPct: 10, fcffMarginPct: 20, discountRatePct: 9.0, terminalGrowthPct: 3.0,
    capexToRevenuePct: 20, volumePassThrough: 0.45, aspPassThrough: 0.45,
    unitCostPassThrough: 0.12, capexPassThrough: 1.00, rateDiscountPassThrough: 0.45,
  }),
  segment('SEG9', 'AI 모델', '기반·멀티모달·영상·음성·도메인 모델 개발', {
    baseGrowthPct: 14, fcffMarginPct: 12, discountRatePct: 10.5, terminalGrowthPct: 3.0,
    capexToRevenuePct: 12, volumePassThrough: 0.60, aspPassThrough: 0.50,
    unitCostPassThrough: 0.10, capexPassThrough: 0.60, rateDiscountPassThrough: 0.50,
  }),
])

const control = (id, driverId, label, unit, min, max, step, defaultValue = 0, role = 'scenario') => Object.freeze({
  id, driverId, label, unit, min, max, step, defaultValue, role,
})

const preset = (label, inputs) => Object.freeze({ label, inputs: Object.freeze(inputs) })

export const SCENARIO_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'interest_rate',
    name: '금리 변화',
    description: '금리 변화의 직접효과와 빅테크 AI 설비투자를 거쳐 기업에 전달되는 효과를 함께 봅니다.',
    controls: Object.freeze([
      control('rateChangePctPoints', 'interestRate', '금리 변화', '%p', -2, 3, 0.25),
      control('rateCapexSensitivity', 'hyperscalerCapex', '금리 +1%p당 AI CAPEX 감소율', '%', 0, 10, 0.5, 5, 'assumption'),
    ]),
    presets: Object.freeze({
      downside: preset('금리 상승', { rateChangePctPoints: 1.5 }),
      neutral: preset('변화 없음', { rateChangePctPoints: 0 }),
      upside: preset('금리 하락', { rateChangePctPoints: -1.0 }),
    }),
  }),
  Object.freeze({
    id: 'hyperscaler_capex',
    name: 'CAPEX 변화',
    description: 'MS·아마존·알파벳·메타의 AI 투자 예산을 조정해 네 회사의 투자 지출과 공급사 주문이 어떻게 달라지는지 봅니다.',
    controls: Object.freeze([
      control('capexChangePct', 'hyperscalerCapex', '기준 CAPEX 예산 대비 변화', '%', -40, 40, 5),
    ]),
    presets: Object.freeze({
      downside: preset('투자 축소', { capexChangePct: -20 }),
      neutral: preset('변화 없음', { capexChangePct: 0 }),
      upside: preset('투자 확대', { capexChangePct: 20 }),
    }),
  }),
  Object.freeze({
    id: 'hbm_market',
    name: 'HBM 가격·공급',
    description: 'HBM 가격과 공급량을 분리해 메모리 수익과 하류 공급 제약을 함께 봅니다.',
    controls: Object.freeze([
      control('hbmPriceChangePct', 'hbmPrice', 'HBM 가격 변화', '%', -40, 40, 5),
      control('hbmSupplyChangePct', 'hbmSupply', 'HBM 공급 변화', '%', -40, 40, 5),
    ]),
    presets: Object.freeze({
      downside: preset('가격·공급 동반 하락', { hbmPriceChangePct: -20, hbmSupplyChangePct: -15 }),
      neutral: preset('변화 없음', { hbmPriceChangePct: 0, hbmSupplyChangePct: 0 }),
      upside: preset('가격·공급 동반 상승', { hbmPriceChangePct: 15, hbmSupplyChangePct: 15 }),
    }),
  }),
  Object.freeze({
    id: 'gpu_dc_rent',
    name: 'GPU·데이터센터 임대료',
    description: 'GPU 컴퓨팅과 데이터센터 임대료를 분리해 공급자 가격 효과와 고객 비용 효과를 봅니다.',
    controls: Object.freeze([
      control('gpuRentChangePct', 'gpuRent', 'GPU 임대료 변화', '%', -40, 40, 5),
      control('dcRentChangePct', 'dcRent', '데이터센터 임대료 변화', '%', -40, 40, 5),
    ]),
    presets: Object.freeze({
      downside: preset('임대료 하락', { gpuRentChangePct: -20, dcRentChangePct: -15 }),
      neutral: preset('변화 없음', { gpuRentChangePct: 0, dcRentChangePct: 0 }),
      upside: preset('임대료 상승', { gpuRentChangePct: 20, dcRentChangePct: 15 }),
    }),
  }),
  Object.freeze({
    id: 'model_growth',
    name: '모델매출 성장률 변화',
    description: '기준 성장률과 시나리오 성장률의 상대 매출 변화가 클라우드·데이터센터·장비·반도체로 전달되는 경로를 봅니다.',
    controls: Object.freeze([
      control('modelBaselineGrowthPct', 'modelGrowth', '기준 모델매출 성장률', '%', -50, 150, 5, 50, 'baseline'),
      control('modelTargetGrowthPct', 'modelGrowth', '시나리오 모델매출 성장률', '%', -50, 150, 5, 50, 'scenario'),
    ]),
    presets: Object.freeze({
      downside: preset('성장 둔화', { modelBaselineGrowthPct: 50, modelTargetGrowthPct: 20 }),
      neutral: preset('기준 유지', { modelBaselineGrowthPct: 50, modelTargetGrowthPct: 50 }),
      upside: preset('성장 확대', { modelBaselineGrowthPct: 50, modelTargetGrowthPct: 80 }),
    }),
  }),
])

const seed = (segmentId, primitive, weight, { applyToSeed = true, propagate = true, lagMonths = 0 } = {}) => Object.freeze({
  segmentId, primitive, weight, applyToSeed, propagate, lagMonths,
})

export const DRIVER_DEFINITIONS = Object.freeze({
  interestRate: Object.freeze({
    id: 'interestRate', label: DRIVER_LABELS.interestRate, controlIds: Object.freeze(['rateChangePctPoints']),
    seeds: Object.freeze([
      ['SEG1', 0.30], ['SEG2', 0.40], ['SEG3', 0.35], ['SEG4', 0.40], ['SEG5', 0.45],
      ['SEG6', 0.55], ['SEG7', 0.90], ['SEG8', 0.65], ['SEG9', 0.50],
    ].map(([segmentId, weight]) => seed(segmentId, 'revenueVolume', weight, { propagate: false }))),
  }),
  hyperscalerCapex: Object.freeze({
    id: 'hyperscalerCapex', label: DRIVER_LABELS.hyperscalerCapex, controlIds: Object.freeze(['capexChangePct']),
    seeds: Object.freeze([
      seed('SEG8', 'capexCashout', 1.00, { propagate: false }),
      seed('SEG8', 'revenueVolume', 0.35, { propagate: false, lagMonths: 12 }),
      seed('SEG8', 'revenueVolume', 1.00, { applyToSeed: false }),
    ]),
  }),
  hbmPrice: Object.freeze({
    id: 'hbmPrice', label: DRIVER_LABELS.hbmPrice, controlIds: Object.freeze(['hbmPriceChangePct']),
    seeds: Object.freeze([
      seed('SEG3', 'asp', 0.90, { propagate: false }),
      seed('SEG3', 'unitCost', 0.90, { applyToSeed: false }),
      seed('SEG3', 'revenueVolume', 0.25, { applyToSeed: false }),
    ]),
  }),
  hbmSupply: Object.freeze({
    id: 'hbmSupply', label: DRIVER_LABELS.hbmSupply, controlIds: Object.freeze(['hbmSupplyChangePct']),
    seeds: Object.freeze([seed('SEG3', 'revenueVolume', 0.85)]),
  }),
  gpuRent: Object.freeze({
    id: 'gpuRent', label: DRIVER_LABELS.gpuRent, controlIds: Object.freeze(['gpuRentChangePct']),
    seeds: Object.freeze([
      seed('SEG8', 'asp', 0.75, { propagate: false }),
      seed('SEG8', 'unitCost', 0.75, { applyToSeed: false }),
      seed('SEG8', 'revenueVolume', 0.35, { applyToSeed: false }),
    ]),
  }),
  dcRent: Object.freeze({
    id: 'dcRent', label: DRIVER_LABELS.dcRent, controlIds: Object.freeze(['dcRentChangePct']),
    seeds: Object.freeze([
      seed('SEG7', 'asp', 0.75, { propagate: false }),
      seed('SEG7', 'unitCost', 0.75, { applyToSeed: false }),
      seed('SEG7', 'revenueVolume', 0.35, { applyToSeed: false }),
    ]),
  }),
  modelGrowth: Object.freeze({
    id: 'modelGrowth', label: DRIVER_LABELS.modelGrowth,
    controlIds: Object.freeze(['modelBaselineGrowthPct', 'modelTargetGrowthPct']),
    seeds: Object.freeze([seed('SEG9', 'revenueVolume', 0.90)]),
  }),
})

const edge = (drivers, from, to, weight, lagMonths, channel, { primitive = null, toPrimitive = null } = {}) => Object.freeze({
  drivers: Object.freeze(drivers), from, to, weight, lagMonths, channel, primitive, toPrimitive,
})

export const PROPAGATION_EDGES = Object.freeze([
  edge(['modelGrowth'], 'SEG9', 'SEG8', 0.65, 6, '모델 매출 성장에서 컴퓨팅 수요'),
  edge(['hyperscalerCapex'], 'SEG8', 'SEG9', 0.25, 12, '컴퓨팅 투자에서 모델 공급 여력', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent'], 'SEG8', 'SEG7', 0.45, 6, '컴퓨팅 수요에서 데이터센터 용량', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent'], 'SEG8', 'SEG5', 0.55, 6, '컴퓨팅 수요에서 서버·네트워크 장비', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent', 'dcRent'], 'SEG7', 'SEG6', 0.55, 6, '데이터센터 용량에서 전력·냉각', { primitive: 'revenueVolume' }),
  edge(['dcRent'], 'SEG7', 'SEG5', 0.30, 6, '데이터센터 임대 신호에서 설비투자', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent', 'dcRent'], 'SEG5', 'SEG4', 0.55, 6, '장비 수요에서 AI 칩 수요', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent', 'dcRent'], 'SEG4', 'SEG3', 0.50, 6, 'AI 칩 수요에서 메모리 수요', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent', 'dcRent'], 'SEG4', 'SEG2', 0.45, 6, 'AI 칩 수요에서 생산·패키징 수요', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent', 'dcRent'], 'SEG3', 'SEG1', 0.35, 6, '메모리 수요에서 소부장 수요', { primitive: 'revenueVolume' }),
  edge(['hyperscalerCapex', 'modelGrowth', 'gpuRent', 'dcRent'], 'SEG2', 'SEG1', 0.40, 6, '생산 수요에서 소부장 수요', { primitive: 'revenueVolume' }),

  edge(['hbmPrice'], 'SEG3', 'SEG4', 0.35, 6, 'HBM 가격에서 AI 칩 단위원가', { primitive: 'unitCost' }),
  edge(['hbmPrice'], 'SEG4', 'SEG5', 0.45, 6, 'AI 칩 원가에서 장비 단위원가', { primitive: 'unitCost' }),
  edge(['hbmPrice'], 'SEG5', 'SEG8', 0.50, 6, '장비 원가에서 컴퓨팅 단위원가', { primitive: 'unitCost' }),
  edge(['hbmPrice'], 'SEG8', 'SEG9', 0.40, 6, '컴퓨팅 원가에서 모델 단위원가', { primitive: 'unitCost' }),
  edge(['hbmPrice'], 'SEG8', 'SEG7', -0.15, 12, '컴퓨팅 원가에서 데이터센터 수요', { primitive: 'unitCost', toPrimitive: 'revenueVolume' }),
  edge(['hbmPrice'], 'SEG7', 'SEG6', 0.40, 6, '데이터센터 수요에서 전력·냉각', { primitive: 'revenueVolume' }),
  edge(['hbmPrice'], 'SEG3', 'SEG2', 0.15, 12, 'HBM 수익성에서 패키징 투자', { primitive: 'revenueVolume' }),
  edge(['hbmPrice'], 'SEG2', 'SEG1', 0.40, 6, '패키징 투자에서 소부장 수요', { primitive: 'revenueVolume' }),

  edge(['hbmSupply'], 'SEG3', 'SEG4', 0.55, 6, 'HBM 공급에서 AI 칩 출하', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG3', 'SEG2', 0.35, 6, 'HBM 공급에서 패키징 물량', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG3', 'SEG1', 0.20, 12, 'HBM 공급에서 소부장 수요', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG2', 'SEG1', 0.40, 6, '패키징 물량에서 소부장 수요', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG4', 'SEG5', 0.50, 6, 'AI 칩 출하에서 장비 공급', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG5', 'SEG8', 0.45, 6, '장비 공급에서 컴퓨팅 용량', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG8', 'SEG9', 0.35, 6, '컴퓨팅 용량에서 모델 공급', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG8', 'SEG7', 0.25, 6, '컴퓨팅 용량에서 데이터센터 수요', { primitive: 'revenueVolume' }),
  edge(['hbmSupply'], 'SEG7', 'SEG6', 0.40, 6, '데이터센터 수요에서 전력·냉각', { primitive: 'revenueVolume' }),

  edge(['gpuRent'], 'SEG8', 'SEG9', 0.45, 6, 'GPU 임대료에서 모델 단위원가', { primitive: 'unitCost' }),
  edge(['dcRent'], 'SEG7', 'SEG8', 0.35, 6, '데이터센터 임대료에서 클라우드 단위원가', { primitive: 'unitCost' }),
  edge(['dcRent'], 'SEG8', 'SEG9', 0.55, 6, '클라우드 원가에서 모델 단위원가', { primitive: 'unitCost' }),
])

export const BIG7_COMPANY_IDS = Object.freeze(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'])
export const HYPERSCALER_CAPEX_OWNER_IDS = Object.freeze(['MSFT', 'AMZN', 'GOOGL', 'META'])

const company = ({ companyId, symbol = companyId, name, listingStatus = 'listed', primarySegmentId,
  segmentWeights = { [primarySegmentId]: 1 }, scenarioExposureScale = 1, driverExposureMultipliers = {} }) => {
  const weights = Object.freeze({ ...segmentWeights })
  return Object.freeze({
    companyId,
    symbol: listingStatus === 'private' ? null : symbol,
    name,
    listingStatus,
    primarySegmentId,
    segmentIds: Object.freeze(Object.keys(weights)),
    segmentWeights: weights,
    isBig7: BIG7_COMPANY_IDS.includes(companyId),
    scenarioExposureScale,
    nonScenarioSharePct: (1 - scenarioExposureScale) * 100,
    driverExposureMultipliers: Object.freeze({ ...driverExposureMultipliers }),
    exposureSource: MODEL_ASSUMPTIONS.assumptionSource,
  })
}

export const COMPANIES = Object.freeze([
  company({ companyId: 'ASML', name: 'ASML', primarySegmentId: 'SEG1', scenarioExposureScale: 0.75 }),
  company({ companyId: 'AMAT', name: '어플라이드 머티어리얼즈', primarySegmentId: 'SEG1', scenarioExposureScale: 0.75 }),
  company({ companyId: 'LRCX', name: '램리서치', primarySegmentId: 'SEG1', scenarioExposureScale: 0.75 }),
  company({ companyId: 'KLAC', name: 'KLA', primarySegmentId: 'SEG1', scenarioExposureScale: 0.75 }),
  company({ companyId: '042700.KS', name: '한미반도체', primarySegmentId: 'SEG1', scenarioExposureScale: 1.00 }),

  company({ companyId: 'TSM', name: 'TSMC ADR', primarySegmentId: 'SEG2', scenarioExposureScale: 0.85 }),
  company({ companyId: '005930.KS', name: '삼성전자', primarySegmentId: 'SEG2', segmentWeights: { SEG2: 0.50, SEG3: 0.50 }, scenarioExposureScale: 0.50, driverExposureMultipliers: { hbmPrice: 0.50, hbmSupply: 0.50 } }),
  company({ companyId: 'INTC', name: '인텔', primarySegmentId: 'SEG2', scenarioExposureScale: 0.55 }),
  company({ companyId: 'ASX', name: 'ASE 테크놀로지 ADR', primarySegmentId: 'SEG2', scenarioExposureScale: 0.75 }),
  company({ companyId: 'AMKR', name: '앰코테크놀로지', primarySegmentId: 'SEG2', scenarioExposureScale: 0.75 }),

  company({ companyId: '000660.KS', name: 'SK하이닉스', primarySegmentId: 'SEG3', scenarioExposureScale: 0.95 }),
  company({ companyId: 'MU', name: '마이크론', primarySegmentId: 'SEG3', scenarioExposureScale: 0.90 }),
  company({ companyId: '285A.T', name: '키옥시아 홀딩스', primarySegmentId: 'SEG3', scenarioExposureScale: 0.55, driverExposureMultipliers: { hbmPrice: 0, hbmSupply: 0 } }),

  company({ companyId: 'NVDA', name: '엔비디아', primarySegmentId: 'SEG4', segmentWeights: { SEG4: 0.80, SEG5: 0.20 }, scenarioExposureScale: 0.90 }),
  company({ companyId: 'AAPL', name: '애플', primarySegmentId: 'SEG4', segmentWeights: { SEG4: 0.60, SEG9: 0.40 }, scenarioExposureScale: 0.25 }),
  company({ companyId: 'AMD', name: 'AMD', primarySegmentId: 'SEG4', scenarioExposureScale: 0.70 }),
  company({ companyId: 'AVGO', name: '브로드컴', primarySegmentId: 'SEG4', scenarioExposureScale: 0.55 }),

  company({ companyId: 'ANET', name: '아리스타 네트웍스', primarySegmentId: 'SEG5', scenarioExposureScale: 0.75 }),
  company({ companyId: 'DELL', name: '델 테크놀로지스', primarySegmentId: 'SEG5', scenarioExposureScale: 0.50 }),
  company({ companyId: 'SMCI', name: '슈퍼마이크로', primarySegmentId: 'SEG5', scenarioExposureScale: 0.90 }),
  company({ companyId: '2382.TW', name: '퀀타 컴퓨터', primarySegmentId: 'SEG5', scenarioExposureScale: 0.55 }),
  company({ companyId: 'HPE', name: '휴렛팩커드 엔터프라이즈', primarySegmentId: 'SEG5', scenarioExposureScale: 0.50 }),

  company({ companyId: 'VRT', name: '버티브', primarySegmentId: 'SEG6', scenarioExposureScale: 0.90 }),
  company({ companyId: 'ETN', name: '이튼', primarySegmentId: 'SEG6', scenarioExposureScale: 0.45 }),
  company({ companyId: 'SU.PA', name: '슈나이더 일렉트릭', primarySegmentId: 'SEG6', scenarioExposureScale: 0.45 }),
  company({ companyId: 'GEV', name: 'GE 버노바', primarySegmentId: 'SEG6', scenarioExposureScale: 0.45 }),
  company({ companyId: '267260.KS', name: 'HD현대일렉트릭', primarySegmentId: 'SEG6', scenarioExposureScale: 0.55 }),

  company({ companyId: 'EQIX', name: '에퀴닉스', primarySegmentId: 'SEG7', scenarioExposureScale: 0.90 }),
  company({ companyId: 'DLR', name: '디지털 리얼티', primarySegmentId: 'SEG7', scenarioExposureScale: 0.90 }),
  company({ companyId: 'IRM', name: '아이언마운틴', primarySegmentId: 'SEG7', scenarioExposureScale: 0.55 }),
  company({ companyId: 'AJBU.SI', name: '케펠 DC 리츠', primarySegmentId: 'SEG7', scenarioExposureScale: 0.95 }),

  company({ companyId: 'MSFT', name: '마이크로소프트', primarySegmentId: 'SEG8', segmentWeights: { SEG8: 0.70, SEG9: 0.30 }, scenarioExposureScale: 0.50 }),
  company({ companyId: 'AMZN', name: '아마존', primarySegmentId: 'SEG8', segmentWeights: { SEG8: 0.80, SEG7: 0.20 }, scenarioExposureScale: 0.45 }),
  company({ companyId: 'GOOGL', name: '알파벳', primarySegmentId: 'SEG8', segmentWeights: { SEG8: 0.60, SEG9: 0.40 }, scenarioExposureScale: 0.45 }),
  company({ companyId: 'ORCL', name: '오라클', primarySegmentId: 'SEG8', scenarioExposureScale: 0.55 }),
  company({ companyId: 'CRWV', name: '코어위브', primarySegmentId: 'SEG8', scenarioExposureScale: 0.95 }),

  company({ companyId: 'META', name: '메타', primarySegmentId: 'SEG9', segmentWeights: { SEG9: 0.80, SEG8: 0.20 }, scenarioExposureScale: 0.35 }),
  company({ companyId: 'TSLA', name: '테슬라', primarySegmentId: 'SEG9', segmentWeights: { SEG9: 0.60, SEG4: 0.40 }, scenarioExposureScale: 0.25 }),
  company({ companyId: 'OPENAI', name: 'OpenAI', listingStatus: 'private', primarySegmentId: 'SEG9', scenarioExposureScale: 1.00 }),
  company({ companyId: 'ANTHROPIC', name: 'Anthropic', listingStatus: 'private', primarySegmentId: 'SEG9', scenarioExposureScale: 1.00 }),
  company({ companyId: 'DEEPSEEK', name: 'DeepSeek', listingStatus: 'private', primarySegmentId: 'SEG9', scenarioExposureScale: 1.00 }),
])
