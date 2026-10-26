import { validateAiStatistics, safeSourceUrl } from './ai-statistics-core.js'
import { validateDisclosureSnapshot } from './ai-disclosure-core.js'
import {
  validateTokenSnapshot, tokenDailyTotals, tokenMovingAverage, visibleAuthorTotals,
  latestTokenDate, tokenRowsForDate, formatTokens, tokenTotalsCsv,
} from './token-core.js'

const view = document.getElementById('v-ai-stats')
const categories = {
  usage: '사용자·이용량', revenue: '매출', customers: '고객·유료 사용자',
  profitability: '수익성·비용', tokens: '토큰', adoption: 'AI 도입',
  investment: '투자', supply: '공급·반도체', energy: '전력·에너지',
  infrastructure: '인프라', economics: '경제성',
}
const evidenceNames = { official: '공식 발표', reported: '보도 수치', estimated: '추정치', research: '연구·조사' }
const regionNames = { global: '글로벌', china: '중국', japan: '일본', korea: '한국', us: '미국', europe: '유럽' }
const newFilters = () => ({ query: '', category: 'all', evidence: 'all', company: 'all', region: 'all' })
const state = {
  tab: 'business', stats: null, tokens: null, disclosures: null, loading: false, attempted: false,
  statsError: '', tokenError: '', tokenFallback: false, disclosureError: '', disclosureFallback: false,
  filters: { business: newFilters(), industry: newFilters() },
  selected: { business: null, industry: null }, limits: { business: 18, industry: 18 },
  tokenDate: '', tokenMode: 'model', trendDays: 30,
}
const numberFormat = new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 12 })
const DAY = 86400000

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}
function sourceLink(url, name) {
  const safe = safeSourceUrl(url)
  return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(name || '원문')} ↗</a>` : esc(name || '출처 미확인')
}
function evidenceBadge(value) {
  return `<span class="aist-badge" data-evidence="${esc(value)}">${esc(evidenceNames[value] || value)}</span>`
}
function observationValue(observation) {
  const prefix = { eq: '', gt: '> ', lt: '< ', approx: '≈ ' }[observation.operator] || ''
  return prefix + numberFormat.format(observation.value)
}
function latest(metric) { return metric.observations[metric.latestIndex] }
function regionKey(value) {
  const text = String(value || '').trim()
  if (/^(global|world|worldwide|글로벌|세계|전세계|전 세계)$/i.test(text)) return 'global'
  if (/^(china|cn|중국)$/i.test(text)) return 'china'
  if (/^(japan|jp|일본)$/i.test(text)) return 'japan'
  if (/^(south korea|korea|kr|한국|대한민국)$/i.test(text)) return 'korea'
  if (/^(united states|us|usa|미국)$/i.test(text)) return 'us'
  if (/^(europe|eu|유럽)$/i.test(text)) return 'europe'
  return text
}
function regionLabel(value) { return regionNames[regionKey(value)] || value || '지역 미분류' }
function companyFor(metric) {
  if (metric.company) return metric.company
  if (/openai|chatgpt/i.test(metric.entity)) return 'OpenAI'
  if (/anthropic|claude/i.test(metric.entity)) return 'Anthropic'
  return ''
}
function groupMetrics(group = state.tab) { return state.stats?.metrics.filter(metric => metric.group === group) || [] }
function filteredMetrics() {
  const filter = state.filters[state.tab]
  const query = filter.query.trim().toLocaleLowerCase()
  return groupMetrics().filter(metric =>
    (filter.company === 'all' || companyFor(metric) === filter.company) &&
    (filter.region === 'all' || regionKey(metric.region) === filter.region) &&
    (filter.category === 'all' || metric.category === filter.category) &&
    (filter.evidence === 'all' || latest(metric).evidence === filter.evidence) &&
    (!query || [metric.name, metric.entity, metric.region, regionLabel(metric.region), metric.scope,
      metric.definition, metric.unit, metric.unitLabel, ...metric.notes].join(' ').toLocaleLowerCase().includes(query)))
}
function filteredGaps() {
  if (state.tab !== 'business') return []
  const filter = state.filters.business
  const query = filter.query.trim().toLocaleLowerCase()
  return (state.stats?.gaps || []).filter(gap =>
    (filter.company === 'all' || companyFor(gap) === filter.company) &&
    (!query || [gap.name, gap.entity, gap.reason].join(' ').toLocaleLowerCase().includes(query)))
}
function definitionCount(metrics) { return new Set(metrics.map(metric => metric.definitionId)).size }
function selectOptions(values, selected, firstLabel) {
  return `<option value="all">${esc(firstLabel)}</option>` + values.map(([value, label]) =>
    `<option value="${esc(value)}"${selected === value ? ' selected' : ''}>${esc(label)}</option>`).join('')
}
function dateTime(value) {
  if (!value) return '기록 없음'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '기록 없음'
}

function headerHTML() {
  const stats = state.stats
  const metrics = stats?.metrics || []
  return `<section class="panel sec">
    <div class="aist-heading"><div><p class="aist-kicker">USAGE · BUSINESS · INFRASTRUCTURE</p><h1>AI 통계</h1>
      <p class="aist-intro">ChatGPT·Claude의 사용자와 매출부터 중국·일본의 AI 산업, 공개 토큰 사용량까지. 각 숫자의 집계 범위와 발표 시점을 함께 확인하세요.</p></div>
      <button type="button" class="aist-button" data-aist-action="refresh"${state.loading ? ' disabled' : ''}>${state.loading ? '불러오는 중…' : '새로고침'}</button></div>
    <div class="aist-meta">${stats ? `<span><b>${stats.definitionCount}개 지표 정의</b> · ${metrics.length}개 표시 항목</span><span>자료 확인일 <b>${esc(stats.asOf)}</b></span><span>공개문서 검토본</span>` : '<span>출처와 관측 시점을 담은 공개 데이터</span>'}</div>
  </section>
  <nav class="aist-subnav" aria-label="AI 통계 분야">${[
    ['business', '모델·서비스', definitionCount(groupMetrics('business'))],
    ['industry', '산업·국가', definitionCount(groupMetrics('industry'))],
    ['tokens', '토큰 사용량', null],
  ].map(([id, name, count]) => `<a href="#ai-stats/${id}"${state.tab === id ? ' aria-current="page"' : ''}>${name}${count ? `<small>${count}</small>` : ''}</a>`).join('')}</nav>`
}

function toolbarHTML(metrics) {
  const filter = state.filters[state.tab]
  const available = groupMetrics()
  const availableCategories = Object.entries(categories).filter(([key]) => available.some(metric => metric.category === key))
  const regions = [...new Set(available.map(metric => regionKey(metric.region)).filter(Boolean))]
  const orderedRegions = ['global', 'china', 'japan', 'korea', 'us', ...regions.filter(key => !['global', 'china', 'japan', 'korea', 'us'].includes(key))].filter(key => regions.includes(key))
  return `<section class="panel sec aist-toolbar" aria-label="지표 검색과 필터">
    <div class="aist-controls">
      <label for="aist-search">지표·기업 검색<input id="aist-search" type="search" placeholder="${state.tab === 'business' ? '사용자, 연환산 매출, Claude…' : '중국, 일본, 전력, 투자…'}" value="${esc(filter.query)}" autocomplete="off"></label>
      <label for="aist-category">지표 유형<select id="aist-category" data-aist-filter="category">${selectOptions(availableCategories, filter.category, '모든 유형')}</select></label>
      <label for="aist-evidence">대표 관측의 근거<select id="aist-evidence" data-aist-filter="evidence">${selectOptions(Object.entries(evidenceNames), filter.evidence, '모든 근거')}</select></label>
      ${state.tab === 'business' ? `<label for="aist-company">기업<select id="aist-company" data-aist-filter="company">${selectOptions([['OpenAI', 'OpenAI · ChatGPT'], ['Anthropic', 'Anthropic · Claude']], filter.company, '모든 기업')}</select></label>` :
      `<label for="aist-region">지역·기업국가<select id="aist-region" data-aist-filter="region">${selectOptions(orderedRegions.map(key => [key, regionNames[key] || key]), filter.region, '모든 지역')}</select></label>`}
    </div>
    ${state.tab === 'industry' ? `<div class="aist-regions" aria-label="지역·기업국가 빠른 선택"><span class="aist-label">지역·기업국가</span>${[['all', '전체'], ...['global', 'china', 'japan', 'korea'].filter(key => regions.includes(key)).map(key => [key, regionNames[key]])].map(([key, label]) => `<button class="f${filter.region === key ? ' on' : ''}" data-aist-region="${key}" type="button" aria-pressed="${filter.region === key}">${label}<small>${key === 'all' ? available.length : available.filter(metric => regionKey(metric.region) === key).length}</small></button>`).join('')}</div>` : ''}
    <div class="aist-filter-row"><p class="aist-count" aria-live="polite"><strong>${definitionCount(metrics)}개 지표 정의 · ${metrics.length}개 표시 항목</strong>${state.tab === 'industry' ? ' · 지역 분류와 실제 집계 범위는 다를 수 있습니다.' : ' · 기업별 비교 항목은 각각 표시합니다.'}</p>
      <div class="aist-actions"><button class="aist-button" type="button" data-aist-action="reset">필터 초기화</button><button class="aist-button" type="button" data-aist-action="export-stats"${metrics.length ? '' : ' disabled'}>검색 결과 CSV ↓</button></div></div>
  </section>`
}

function selectedHTML(metric) {
  if (!metric) return ''
  const observation = latest(metric)
  const notes = [...metric.notes]
  if (observation.note && !notes.includes(observation.note)) notes.unshift(observation.note)
  const mainSource = (metric.sources || []).find(source => source.url === observation.sourceUrl)
  const extraSources = (metric.sources || []).filter(source => source.url !== observation.sourceUrl)
  if (observation.corroboratingSourceUrl && !extraSources.some(source => source.url === observation.corroboratingSourceUrl)) {
    extraSources.push({ url: observation.corroboratingSourceUrl, title: '보조 원문', publishedAt: observation.corroboratingSourcePublishedAt })
  }
  return `<section id="aist-selected" class="panel sec aist-selected" tabindex="-1" aria-labelledby="aist-selected-title">
    <div class="aist-detail-top"><div><p class="aist-eyebrow">${esc(metric.entity)} · ${esc(regionLabel(metric.region))} · ${esc(categories[metric.category])}</p>
      <h2 id="aist-selected-title">${esc(metric.name)}</h2><div class="aist-value">${esc(observationValue(observation))}<small>${esc(metric.unitLabel || metric.unit)}</small></div>
      <p class="aist-detail-period">관측 시점 · ${esc(observation.period)}<br>근거 · ${evidenceBadge(observation.evidence)}</p></div>
      <dl class="aist-detail-facts"><dt>집계 범위</dt><dd>${esc(metric.scope || metric.definition)}</dd>${observation.periodEnd ? `<dt>기간 말일</dt><dd>${esc(observation.periodEnd)}</dd>` : ''}<dt>출처</dt><dd>${sourceLink(observation.sourceUrl, mainSource?.title || observation.sourceName)}</dd>
        <dt>발표일</dt><dd>${esc(observation.publishedAt || '발표일 미확인')}</dd><dt>확인일</dt><dd>${esc(observation.verifiedAt)}</dd><dt>원문 단위</dt><dd>${esc(metric.unit)}</dd></dl></div>
    ${metric.definition && metric.definition !== metric.scope ? `<p class="aist-scope">${esc(metric.definition)}</p>` : ''}
    ${notes.length ? `<ul class="aist-notes">${notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}
    ${extraSources.length ? `<div class="aist-source">함께 확인한 원문<ul class="aist-notes">${extraSources.map(source => `<li>${sourceLink(source.url, source.title || '보조 원문')}${source.publishedAt ? ` · 발표 ${esc(source.publishedAt)}` : ''}${source.verifiedAt ? ` · 확인 ${esc(source.verifiedAt)}` : ''}</li>`).join('')}</ul></div>` : ''}
    <details class="aist-history"><summary>관측 기록 ${metric.observations.length}건 · 원문 보기<small>${metric.fullHistory ? '전체 관측 기록' : '확인된 발표 시점만 수록'}</small></summary>
      <p class="aist-source">단위: ${esc(metric.unitLabel || metric.unit)} · 대표 관측은 자료가 지정한 기준값입니다. 발표일이 늦어도 관측 기간이 과거일 수 있습니다.</p>
      <div class="aist-table-wrap"><table class="aist-table"><caption class="sr">${esc(metric.name)}의 기간별 관측값과 출처</caption><thead><tr><th scope="col">관측 시점</th><th scope="col" class="aist-number">값</th><th scope="col">근거</th><th scope="col">원문</th><th scope="col">발표일 / 확인일</th></tr></thead><tbody>
      ${metric.observations.map((item, index) => `<tr><td>${esc(item.period)}${item.periodEnd ? `<small>기간 말일 ${esc(item.periodEnd)}</small>` : ''}${index === metric.latestIndex ? '<small>대표 관측</small>' : ''}</td><td class="aist-number">${esc(observationValue(item))}</td><td>${evidenceBadge(item.evidence)}</td><td>${sourceLink(item.sourceUrl, item.sourceName)}${item.corroboratingSourceUrl ? `<small>${sourceLink(item.corroboratingSourceUrl, '보조 원문')}${item.corroboratingSourcePublishedAt ? ` · 발표 ${esc(item.corroboratingSourcePublishedAt)}` : ''}</small>` : ''}${item.note ? `<small>${esc(item.note)}</small>` : ''}</td><td>${esc(item.publishedAt || '발표일 미확인')}<small>확인 ${esc(item.verifiedAt)}</small></td></tr>`).join('')}
      </tbody></table></div></details>
  </section>`
}

