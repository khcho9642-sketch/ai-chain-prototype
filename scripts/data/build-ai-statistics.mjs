import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAiStatistics } from '../../assets/ai-statistics-core.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const unitLabels = {
  'USD billion': '십억 달러', 'USD billion annualized': '십억 달러·연환산',
  'USD billion per year run rate': '십억 달러·연환산', 'USD billion per month': '십억 달러/월',
  'USD billion loss magnitude': '십억 달러·손실액', 'USD per million tokens': '달러/백만 토큰',
  'USD per user': '달러/이용자', 'RMB billion': '십억 위안', 'RMB million': '백만 위안',
  'US cents per kWh': '미국 센트/kWh', 'million square inches (MSI)': '백만 제곱인치',
  'billion integrated circuits': '십억 개', 'EFLOPS (FP16)': 'EFLOPS·FP16',
  'million weekly users': '백만 명·주간', 'million users': '백만 명',
  'million subscribers': '백만 구독자', 'million paying business users': '백만 명·유료 업무',
  'million organizations': '백만 조직', 'million seats': '백만 좌석',
  'million paid seats': '백만 유료 좌석', 'business customers': '기업 고객',
  'customers': '고객', 'billion tokens per minute': '십억 토큰/분',
  'multiple': '배', 'percent': '%', 'percent year over year': '%·전년 동기 대비',
  'percent decline per quarter': '%·분기당 하락', 'percent of company revenue': '%·회사 매출',
  'percent of businesses': '%·조사 대상 기업', 'percent of enterprises': '%·조사 대상 기업',
  'percent of employed US adults': '%·미국 취업 성인', 'percent of in-scope Ramp businesses': '%·Ramp 표본 기업',
  'percent of in-scope respondents': '%·조사 대상 응답자', 'percent of observed token spend': '%·관측 토큰 지출',
  'percent of observed token volume': '%·관측 토큰 수', 'percent of respondents': '%·응답자',
  'percent of respondents aged 20+': '%·20세 이상 응답자',
  'percent of respondents at large organizations': '%·대기업 소속 응답자',
  'percent of surveyed enterprises': '%·응답 기업', 'robots': '대',
  'robots installed': '대·신규 설치', 'systems': '대', 'minutes per AI user per day': '분/일·AI 이용자',
  'million visits per month': '백만 회/월·방문',
  'million estimated unique visitors per month': '백만 명/월·순방문 추정',
  'million estimated monthly active app users': '백만 명·앱 MAU 추정',
}
const industryCategories = {
  semiconductors:'supply', semiconductor_equipment:'supply', semiconductor_materials:'supply',
  ai_compute:'supply', ai_compute_networking:'supply', memory:'supply', data_center_power_cooling:'energy', power_infrastructure:'energy',
  power_supply:'energy', electricity_cost:'energy', electricity_demand:'energy',
  ai_adoption:'adoption', ai_adoption_outcomes:'adoption', compute_capacity:'infrastructure',
  robotics:'supply', cloud_revenue:'revenue', ai_revenue:'revenue', cloud_capex:'investment',
  ai_investment:'investment', ai_usage:'usage', model_economics:'economics',
  data_center_capacity:'infrastructure', data_center_demand:'infrastructure',
  data_center_financials:'profitability', data_center_utilization:'infrastructure',
}
const gapNames = {
  chatgpt_standalone_total_revenue:'ChatGPT 단독 전체 매출', chatgpt_mau:'ChatGPT 공식 월간 활성 이용자',
  chatgpt_dau:'ChatGPT 공식 일간 활성 이용자', chatgpt_current_paid_conversion_rate:'ChatGPT 유료 전환율',
  chatgpt_churn_rate:'ChatGPT 이탈률', openai_current_arpu:'OpenAI 사용자당 매출',
  openai_company_operating_margin:'OpenAI 공식 영업이익률', claude_global_wau:'Claude 공식 주간 활성 이용자',
  claude_global_mau:'Claude 공식 월간 활성 이용자', claude_paid_subscribers:'Claude 개인 유료 구독자',
  claude_api_total_tokens_or_active_developers:'Claude 전체 API 토큰·활성 개발자',
}
function sourceName(url) {
  const host = new URL(url).hostname.replace(/^www\./, '')
  const publishers = { 'hai.stanford.edu':'Stanford HAI', 'oecd.org':'OECD', 'ec.europa.eu':'Eurostat',
    'census.gov':'US Census Bureau', 'mckinsey.com':'McKinsey', 'epoch.ai':'Epoch AI' }
  return publishers[host] || host
}
function businessCategory(id) {
  if (/loss|margin/.test(id)) return 'profitability'
  if (/price|arpu/.test(id)) return 'economics'
  if (/revenue/.test(id)) return 'revenue'
  if (/token/.test(id)) return 'tokens'
  if (/adoption/.test(id)) return 'adoption'
  if (/subscriber|subscription|customer|organizations|seats|paying_business/.test(id)) return 'customers'
  return 'usage'
}
function evidenceFor(type) {
  const types = {
    reported_actual:'official', reported_capacity:'official',
    official_company_cfo:'official', official_company_cro:'official', official_company_statement:'official',
    press_report_reuters:'reported', press_report_reuters_anonymous_source:'reported',
    reputable_media_anonymous_source:'reported', reputable_media_anonymous_sources:'reported',
    reputable_media_review_of_nonpublic_document:'reported',
    compiled_deals_actual:'research', research_model_estimate:'research',
    compiled_deals_estimate:'estimated', historical_estimate:'estimated', survey_estimate:'estimated',
    primary_data_vendor:'estimated',
  }
  if (!Object.hasOwn(types,type)) throw new Error('미확인 출처 유형: ' + type)
  return types[type]
}
function regionFor(metric) {
  if (/^china_|^alibaba_/.test(metric.id)) return '중국'
  if (/^japan_/.test(metric.id)) return '일본'
  if (/^korea_/.test(metric.id)) return '한국'
  if (/^eu_/.test(metric.id)) return '유럽'
  if (/^us_|^ramp_|^sensortower_/.test(metric.id)) return '미국'
  if (/^cbre_/.test(metric.id)) return '북미'
  return '글로벌'
}
function companyFor(entity) {
  if (/openai|chatgpt|codex/i.test(entity)) return 'OpenAI'
  if (/anthropic|claude/i.test(entity)) return 'Anthropic'
  return null
}
function observation(row, fallback) {
  const sourceUrl = row.sourceUrl || fallback.sourceUrl
  return {
    value: row.value, operator: row.operator || 'eq', period: row.period || fallback.period,
    sourceUrl, sourceName: sourceName(sourceUrl),
    evidence: row.sourceType ? evidenceFor(row.sourceType) : fallback.evidence,
    publishedAt: row.publishedAt || row.disclosedAt || fallback.publishedAt || null,
    verifiedAt: row.verifiedAt || fallback.verifiedAt,
    ...(row.periodEnd ? {periodEnd:row.periodEnd} : {}),
    ...(row.evidenceKo || row.noteKo ? {note:row.evidenceKo || row.noteKo} : {}),
    ...(row.corroboratingSourceUrl ? {corroboratingSourceUrl:row.corroboratingSourceUrl,
      corroboratingSourcePublishedAt:row.corroboratingSourcePublishedAt || null} : {}),
  }
}
function finish(metric, rows, latest, fallback) {
  const observations = [], indexByKey = new Map()
  let latestIndex = -1
  for (const row of [...rows, latest]) {
    const value = observation(row, fallback)
    const key = JSON.stringify([value.period, value.value, value.operator, value.sourceUrl])
    if (!indexByKey.has(key)) {
      indexByKey.set(key, observations.length)
      observations.push(value)
    } else if (row === latest) {
      // The explicit latest observation can carry a period end absent from history.
      observations[indexByKey.get(key)] = {...observations[indexByKey.get(key)], ...value}
    }
    if (row === latest) latestIndex = indexByKey.get(key)
  }
  return { ...metric, unitLabel:unitLabels[metric.unit] || metric.unit,
    fullHistory:false, observations, latestIndex }
}

