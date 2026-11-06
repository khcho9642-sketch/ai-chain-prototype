import { monthNumber, orderedPoints, yearOnYear } from './industry-core.js'
import { EPOCH_DATASETS, EPOCH_SOURCE } from './epoch-ai-core.js'

// Mapping is by the measured business or product, independent of the old numeric chain tags.
const monthly = (id, scope, relation = 'direct') => ({ kind: 'monthly', id, scope, relation })
const observation = (id, scope, relation = 'direct') => ({ kind: 'observations', id, scope, relation })
const comparison = (dataset, field, name, scope, relation = 'direct') => ({
  kind: 'comparison', id: `epoch-${dataset}-${field}`, dataset, field, name, scope, relation,
})

const sectorCatalog = {
  'semiconductor-equipment': [
    observation('global_silicon_wafer_shipments', '세계 반도체용 실리콘 웨이퍼 출하면적'),
    observation('asml_lithography_systems_sold', 'ASML 신규·중고 노광장비'),
    observation('global_semiconductor_equipment_billings', '세계 반도체 제조장비 매출'),
    observation('global_semiconductor_sales_3mma', '세계 반도체 전체 매출 · 소부장 수요 참고 지표', 'reference'),
    observation('china_ic_output', '중국 집적회로 전체 생산량 · 소부장 수요 참고 지표', 'reference'),
  ],
  'foundry-packaging': [
    monthly('tsmc-revenue', 'TSMC 전체 월매출'),
    observation('global_semiconductor_sales_3mma', '세계 반도체 전체 매출 · 파운드리 수요 참고 지표', 'reference'),
    observation('global_silicon_wafer_shipments', '세계 반도체용 웨이퍼 출하면적 · 생산활동 참고 지표', 'reference'),
    observation('china_ic_output', '중국 집적회로 전체 생산량 · 파운드리 업황 참고 지표', 'reference'),
    monthly('kr-semiconductor-volume', '한국 반도체 수출 전체 · 파운드리 업황 참고 지표', 'reference'),
  ],
  memory: [
    monthly('kr-semiconductor-volume', '반도체 전체 기준 · 메모리 참고 지표', 'reference'),
    observation('micron_cloud_memory_revenue', 'Micron Cloud Memory 사업부 전체 · 회계분기'),
    monthly('kr-semiconductor-production', '국내 반도체 제조업 전체 · 메모리 참고 지표', 'reference'),
    monthly('kr-semiconductor-shipments', '국내 반도체 제조업 전체 · 메모리 참고 지표', 'reference'),
    monthly('kr-semiconductor-inventory', '국내 반도체 제조업 전체 · 메모리 참고 지표', 'reference'),
    monthly('kr-semiconductor-value-index', '반도체 전체 기준 · 메모리 참고 지표', 'reference'),
    monthly('kr-semiconductor-export-usd', '한국 반도체 수출 전체 · 메모리 참고 지표', 'reference'),
    comparison('hardware', 'memory', '가속기별 탑재 메모리 용량', 'Epoch AI에 수록된 가속기 사양 · 메모리 수요 참고 지표', 'reference'),
  ],
  'ai-chips': [
    observation('broadcom_ai_semiconductor_revenue', 'Broadcom 공시 기준 AI 반도체 매출'),
    observation('nvidia_data_center_revenue', 'NVIDIA 데이터센터 사업 전체 · 칩 수요 참고 지표', 'reference'),
    observation('amd_data_center_revenue', 'AMD 서버 CPU와 데이터센터 GPU를 포함한 사업부 매출', 'reference'),
    comparison('hardware', 'fp8', '가속기별 FP8 성능', '공개 사양 기준 · FP8 정밀도'),
    comparison('chip-sales', 'units', '칩·기간별 판매량 추정', 'Epoch AI 추정치 · 칩과 집계 기간별 비교'),
    comparison('hardware', 'price', '가속기별 출시 가격', '공개된 칩·가속기 출시 가격'),
    comparison('hardware', 'memory', '가속기별 탑재 메모리 용량', '공개된 칩·가속기 사양'),
    comparison('hardware', 'tdp', '가속기별 설계 전력', '공개된 칩·가속기 설계 전력'),
    comparison('chip-sales', 'h100', '칩·기간별 H100 환산 판매량', '칩 판매 연산능력의 H100 환산 중앙값 · 기간별 추정'),
  ],
  'ai-equipment': [
    observation('nvidia_data_center_revenue', 'NVIDIA 데이터센터 컴퓨팅·네트워킹 사업 매출 · 장비 수요 참고 지표', 'reference'),
    observation('amd_data_center_revenue', '서버 CPU·데이터센터 GPU 사업 매출 · 장비 수요 참고 지표', 'reference'),
    monthly('kr-electronics-volume', '한국 전자·광학기기 수출 전체 · 장비 업황 참고 지표', 'reference'),
    comparison('hardware', 'tdp', '가속기별 설계 전력', '서버에 탑재하는 가속기 사양 · 장비 설계 참고 지표', 'reference'),
  ],
  'power-cooling': [
    monthly('kr-transformer-volume', '한국 변압기 수출 전체 · 전력설비 수요 참고 지표', 'reference'),
    monthly('kr-transformer-value-index', '한국 변압기 수출 전체 · 전력설비 수요 참고 지표', 'reference'),
    monthly('kr-electrical-volume', '한국 전기장비 수출 전체 · 전력설비 수요 참고 지표', 'reference'),
    observation('ge_vernova_data_center_orders_ytd', 'GE Vernova가 공개한 데이터센터 관련 누적 주문액'),
    observation('vertiv_net_sales', 'Vertiv 전체 매출 · 전력·냉각 인프라 공급사 실적', 'reference'),
    observation('us_commercial_electricity_price', '미국 상업용 평균 전기요금 · 전력비 참고 지표', 'reference'),
    observation('global_data_center_electricity_consumption', '전 세계 데이터센터 전력소비 추정 · 전력 수요 참고 지표', 'reference'),
    observation('ge_vernova_backlog_rpo', 'GE Vernova 전사 수주잔고 · 전력설비 공급사 참고 지표', 'reference'),
    observation('ge_vernova_gas_equipment_reserved_capacity', 'GE Vernova 가스발전 장비 수주·예약 전체 · 발전설비 공급 참고 지표', 'reference'),
    comparison('data-centers', 'power', '시설별 IT 전력용량 추정', 'Epoch AI 주요 AI 데이터센터 · 전력 수요 참고 지표', 'reference'),
  ],
  'data-centers': [
    observation('cbre_primary_na_dc_vacancy', 'CBRE 북미 주요시장 표본'),
    observation('cbre_primary_na_dc_capacity', 'CBRE 북미 주요시장 표본'),
    observation('cbre_primary_na_dc_construction', 'CBRE 북미 주요시장 표본'),
    observation('cbre_primary_na_dc_net_absorption', 'CBRE 북미 주요시장 표본'),
    observation('equinix_affo', 'Equinix 공시 기준 AFFO'),
    observation('equinix_cabinet_utilization', 'Equinix 캐비닛 가동률'),
    observation('global_data_center_electricity_consumption', '세계 데이터센터 전체의 연간 전력소비 추정'),
    comparison('data-centers', 'power', '시설별 IT 전력용량 추정', 'Epoch AI가 추적하는 주요 AI 데이터센터'),
    comparison('data-centers', 'h100', '시설별 H100 환산량 추정', 'Epoch AI가 추적하는 주요 AI 데이터센터'),
    comparison('data-centers', 'capitalCost', '시설별 자본비용 추정', 'Epoch AI 주요 AI 데이터센터 · 2025년 달러 기준'),
  ],
  'cloud-gpu': [
    observation('aws_revenue', 'Amazon Web Services 사업부 전체'),
    observation('azure_other_cloud_revenue_yoy', 'Microsoft Azure 및 기타 클라우드 서비스'),
    observation('google_cloud_revenue', 'Google Cloud Platform과 Workspace를 포함한 사업부 매출'),
    observation('alibaba_ai_cloud_compute_revenue', 'Alibaba AI Cloud and Compute Services 사업부'),
    observation('alibaba_ai_related_product_revenue', 'Alibaba 클라우드 사업부 내 AI 관련 제품'),
    observation('microsoft_cloud_revenue', 'Microsoft가 공시하는 전체 클라우드 사업 기준'),
    observation('china_intelligent_compute_capacity_fp16', '중국 전체 FP16 환산 연산능력 · 공급 참고 지표', 'reference'),
  ],
  'ai-models': [
    observation('openai_company_annualized_revenue', 'OpenAI 회사 전체 · 발표 시점의 연환산 매출', 'reference'),
    observation('anthropic_company_annualized_revenue', 'Anthropic 회사 전체 · 발표 시점의 연환산 매출', 'reference'),
    observation('chatgpt_weekly_active_users', 'ChatGPT 서비스 주간 사용자 · 모델 수요 참고 지표', 'reference'),
    observation('openai_api_token_processing_rate', 'OpenAI API 분당 토큰 처리량 · 모델 수요 참고 지표', 'reference'),
    observation('fixed_performance_inference_cost_decline', '원자료가 분석한 모델·벤치마크 기준'),
    comparison('models', 'trainingCompute', '모델별 학습 연산량', 'Epoch AI 주요 모델 표본 · 공개값과 추정치 포함'),
    comparison('models', 'parameters', '모델별 파라미터 수', 'Epoch AI 주요 모델 표본 · 공개값과 추정치 포함'),
    comparison('models', 'trainingCost', '모델별 학습 비용 추정', 'Epoch AI 주요 모델 표본 · 2023년 달러 기준'),
    observation('openai_company_quarter_revenue', 'OpenAI 전사 분기 매출 보도 · 모델 공급사 참고 지표', 'reference'),
    observation('anthropic_quarterly_revenue_reported', 'Anthropic 전사 분기 매출 보도 · 모델 공급사 참고 지표', 'reference'),
    ...['openai', 'anthropic'].flatMap(provider => [
      observation('ramp_token_volume_share_by_provider__' + provider, 'Ramp TSM 기업 표본 · 공급사별 토큰 사용 비중'),
      observation('ramp_token_spend_share_by_provider__' + provider, 'Ramp TSM 기업 표본 · 공급사별 토큰 지출 비중'),
      observation('ramp_blended_price_per_million_tokens__' + provider, 'Ramp TSM 기업 표본 · 공급사별 혼합 토큰 단가'),
      observation('ramp_paid_ai_adoption_by_provider__' + provider, 'Ramp 결제 기업 표본 · 공급사별 기업 유료 도입률', 'reference'),
    ]),
    observation('chatgpt_consumer_paid_subscribers', 'ChatGPT 소비자 구독 · 모델 수요 참고 지표', 'reference'),
    observation('anthropic_business_customers_official', 'Anthropic 기업 고객 · 모델 수요 참고 지표', 'reference'),
  ],
}