function cardHTML(metric) {
  const observation = latest(metric)
  const selected = state.selected[state.tab] === metric.id
  return `<article class="aist-card${selected ? ' selected' : ''}"><button class="aist-metric-main" type="button" data-aist-metric="${esc(metric.id)}" aria-pressed="${selected}" aria-label="${esc(metric.entity + ' · ' + metric.name)} 상세 보기">
    <span class="aist-card-top"><span>${esc(metric.entity)} · ${esc(regionLabel(metric.region))}</span>${evidenceBadge(observation.evidence)}</span>
    <span class="aist-metric-name">${esc(metric.name)}</span><span class="aist-value">${esc(observationValue(observation))}<small>${esc(metric.unitLabel || metric.unit)}</small></span>
    <span class="aist-card-period">${esc(observation.period)}</span></button><div class="aist-card-source">${sourceLink(observation.sourceUrl, observation.sourceName)}<span>확인 ${esc(observation.verifiedAt)}</span></div></article>`
}

function gapsHTML(gaps, noMetrics) {
  if (!gaps.length) return ''
  return `<details class="panel aist-gaps"${noMetrics ? ' open' : ''}><summary>공개 확인이 필요한 지표<small>${gaps.length}개 · 미확인 값을 0으로 표시하지 않습니다.</small></summary><div class="aist-gap-grid">${gaps.map(gap =>
    `<article class="aist-gap"><div><h3>${esc(gap.entity)} · ${esc(gap.name)}</h3><span class="aist-badge">미확인</span></div><p>${esc(gap.reason)}</p>${gap.scope ? `<p>집계 범위 · ${esc(gap.scope)}</p>` : ''}</article>`).join('')}</div></details>`
}

