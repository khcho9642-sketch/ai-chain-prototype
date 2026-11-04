const root = document.getElementById('v-scenario')

const STORAGE_KEY = 'ai-chain.scenario.v1'
const STORAGE_VERSION = 1
const DURATION = { min: 6, max: 36, step: 6, defaultValue: 12 }
const EXPECTED_SCENARIOS = ['interest_rate', 'hyperscaler_capex', 'hbm_market', 'gpu_dc_rent', 'model_growth']
const EXPECTED_SEGMENTS = [
  '반도체 소부장', '파운드리·패키징', '메모리', 'AI 칩', 'AI 장비',
  '전력·냉각', '데이터센터', '클라우드·GPU 컴퓨팅', 'AI 모델',
]
const BIG7_ORDER = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']
const ASSUMPTION_FIELD_META = [
  { id: 'baseGrowthPct', label: '기준 매출 성장률', unit: '%', step: 0.5 },
  { id: 'fcffMarginPct', label: 'FCFF 마진', unit: '%', step: 0.5 },
  { id: 'capexToRevenuePct', label: 'CAPEX ÷ 매출', unit: '%', step: 0.5 },
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
let uiState
let result
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
  const requests = Object.fromEntries(dataModule.SCENARIO_DEFINITIONS.map(item => [item.id, defaultRequest(item.id)]))
  const first = dataModule.SCENARIO_DEFINITIONS[0].id
  const fallback = {
    version: STORAGE_VERSION, scenarioId: first, requests, selectedCompanyId: dataModule.BIG7_COMPANY_IDS[0],
    segmentFilter: 'all', companySearch: '',
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || parsed.version !== STORAGE_VERSION) return fallback
    for (const id of Object.keys(requests)) {
      try { requests[id] = sanitizeRequest(id, parsed.requests?.[id]) } catch { /* keep a verified default */ }
    }
    return {
      ...fallback,
      scenarioId: scenarioById(parsed.scenarioId) ? parsed.scenarioId : first,
      requests,
      selectedCompanyId: companyById(parsed.selectedCompanyId) ? parsed.selectedCompanyId : fallback.selectedCompanyId,
      segmentFilter: parsed.segmentFilter === 'all' || segmentById(parsed.segmentFilter) ? parsed.segmentFilter : 'all',
      companySearch: typeof parsed.companySearch === 'string' ? parsed.companySearch.slice(0, 80) : '',
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
    engineError = null
    inputMessage = ''
    saveState()
  } catch (error) {
    result = null
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

function numberInput(control, value, attributes = '') {
  const output = `${Number(value) > 0 ? '+' : ''}${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${control.unit || ''}`
  return `<div class="scenario-control" data-control-wrap="${esc(control.id)}">
    <div class="scenario-control-head"><label for="scenario-${esc(control.id)}">${esc(control.label)}</label><output data-control-output="${esc(control.id)}">${esc(output)}</output></div>
    ${control.description ? `<p>${esc(control.description)}</p>` : ''}
    <div class="scenario-control-pair">
      <input id="scenario-${esc(control.id)}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" data-scenario-control="${esc(control.id)}" aria-label="${esc(control.label)} 범위" ${attributes}>
      <span class="scenario-signed-input"><input type="number" inputmode="decimal" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" data-scenario-control="${esc(control.id)}" aria-label="${esc(control.label)} 직접 입력"><small>${esc(control.unit || '')}</small></span>
    </div>
  </div>`
}

function scenarioCards() {
  return `<div class="scenario-picker" role="group" aria-label="시나리오 선택">${dataModule.SCENARIO_DEFINITIONS.map((item, index) => `
    <button type="button" class="scenario-choice${item.id === uiState.scenarioId ? ' selected' : ''}" data-scenario-id="${esc(item.id)}" aria-pressed="${item.id === uiState.scenarioId}">
      <span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(item.name)}</strong><small>${esc(item.description)}</small>
    </button>`).join('')}</div>`
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

function controls() {
  const definition = scenarioById(uiState.scenarioId), request = currentRequest()
  const presets = Object.entries(definition.presets || {})
  return `<section class="scenario-panel scenario-inputs" aria-labelledby="scenario-input-heading">
    <div class="scenario-section-heading"><div><p class="scenario-eyebrow">CONDITIONAL INPUTS</p><h2 id="scenario-input-heading">충격 가정 조정</h2></div><button type="button" class="scenario-reset" data-scenario-reset>이 시나리오 초기화</button></div>
    <p class="scenario-lead">슬라이더와 숫자 입력은 같은 값을 공유합니다. 양수·음수를 직접 입력하면 즉시 다시 계산됩니다.</p>
    ${presets.length ? `<div class="scenario-presets" role="group" aria-label="시나리오 수치 프리셋">${presets.map(([id, values]) => `<button type="button" data-scenario-preset="${esc(id)}" title="${esc(id)}">${esc(presetText(definition, values))}</button>`).join('')}</div>` : ''}
    <div class="scenario-control-grid">${(definition.controls || []).map(control => numberInput(control, request.inputs[control.id])).join('')}
      ${numberInput({ id: 'durationMonths', label: '충격 지속기간', unit: '개월', ...DURATION }, request.durationMonths, 'data-duration-control')}
    </div>
    ${uiState.scenarioId === 'model_growth' ? `<div class="scenario-derived-input" data-model-growth-helper>${modelGrowthHelperContent()}</div>` : ''}
    <div class="scenario-duration-shortcuts" role="group" aria-label="충격 지속기간 빠른 선택">${[6, 12, 24, 36].map(months => `<button type="button" data-duration="${months}" aria-pressed="${Number(request.durationMonths) === months}">${months}개월</button>`).join('')}</div>
    <p class="scenario-note">지속기간 뒤 충격은 ${esc(dataModule.MODEL_ASSUMPTIONS.shockFadeMonths)}개월에 걸쳐 선형 정상화하며, 터미널 가치에 영구 반영하지 않습니다.</p>
  </section>`
}

function resultSummary() {
  if (!result) return calculationError()
  const big7 = Array.isArray(result.big7) ? result.big7 : result.big7?.members || result.companies.filter(item => item.isBig7)
  const big7Values = big7.map(item => valueFrom(item, 'scenarioValueIndex', 'valueIndex')).filter(finite)
  const average = big7Values.length === big7.length && big7.length ? big7Values.reduce((sum, value) => sum + Number(value), 0) / big7Values.length : null
  const strongest = [...result.segments].sort((a, b) => Math.abs(valueFrom(b, 'changePct', 'valueChangePct') || 0) - Math.abs(valueFrom(a, 'changePct', 'valueChangePct') || 0))[0]
  const strongestChange = valueFrom(strongest, 'changePct', 'valueChangePct')
  const noSegmentChange = finite(strongestChange) && Math.abs(Number(strongestChange)) < 0.0001
  const checksOk = !result.checks || Object.entries(result.checks).every(([key, value]) => key === 'terminalShockApplied' ? value === false : typeof value === 'boolean' ? value : finite(value))
  return `<section class="scenario-summary" aria-live="polite">
    <div><span>Big 7 단순평균 지수</span><strong>${indexValue(average)}</strong><small class="${impactClass(finite(average) ? average - 100 : null)}">${finite(average) ? `${signed(average - 100)} · 기준 100` : '7개 기업 결과 확인 필요'}</small></div>
    <div><span>가장 민감한 섹터</span><strong>${esc(noSegmentChange ? '변화 없음' : strongest?.name || segmentById(segmentId(strongest))?.name || '—')}</strong><small class="${impactClass(strongestChange)}">${signed(strongestChange)}</small></div>
    <div><span>계산 점검</span><strong>${checksOk ? '통과' : '확인 필요'}</strong><small>${esc(result.model?.horizonMonths ? `${result.model.horizonMonths}개월 명시적 현금흐름` : `${dataModule.MODEL_ASSUMPTIONS.forecastYears}년 예시 모형`)}</small></div>
  </section>`
}

function calculationError() {
  return `<section class="scenario-unavailable" role="alert"><strong>시나리오 결과를 표시하지 못했습니다.</strong><p>${esc(engineError || '계산 입력과 모형을 확인해 주세요.')}</p><p>임의 값이나 이전 계산값으로 대체하지 않습니다.</p></section>`
}

function segmentCards() {
  if (!result) return calculationError()
  const map = new Map(result.segments.map(item => [String(segmentId(item)), item]))
  return `<section class="scenario-panel" aria-labelledby="scenario-segment-heading">
    <div class="scenario-section-heading"><div><p class="scenario-eyebrow">9-SEGMENT TRANSMISSION</p><h2 id="scenario-segment-heading">9개 섹터 영향</h2></div><span class="scenario-honesty">가정 기반 계산 · 기준 100</span></div>
    <div class="scenario-segment-grid">${dataModule.SEGMENTS.map((segment, index) => {
      const id = segment.segmentId ?? segment.id, item = map.get(String(id)), change = valueFrom(item, 'changePct', 'valueChangePct'), value = valueFrom(item, 'scenarioValueIndex', 'valueIndex')
      const width = Math.min(100, Math.abs(change || 0) * 5)
      return `<article class="scenario-segment-card ${impactClass(change)}"><div><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(segment.name)}</strong></div><p><b>${indexValue(value)}</b><small>${signed(change)}</small></p><div class="scenario-impact-track" aria-hidden="true"><i style="--impact:${width}%"></i></div></article>`
    }).join('')}</div><p class="scenario-note scenario-segment-note">섹터 지수는 역할별 기준 모형이며, 기업별 결과의 평균이 아닙니다.</p>
  </section>`
}

function observedQuote(item) {
  const source = companyById(companyId(item)), quote = quoteFor(item.symbol || source?.symbol)
  if (!quote) return ''
  const ratio = item.valuation?.equityValueRatio
  const ready = item.valuation?.quoteLinkStatus === 'ready-for-observed-price-ratio-only' && finite(ratio) && Number(ratio) > 0
  const converted = ready ? Number(quote.price) * Number(ratio) : null
  const unavailable = {
    'missing-same-date-net-debt-to-ev': '동일 기준일 순차입금/EV 가정 미입력 · 환산주가 미산정',
    'unavailable-nonpositive-equity': '주주가치가 양수가 아니어서 환산주가 미산정',
  }[item.valuation?.quoteLinkStatus] || 'EV→주주가치 브리지 미완료 · 환산주가 미산정'
  return `<div class="scenario-quote-observation"><span><b>${esc(item.name || source?.name)}</b><small>${esc(item.symbol || source?.symbol)}</small></span><strong>${Number(quote.price).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${esc(quote.currency)} <em>관측</em></strong><small>${esc(quote.source || '시세 출처 미제공')} · 관측 ${esc(quoteTime(quote))} · 수집 ${esc(isoTime(quote.fetchedAt))}</small>${ready ? `<span class="scenario-linked-quote"><small>관측시가 기준 환산주가</small><b>${converted.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${esc(quote.currency)}</b><small>순차입금/EV 가정으로 EV→주주가치 브리지 · 내재가치 아님</small></span>` : `<small>${esc(unavailable)}</small>`}</div>`
}

function companyCard(item, compact = false) {
  const id = companyId(item), source = companyById(id) || {}, change = valueFrom(item, 'valueChangePct', 'changePct')
  const index = valueFrom(item, 'scenarioValueIndex', 'valueIndex'), segment = segmentById(item.primarySegmentId ?? source.primarySegmentId)
  return `<button type="button" class="scenario-company-card ${impactClass(change)}${id === uiState.selectedCompanyId ? ' selected' : ''}${compact ? ' compact' : ''}" data-company-id="${esc(id)}" aria-pressed="${id === uiState.selectedCompanyId}">
    <span class="scenario-company-name"><strong>${esc(item.name || source.name)}</strong><small>${esc(item.symbol || source.symbol || '비상장')}</small></span>
    <span class="scenario-company-segment">${esc(segment?.name || '구간 미확인')}</span>
    <span class="scenario-company-index"><b>${indexValue(index)}</b><small>${signed(change)}</small></span>
  </button>`
}

function big7Section() {
  if (!result) return ''
  const byId = new Map(result.companies.map(item => [companyId(item), item]))
  const ids = dataModule.BIG7_COMPANY_IDS
    .slice()
    .sort((a, b) => BIG7_ORDER.indexOf(companyById(a)?.symbol) - BIG7_ORDER.indexOf(companyById(b)?.symbol))
  return `<section class="scenario-panel scenario-big7" aria-labelledby="scenario-big7-heading">
    <div class="scenario-section-heading"><div><p class="scenario-eyebrow">ALWAYS ON · BIG 7</p><h2 id="scenario-big7-heading">Big 7 결과</h2></div><span class="scenario-honesty">기업별 가정 보기</span></div>
    <p class="scenario-note">Big 7은 항상 표시하며 기업당 한 번만 평균합니다. Tesla를 포함한 표준 7개 기업입니다.</p>
    <div class="scenario-company-grid big7-grid">${ids.map(id => byId.get(id)).filter(Boolean).map(item => companyCard(item)).join('')}</div>
    <details class="scenario-market-observations"><summary>Big 7 실제 관측시가 별도 보기</summary><p class="scenario-note">정상 상태의 유효 시세만 표시합니다. 회사 상세에서 순차입금/EV를 명시해야 EV→주주가치 환산이 활성화됩니다.</p><div>${ids.map(id => byId.get(id)).filter(Boolean).map(observedQuote).filter(Boolean).join('') || '<p class="scenario-note">표시할 정상 관측시가가 없습니다.</p>'}</div></details>
  </section>`
}

function filteredOtherCompanies() {
  if (!result) return ''
  const big7 = new Set(dataModule.BIG7_COMPANY_IDS), needle = uiState.companySearch.trim().toLocaleLowerCase('ko-KR')
  return result.companies.filter(item => {
    const id = companyId(item), source = companyById(id) || {}, segmentIds = item.segmentIds || source.segmentIds || [item.primarySegmentId ?? source.primarySegmentId]
    if (big7.has(id)) return false
    if (uiState.segmentFilter !== 'all' && !segmentIds.map(String).includes(String(uiState.segmentFilter))) return false
    return !needle || `${item.name || source.name} ${item.symbol || source.symbol || ''}`.toLocaleLowerCase('ko-KR').includes(needle)
  })
}

function otherCompanyCards() {
  const companies = filteredOtherCompanies()
  return companies.length ? companies.map(item => companyCard(item, true)).join('') : '<p class="scenario-empty">조건에 맞는 대표기업이 없습니다.</p>'
}

function otherCompaniesSection() {
  if (!result) return ''
  return `<section class="scenario-panel" aria-labelledby="scenario-reps-heading">
    <div class="scenario-section-heading"><div><p class="scenario-eyebrow">REPRESENTATIVE COMPANIES</p><h2 id="scenario-reps-heading">섹터별 대표기업</h2></div><span class="scenario-honesty">대표기업만 · 전체 시장 아님</span></div>
    <div class="scenario-company-filters"><label>섹터<select data-company-segment-filter><option value="all">9개 전체</option>${dataModule.SEGMENTS.map(segment => { const id = segment.segmentId ?? segment.id; return `<option value="${esc(id)}"${String(uiState.segmentFilter) === String(id) ? ' selected' : ''}>${esc(segment.name)}</option>` }).join('')}</select></label><label>기업 검색<input type="search" data-company-search value="${esc(uiState.companySearch)}" placeholder="기업명 · 티커"></label></div>
    <div class="scenario-company-grid reps-grid">${otherCompanyCards()}</div>
  </section>`
}

function sourceExposure(company, driverId) {
  const id = companyId(company), override = currentRequest().companyOverrides?.[id]?.exposures?.[driverId]
  if (finite(override)) return Number(override)
  return finite(company.assumptions?.driverExposureMultipliers?.[driverId]) ? Number(company.assumptions.driverExposureMultipliers[driverId]) : 1
}

function operatingBridge(company) {
  const valuation = company.valuation || {}, rows = valuation.operatingBridge || []
  if (!rows.length) return ''
  const delta = (value, suffix = '') => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}${suffix}` : '—'
  const level = (value, suffix = '') => finite(value) ? `${Number(value).toFixed(2)}${suffix}` : '—'
  return `<div class="scenario-operating-bridge"><div><h3>재무 드라이버 브리지</h3><p class="scenario-note">시작 매출 100의 정규화 단위입니다. 실제 회사 재무나 컨센서스가 아닙니다.</p></div><div class="scenario-bridge-scroll"><table><thead><tr><th>연도</th><th>물량</th><th>ASP</th><th>단위원가 증감</th><th>CAPEX 현금유출 증감</th><th>할인율</th><th>기준 FCFF</th><th>시나리오 FCFF</th></tr></thead><tbody>${rows.map((row, index) => `<tr><th>${esc(row.year)}년</th><td>${delta(row.revenueVolumePct, '%')}</td><td>${delta(row.aspPct, '%')}</td><td>${delta(row.incrementalUnitCostUnits)}</td><td>${delta(row.incrementalCapexCashoutUnits)}</td><td>${level(valuation.scenarioDiscountRatesPct?.[index], '%')}</td><td>${level(valuation.baselineFcff?.[index])}</td><td>${level(valuation.scenarioFcff?.[index])}</td></tr>`).join('')}</tbody></table></div></div>`
}

function companyDetail() {
  if (!result) return ''
  const company = result.companies.find(item => companyId(item) === uiState.selectedCompanyId) || result.companies[0]
  if (!company) return ''
  const id = companyId(company), source = companyById(id) || {}, change = valueFrom(company, 'valueChangePct', 'changePct'), index = valueFrom(company, 'scenarioValueIndex', 'valueIndex')
  const contributions = company.driverContributions || [], paths = company.paths || []
  return `<section class="scenario-panel scenario-company-detail" aria-labelledby="scenario-company-detail-heading">
    <div class="scenario-detail-hero"><div><p class="scenario-eyebrow">COMPANY DETAIL · EDITABLE</p><h2 id="scenario-company-detail-heading">${esc(company.name || source.name)} <small>${esc(company.symbol || source.symbol || '비상장')}</small></h2><p>${esc(segmentById(company.primarySegmentId ?? source.primarySegmentId)?.name || '')} · ${source.listingStatus === 'private' || company.listingStatus === 'private' ? '비상장' : '상장 대표기업'}</p></div><div class="scenario-detail-index"><span>조건부 가치지수</span><strong>${indexValue(index)}</strong><small class="${impactClass(change)}">${signed(change)} · 기준 100</small></div></div>
    <div class="scenario-detail-columns"><div><h3>기업별 가치평가 가정</h3><p class="scenario-note">아래 변경은 이 기업에만 적용됩니다. 입력 삭제 시 모형 기본값으로 돌아갑니다. 순차입금/EV를 입력해야 주주가치 브리지가 활성화됩니다.</p><div class="scenario-assumption-grid">${assumptionFields().map(field => {
      const value = field.optional
        ? currentRequest().companyOverrides?.[id]?.assumptions?.[field.id]
        : company.assumptions?.[field.id]
      return `<label><span>${esc(field.label)}${field.optional ? ' · 선택' : ''}</span><span class="scenario-signed-input"><input type="number" inputmode="decimal" min="${field.min}" max="${field.max}" step="${field.step}" value="${finite(value) ? value : ''}" placeholder="${field.optional ? '미입력' : ''}" data-company-assumption="${esc(field.id)}" data-company-id="${esc(id)}"><small>${field.unit}</small></span></label>`
    }).join('')}</div></div>
    <div><h3>전파 노출과 기여도</h3>${contributions.length ? `<div class="scenario-driver-list">${contributions.map(item => {
      const exposure = sourceExposure(company, item.driverId), points = valueFrom(item, 'valueIndexPoints', 'impactPoints', 'contribution')
      return `<div class="scenario-driver"><div><strong>${esc(item.label || driverLabel(item.driverId))}</strong><small>${finite(points) ? `${Number(points) > 0 ? '+' : ''}${Number(points).toFixed(2)} 지수p` : '기여도 미제공'}</small></div>${finite(exposure) ? `<label>노출 배수<input type="number" inputmode="decimal" min="0" max="2" step="0.05" value="${exposure}" data-company-exposure="${esc(item.driverId)}" data-company-id="${esc(id)}"></label>` : ''}</div>`
    }).join('')}</div>` : '<p class="scenario-note">이 시나리오의 기업별 드라이버 기여도가 없습니다.</p>'}</div></div>
    <div class="scenario-paths"><h3>왜 이렇게 움직였나</h3>${paths.length ? `<ol>${paths.map(path => `<li><b>${esc(driverLabel(path.driverId))}</b><span>${(path.segments || []).map(id => segmentById(id)?.name || id).map(esc).join(' → ')}</span><strong>${finite(path.impactPoints) ? `${Number(path.impactPoints) > 0 ? '+' : ''}${Number(path.impactPoints).toFixed(2)} 지수p` : ''}</strong></li>`).join('')}</ol>` : '<p class="scenario-note">표시할 전파 경로가 없습니다.</p>'}</div>
    ${operatingBridge(company)}
    ${observedQuote(company)}
  </section>`
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
      <div class="scenario-method-callouts"><p><b>조건부 가치지수</b> 기준값을 100으로 놓고 시나리오 충격에 따른 상대 변화를 표시합니다. 현재 주가나 내재가치의 절대 추정이 아닙니다.</p><p><b>전파 구조</b> 외생 충격 → 섹터 → 기업 노출 → ${esc(result?.model?.horizonMonths ? `${result.model.horizonMonths}개월` : `${assumptions.forecastYears}년`)} 명시적 현금흐름을 분리합니다. 충격 종료 뒤 ${esc(assumptions.shockFadeMonths)}개월에 걸쳐 정상화합니다.</p><p><b>근거 상태</b> 현재 계수는 예시 가정이며 실제 사건으로 보정된 확률·예측 모형이 아닙니다.</p></div>
      <div class="scenario-matrix-wrap"><table class="scenario-matrix"><caption>표 머리글에 표시한 고정 참조 충격의 섹터별 가치지수 변화율</caption><thead><tr><th>섹터</th>${matrix.map(column => `<th>${esc(column.scenario.name)}<small>${esc(column.inputLabel)}</small></th>`).join('')}</tr></thead><tbody>${dataModule.SEGMENTS.map(segment => { const id = segment.segmentId ?? segment.id; return `<tr><th>${esc(segment.name)}</th>${matrix.map(column => { const value = column.values.get(String(id)); return `<td class="${impactClass(value)}">${signed(value)}</td>` }).join('')}</tr>` }).join('')}</tbody></table></div>
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

function renderDynamic({ skipDetail = false } = {}) {
  if (!root || !initialized) return
  const summary = root.querySelector('[data-scenario-summary]')
  const segments = root.querySelector('[data-scenario-segments]')
  const companies = root.querySelector('[data-scenario-companies]')
  const detail = root.querySelector('[data-scenario-detail]')
  const warningHost = root.querySelector('[data-scenario-warnings]')
  if (summary) summary.innerHTML = resultSummary()
  if (segments) segments.innerHTML = segmentCards()
  if (companies) companies.innerHTML = big7Section() + otherCompaniesSection()
  if (detail && !skipDetail) detail.innerHTML = companyDetail()
  if (warningHost) warningHost.innerHTML = warnings()
}

function renderReady() {
  const definition = scenarioById(uiState.scenarioId)
  root.innerHTML = `<div class="scenario-shell">
    <header class="scenario-hero"><div><p class="scenario-eyebrow">AI VALUE CHAIN · SCENARIO ANALYSIS</p><h1>충격이 전파되면 기업가치는 어떻게 달라질까</h1><p>5개 외생 시나리오를 9개 섹터와 대표기업의 재무 가정으로 연결합니다. 결과는 조건부 가치지수이며 목표주가·확률예측이 아닙니다.</p></div><div class="scenario-hero-badges"><span>가정 기반 계산 · 기준 100</span></div></header>
    <section class="scenario-panel scenario-select" aria-labelledby="scenario-select-heading"><div class="scenario-section-heading"><div><p class="scenario-eyebrow">CHOOSE ONE SHOCK</p><h2 id="scenario-select-heading">5개 시나리오</h2></div><span class="scenario-selected-name">현재 · ${esc(definition.name)}</span></div>${scenarioCards()}</section>
    ${controls()}
    <div data-scenario-summary>${resultSummary()}</div>
    <div data-scenario-warnings>${warnings()}</div>
    <div data-scenario-segments>${segmentCards()}</div>
    <div data-scenario-companies>${big7Section()}${otherCompaniesSection()}</div>
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
    ;[dataModule, coreModule] = await Promise.all([
      import(`./scenario-data.js${suffix}`),
      import(`./scenario-core.js${suffix}`),
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
  for (const input of root.querySelectorAll(`[data-scenario-control="${CSS.escape(id)}"]`)) if (input !== document.activeElement || input.type === 'range') input.value = id === 'durationMonths' ? request.durationMonths : request.inputs[id]
  const value = id === 'durationMonths' ? request.durationMonths : request.inputs[id]
  const output = root.querySelector(`[data-control-output="${CSS.escape(id)}"]`)
  if (output) output.textContent = `${Number(value) > 0 && id !== 'durationMonths' ? '+' : ''}${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${control.unit || ''}`
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
    const preset = event.target.closest('[data-scenario-preset]')
    if (preset) {
      const presetDefinition = scenarioById(uiState.scenarioId).presets?.[preset.dataset.scenarioPreset]
      if (presetDefinition) Object.assign(currentRequest().inputs, clone(presetDefinition.inputs || presetDefinition))
      recalculate(); renderReady(); return
    }
    if (event.target.closest('[data-scenario-reset]')) {
      uiState.requests[uiState.scenarioId] = defaultRequest(uiState.scenarioId)
      inputMessage = ''
      recalculate(); renderReady(); return
    }
    const duration = event.target.closest('[data-duration]')
    if (duration) { updateControl('durationMonths', Number(duration.dataset.duration)); renderReady(); return }
    const company = event.target.closest('button.scenario-company-card[data-company-id]')
    if (company) { uiState.selectedCompanyId = company.dataset.companyId; saveState(); renderDynamic(); root.querySelector('.scenario-company-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
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
    if (search) { uiState.companySearch = search.value.slice(0, 80); saveState(); const grid = root.querySelector('.reps-grid'); if (grid) grid.innerHTML = otherCompanyCards() }
  })
  root.addEventListener('change', event => {
    if (event.target.matches('[data-company-assumption],[data-company-exposure]')) { renderDynamic(); return }
    if (event.target.matches('[data-company-segment-filter]')) { uiState.segmentFilter = event.target.value; saveState(); const host = root.querySelector('[data-scenario-companies]'); if (host) host.innerHTML = big7Section() + otherCompaniesSection(); return }
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
