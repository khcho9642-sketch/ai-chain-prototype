const root = document.getElementById('v-scenario')

const STORAGE_KEY = 'ai-chain.scenario.v1'
const STORAGE_VERSION = 3
const DURATION = { min: 6, max: 36, step: 6, defaultValue: 12 }
const EXPECTED_SCENARIOS = ['interest_rate', 'hyperscaler_capex', 'hbm_market', 'gpu_dc_rent', 'model_growth']
const EXPECTED_SEGMENTS = [
  '반도체 소부장', '파운드리·패키징', '메모리', 'AI 칩', 'AI 장비',
  '전력·냉각', '데이터센터', '클라우드·GPU 컴퓨팅', 'AI 모델',
]
const BIG7_ORDER = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']
const ASSUMPTION_FIELD_META = [
  { id: 'baseGrowthPct', label: '전망 매출 성장률', unit: '%', step: 0.5 },
  { id: 'fcffMarginPct', label: '전망 현금흐름 마진', unit: '%', step: 0.5 },
  { id: 'capexToRevenuePct', label: '전망 CAPEX ÷ 매출', unit: '%', step: 0.5 },
  { id: 'discountRatePct', label: '할인율', unit: '%', step: 0.25 },
  { id: 'terminalGrowthPct', label: '영구 성장률', unit: '%', step: 0.25 },
  { id: 'volumePassThrough', label: '물량 전이계수', unit: '×', step: 0.05 },
  { id: 'aspPassThrough', label: 'ASP 전이계수', unit: '×', step: 0.05 },
  { id: 'unitCostPassThrough', label: '단위원가 전이계수', unit: '×', step: 0.05 },
  { id: 'capexPassThrough', label: 'CAPEX 전이계수', unit: '×', step: 0.05 },
  { id: 'rateDiscountPassThrough', label: '금리→할인율 전이계수', unit: '×', step: 0.05 },
  { id: 'netDebtToEvPct', label: '순차입금 ÷ EV', unit: '%', step: 1, optional: true },
]
const CONTROL_SHORT_LABELS = {
  rateChangePctPoints: '금리', capexChangePct: '기준 CAPEX', hbmPriceChangePct: 'HBM 가격',
  hbmSupplyChangePct: 'HBM 공급', gpuRentChangePct: 'GPU 임대료', dcRentChangePct: 'DC 임대료',
  modelBaselineGrowthPct: '기준 모델매출 성장', modelTargetGrowthPct: '목표 모델매출 성장',
}

let dataModule
let coreModule
let viewModule
let uiState
let result
let scenarioView
let engineError = null
let loading = false
let initialized = false
let marketSnapshot = window.aiChainSnapshot || null
let storageMessage = ''
let inputMessage = ''
let matrixCache = null