export function buildAiStatistics(catalog) {
  const asOf = catalog.metadata.asOf
  const metrics = []
  for (const m of catalog.metrics) {
    const source = m.sources[0]
    const entity = m.entity || sourceName(source.url)
    const notes = [...(m.collection?.constraints || []), ...(m.constraintsKo || [])]
    if (m.verifiedObservation.recencyStatus === 'historical_not_latest') notes.unshift('과거 확인값입니다. 현재 최신 관측값으로 해석하지 마세요.')
    if (m.aiRelationship !== 'direct' && m.aiRelationship !== 'direct_business_segment') {
      notes.unshift('AI 전용 통계가 아닐 수 있습니다. 조사 범위와 사업 정의를 확인하세요.')
    }
    if (m.id.startsWith('alibaba_')) notes.unshift('국가 필터는 기업 본거지(중국)입니다. 실제 매출·투자 범위는 회사의 연결 또는 사업부 기준입니다.')
    notes.push('공개 자료에서 확인한 관측값과 일부 과거 예시입니다. 전체 이력 자동 수집은 연결하지 않았습니다.')
    let evidence = evidenceFor(m.measurementStatus)
    if (/compiled_deals_actual/.test(m.measurementStatus)) evidence = 'research'
    if (m.entity === 'CBRE') evidence = 'estimated'
    const category = industryCategories[m.category]
    if (!category) throw new Error('미등록 산업 분류: ' + m.category)
    metrics.push(finish({
      id:m.id, definitionId:m.id, name:m.name, entity, company:companyFor(entity),
      region:regionFor(m), group:'industry', category, unit:m.unit, scope:m.scope,
      definition:m.definition, frequency:m.frequency, collectionMethod:'reviewed-report',
      measurementStatus:m.measurementStatus, aiRelationship:m.aiRelationship, sources:m.sources, notes,
    }, m.historicalExamples || [], m.verifiedObservation, {
      sourceUrl:source.url, publishedAt:source.publishedAt, verifiedAt:m.verifiedAt || asOf, evidence,
    }))
  }
  const modules = catalog.modelBusinessStatistics.modules
  for (const m of modules.openai.metrics) {
    const entity = m.entity || 'OpenAI'
    metrics.push(finish({
      id:m.id, definitionId:m.id, name:m.name, entity, company:'OpenAI', region:'글로벌',
      group:'business', category:businessCategory(m.id), unit:m.unit,
      scope:m.scope || m.definition, definition:m.definition, frequency:m.frequency,
      collectionMethod:'reviewed-release', notes:[...(m.limitations || [])],
    }, m.historicalExamples || [], m.latestVerifiedObservation, {verifiedAt:m.verifiedAt || asOf, evidence:'official'}))
  }
  for (const m of modules.anthropic.metrics) {
    const entity = m.id.startsWith('claude_code_') ? 'Claude Code' : 'Anthropic'
    metrics.push(finish({
      id:m.id, definitionId:m.id, name:m.name, entity, company:'Anthropic', region:'글로벌',
      group:'business', category:businessCategory(m.id), unit:m.unit, scope:m.scope,
      definition:m.definition || m.scope || m.name, frequency:m.frequency,
      collectionMethod:'reviewed-release', notes:[...(m.constraintsKo || [])],
    }, m.observations.slice(0, -1), m.observations.at(-1), {verifiedAt:asOf, evidence:'official'}))
  }
  for (const m of modules.thirdPartyComparisons.metrics) {
    // One definition, separate series for each measured provider or product.
    const source = m.sources[0]
    for (const latest of m.observations) {
      const entity = latest.entity
      const history = (m.historicalExamples || []).filter(row => row.entity === entity)
      metrics.push(finish({
        id:m.id + '__' + entity.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        definitionId:m.id, name:m.nameKo, entity, company:companyFor(entity),
        region:regionFor(m), group:'business', category:businessCategory(m.id), unit:m.unit,
        scope:m.scope, definition:m.definition, frequency:m.collection?.frequency || 'irregular',
        collectionMethod:'reviewed-report', sources:m.sources, notes:[...(m.cautions || [])],
      }, history, latest, {
        sourceUrl:source.url, publishedAt:source.publishedAt, period:m.period,
        evidence:'estimated', verifiedAt:m.verifiedAt || asOf,
      }))
    }
  }
  const gaps = [
    ...modules.openai.unavailableMetrics.map(g => ({...g, entity:'OpenAI'})),
    ...modules.anthropic.coverageGaps.map(g => ({...g, entity:'Anthropic'})),
  ].map(g => ({id:g.id, name:gapNames[g.id] || g.id, entity:g.entity, value:null,
    reason:g.reasonKo || g.noteKo, unit:g.unit || null, scope:g.scope || null}))
  return validateAiStatistics({
    schemaVersion:1, asOf, generatedAt:asOf + 'T00:00:00.000Z',
    definitionCount:new Set(metrics.map(m => m.definitionId)).size,
    collection:{method:'reviewed-sources', status:'reviewed-snapshot'},
    notes:[
      '매출·사용자 통계는 발표 자료와 공개 보고서를 검토한 값입니다. 새 발표는 검토 후 반영합니다.',
      '회사 전체 매출, 제품 매출, 실제 기간 매출, 연환산 매출을 합산하거나 같은 지표로 비교하지 않습니다.',
      '공식 사용자·방문 횟수·외부 추정 MAU·기업 고객·유료 좌석은 각각 다른 모집단입니다.',
      '기간과 발표일을 구분하며, 미확인 값은 0으로 대체하지 않습니다.',
    ], metrics, gaps,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = JSON.parse(await readFile(resolve(root, 'research/ai-statistics-2026-10-26.json'), 'utf8'))
  const data = buildAiStatistics(catalog)
  await writeFile(resolve(root, 'data/ai-statistics.json'), JSON.stringify(data, null, 2) + '\n')
  console.log('검토 통계:', data.definitionCount, '개 정의 /', data.metrics.length, '개 표시 항목 / 미확인', data.gaps.length, '개')
}