function methodHTML() {
  return `<details class="panel aist-method"><summary>숫자를 읽는 기준 · 수집 방식</summary>
    <p><strong>모델·서비스와 산업·국가 지표는 공개문서 검토본입니다.</strong> 공식 발표, 보도, 연구 자료에서 기간·정의·단위를 확인한 관측값을 수록합니다. 현재 기업 지표를 실시간 매출·사용자 API 값으로 표시하지 않습니다. 새로고침은 저장된 최신 검토본을 다시 불러옵니다.</p>
    <div class="aist-evidence-legend"><span>${evidenceBadge('official')}기업·기관 직접 발표</span><span>${evidenceBadge('reported')}언론이 보도한 수치</span><span>${evidenceBadge('estimated')}외부 추정</span><span>${evidenceBadge('research')}조사·연구 결과</span></div>
    <p><strong>실제 매출과 연환산 매출(run-rate)은 다릅니다.</strong> 연환산 수치는 특정 시점의 매출 속도를 1년으로 환산한 값입니다. 연간·분기 실적, 월간·주간 활성 사용자, 방문 수, 유료 계정·좌석은 각 정의로 읽어야 합니다. 시점과 모집단이 다른 숫자로 ARPU·전환율·성장률을 계산하지 않습니다.</p>
    <p><strong>지역·기업국가와 집계 범위를 함께 확인하세요.</strong> 기업의 본거지로 분류한 자료에는 해외 매출·사용량이 포함될 수 있습니다. 수록된 발표 기록은 완전한 시계열이 아니며, ≈는 근삿값, &gt;와 &lt;는 원문에 나온 초과·미만입니다. 토큰 수집 상태와 OpenRouter의 공개 범위는 토큰 화면에 별도로 표시합니다.</p>
  </details>`
}