function monthlyMetric(spec, industry) {
  const series = industry?.series.find(item => item.id === spec.id)
  const provider = industry?.sources.find(item => item.id === series?.sourceId)
  if (!series?.points.length || !provider) return null
  const points = orderedPoints(series).map(point => ({
    label: point.period, ordinal: monthNumber(point.period), value: point.value,
    status: point.status, source: provider.name, sourceUrl: point.sourceUrl || provider.url,
    yoy: yearOnYear(series, point),
    verifiedAt: point.checkedAt || series.checkedAt || provider.checkedAt,
    publishedAt: point.publishedAt || provider.publishedAt,
  }))
  const latest = points.at(-1)
  return {
    ...spec, name: series.name, unit: series.unit, source: provider.name,
    sourceUrl: latest.sourceUrl, description: series.definition, points, latest,
  }
}

function regularPeriod(label) {
  const quarter = /^(FY)?(\d{4})-Q([1-4])(?:-end)?$/.exec(label)
  if (quarter) return { frequency: quarter[1] ? 'fiscal-quarter' : 'quarter', ordinal: Number(quarter[2]) * 4 + Number(quarter[3]) - 1 }
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(label)) return { frequency: 'month', ordinal: monthNumber(label) }
  return null
}

// Mixed company disclosures sometimes identify only the month. Use the finest
// time unit shared by all points, without inventing a day for "earlier in month".
function disclosedDate(item) {
  if (item.periodEnd) return item.periodEnd
  const date = /(?:^|\bat |\bending )(\d{4}-\d{2}-\d{2})(?:$|;| disclosure$)/.exec(item.period)
  if (date) return date[1]
  const month = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:-end| earlier in month| revenue pace)?$/.exec(item.period)
  if (month) return month[1]
  const yearEnd = /^(\d{4}) year-end ARR as stated$/.exec(item.period)
  return yearEnd ? yearEnd[1] + '-12' : null
}