const active = () => root && !root.hidden
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])
const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value))
const finite = value => value !== '' && value !== null && value !== undefined && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value))
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)))
const signed = (value, digits = 1) => !finite(value) ? '—' : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(digits)}%`
const indexValue = value => finite(value) ? Number(value).toFixed(1) : '—'
const impactClass = value => Number(value) > 0.0001 ? 'positive' : Number(value) < -0.0001 ? 'negative' : 'neutral'
const segmentId = row => row?.segmentId ?? row?.id
const companyId = row => row?.companyId ?? row?.id
const scenarioById = id => dataModule?.SCENARIO_DEFINITIONS?.find(item => item.id === id)
const companyById = id => dataModule?.COMPANIES?.find(item => (item.companyId ?? item.id) === id)
const segmentById = id => dataModule?.SEGMENTS?.find(item => (item.segmentId ?? item.id) === id)
const driverLabel = id => {
  const labels = dataModule?.MODEL_ASSUMPTIONS?.driverLabels || {}
  if (labels[id]) return labels[id]
  if (dataModule?.DRIVER_LABELS?.[id]) return dataModule.DRIVER_LABELS[id]
  if (dataModule?.DRIVER_DEFINITIONS?.[id]?.label) return dataModule.DRIVER_DEFINITIONS[id].label
  for (const scenario of dataModule?.SCENARIO_DEFINITIONS || []) {
    const control = scenario.controls?.find(item => item.id === id)
    if (control) return control.label
  }
  return String(id).replaceAll('_', ' ')
}
const sourceLabel = value => String(value || '').includes('illustrative')
  ? '역할별 모형 가정(실제 재무 미보정)'
  : String(value || '출처 미제공')

function assumptionFields() {
  const limits = dataModule?.ASSUMPTION_LIMITS || dataModule?.MODEL_ASSUMPTIONS?.assumptionLimits || {}
  return ASSUMPTION_FIELD_META.map(meta => {
    const rule = limits[meta.id]
    const min = Array.isArray(rule) ? rule[0] : rule?.min
    const max = Array.isArray(rule) ? rule[1] : rule?.max
    return finite(min) && finite(max) ? { ...meta, min: Number(min), max: Number(max) } : null
  }).filter(Boolean)
}

function valueFrom(row, ...keys) {
  for (const key of keys) if (finite(row?.[key])) return Number(row[key])
  return null
}

function checkContract() {
  const requiredData = ['SEGMENTS', 'SCENARIO_DEFINITIONS', 'COMPANIES', 'BIG7_COMPANY_IDS', 'MODEL_ASSUMPTIONS', 'ASSUMPTION_LIMITS', 'DRIVER_LABELS']
  const requiredCore = ['evaluateScenario', 'validateScenarioRequest', 'buildDefaultScenarioRequest']
  for (const key of requiredData) if (!(key in dataModule)) throw new Error(`scenario-data.js export 누락: ${key}`)
  for (const key of requiredCore) if (typeof coreModule[key] !== 'function') throw new Error(`scenario-core.js export 누락: ${key}`)
  if (typeof viewModule?.buildScenarioView !== 'function') throw new Error('scenario-view-model.js export 누락: buildScenarioView')
  const scenarioIds = dataModule.SCENARIO_DEFINITIONS.map(item => item.id)
  if (EXPECTED_SCENARIOS.some(id => !scenarioIds.includes(id))) throw new Error('합의된 5개 시나리오 정의가 모두 필요합니다.')
  if (dataModule.SEGMENTS.length !== 9) throw new Error('시나리오 분석은 정확히 9개 섹터를 사용합니다.')
  const names = dataModule.SEGMENTS.map(item => item.name)
  if (EXPECTED_SEGMENTS.some(name => !names.includes(name))) throw new Error('9개 섹터 명칭이 합의안과 다릅니다.')
  const big7Symbols = dataModule.BIG7_COMPANY_IDS.map(id => companyById(id)?.symbol)
  if (BIG7_ORDER.some(symbol => !big7Symbols.includes(symbol))) throw new Error('Big 7에는 AAPL·MSFT·NVDA·AMZN·GOOGL·META·TSLA가 모두 필요합니다.')
}

function defaultRequest(id) {
  const request = clone(coreModule.buildDefaultScenarioRequest(id))
  if (!finite(request.durationMonths)) request.durationMonths = DURATION.defaultValue
  request.companyOverrides ||= {}
  return request
}

function newSessionRequest(id) {
  const request = defaultRequest(id)
  if (id === 'interest_rate' && 'rateChangePctPoints' in request.inputs) request.inputs.rateChangePctPoints = 1
  request.durationMonths = 12
  return request
}

function cleanOverrides(raw) {
  const validIds = new Set(dataModule.COMPANIES.map(companyId))
  const output = {}
  if (!raw || typeof raw !== 'object') return output
  for (const [id, entry] of Object.entries(raw)) {
    if (!validIds.has(id) || !entry || typeof entry !== 'object') continue
    const assumptions = {}, exposures = {}
    for (const field of assumptionFields()) {
      const value = entry.assumptions?.[field.id]
      if (finite(value)) assumptions[field.id] = clamp(value, field.min, field.max)
    }
    for (const [driverId, value] of Object.entries(entry.exposures || {})) {
      if (finite(value)) exposures[driverId] = clamp(value, 0, 2)
    }
    if (Object.keys(assumptions).length || Object.keys(exposures).length) output[id] = { assumptions, exposures }
  }
  return output
}

function sanitizeRequest(id, raw) {
  const base = defaultRequest(id), definition = scenarioById(id)
  if (!raw || raw.scenarioId !== id) return base
  for (const control of definition.controls || []) {
    const value = raw.inputs?.[control.id]
    if (finite(value)) base.inputs[control.id] = clamp(value, control.min, control.max)
  }
  if (finite(raw.durationMonths)) base.durationMonths = clamp(raw.durationMonths, DURATION.min, DURATION.max)
  base.companyOverrides = cleanOverrides(raw.companyOverrides)
  const validated = coreModule.validateScenarioRequest(clone(base))
  if (validated === false) throw new Error('저장된 입력 검증 실패')
  return base
}

function loadState() {
  const requests = Object.fromEntries(dataModule.SCENARIO_DEFINITIONS.map(item => [item.id, newSessionRequest(item.id)]))
  const first = 'interest_rate'
  const fallback = {
    version: STORAGE_VERSION, scenarioId: first, requests, selectedCompanyId: null,
    segmentFilter: 'all', companySearch: '', sortRepresentativesByAbs: false, showObservedQuotes: false, touchedControls: {},
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || ![1, 2, STORAGE_VERSION].includes(parsed.version)) return fallback
    for (const id of Object.keys(requests)) {
      try {
        const saved = sanitizeRequest(id, parsed.requests?.[id])
        if (id === first) requests[id].companyOverrides = saved.companyOverrides
        else requests[id] = saved
      } catch { /* keep a verified default */ }
    }
    return {
      ...fallback,
      requests,
      selectedCompanyId: parsed.version === STORAGE_VERSION && companyById(parsed.selectedCompanyId) ? parsed.selectedCompanyId : null,
      segmentFilter: parsed.segmentFilter === 'all' || segmentById(parsed.segmentFilter) ? parsed.segmentFilter : 'all',
      companySearch: typeof parsed.companySearch === 'string' ? parsed.companySearch.slice(0, 80) : '',
      sortRepresentativesByAbs: Boolean(parsed.sortRepresentativesByAbs),
      showObservedQuotes: false,
      touchedControls: parsed.version === STORAGE_VERSION && parsed.touchedControls && typeof parsed.touchedControls === 'object' ? parsed.touchedControls : {},
    }
  } catch {
    storageMessage = '브라우저 저장값을 읽지 못해 기본 입력으로 시작했습니다.'
    return fallback
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uiState))
    storageMessage = ''
  } catch {
    storageMessage = '이 브라우저에서는 시나리오 입력을 저장하지 못했습니다. 현재 화면 계산은 유지됩니다.'
  }
}

function currentRequest() { return uiState.requests[uiState.scenarioId] }

function recalculate() {
  try {
    const request = clone(currentRequest())
    const validated = coreModule.validateScenarioRequest(request)
    if (validated === false) throw new Error('입력 범위를 확인해 주세요.')
    result = coreModule.evaluateScenario(request)
    if (!result || !Array.isArray(result.segments) || !Array.isArray(result.companies)) throw new Error('계산 결과 형식이 올바르지 않습니다.')
    scenarioView = viewModule.buildScenarioView(result)
    if (!scenarioView || !Array.isArray(scenarioView.companies)) throw new Error('표시용 결과 형식이 올바르지 않습니다.')
    if (!scenarioView.companies.some(item => companyId(item) === uiState.selectedCompanyId)) {
      uiState.selectedCompanyId = companyId(scenarioView.summary?.largestDecline || scenarioView.representativeRows?.[0] || scenarioView.companies[0])
    }
    engineError = null
    inputMessage = ''
    saveState()
  } catch (error) {
    result = null
    scenarioView = null
    engineError = error instanceof Error ? error.message : '시나리오를 계산하지 못했습니다.'
  }
}

function quoteFor(symbol) {
  if (!symbol) return null
  const quote = marketSnapshot?.quotes?.find(item => item.symbol === symbol)
  if (!quote || quote.status !== 'ok') return null
  if (!finite(quote.price) || Number(quote.price) <= 0 || !finite(quote.marketTime) || Number(quote.marketTime) <= 0) return null
  if (!/^[A-Z]{3}$/u.test(quote.currency || '')) return null
  if (Number(quote.marketTime) * 1000 > Date.now() + 300000) return null
  return quote
}

function quoteTime(quote) {
  return new Date(Number(quote.marketTime) * 1000).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' KST'
}

function isoTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '수집시각 미제공'
  return new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' KST'
}

function presetText(definition, values) {
  const inputs = values?.inputs || values || {}
  const parts = Object.entries(inputs).map(([id, value]) => {
    const control = definition.controls?.find(item => item.id === id)
    if (!control || !finite(value)) return null
    const label = CONTROL_SHORT_LABELS[id] || control.label
    return `${label} ${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${Math.abs(Number(value)).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${control.unit || ''}`
  }).filter(Boolean)
  const numeric = parts.length && parts.every(part => / 0(?:\D|$)/u.test(part)) ? '모든 충격 0' : parts.join(' · ')
  return [values?.label, numeric].filter(Boolean).join(' · ') || '입력값 적용'
}

function modelGrowthHelperContent() {
  if (uiState.scenarioId !== 'model_growth') return ''
  const inputs = currentRequest().inputs, baseline = inputs.modelBaselineGrowthPct, target = inputs.modelTargetGrowthPct
  if (!finite(baseline) || !finite(target) || 1 + Number(baseline) / 100 <= 0) return ''
  const relative = ((1 + Number(target) / 100) / (1 + Number(baseline) / 100) - 1) * 100
  const pointChange = Number(target) - Number(baseline)
  return `기준 전망 대비 모델매출 <strong>${signed(relative)}</strong> <span>(성장률 ${Number(pointChange) > 0 ? '+' : Number(pointChange) < 0 ? '−' : ''}${Math.abs(pointChange).toFixed(1)}%p)</span><small>사용자가 입력한 모형 가정이며 실제 회사 전망이 아닙니다.</small>`
}

function calculationError() {
  return `<section class="scenario-unavailable" role="alert"><strong>시나리오 결과를 표시하지 못했습니다.</strong><p>${esc(engineError || '계산 입력과 모형을 확인해 주세요.')}</p><p>임의 값이나 이전 계산값으로 대체하지 않습니다.</p></section>`
}

function observedQuote(item) {
  const source = companyById(companyId(item)), quote = quoteFor(item.symbol || source?.symbol)
  if (!quote) return ''
  const ratio = item.valuation?.equityValueRatio
  const ready = item.valuation?.quoteLinkStatus === 'ready-for-observed-price-ratio-only' && finite(ratio) && Number(ratio) > 0
  const converted = ready ? Number(quote.price) * Number(ratio) : null
  const unavailable = item.valuation?.comparisonStatus === 'nonpositive-baseline' ? '기준 EV가 0 이하라 환산주가 미산정' : {
    'missing-same-date-net-debt-to-ev': '동일 기준일 순차입금/EV 가정 미입력 · 환산주가 미산정',
    'unavailable-nonpositive-equity': '주주가치가 양수가 아니어서 환산주가 미산정',
  }[item.valuation?.quoteLinkStatus] || 'EV→주주가치 브리지 미완료 · 환산주가 미산정'
  return `<div class="scenario-quote-observation"><span><b>${esc(item.name || source?.name)}</b><small>${esc(item.symbol || source?.symbol)}</small></span><strong>${Number(quote.price).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${esc(quote.currency)} <em>관측</em></strong><small>${esc(quote.source || '시세 출처 미제공')} · 관측 ${esc(quoteTime(quote))} · 수집 ${esc(isoTime(quote.fetchedAt))}</small>${ready ? `<span class="scenario-linked-quote"><small>관측시가 기준 환산주가</small><b>${converted.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${esc(quote.currency)}</b><small>순차입금/EV 가정으로 EV→주주가치 브리지 · 내재가치 아님</small></span>` : `<small>${esc(unavailable)}</small>`}</div>`
}

const financialNumber = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })

function monetaryAmount(value, currency) {
  if (!finite(value)) return '—'
  return financialNumber.format(Number(value) / (currency ? 1e6 : 1))
}

function fallbackLabel(company) {
  if (company?.financialBasis?.status !== 'illustrative') return ''
  return company.symbol ? '재무 자료 없음 · 가정' : '재무 미공개 · 가정'
}

function financialCoverage() {
  const companies = scenarioView?.companies || []
  if (!companies.length) return ''
  const actual = companies.filter(company => company.financialBasis?.status === 'actual')
  const cashCount = actual.filter(company => company.financialBasis.marginMethod === 'cfo-minus-capex').length
  const privateCount = companies.filter(company => company.listingStatus === 'private' && company.financialBasis?.status === 'illustrative').length
  return `<p>참여 ${companies.length}개사 중 <strong>${actual.length}개사</strong>의 연간 매출을 반영했습니다. ${privateCount}개 비상장사는 섹터 가정을 씁니다. 현금흐름 마진은 ${cashCount}개사의 실적으로 계산했고, 충격 민감도와 전파계수는 C등급 가정입니다.</p>`
}

function factSource(fact) {
  if (!fact) return '자료 없음'
  const portal = { YAHOO: 'Yahoo Finance', NAVER: '네이버페이 증권' }[fact.provider]
  const provider = esc(portal || fact.provider || '출처 미제공')
  const link = /^https:\/\//iu.test(fact.url || '') ? `<a href="${esc(fact.url)}" target="_blank" rel="noopener noreferrer">${provider}</a>` : provider
  return `${link} · ${portal ? '2차 출처' : '실적 원천'} ${esc(fact.grade || 'C')}${fact.accountingStandard ? ` · ${esc(fact.accountingStandard)}` : ''}`
}

function financialDetails(company) {
  const basis = company.financialBasis
  if (!basis) return ''
  const actual = basis.status === 'actual'
  const facts = basis.facts || {}
  const unit = actual ? `${esc(basis.currency)} 백만` : '정규화 단위'
  const historical = (label, amount, source) => `<div><dt>${label}</dt><dd>${monetaryAmount(amount, basis.currency)}</dd><dd>${source}</dd></div>`
  const sourceAmount = (key, label) => historical(label, facts[key]?.value, factSource(facts[key]))
  const cashStandard = facts.operatingCashFlow?.accountingStandard
  const capexStandard = facts.capitalExpenditure?.accountingStandard
  const cashComparable = !cashStandard || !capexStandard || cashStandard === capexStandard
  const cash = cashComparable && finite(facts.operatingCashFlow?.value) && finite(facts.capitalExpenditure?.value)
    ? facts.operatingCashFlow.value - Math.abs(facts.capitalExpenditure.value) : null
  const fallbackReasons = {
    'missing-gross-capex': 'CAPEX 미확인', 'missing-operating-cash-flow': '영업현금흐름 미확인',
    'incompatible-accounting-standards': '공시 회계기준 불일치',
  }
  const projected = (label, previous, next, field, reason) => {
    const kind = basis.fieldSources?.[field]
    const source = kind === 'historical' ? '실적 기반' : kind === 'user' ? '사용자 가정 C' : '섹터 가정 C'
    return `<tr><th scope="row">${label}</th><td>${signed(previous, 2)}</td><td>${signed(next, 2)}</td><td>${source}${kind === 'sector' && fallbackReasons[reason] ? ` · ${fallbackReasons[reason]}` : ''}</td></tr>`
  }
  const growthPeriod = basis.growthStartFiscalYear && basis.growthEndFiscalYear ? ` (FY${esc(basis.growthStartFiscalYear)}–${esc(basis.growthEndFiscalYear)})` : ''
  return `<section class="scenario-financial-detail"><h3>기업 재무와 현금흐름 전망</h3>
    ${actual ? `<p>FY${esc(basis.fiscalYear)} · ${esc(basis.endDate)} 결산 · ${basis.scope === 'consolidated' ? '연결' : esc(basis.scope)} · 금액 단위 ${unit} · DB 기준 ${esc(basis.asOfDate)}</p>
      <dl class="scenario-history-facts">${sourceAmount('revenue', '매출')}${sourceAmount('operatingCashFlow', '영업현금흐름')}${sourceAmount('capitalExpenditure', 'CAPEX (원천 부호)')}${historical('FCF 대용치', cash, finite(cash) ? '영업현금흐름 − |CAPEX|' : cashComparable ? 'CAPEX 또는 영업현금흐름 미확인' : '공시 회계기준 불일치')}</dl>
      ${basis.cashFlowRevenueFactKey === 'cashFlowBasisRevenue' ? `<p class="scenario-note">현금흐름 비율 계산용 매출 · ${monetaryAmount(facts.cashFlowBasisRevenue.value, basis.currency)} ${unit} · ${factSource(facts.cashFlowBasisRevenue)}. 현금흐름 마진과 CAPEX 비율은 영업현금흐름·CAPEX와 같은 제공자·회계기준의 매출로 계산했습니다.</p>` : ''}` : `<p>${esc(fallbackLabel(company))}. 시작 매출 ${esc(basis.startingRevenue)}과 섹터 가정을 사용합니다.</p>`}
    <table class="scenario-forecast-inputs"><thead><tr><th scope="col">지표</th><th scope="col">과거 실적</th><th scope="col">전망 1년차</th><th scope="col">적용 근거</th></tr></thead><tbody>
      ${projected(`매출 연평균 성장률${growthPeriod}`, basis.historicalGrowthPct, basis.firstYearGrowthPct, 'baseGrowthPct')}
      ${projected('현금흐름 마진', basis.historicalCashMarginPct, basis.firstYearCashMarginPct, 'fcffMarginPct', basis.marginFallbackReason)}
      ${projected('CAPEX / 매출', basis.historicalCapexToRevenuePct, basis.firstYearCapexToRevenuePct, 'capexToRevenuePct', basis.capexFallbackReason)}
    </tbody></table>
    ${basis.growthStartRevenueFact ? `<p class="scenario-note">성장률 계산의 시작 매출 · FY${esc(basis.growthStartFiscalYear)} ${monetaryAmount(basis.growthStartRevenueFact.value, basis.currency)} ${unit} · ${factSource(basis.growthStartRevenueFact)}${basis.growthEndRevenueFact ? `<br>마지막 매출 · FY${esc(basis.growthEndFiscalYear)} ${monetaryAmount(basis.growthEndRevenueFact.value, basis.currency)} ${unit} · ${factSource(basis.growthEndRevenueFact)}` : ''}</p>` : ''}
    <p class="scenario-note">전망 가정 C · 실적 기반 매출 성장률은 1년차에 −5~30% 범위로 적용합니다. 실적 기반 지표는 2년차에 섹터 가정과 절반씩 반영하고 3년차부터 섹터 가정을 씁니다. 직접 입력한 지표는 8년간 입력값을 적용합니다.</p></section>`
}

function operatingBridge(company) {
  const valuation = company.valuation || {}, rows = valuation.operatingBridge || []
  if (!rows.length) return ''
  const currency = valuation.currency
  const amount = value => monetaryAmount(value, currency)
  const delta = value => finite(value) && Number(value) > 0 ? `+${amount(value)}` : amount(value)
  const cashLabel = valuation.cashFlowMeasure === 'fcf-proxy' ? 'FCF 대용치' : '모형 현금흐름'
  const units = currency ? `금액 단위 ${esc(currency)} 백만.${company.financialBasis?.fieldSources?.fcffMarginPct === 'user' ? ' 현금흐름 마진은 사용자 가정을 적용했습니다.' : ''}` : '금액은 시작 매출 100을 기준으로 한 정규화 단위입니다.'
  return `<div class="scenario-operating-bridge"><div><h3>연도별 재무 전망</h3><p class="scenario-note">${units}${valuation.cashFlowMeasure === 'fcf-proxy' ? ' 현금흐름 마진을 산출할 때 별도의 이자 조정은 적용하지 않았습니다.' : ''}</p><p class="scenario-note">현금흐름 할인값(EV) · 기준 ${amount(valuation.baselineEnterpriseValueUnits)} → 시나리오 ${amount(valuation.scenarioEnterpriseValueUnits)}. 관측시가는 별도 토글에서 확인할 수 있습니다.</p></div><div class="scenario-bridge-scroll"><table><thead><tr><th>전망 연도</th><th>물량 변화</th><th>ASP 변화</th><th>단위원가 증감</th><th>CAPEX 현금유출 증감</th><th>할인율</th><th>기준 ${cashLabel}</th><th>시나리오 ${cashLabel}</th></tr></thead><tbody>${rows.map((row, index) => `<tr><th>${esc(row.year)}년</th><td>${signed(row.revenueVolumePct, 2)}</td><td>${signed(row.aspPct, 2)}</td><td>${delta(row.incrementalUnitCostUnits)}</td><td>${delta(row.incrementalCapexCashoutUnits)}</td><td>${finite(valuation.scenarioDiscountRatesPct?.[index]) ? `${Number(valuation.scenarioDiscountRatesPct[index]).toFixed(2)}%` : '—'}</td><td>${amount(valuation.baselineFcff?.[index])}</td><td>${amount(valuation.scenarioFcff?.[index])}</td></tr>`).join('')}</tbody></table></div></div>`
}

function defaultMatrix() {
  if (matrixCache) return matrixCache
  const columns = []
  for (const scenario of dataModule.SCENARIO_DEFINITIONS) {
    try {
      const request = defaultRequest(scenario.id)
      const reference = scenario.presets?.downside || Object.values(scenario.presets || {}).find(preset => Object.values(preset.inputs || preset).some(value => finite(value) && Number(value) !== 0))
      if (reference) Object.assign(request.inputs, clone(reference.inputs || reference))
      const evaluated = coreModule.evaluateScenario(request)
      columns.push({ scenario, inputLabel: presetText(scenario, reference || request.inputs), values: new Map(evaluated.segments.map(item => [String(segmentId(item)), valueFrom(item, 'changePct', 'valueChangePct')])) })
    } catch {
      columns.push({ scenario, inputLabel: '계산 불가', values: new Map() })
    }
  }
  matrixCache = columns
  return columns
}

function methodology() {
  const matrix = defaultMatrix(), assumptions = dataModule.MODEL_ASSUMPTIONS || {}
  const sourceDate = assumptions.asOfDate || assumptions.sourceDate || assumptions.reviewedAt || '기준일 미제공'
  const unmodeled = Array.isArray(result?.model?.unmodeledMitigants) ? result.model.unmodeledMitigants.join(' · ') : result?.model?.unmodeledMitigants
  return `<section class="scenario-methodology">
    <details><summary><span><b>방법론 · 9×5 기본 영향표</b><small>계산 구조, 기본 충격, 출처 상태 확인</small></span><i aria-hidden="true">＋</i></summary><div class="scenario-method-body">
      <div class="scenario-method-callouts"><p><b>조건부 가치지수</b> 기준값을 100으로 놓고 시나리오 충격에 따른 상대 변화를 표시합니다. 현재 주가나 내재가치의 절대 추정이 아닙니다.</p><p><b>전파 구조</b> 외생 충격 → 섹터 → 기업 노출 → ${esc(result?.model?.horizonMonths ? `${result.model.horizonMonths}개월` : `${assumptions.forecastYears}년`)} 명시적 현금흐름을 분리합니다. 기간을 줄이면 엔진 정의에 따라 직접효과도 함께 달라집니다.</p><p><b>직접·전파 배분</b> ${esc(viewModule?.VIEW_MODEL_NOTE || '화면용 설명값입니다.')} 충격 민감도와 전파계수에는 가정 등급 C를 적용합니다.</p></div>
      <div class="scenario-grade-key"><span><b>A</b> 공시 직접</span><span><b>B</b> 공시 기반 추정</span><span><b>C</b> 모형 가정 / 2차 출처 실적 (항목별 구분)</span></div>
      <div class="scenario-matrix-wrap"><table class="scenario-matrix"><caption>고정 참조 충격과 섹터 가정으로 계산한 섹터별 가치지수 변화율</caption><thead><tr><th>섹터</th>${matrix.map(column => `<th>${esc(column.scenario.name)}<small>${esc(column.inputLabel)}</small></th>`).join('')}</tr></thead><tbody>${dataModule.SEGMENTS.map(segment => { const id = segment.segmentId ?? segment.id; return `<tr><th>${esc(segment.name)}</th>${matrix.map(column => { const value = column.values.get(String(id)); return `<td class="${impactClass(value)}">${signed(value)}</td>` }).join('')}</tr>` }).join('')}</tbody></table></div>
      <div class="scenario-source-ledger"><p><b>모형 가정 기준일</b> ${esc(sourceDate)}</p><p><b>가정 상태</b> ${esc(assumptions.calibrationStatus || '예시 전파계수 · 미보정')}</p><p><b>회사 범위</b> Big 7과 9개 섹터의 대표기업. 전체 업종·지수 구성종목이 아닙니다.</p></div>
      ${unmodeled ? `<p class="scenario-unmodeled"><b>미반영 완충요인</b> ${esc(unmodeled)}</p>` : ''}
      ${result?.warnings?.length ? `<div class="scenario-method-limitations"><b>해석 한계</b><ul>${result.warnings.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
    </div></details>
  </section>`
}

function warnings() {
  const list = []
  if (storageMessage) list.push(storageMessage)
  const input = inputMessage ? `<div class="scenario-input-alert" role="alert"><strong>입력 오류 · 마지막 유효 결과 유지</strong><span>${esc(inputMessage.replace(' 마지막으로 검증된 계산 결과를 유지합니다.', ''))}</span></div>` : ''
  const storage = list.length ? `<div class="scenario-storage-alert" role="status">${list.map(item => esc(item)).join(' ')}</div>` : ''
  return input + storage
}

function compactScenarioCards() {
  return `<div class="scenario-picker compact" role="group" aria-label="시나리오 선택">${dataModule.SCENARIO_DEFINITIONS.map(item => `<button type="button" class="scenario-choice${item.id === uiState.scenarioId ? ' selected' : ''}" data-scenario-id="${esc(item.id)}" aria-pressed="${item.id === uiState.scenarioId}"><strong>${esc(item.name)}</strong></button>`).join('')}</div>`
}

function compactControls() {
  const definition = scenarioById(uiState.scenarioId), request = currentRequest()
  const presets = Object.entries(definition.presets || {})
  const presetButtons = uiState.scenarioId === 'interest_rate'
    ? [0.5, 1, 2].map(value => `<button type="button" data-control-preset-id="rateChangePctPoints" data-control-preset-value="${value}" aria-pressed="${Number(request.inputs.rateChangePctPoints) === value}">+${value}%p</button>`).join('')
    : presets.map(([id, values]) => `<button type="button" data-scenario-preset="${esc(id)}">${esc(presetText(definition, values))}</button>`).join('')
  return `<section class="scenario-panel scenario-inputs compact" aria-labelledby="scenario-input-heading">
    <div class="scenario-input-top"><div><h2 id="scenario-input-heading">${esc(definition.name)}</h2></div>
      <div class="scenario-presets" role="group" aria-label="수치 프리셋">${presetButtons}</div>
      <button type="button" class="scenario-reset" data-scenario-reset>초기화</button></div>
    <div class="scenario-compact-controls">${(definition.controls || []).map(control => `<label class="scenario-number-control"><span>${esc(control.label)}</span><span class="scenario-signed-input"><input type="number" inputmode="decimal" min="${control.min}" max="${control.max}" step="${control.step}" value="${request.inputs[control.id]}" data-scenario-control="${esc(control.id)}"><small>${esc(control.unit || '')}</small></span></label>`).join('')}
      <div class="scenario-duration-shortcuts"><span>지속기간</span><div role="group" aria-label="충격 지속기간">${[6, 12, 24, 36].map(months => `<button type="button" data-duration="${months}" aria-pressed="${Number(request.durationMonths) === months}">${months}개월</button>`).join('')}</div></div>
    </div>${uiState.scenarioId === 'model_growth' ? `<div class="scenario-derived-input" data-model-growth-helper>${modelGrowthHelperContent()}</div>` : ''}
  </section>`
}

const pct2 = value => !finite(value) ? '분해 불가' : `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${Math.abs(Number(value)).toFixed(2)}%`

const totalChange = value => finite(value) ? pct2(value) : '산정 불가'

function displayParts(row) {
  if (!row?.breakdownAvailable || !finite(row.totalPct) || !finite(row.chainPct)) return { direct: null, chain: null, total: finite(row?.totalPct) ? Number(row.totalPct) : null }
  const total = Number(Number(row.totalPct).toFixed(2))
  const chain = Number(Number(row.chainPct).toFixed(2))
  return { direct: Number((total - chain).toFixed(2)), chain, total }
}

function sharedBarScale() {
  let max = 0
  for (const row of scenarioView?.companies || []) {
    const values = row.breakdownAvailable ? [Number(row.directPct), Number(row.chainPct)] : []
    const positive = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0)
    const negative = Math.abs(values.filter(value => value < 0).reduce((sum, value) => sum + value, 0))
    max = Math.max(max, positive, negative, Math.abs(Number(row.totalPct) || 0))
  }
  return max > 0 ? max : 1
}

function divergingBar(row, scale) {
  if (!finite(row.totalPct)) return ''
  const parts = displayParts(row)
  const pieces = []
  let positiveOffset = 0, negativeOffset = 0
  if (row.breakdownAvailable) {
    for (const [kind, raw] of [['direct', row.directPct], ['chain', row.chainPct]]) {
      if (!finite(raw) || Math.abs(Number(raw)) < 1e-12) continue
      const value = Number(raw), width = Math.abs(value) / scale * 50
      let left
      if (value > 0) { left = 50 + positiveOffset / scale * 50; positiveOffset += value }
      else { negativeOffset += Math.abs(value); left = 50 - negativeOffset / scale * 50 }
      pieces.push(`<i class="scenario-bar-segment ${kind} ${value > 0 ? 'positive' : 'negative'}" style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%" title="${kind === 'direct' ? '직접' : '밸류체인'} ${pct2(parts[kind])}"></i>`)
    }
  }
  const total = Number(row.totalPct)
  const marker = Math.max(0, Math.min(100, 50 + total / scale * 50))
  return `<div class="scenario-impact-bar" aria-label="직접 ${pct2(parts.direct)}, 밸류체인 ${pct2(parts.chain)}, 총 ${pct2(parts.total)}"><span class="scenario-bar-axis"></span>${pieces.join('')}<b class="scenario-total-marker" style="left:${marker.toFixed(4)}%" title="총 ${pct2(parts.total)}"></b></div>`
}

function resultSummary() {
  if (!scenarioView) return calculationError()
  const summary = scenarioView.summary || {}, decline = summary.largestDecline, propagation = summary.largestPropagation
  const comparable = summary.comparableCompanyCount
  const rankBasis = comparable < summary.companyCount ? ` · 산정 가능 ${comparable}/${summary.companyCount}개사` : ''
  const winnerBasis = company => fallbackLabel(company) ? ` · ${fallbackLabel(company)}` : ''
  return `<section class="scenario-summary-grid" aria-live="polite">
    <article><span>가장 크게 빠지는 기업 · 전체 ${summary.companyCount || 0}개</span><strong>${decline ? esc(decline.name) : comparable === 0 ? '산정 불가' : '하락 기업 없음'}</strong><small class="${impactClass(decline?.totalPct)}">${decline ? pct2(decline.totalPct) + winnerBasis(decline) : '—'}${rankBasis}</small></article>
    <article><span>전파 효과가 가장 큰 기업 · 전체 ${summary.companyCount || 0}개</span><strong>${propagation ? esc(propagation.name) : comparable === 0 ? '산정 불가' : '전파효과 없음'}</strong><small>${propagation ? `밸류체인 ${pct2(propagation.chainPct)}${winnerBasis(propagation)}` : '산정된 전파 기여도 없음'}${rankBasis}</small></article>
    <article><span>9개 섹터 대표기업 단순평균</span><strong>${totalChange(summary.representativeAveragePct)}</strong><small>${summary.comparableRepresentativeCount === 9 ? '9개 기업 · 중복 없음' : `산정 가능 ${summary.comparableRepresentativeCount}/9개사`}</small></article>
  </section>`
}

function companyTable(rows, label, scale, companyColumn = '기업') {
  if (!rows?.length) return '<p class="scenario-empty">표시할 기업이 없습니다.</p>'
  return `<div class="scenario-table-scroll"><table class="scenario-data-table"><caption class="sr-only">${esc(label)}</caption><thead><tr><th>섹터</th><th>${esc(companyColumn)}</th><th>직접효과</th><th>밸류체인 효과</th><th>총 EV 변화</th></tr></thead><tbody>${rows.map(row => {
    const id = companyId(row), source = companyById(id) || {}, segment = segmentById(row.representativeSegmentId || row.primarySegmentId || source.primarySegmentId), parts = displayParts(row)
    return `<tr tabindex="0" class="scenario-company-row${id === uiState.selectedCompanyId ? ' selected' : ''}" data-company-row data-company-id="${esc(id)}" aria-selected="${id === uiState.selectedCompanyId}">
      <td data-label="섹터"><span class="scenario-sector-name">${esc(segment?.name || '미분류')}</span></td>
      <td data-label="${esc(companyColumn)}"><strong>${esc(row.name || source.name)}</strong><small>${esc(row.symbol || source.symbol || '비상장')}${fallbackLabel(row) ? ` · ${fallbackLabel(row)}` : ''}</small></td>
      <td data-label="직접효과" class="${impactClass(parts.direct)}">${pct2(parts.direct)}</td>
      <td data-label="밸류체인 효과" class="${impactClass(parts.chain)}">${pct2(parts.chain)}</td>
      <td data-label="총 EV 변화" class="scenario-total-cell ${impactClass(parts.total)}"><b>${totalChange(parts.total)}</b>${divergingBar(row, scale)}</td></tr>`
  }).join('')}</tbody></table></div>`
}

function filteredOtherRows() {
  const needle = uiState.companySearch.trim().toLocaleLowerCase('ko-KR')
  return (scenarioView?.otherRows || []).filter(row => !needle || `${row.name || ''} ${row.symbol || ''}`.toLocaleLowerCase('ko-KR').includes(needle))
}

function resultsTables() {
  if (!scenarioView) return calculationError()
  const scale = sharedBarScale()
  const big7 = [...scenarioView.big7Rows].sort((a, b) => BIG7_ORDER.indexOf(a.symbol) - BIG7_ORDER.indexOf(b.symbol))
  const reps = [...scenarioView.representativeRows]
  if (uiState.sortRepresentativesByAbs) reps.sort((a, b) => (finite(b.totalPct) ? Math.abs(b.totalPct) : -1) - (finite(a.totalPct) ? Math.abs(a.totalPct) : -1))
  return `<p class="scenario-attribution-note">직접·밸류체인 효과는 기존 경로 기여도에 비례해 배분한 C등급 추정치입니다.<br>진한 막대는 직접효과, 연한 막대는 밸류체인 효과, 세로선은 기준 대비 총 EV 변화입니다. EV는 96개월 현금흐름과 잔존가치를 할인해 비교합니다.</p><section class="scenario-panel scenario-results-section" aria-labelledby="scenario-big7-heading"><div class="scenario-section-heading"><div><h2 id="scenario-big7-heading">Big 7</h2></div><span class="scenario-honesty">기준 기업가치 = 100</span></div>${companyTable(big7, 'Big 7 결과', scale)}</section>
    <section class="scenario-panel scenario-results-section" aria-labelledby="scenario-representative-heading"><div class="scenario-section-heading"><div><h2 id="scenario-representative-heading">9개 섹터 대표기업</h2></div><button type="button" class="scenario-sort" data-sort-representatives aria-pressed="${uiState.sortRepresentativesByAbs}">절대 변화폭순</button></div><p class="scenario-note">섹터당 한 기업의 조건부 결과입니다. 섹터 지수나 전체 기업 평균이 아닙니다.</p>${companyTable(reps, '9개 섹터 대표기업 결과', scale, '대표기업')}</section>
    <details class="scenario-panel scenario-results-section scenario-other-results"><summary><span>더 보기 · 기타 기업 ${scenarioView.summary?.otherCount || 0}개</span><small>Big 7과 9개 대표기업 제외 · 중복 없음</small></summary><div class="scenario-other-toolbar"><label>기업 검색<input type="search" data-company-search value="${esc(uiState.companySearch)}" placeholder="기업명 · 티커"></label></div><div data-other-table>${companyTable(filteredOtherRows(), '기타 기업 결과', scale)}</div></details>`
}


function pathCoefficients(path) {
  const steps = path.coefficientSteps || []
  if (!steps.length) return ''
  return `<ul aria-label="경로에 사용한 전파계수">${steps.map(step => {
    const label = `${segmentById(step.from)?.name || step.from} → ${segmentById(step.to)?.name || step.to}`
    return `<li><span>${esc(label)}</span><b>${esc(step.weight)}×</b><small>${esc(step.channel)} · ${esc(step.lagMonths)}개월 · ${esc(step.source)} · ${esc(step.grade)}등급</small></li>`
  }).join('')}</ul>`
}

function pathSummary(path, company) {
  if (!path) return '반영된 충격 경로가 없습니다.'
  const controlValues = result.scenario.drivers.find(driver => driver.driverId === path.driverId)?.controlValues || {}
  const shock = Object.entries(controlValues).map(([id, value]) => {
    const control = scenarioById(uiState.scenarioId).controls.find(item => item.id === id)
    return `${CONTROL_SHORT_LABELS[id] || control?.label || driverLabel(path.driverId)} ${value > 0 ? '+' : ''}${value}${control?.unit || ''}`
  }).join(' · ')
  const sectors = path.segments.map(id => segmentById(id)?.name || id)
  const primitive = { revenueVolume: '판매 물량', capexCashout: '투자 지출', asp: '평균판매가격', unitCost: '단위원가' }[path.primitive] || path.primitive
  const metric = path.driverId === 'interestRate' ? '수요·할인율' : primitive
  const lag = finite(path.lagMonths) ? (path.lagMonths ? `${path.lagMonths}개월 뒤` : '즉시') : '시차 미제공'
  return `${shock || driverLabel(path.driverId)} → ${sectors.join(' → ')} → ${company.name} ${metric}에 ${lag} 반영`
}

function quoteContent(company) {
  return observedQuote(company) || '<p class="scenario-note">표시할 정상 관측시가가 없습니다.</p>'
}

function companyDetail() {
  if (!scenarioView) return ''
  const company = scenarioView.companies.find(item => companyId(item) === uiState.selectedCompanyId) || scenarioView.representativeRows[0]
  if (!company) return ''
  const id = companyId(company), source = companyById(id) || {}, parts = displayParts(company)
  const coefficientFields = ['volumePassThrough', 'aspPassThrough', 'unitCostPassThrough', 'capexPassThrough', 'rateDiscountPassThrough']
  const coefficients = coefficientFields.filter(field => finite(company.assumptions?.[field])).map(field => {
    const meta = ASSUMPTION_FIELD_META.find(item => item.id === field)
    const source = Object.hasOwn(currentRequest().companyOverrides?.[id]?.assumptions || {}, field) ? '사용자 입력' : '모형 가정'
    return `<li><span>${esc(meta?.label || field)} <small>· ${esc(source)} · C</small></span><b>${Number(company.assumptions[field]).toFixed(2)}×</b></li>`
  }).join('')
  const paths = company.paths || []

  return `<section class="scenario-panel scenario-company-detail" aria-labelledby="scenario-company-detail-heading">
    <div class="scenario-detail-hero"><div><h2 id="scenario-company-detail-heading">${esc(company.name || source.name)} <small>${esc(company.symbol || source.symbol || '비상장')}</small></h2><p>${esc(pathSummary(company.topPath, company))}</p><button type="button" class="scenario-quote-button" data-toggle-quotes aria-pressed="${uiState.showObservedQuotes}">${uiState.showObservedQuotes ? '관측·환산주가 숨기기' : '관측·환산주가 보기'}</button></div><div class="scenario-detail-index"><span>총 EV 변화</span><strong class="${impactClass(parts.total)}">${totalChange(parts.total)}</strong><small>가치지수 ${indexValue(company.scenarioValueIndex)}</small></div></div>
    <div class="scenario-detail-breakdown"><div><span>직접</span><b>${pct2(parts.direct)}</b></div><div><span>밸류체인</span><b>${pct2(parts.chain)}</b></div><div><span>원시 잔차</span><b>${finite(company.residualPct) ? `${Number(company.residualPct).toFixed(4)}%p` : '—'}</b></div><div><span>전파 가정 신뢰등급</span><b>C</b></div></div>
    ${company.breakdownAvailable ? `<p class="scenario-note">직접 ${pct2(parts.direct)} + 밸류체인 ${pct2(parts.chain)} = 총 ${pct2(parts.total)}. 순위와 막대는 반올림 전 값을 사용합니다.</p>` : !finite(parts.total) ? '<p class="scenario-input-alert" role="status">기준 기업가치가 0 이하라 EV 변화율과 직접·밸류체인 효과를 산정할 수 없습니다.</p>' : `<div class="scenario-input-alert" role="status"><strong>직접·전파 분해 불가</strong><span>경로 누락 또는 허용 잔차 초과로 총 변화만 표시합니다.</span></div>`}
    <div data-financial-basis>${financialDetails(company)}</div>
    <div class="scenario-detail-grid"><div><h3>주요 경로</h3>${paths.length ? `<ol class="scenario-path-list">${paths.slice().sort((a, b) => Math.abs(b.impactPoints) - Math.abs(a.impactPoints)).map(path => `<li><div><strong>${esc(pathSummary(path, company))}</strong><small>${esc(driverLabel(path.driverId))} · 섹터 간 전파 ${path.hops || 0}회</small></div><b class="${impactClass(path.impactPoints)}">${pct2(path.impactPoints)}</b>${pathCoefficients(path)}<p>경로 배분 출처 · ${esc(sourceLabel(path.source || dataModule.MODEL_ASSUMPTIONS.assumptionSource))} · 등급 C</p></li>`).join('')}</ol>` : '<p class="scenario-note">이 시나리오에 표시할 경로가 없습니다.</p>'}</div>
      <div><h3>기업별 충격 민감도</h3>${coefficients ? `<ul class="scenario-coefficient-list">${coefficients}</ul>` : '<p class="scenario-note">표시 가능한 기업 계수가 없습니다.</p>'}<p class="scenario-note">신뢰등급 A · 공시 직접 / B · 공시 기반 추정 / C · 가정. 현재 기업 계수와 경로 기여도 배분은 실제 재무로 보정되지 않은 C등급입니다.</p></div></div>
    <details class="scenario-detail-fold"><summary>기업별 가정 편집</summary><p class="scenario-note">값을 지우면 기본 가정이 복원됩니다. 순차입금/EV는 관측시가 환산 브리지를 위해 선택 입력합니다.</p><div class="scenario-assumption-grid">${assumptionFields().map(field => {
      const projectionFields = { baseGrowthPct: 'firstYearGrowthPct', fcffMarginPct: 'firstYearCashMarginPct', capexToRevenuePct: 'firstYearCapexToRevenuePct' }
      const projected = projectionFields[field.id]
      const value = field.optional || projected ? currentRequest().companyOverrides?.[id]?.assumptions?.[field.id] : company.assumptions?.[field.id]
      const defaultValue = projected ? company.financialBasis?.[projected] : null
      const placeholder = finite(defaultValue) ? Number(defaultValue).toFixed(2) : field.optional ? '미입력' : ''
      return `<label><span>${esc(field.label)}${field.optional ? ' · 선택' : ''}</span><span class="scenario-signed-input"><input type="number" inputmode="decimal" min="${field.min}" max="${field.max}" step="${field.step}" value="${finite(value) ? value : ''}" placeholder="${placeholder}" data-company-assumption="${esc(field.id)}" data-company-id="${esc(id)}"><small>${field.unit}</small></span></label>`
    }).join('')}${Object.entries(company.assumptions?.driverExposureMultipliers || {}).map(([driver, value]) => `<label><span>${esc(driverLabel(driver))} 노출 배수</span><span class="scenario-signed-input"><input type="number" min="0" max="2" step="0.05" value="${value}" data-company-exposure="${esc(driver)}" data-company-id="${esc(id)}"><small>×</small></span></label>`).join('')}</div></details>
    <details class="scenario-detail-fold"><summary>${esc(result?.model?.horizonMonths || 96)}개월 현금흐름 전망</summary>${operatingBridge(company)}</details>
    <p class="scenario-note">관측시가 환산은 동일 기준일 순차입금/EV 입력과 유효 시세가 있을 때만 표시합니다.</p>
    ${uiState.showObservedQuotes ? `<div data-company-quote>${quoteContent(company)}</div>` : ''}
  </section>`
}

function renderDynamic({ skipDetail = false } = {}) {
  if (!root || !initialized) return
  const summary = root.querySelector('[data-scenario-summary]')
  const companies = root.querySelector('[data-scenario-companies]')
  const detail = root.querySelector('[data-scenario-detail]')
  const warningHost = root.querySelector('[data-scenario-warnings]')
  if (summary) summary.innerHTML = resultSummary()
  if (companies) {
    const otherOpen = companies.querySelector('.scenario-other-results')?.open
    companies.innerHTML = resultsTables()
    const nextOther = companies.querySelector('.scenario-other-results')
    if (nextOther && otherOpen) nextOther.open = true
  }
  if (detail && skipDetail) {
    const company = scenarioView?.companies.find(row => companyId(row) === uiState.selectedCompanyId)
    if (company) {
      const basis = detail.querySelector('[data-financial-basis]')
      if (basis) basis.innerHTML = financialDetails(company)
      const quote = uiState.showObservedQuotes && detail.querySelector('[data-company-quote]')
      if (quote) quote.innerHTML = quoteContent(company)
    }
  }
  if (detail && !skipDetail) {
    const openFolds = [...detail.querySelectorAll('.scenario-detail-fold')].map(node => node.open)
    detail.innerHTML = companyDetail()
    detail.querySelectorAll('.scenario-detail-fold').forEach((node, index) => { if (openFolds[index]) node.open = true })
  }
  if (warningHost) warningHost.innerHTML = warnings()
}

function renderReady() {
  const definition = scenarioById(uiState.scenarioId)
  root.innerHTML = `<div class="scenario-shell">
    <header class="scenario-hero compact"><div><h1>밸류체인 충격, 기업가치까지</h1>${financialCoverage()}</div><span class="scenario-honesty">기준 기업가치 = 100</span></header>
    <section class="scenario-panel scenario-select compact" aria-labelledby="scenario-select-heading"><div class="scenario-section-heading"><div><h2 id="scenario-select-heading">5개 시나리오</h2></div><span class="scenario-selected-name">현재 · ${esc(definition.name)}</span></div>${compactScenarioCards()}</section>
    ${compactControls()}
    <div data-scenario-summary>${resultSummary()}</div>
    <div data-scenario-warnings>${warnings()}</div>
    <div data-scenario-companies>${resultsTables()}</div>
    <div data-scenario-detail>${companyDetail()}</div>
    ${methodology()}
  </div>`
}

function renderLoading() {
  root.innerHTML = `<section class="scenario-loading" role="status"><span aria-hidden="true"></span><strong>시나리오 계산 모듈을 읽고 있습니다.</strong><p>계산 스키마와 입력을 확인한 뒤 결과를 표시합니다.</p></section>`
}

function renderUnavailable() {
  root.innerHTML = `<section class="scenario-unavailable" role="alert"><strong>시나리오 분석을 사용할 수 없습니다.</strong><p>${esc(engineError || '계산 모듈을 읽지 못했습니다.')}</p><p>임의 가정이나 이전 값을 대신 표시하지 않습니다.</p><button type="button" data-scenario-retry>다시 읽기</button></section>`
}

async function initialize({ force = false } = {}) {
  if (loading) return
  if (initialized && !force) { if (active()) renderReady(); return }
  loading = true; engineError = null
  if (active()) renderLoading()
  try {
    const suffix = force ? `?retry=${Date.now()}` : ''
    ;[dataModule, coreModule, viewModule] = await Promise.all([
      import(`./scenario-data.js${suffix}`),
      import(`./scenario-core.js${suffix}`),
      import(`./scenario-view-model.js${suffix}`),
    ])
    checkContract()
    uiState = loadState()
    recalculate()
    initialized = true
    if (active()) renderReady()
  } catch (error) {
    initialized = false
    engineError = error instanceof Error ? error.message : '계산 모듈을 읽지 못했습니다.'
    if (active()) renderUnavailable()
  } finally { loading = false }
}

function showInputError(element, message) {
  inputMessage = `${message} 마지막으로 검증된 계산 결과를 유지합니다.`
  element?.setAttribute('aria-invalid', 'true')
  element?.setCustomValidity?.(message)
  const warningHost = root.querySelector('[data-scenario-warnings]')
  if (warningHost) warningHost.innerHTML = warnings()
}

function clearInputError(element) {
  inputMessage = ''
  element?.removeAttribute('aria-invalid')
  element?.setCustomValidity?.('')
}

function updateControl(id, rawValue, { skipDetail = false, element = null } = {}) {
  const request = currentRequest()
  const control = id === 'durationMonths' ? { label: '충격 지속기간', unit: '개월', ...DURATION } : scenarioById(uiState.scenarioId)?.controls?.find(item => item.id === id)
  if (!control) return false
  if (!finite(rawValue)) { showInputError(element, `${control.label}에 유효한 숫자를 입력해 주세요.`); return false }
  const numeric = Number(rawValue)
  if (numeric < control.min || numeric > control.max) { showInputError(element, `${control.label}은(는) ${control.min}~${control.max}${control.unit || ''} 범위여야 합니다.`); return false }
  if (id === 'durationMonths' && (!Number.isInteger(numeric) || (numeric - control.min) % control.step !== 0)) { showInputError(element, `${control.label}은(는) ${control.step}개월 단위여야 합니다.`); return false }
  clearInputError(element)
  if (id === 'durationMonths') request.durationMonths = numeric
  else request.inputs[id] = numeric
  uiState.touchedControls[`${uiState.scenarioId}:${id}`] = true
  for (const button of root.querySelectorAll('[data-control-preset-id]')) {
    if (button.dataset.controlPresetId === id) button.setAttribute('aria-pressed', String(Number(button.dataset.controlPresetValue) === numeric))
  }
  const modelHelper = root.querySelector('[data-model-growth-helper]')
  if (modelHelper) modelHelper.innerHTML = modelGrowthHelperContent()
  recalculate(); renderDynamic({ skipDetail })
  return true
}

function updateCompanyOverride(id, group, field, rawValue, element = null) {
  const company = result?.companies?.find(item => companyId(item) === id)
  if (!company) return false
  const definition = group === 'assumptions' ? assumptionFields().find(item => item.id === field) : { label: '노출 배수', min: 0, max: 2 }
  if (!definition) return false
  if (group === 'assumptions' && (rawValue === '' || typeof rawValue === 'string' && !rawValue.trim())) {
    const request = currentRequest(), entry = request.companyOverrides[id]
    if (entry?.assumptions) delete entry.assumptions[field]
    if (entry && !Object.keys(entry.assumptions || {}).length && !Object.keys(entry.exposures || {}).length) delete request.companyOverrides[id]
    clearInputError(element); recalculate(); renderDynamic({ skipDetail: true }); return true
  }
  if (!finite(rawValue)) { showInputError(element, `${definition.label}에 유효한 숫자를 입력해 주세요.`); return false }
  const numeric = Number(rawValue)
  if (numeric < definition.min || numeric > definition.max) { showInputError(element, `${definition.label}은(는) ${definition.min}~${definition.max} 범위여야 합니다.`); return false }
  clearInputError(element)
  const request = currentRequest(), entry = request.companyOverrides[id] ||= { assumptions: {}, exposures: {} }
  entry.assumptions ||= {}; entry.exposures ||= {}
  if (group === 'assumptions') {
    entry.assumptions[field] = numeric
  } else entry.exposures[field] = numeric
  recalculate(); renderDynamic({ skipDetail: true })
  return true
}

if (root) {
  root.addEventListener('click', event => {
    const scenario = event.target.closest('[data-scenario-id]')
    if (scenario) { uiState.scenarioId = scenario.dataset.scenarioId; matrixCache = null; recalculate(); renderReady(); return }
    const numericPreset = event.target.closest('[data-control-preset-id]')
    if (numericPreset) { updateControl(numericPreset.dataset.controlPresetId, numericPreset.dataset.controlPresetValue); renderReady(); return }
    const preset = event.target.closest('[data-scenario-preset]')
    if (preset) {
      const presetDefinition = scenarioById(uiState.scenarioId).presets?.[preset.dataset.scenarioPreset]
      if (presetDefinition) {
        const values = clone(presetDefinition.inputs || presetDefinition)
        Object.assign(currentRequest().inputs, values)
        for (const id of Object.keys(values)) uiState.touchedControls[`${uiState.scenarioId}:${id}`] = true
      }
      recalculate(); renderReady(); return
    }
    if (event.target.closest('[data-scenario-reset]')) {
      uiState.requests[uiState.scenarioId] = newSessionRequest(uiState.scenarioId)
      inputMessage = ''
      recalculate(); renderReady(); return
    }
    const duration = event.target.closest('[data-duration]')
    if (duration) { updateControl('durationMonths', Number(duration.dataset.duration)); renderReady(); return }
    const company = event.target.closest('tr[data-company-row][data-company-id]')
    if (company) { uiState.selectedCompanyId = company.dataset.companyId; saveState(); renderDynamic(); root.querySelector('.scenario-company-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    if (event.target.closest('[data-sort-representatives]')) { uiState.sortRepresentativesByAbs = !uiState.sortRepresentativesByAbs; saveState(); renderDynamic({ skipDetail: true }); return }
    if (event.target.closest('[data-toggle-quotes]')) { uiState.showObservedQuotes = !uiState.showObservedQuotes; saveState(); const detail = root.querySelector('[data-scenario-detail]'); if (detail) detail.innerHTML = companyDetail(); return }
    if (event.target.closest('[data-scenario-retry]')) initialize({ force: true })
  })
  root.addEventListener('input', event => {
    const control = event.target.closest('[data-scenario-control]')
    if (control) { updateControl(control.dataset.scenarioControl, control.value, { element: control }); return }
    const assumption = event.target.closest('[data-company-assumption]')
    if (assumption) { updateCompanyOverride(assumption.dataset.companyId, 'assumptions', assumption.dataset.companyAssumption, assumption.value, assumption); return }
    const exposure = event.target.closest('[data-company-exposure]')
    if (exposure) { updateCompanyOverride(exposure.dataset.companyId, 'exposures', exposure.dataset.companyExposure, exposure.value, exposure); return }
    const search = event.target.closest('[data-company-search]')
    if (search) { uiState.companySearch = search.value.slice(0, 80); saveState(); const host = root.querySelector('[data-other-table]'); if (host) host.innerHTML = companyTable(filteredOtherRows(), '기타 기업 결과', sharedBarScale()) }
  })
  root.addEventListener('change', event => {
    const assumption = event.target.closest('[data-company-assumption]')
    if (assumption) {
      if (updateCompanyOverride(assumption.dataset.companyId, 'assumptions', assumption.dataset.companyAssumption, assumption.value, assumption)) renderDynamic()
      return
    }
    const exposure = event.target.closest('[data-company-exposure]')
    if (exposure) {
      if (updateCompanyOverride(exposure.dataset.companyId, 'exposures', exposure.dataset.companyExposure, exposure.value, exposure)) renderDynamic()
      return
    }
  })
  root.addEventListener('keydown', event => {
    const row = event.target.closest('tr[data-company-row][data-company-id]')
    if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); row.click() }
  })
  root.addEventListener('toggle', event => {
    if (event.target.matches('.scenario-methodology details')) event.target.querySelector('summary i').textContent = event.target.open ? '−' : '＋'
  }, true)
}

window.renderScenario = () => {
  if (!active()) return
  if (initialized) renderReady()
  else initialize()
}
window.addEventListener('hashchange', window.renderScenario)
window.addEventListener('market-snapshot', event => {
  marketSnapshot = event.detail
  const editingDetail = root?.contains?.(document.activeElement) && document.activeElement?.matches?.('[data-company-assumption],[data-company-exposure]')
  if (active() && initialized) renderDynamic({ skipDetail: editingDetail })
})
window.addEventListener('market-snapshot-error', () => {
  marketSnapshot = null
  const editingDetail = root?.contains?.(document.activeElement) && document.activeElement?.matches?.('[data-company-assumption],[data-company-exposure]')
  if (active() && initialized) renderDynamic({ skipDetail: editingDetail })
})
window.renderScenario()