function disclosuresHTML() {
  if (state.tab !== 'business') return ''
  const snapshot = state.disclosures
  if (!snapshot) return `<details class="panel aist-method"><summary>공식 발표자료 자동 확인</summary><p>${state.loading ? '확인 기록을 불러오고 있습니다.' : '발표자료 확인 기록을 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.'}</p></details>`
  const collection = snapshot.collection
  const status = { 'not-run': '첫 확인 전', ok: '정상 확인', partial: '일부 확인 실패', error: '확인 실패' }[collection.status]
  const failures = [...snapshot.sources, ...(snapshot.discovery || [])].filter(source => source.error).length
  const candidates = snapshot.candidates.filter(candidate => candidate.status === 'needs-review')
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
  return `<details class="panel aist-method"><summary>공식 발표자료 자동 확인 · ${status}</summary>
    ${state.disclosureError ? '<p class="aist-alert">새 확인 기록을 불러오지 못해 이전에 불러온 기록을 유지합니다.</p>' : ''}
    <div class="aist-disclosure-meta"><span>최근 확인 시도 <b>${collection.lastAttemptAt ? esc(dateTime(collection.lastAttemptAt)) : '첫 확인 전'}</b></span><span>최근 정상 확인 <b>${collection.lastSuccessAt ? esc(dateTime(collection.lastSuccessAt)) : '첫 확인 전'}</b></span><span>원문 ${snapshot.sources.length}개 · 실패 ${failures}개 · 검토 대기 ${candidates.length}개${state.disclosureFallback ? ' · 저장본 사용' : ''}</span></div>
    <p>OpenAI·Anthropic의 공식 웹 발표에서 새 원문과 변경 내용을 찾아 검토 대상으로 모읍니다. <strong>숫자를 자동 승인하지 않으며, 검토 전에는 통계 값을 변경하지 않습니다.</strong></p>
    ${candidates.length ? `<ul class="aist-disclosure-list">${candidates.slice(0, 10).map(candidate => `<li>${sourceLink(candidate.url, candidate.title || '공식 발표 원문')}<p>감지 ${esc(dateTime(candidate.detectedAt))} · ${esc(candidate.reason)}</p></li>`).join('')}</ul>${candidates.length > 10 ? '<p>가장 최근 검토 대기 원문 10개를 표시합니다.</p>' : ''}` : `<p>${collection.status === 'not-run' ? '아직 자동 확인 기록이 없습니다.' : '현재 기록에 검토 대기 중인 새 원문이 없습니다.'}</p>`}
  </details>`
}

function metricsHTML() {
  if (!state.stats) return `<section class="panel aist-loading" role="status">${state.loading ? '지표와 출처를 불러오고 있습니다.' : 'AI 통계 자료를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.'}</section>`
  const metrics = filteredMetrics()
  const gaps = filteredGaps()
  if (!metrics.some(metric => metric.id === state.selected[state.tab])) state.selected[state.tab] = metrics[0]?.id || null
  const selected = metrics.find(metric => metric.id === state.selected[state.tab])
  const shown = metrics.slice(0, state.limits[state.tab])
  return `${state.statsError ? `<p class="aist-alert" role="status">새 검토본을 불러오지 못해 이전에 불러온 자료를 유지합니다. ${esc(state.statsError)}</p>` : ''}
    ${toolbarHTML(metrics)}${selectedHTML(selected)}
    <div class="aist-catalog-heading"><h2>${state.tab === 'business' ? '사용·매출·고객 지표' : '글로벌 AI 산업 지표'}</h2><p>항목을 누르면 정의와 관측 기록을 확인할 수 있습니다.</p></div>
    ${metrics.length ? `<div class="aist-grid">${shown.map(cardHTML).join('')}</div>` : '<div class="aist-empty" role="status">검색 조건에 맞는 관측값이 없습니다.<br>검색어를 바꾸거나 필터를 초기화해 주세요.</div>'}
    ${shown.length < metrics.length ? `<button class="aist-button aist-more" type="button" data-aist-action="more">항목 더 보기 · ${shown.length} / ${metrics.length}</button>` : ''}
    ${gapsHTML(gaps, !metrics.length)}${disclosuresHTML()}${methodHTML()}`
}