function observationAxis(metric) {
  const periods = metric.observations.map(item => regularPeriod(item.period))
  if (periods.every(period => period && period.frequency === periods[0].frequency)) {
    const monthly = periods[0].frequency === 'month' && /^monthly\b/.test(metric.frequency)
    return { kind: monthly ? 'monthly' : 'observations', ordinals: periods.map(period => period.ordinal) }
  }
  const dates = metric.observations.map(disclosedDate)
  if (!dates.every(Boolean)) return { kind: 'observations', ordinals: [] }
  const allDaily = dates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
  const ordinals = dates.map(date => allDaily ? Date.parse(date) / 86400000 : monthNumber(date))
  return { kind: 'observations', ordinals }
}

function observationMetric(spec, ai) {
  const metric = ai?.metrics.find(item => item.id === spec.id)
  if (!metric?.observations.length) return null
  const { kind, ordinals } = observationAxis(metric)
  const points = metric.observations.map((item, index) => ({
    label: item.period, value: item.value, operator: item.operator,
    ...(ordinals.length ? { ordinal: ordinals[index] } : {}),
    source: item.sourceName, sourceUrl: item.sourceUrl, evidence: item.evidence,
    publishedAt: item.publishedAt, verifiedAt: item.verifiedAt,
  }))
  const latest = points[metric.latestIndex]
  if (ordinals.length) points.sort((a, b) => a.ordinal - b.ordinal)
  const name = metric.id.includes('__') ? metric.entity + ' ' + metric.name : metric.name
  return {
    ...spec, kind, name, unit: metric.unitLabel || metric.unit,
    source: latest.source, sourceUrl: latest.sourceUrl, description: metric.definition,
    points, latest,
  }
}