function chartHTML(daily, averages) {
  if (!daily.length) return ''
  const width = 900, height = 265, left = 82, right = 28, top = 20, bottom = 38
  const start = Date.parse(daily[0].date + 'T00:00:00Z')
  const end = Date.parse(daily.at(-1).date + 'T00:00:00Z')
  const averageByDate = new Map(averages.map(item => [item.date, item]))
  const max = Math.max(1, ...daily.map(item => Number(item.totalTokens)), ...daily.map(item => averageByDate.get(item.date)?.value || 0)) * 1.08
  const x = date => left + (end === start ? .5 : (Date.parse(date + 'T00:00:00Z') - start) / (end - start)) * (width - left - right)
  const y = value => height - bottom - value / max * (height - top - bottom)
  function linePath(points) {
    let previous = null
    return points.map(point => {
      if (point.value === null || point.value === undefined) { previous = null; return '' }
      const continuous = previous && Date.parse(point.date + 'T00:00:00Z') - Date.parse(previous + 'T00:00:00Z') === DAY
      previous = point.date
      return `${continuous ? 'L' : 'M'}${x(point.date).toFixed(2)},${y(point.value).toFixed(2)}`
    }).join(' ')
  }
  const actual = daily.map(item => ({ date: item.date, value: Number(item.totalTokens) }))
  const mean = daily.map(item => ({ date: item.date, value: averageByDate.get(item.date)?.value ?? null }))
  const dates = [...new Set([daily[0].date, daily[Math.floor((daily.length - 1) / 2)].date, daily.at(-1).date])]
  return `<div class="aist-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(daily[0].date)}부터 ${esc(daily.at(-1).date)}까지 OpenRouter 공개 토큰 일별 합계와 연속 7일 평균. 정확한 값은 아래 관측 기록에서 확인할 수 있습니다.">
    ${[0, .5, 1].map(fraction => `<line class="aist-grid-line" x1="${left}" x2="${width - right}" y1="${y(max * fraction)}" y2="${y(max * fraction)}"/><text x="${left - 12}" y="${y(max * fraction) + 4}" text-anchor="end">${esc(formatTokens(Math.floor(max * fraction)))}</text>`).join('')}
    <path d="${linePath(actual)}" fill="none" stroke="#4CC2FF" stroke-width="2.2"/>
    <path d="${linePath(mean)}" fill="none" stroke="#FFB07A" stroke-width="2" stroke-dasharray="5 4"/>
    ${actual.map(point => `<circle cx="${x(point.date)}" cy="${y(point.value)}" r="2" fill="#4CC2FF"/>`).join('')}
    ${dates.map(date => `<text x="${x(date)}" y="${height - 13}" text-anchor="middle">${esc(date)}</text>`).join('')}
  </svg></div>`
}

function tokenTrendHTML(snapshot, daily) {
  if (!snapshot.coverage.completePublicTotal) return `<section class="panel sec"><h2>일별 합계·7일 평균</h2><p class="aist-scope">현재 자료는 하루의 공개 상위 모델 관측값입니다. 전체 공개 트래픽을 포괄하지 않아 플랫폼 합계와 추세를 계산하지 않습니다. 완결된 일별 API 기록이 확보되면 이곳에 표시합니다.</p></section>`
  if (!daily.length) return ''
  const averages = tokenMovingAverage(daily, 7)
  const averageByDate = new Map(averages.map(item => [item.date, item]))
  const cutoff = state.trendDays ? Date.parse(daily.at(-1).date + 'T00:00:00Z') - (state.trendDays - 1) * DAY : -Infinity
  const shown = daily.filter(item => Date.parse(item.date + 'T00:00:00Z') >= cutoff)
  return `<section class="panel sec"><div class="aist-token-header"><h2>일별 공개 토큰 사용량</h2><div class="aist-actions">${[[30, '30일'], [90, '90일'], [0, '전체']].map(([days, name]) => `<button type="button" class="f${state.trendDays === days ? ' on' : ''}" data-aist-days="${days}" aria-pressed="${state.trendDays === days}">${name}</button>`).join('')}</div></div>
    <div class="aist-chart-legend"><span>일별 합계</span><span>연속 7일 평균</span></div>${chartHTML(shown, averages)}
    <p class="aist-source">${sourceLink(snapshot.source.url, 'OpenRouter')} · ${esc(shown[0].date)}–${esc(shown.at(-1).date)} UTC · 프롬프트 + 생성 토큰. 비공개 사용량은 제외되며, 날짜가 빠진 구간은 선으로 연결하지 않습니다.</p>
    <details class="aist-history"><summary>일별 관측 기록 ${shown.length}건 · 정확한 토큰 수</summary><p class="aist-source">7일 평균은 연속된 날짜가 모두 있을 때만 표시합니다. 표의 평균은 소수점 이하를 버린 토큰 수입니다.</p><div class="aist-table-wrap"><table class="aist-table"><thead><tr><th scope="col">날짜 · UTC</th><th scope="col" class="aist-number">일별 합계 · 토큰</th><th scope="col" class="aist-number">7일 평균 · 토큰</th></tr></thead><tbody>${[...shown].reverse().map(item => `<tr><td>${esc(item.date)}</td><td class="aist-number">${BigInt(item.totalTokens).toLocaleString('ko-KR')}</td><td class="aist-number">${averageByDate.get(item.date)?.totalTokens === null ? '연속 7일 미충족' : BigInt(averageByDate.get(item.date).totalTokens).toLocaleString('ko-KR')}</td></tr>`).join('')}</tbody></table></div></details>
  </section>`
}

function tokensHTML() {
  const snapshot = state.tokens
  if (!snapshot) return `<section class="panel aist-loading" role="status">${state.loading ? '공개 토큰 관측값을 불러오고 있습니다.' : '토큰 자료를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.'}</section>`
  const dates = [...new Set(snapshot.rows.map(row => row.date))].sort().reverse()
  if (!dates.includes(state.tokenDate)) state.tokenDate = latestTokenDate(snapshot) || ''
  const daily = tokenDailyTotals(snapshot)
  const latestDaily = daily.at(-1)
  const latestMean = tokenMovingAverage(daily, 7).at(-1)
  const rows = tokenRowsForDate(snapshot, state.tokenDate)
  const authors = visibleAuthorTotals(snapshot, state.tokenDate)
  const visible = state.tokenMode === 'model' ? rows : authors
  const maximum = visible.reduce((max, row) => BigInt(row.totalTokens) > max ? BigInt(row.totalTokens) : max, 0n)
  const complete = snapshot.coverage.completePublicTotal
  const collection = snapshot.collection
  const status = collection.status === 'ok' ? 'API 수집 완료' : collection.status === 'error' ? '최근 자동 수집 실패 · 저장 자료 유지' : '자동 갱신 대기'
  const reviewedDate = snapshot.meta?.verifiedAt || snapshot.meta?.verified_at || snapshot.asOf
  return `${state.tokenError ? `<p class="aist-alert" role="status">새 토큰 자료를 불러오지 못해 이전 자료를 유지합니다. ${esc(state.tokenError)}</p>` : ''}
    <section class="panel sec"><div class="aist-token-header"><div><p class="aist-kicker">OPENROUTER · PUBLIC USAGE</p><h2>토큰 사용량</h2></div><button class="aist-button" type="button" data-aist-action="export-tokens"${snapshot.rows.length ? '' : ' disabled'}>토큰 기록 CSV ↓</button></div>
      <p class="aist-scope">OpenRouter를 거친 공개 트래픽의 프롬프트·생성 토큰입니다. OpenAI·Anthropic의 전체 서비스 사용량이나 전 세계 AI 시장점유율을 뜻하지 않습니다. ${complete ? '상위 모델과 기타 모델을 포함한 일별 공개 합계입니다.' : '현재는 공개 상위 모델만 수록한 검토 스냅샷이며, 원문의 반올림 수치입니다.'}</p>
      <div class="aist-meta"><span><b>${complete ? '일별 API 데이터' : '공개 순위 검토 스냅샷'}</b></span><span>${esc(status)}</span>${collection.lastSuccessAt ? `<span>수집 성공 ${esc(dateTime(collection.lastSuccessAt))}</span>` : `<span>자료 확인 ${esc(reviewedDate)}</span>`}${state.tokenFallback ? '<span>저장본 사용</span>' : ''}</div>
      <div class="aist-token-summary"><article class="aist-token-stat"><h3>가장 최근 완결일 · 공개 토큰 합계</h3><strong>${latestDaily ? `${esc(formatTokens(latestDaily.totalTokens))}<small>토큰</small>` : '미확인'}</strong><p>${latestDaily ? `${esc(latestDaily.date)} UTC · ${sourceLink(snapshot.source.url, 'OpenRouter API')}` : '상위 모델만으로 플랫폼 합계를 계산하지 않습니다.'}</p></article>
        <article class="aist-token-stat"><h3>가장 최근 완결일 · 7일 평균</h3><strong>${latestMean?.totalTokens !== null && latestMean?.totalTokens !== undefined ? `${esc(formatTokens(latestMean.totalTokens))}<small>토큰/일</small>` : '관측 부족'}</strong><p>${latestMean?.totalTokens !== null && latestMean?.totalTokens !== undefined ? `${esc(latestMean.date)} UTC까지 연속 7일 · ${sourceLink(snapshot.source.url, 'OpenRouter API')}` : '전체 공개 합계가 있는 연속 7일이 필요합니다.'}</p></article>
        <article class="aist-token-stat"><h3>공개 모델 목록 · 선택 날짜</h3><strong>${rows.filter(row => row.model !== 'other').length}<small>개 모델</small></strong><p>${esc(state.tokenDate || '관측 없음')} UTC · ${sourceLink(snapshot.source.url, snapshot.source.name)}${rows.some(row => row.model === 'other') ? '<br>기타 모델 합계 별도 포함' : ''}</p></article></div>
    </section>
    <section class="panel sec"><div class="aist-token-header"><h2>${state.tokenMode === 'model' ? '모델별 공개 사용량' : '개발사별 · 표시된 모델 합계'}</h2><div class="aist-token-controls"><label class="aist-date" for="aist-token-date">관측 날짜 · UTC<select id="aist-token-date">${dates.map(date => `<option value="${date}"${date === state.tokenDate ? ' selected' : ''}>${date}</option>`).join('')}</select></label>
      <div class="aist-actions"><button type="button" class="f${state.tokenMode === 'model' ? ' on' : ''}" data-aist-token-mode="model" aria-pressed="${state.tokenMode === 'model'}">모델</button><button type="button" class="f${state.tokenMode === 'author' ? ' on' : ''}" data-aist-token-mode="author" aria-pressed="${state.tokenMode === 'author'}">개발사</button></div></div></div>
      <p class="aist-source">${state.tokenMode === 'author' ? '개발사 수치는 아래에 공개된 모델만 더한 값입니다. 기타 모델을 개발사에 배분하지 않으며, 개발사 전체 사용량이 아닙니다.' : '모델 순위는 수록된 공개 모델 안에서 비교합니다. 기타 모델은 마지막에 별도로 표시합니다.'}</p>
      ${visible.length ? `<div class="aist-table-wrap"><table class="aist-table aist-rank-table"><caption class="sr">${esc(state.tokenDate)} UTC ${state.tokenMode === 'model' ? '모델별' : '표시된 모델의 개발사별'} 공개 토큰 사용량</caption><thead><tr><th scope="col">순서</th><th scope="col">${state.tokenMode === 'model' ? '모델 · 개발사' : '개발사 · 표시된 모델만'}</th><th scope="col" class="aist-number">사용량 · 토큰</th></tr></thead><tbody>${visible.map((row, index) => {
        const other = row.model === 'other'
        const rounded = state.tokenMode === 'model' ? row.rounded : rows.some(item => item.author === row.author && item.rounded)
        const width = maximum ? Number(BigInt(row.totalTokens) * 10000n / maximum) / 100 : 0
        return `<tr><td>${other ? '—' : index + 1}</td><td><strong>${esc(other ? '기타 모델 · 개발사 미분류' : state.tokenMode === 'model' ? row.model : row.author)}</strong>${state.tokenMode === 'model' && !other ? `<small>${esc(row.author)}</small>` : ''}<div class="aist-rank-bar${other ? ' other' : ''}" style="--aist-bar:${width}%" aria-hidden="true"></div></td><td class="aist-number">${rounded ? '≈ ' : ''}${esc(formatTokens(row.totalTokens))}<small>${BigInt(row.totalTokens).toLocaleString('ko-KR')}${rounded ? ' · 원문 반올림' : ''}</small></td></tr>`
      }).join('')}</tbody></table></div>` : '<p class="aist-empty">완결된 일별 관측값이 없습니다.</p>'}
      <p class="aist-source">출처 ${sourceLink(snapshot.source.url, snapshot.source.name)} · ${esc(state.tokenDate || '관측 없음')} UTC · ${complete ? 'API의 일별 프롬프트 + 생성 토큰' : '공개 순위의 반올림 관측값'} · ${sourceLink('https://creativecommons.org/licenses/by/4.0/', snapshot.source.license)}</p>
    </section>${tokenTrendHTML(snapshot, daily)}
    <details class="panel aist-method"><summary>토큰 집계 범위 · 자동 수집</summary><p>일별 자동 수집은 OpenRouter 데이터 API를 사용합니다. API 기록이 연결되기 전에는 검토한 공개 순위 스냅샷을 표시하며, 스냅샷을 API로 수집한 값으로 표시하지 않습니다. 수집 실패 시 마지막 관측을 유지하고 성공 시점을 표시합니다.</p><p>진행 중인 UTC 날짜는 제외합니다. 일별 전체 공개 합계는 상위 모델과 기타 모델을 함께 포함한 경우에만 계산합니다. 개발사별 수치는 표시된 모델의 합계이며 기타 모델에 포함된 개발사별 물량은 알 수 없습니다. 원본 정수 토큰 수는 CSV에 보존하며, 화면의 만·억·조 표시는 읽기 쉽게 반올림합니다.</p></details>`
}