function comparisonMetric(spec, epoch) {
  const dataset = epoch?.datasets.find(item => item.id === spec.dataset)
  if (!dataset?.rows.length) return null
  const definition = EPOCH_DATASETS.find(item => item.id === spec.dataset)
  const column = definition.columns.find(item => item.key === spec.field)
  const points = dataset.rows
    .filter(row => Number.isFinite(row[spec.field]))
    .map(row => ({
      label: row.incomplete ? `${row.name} (부분 집계)` : row.name,
      value: row[spec.field], source: EPOCH_SOURCE.name, sourceUrl: definition.sourceUrl,
      verifiedAt: dataset.lastSuccessAt,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
  if (!points.length) return null
  const periodText = `자료 확인 ${dataset.lastSuccessAt.slice(0, 10)}`
  return {
    ...spec, unit: column.unit, source: EPOCH_SOURCE.name, sourceUrl: definition.sourceUrl,
    description: definition.description, points, latest: { label: periodText, value: points.length },
    latestText: `수치 공개 ${points.length.toLocaleString('ko-KR')}개 항목`, periodText,
  }
}

export function sectorMetrics(sectorId, { industry, ai, epoch } = {}) {
  const specs = sectorId === 'monthly'
    ? (industry?.series || []).map(series => monthly(series.id, '월별 산업통계'))
    : sectorCatalog[sectorId] || []
  return specs.map(spec => {
    if (spec.kind === 'monthly') return monthlyMetric(spec, industry)
    if (spec.kind === 'comparison') return comparisonMetric(spec, epoch)
    return observationMetric(spec, ai)
  }).filter(Boolean)
}