function render() {
  if (!view || view.hidden) return
  const active = document.activeElement
  const focusId = view.contains(active) ? active.id : ''
  const focusAction = view.contains(active) && active.tagName === 'BUTTON' ? Object.entries(active.dataset).find(([key]) => key.startsWith('aist')) : null
  const selection = active?.id === 'aist-search' ? [active.selectionStart, active.selectionEnd] : null
  view.setAttribute('aria-busy', String(state.loading))
  view.innerHTML = headerHTML() + (state.tab === 'tokens' ? tokensHTML() : metricsHTML())
  if (focusId) {
    const replacement = document.getElementById(focusId)
    replacement?.focus({ preventScroll: true })
    if (selection && replacement?.setSelectionRange) replacement.setSelectionRange(...selection)
  } else if (focusAction) {
    const [key, value] = focusAction
    const replacement = [...view.querySelectorAll('button')].find(button => button.dataset[key] === value)
    replacement?.focus({ preventScroll: true })
  }
}

async function fetchJSON(path) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(path, { cache: 'no-cache', signal: controller.signal })
    if (!response.ok) throw new Error(`자료 응답을 확인할 수 없습니다 (${response.status}).`)
    return await response.json()
  } finally { clearTimeout(timeout) }
}
async function fetchSnapshot(name, validate) {
  const staticHost = location.hostname === 'github.io' || location.hostname.endsWith('.github.io') || location.protocol === 'file:'
  if (staticHost) return { data: validate(await fetchJSON(`./data/${name}.json`)), fallback: false }
  try { return { data: validate(await fetchJSON(`./api/${name}`)), fallback: false } }
  catch { return { data: validate(await fetchJSON(`./data/${name}.json`)), fallback: true } }
}
async function load() {
  if (state.loading) return
  state.loading = true
  render()
  const results = await Promise.allSettled([
    fetchJSON('./data/ai-statistics.json').then(validateAiStatistics),
    fetchSnapshot('ai-tokens', validateTokenSnapshot),
    fetchSnapshot('ai-disclosures', validateDisclosureSnapshot),
  ])
  if (results[0].status === 'fulfilled') { state.stats = results[0].value; state.statsError = '' }
  else state.statsError = '연결 또는 자료 형식을 확인할 수 없습니다.'
  if (results[1].status === 'fulfilled') { state.tokens = results[1].value.data; state.tokenFallback = results[1].value.fallback; state.tokenError = '' }
  else state.tokenError = '연결 또는 자료 형식을 확인할 수 없습니다.'
  if (results[2].status === 'fulfilled') { state.disclosures = results[2].value.data; state.disclosureFallback = results[2].value.fallback; state.disclosureError = '' }
  else state.disclosureError = '발표자료 확인 기록을 불러오지 못했습니다.'
  state.loading = false
  state.attempted = true
  render()
}

function csvCell(value) {
  let text = String(value ?? '')
  if (typeof value !== 'number' && (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
function statsCsv(metrics) {
  const rows = [['definition_id', 'series_id', 'metric', 'entity', 'region_or_company_country', 'category', 'scope', 'unit', 'value', 'operator', 'period', 'evidence', 'source_name', 'source_url', 'published_at', 'verified_at', 'representative_observation', 'observation_note', 'period_end', 'corroborating_source_url', 'corroborating_source_published_at', 'source_references']]
  for (const metric of metrics) metric.observations.forEach((item, index) => rows.push([
    metric.definitionId, metric.id, metric.name, metric.entity, metric.region, metric.category,
    metric.scope, metric.unit, item.value, item.operator, item.period, item.evidence, item.sourceName,
    item.sourceUrl, item.publishedAt, item.verifiedAt, index === metric.latestIndex, item.note,
    item.periodEnd, item.corroboratingSourceUrl, item.corroboratingSourcePublishedAt, JSON.stringify(metric.sources || []),
  ]))
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}
function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.hidden = true
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function updateFilter(key, value) {
  state.filters[state.tab][key] = value
  state.limits[state.tab] = 18
  render()
}

view?.addEventListener('click', event => {
  const button = event.target.closest('button')
  if (!button) return
  if (button.dataset.aistMetric) {
    state.selected[state.tab] = button.dataset.aistMetric
    render()
    const panel = document.getElementById('aist-selected')
    panel?.focus({ preventScroll: true })
    panel?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  } else if (button.dataset.aistRegion) updateFilter('region', button.dataset.aistRegion)
  else if (button.dataset.aistTokenMode) { state.tokenMode = button.dataset.aistTokenMode; render() }
  else if (button.hasAttribute('data-aist-days')) { state.trendDays = Number(button.dataset.aistDays); render() }
  else if (button.dataset.aistAction === 'refresh') load()
  else if (button.dataset.aistAction === 'reset') { state.filters[state.tab] = newFilters(); state.limits[state.tab] = 18; render() }
  else if (button.dataset.aistAction === 'more') { state.limits[state.tab] += 18; render() }
  else if (button.dataset.aistAction === 'export-stats') download(`ai-statistics-${state.tab}-${state.stats.asOf}.csv`, statsCsv(filteredMetrics()))
  else if (button.dataset.aistAction === 'export-tokens') download(`ai-tokens-${latestTokenDate(state.tokens) || 'empty'}.csv`, tokenTotalsCsv(state.tokens))
})
view?.addEventListener('change', event => {
  if (event.target.dataset.aistFilter) updateFilter(event.target.dataset.aistFilter, event.target.value)
  else if (event.target.id === 'aist-token-date') { state.tokenDate = event.target.value; render() }
})
view?.addEventListener('input', event => {
  if (event.target.id === 'aist-search' && !event.isComposing) updateFilter('query', event.target.value)
})
view?.addEventListener('compositionend', event => {
  if (event.target.id === 'aist-search') updateFilter('query', event.target.value)
})

window.renderAiStatistics = function () {
  if (!view || view.hidden) return
  const tab = location.hash.slice(1).split('/')[1]
  state.tab = ['business', 'industry', 'tokens'].includes(tab) ? tab : 'business'
  if (!state.attempted && !state.loading) load()
  else render()
}
if (view && !view.hidden) window.renderAiStatistics()
