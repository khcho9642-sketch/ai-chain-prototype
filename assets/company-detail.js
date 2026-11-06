import { safeSourceUrl } from './ai-statistics-core.js'
import { catalog } from './company-catalog.js'
import { mountCompanyFinancials } from './company-financials.js'
import { discussionHref, mountQuote, mountSources } from './company-market.js'

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

const sectorNames = new Map(catalog.sectors.map(sector => [sector.id, sector.name]))
const countryNames = new Intl.DisplayNames(['ko'], { type: 'region' })
const metricNumber = new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 15 })
const preview = catalog.mode === 'preview'
const noop = () => {}

function detailHref(id, tab) {
  const base = '#company-info/company/' + encodeURIComponent(id)
  return tab === 'overview' ? base : base + '/' + tab
}

function date(value) {
  return `<time datetime="${escape(value)}">${escape(value)}</time>`
}

function evidenceList(sources) {
  const links = []
  for (const source of sources) {
    const url = safeSourceUrl(source.url)
    if (!url) continue
    const domain = new URL(url).hostname.replace(/^www\./, '')
    links.push(`<li><a class="cid-evidence" href="${escape(url)}" target="_blank" rel="noopener noreferrer">
      <span>${escape(source.label)} <span aria-hidden="true">↗</span></span>
      <small>${escape(domain)}</small><span class="sr">새 창</span>
    </a></li>`)
  }
  return links.length ? `<ul class="cid-evidence-list">${links.join('')}</ul>` : ''
}

function metadata(company) {
  const country = /^[A-Z]{2}$/.test(company.country) ? countryNames.of(company.country) : company.country
  const listing = company.listed === true ? '상장' : company.listed === false ? '비상장' : '확인 중'
  const pairs = [
    ['국가', country], ['주 섹터', sectorNames.get(company.sectorId)],
    ['보조 섹터', company.secondarySectorIds.map(id => sectorNames.get(id)).filter(Boolean).join(' · ')],
    ['상장 여부', listing], ['대표 티커', company.listings[0]?.ticker],
  ]
  return `<dl class="cid-facts">${pairs.filter(([, value]) => value).map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`
}

function overview(company, options) {
  const sources = evidenceList(company.sources)
  const hasSectorCore = catalog.companies.some(item => item.sectorId === company.sectorId && item.selection)
  const relatedTab = hasSectorCore ? 'core' : 'all'
  const relatedUrl = options.sectorHref?.(company.sectorId, relatedTab)
    ?? `#company-info?tab=${relatedTab}&sector=${encodeURIComponent(company.sectorId)}`
  const analysis = company.analysis
  const relatedLabel = hasSectorCore && !preview ? '같은 섹터 핵심 기업 보기' : hasSectorCore ? '같은 섹터 분석 대상 보기' : '같은 섹터 기업 보기'
  const related = `<a class="cid-action" href="${escape(relatedUrl)}">${relatedLabel} <span aria-hidden="true">→</span></a>`
  return `<div class="cid-overview">
    <section class="cid-card"><h2>기업 개요</h2>
      <p class="cid-description">${escape(company.overview || company.product)}</p>
      ${sources ? `<h3>공식 자료</h3>${sources}` : ''}
    </section>
    <section class="cid-card cid-related">
      ${company.selection ? `<h2>${preview ? '재무 DB 편입 이유' : '핵심 기업 선정 이유'}</h2><p>${escape(company.selection.reason)}</p>
        ${analysis ? `<a class="cid-action" href="${detailHref(company.id, 'analysis')}">분석 읽기 <span aria-hidden="true">→</span></a>
          <small>분석 갱신 ${date(analysis.updatedAt)}</small>` : `<p class="cid-state">${preview ? '심층 분석 미발행' : '분석 준비 중'}</p>`}`
        : `<h2>${escape(sectorNames.get(company.sectorId))}</h2>${related}`}
    </section>
  </div>${company.financialId ? '<section class="cid-card" data-detail-financials aria-label="기업 재무 실적"></section>' : ''}`
}

function metricTable(metrics) {
  if (!metrics.length) return ''
  const rows = metrics.map(metric => {
    const url = safeSourceUrl(metric.sourceUrl)
    const value = Number.isFinite(metric.value) ? metricNumber.format(metric.value) : '미공개'
    return `<tr><th scope="row">${escape(metric.label)}</th><td>${escape(metric.period)}</td>
      <td>${escape(metric.scope)}</td><td class="cid-number">${escape(value)}</td>
      <td>${escape([metric.currency, metric.unit].filter(Boolean).join(' '))}</td>
      <td>${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">원문<span class="sr"> · ${escape(metric.label)} ${escape(metric.period)}, 새 창</span> ↗</a>` : '—'}</td></tr>`
  })
  return `<div class="cid-metrics" role="region" aria-label="실적과 업종 지표" tabindex="0">
    <table><caption>실적과 업종 지표</caption><thead><tr>
    <th scope="col">지표</th><th scope="col">기간</th><th scope="col">범위</th>
    <th scope="col" class="cid-number">수치</th><th scope="col">단위</th><th scope="col">출처</th>
    </tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

function analysisBody(analysis) {
  const sections = [
    ['현재 문제', analysis.problem], ['기업의 해결 방식', analysis.solution],
    ['실적 검증', analysis.verification], ['결론과 다음 확인 항목', analysis.outlook],
  ]
  return `<article class="cid-analysis cid-card" aria-label="공개된 핵심 기업 분석">
    <div class="cid-thesis"><div>분석 결론 <span>자료 기준 ${date(analysis.asOf)}</span></div>
      <p>${escape(analysis.conclusion)}</p></div>
    ${sections.map(([heading, body], index) => `<section><h2>${heading}</h2><p>${escape(body)}</p>
      ${index === 2 ? metricTable(analysis.metrics) : ''}</section>`).join('')}
    <section><h2>분석 출처</h2>${evidenceList(analysis.sources)}</section>
    <p class="cid-publication">검토 ${escape(analysis.reviewer)} · 공개 ${date(analysis.publishedAt)} · 갱신 ${date(analysis.updatedAt)}</p>
  </article>`
}

export function renderCompanyDetail(container, company, tab = 'overview', options = {}) {
  const back = `<a class="cid-back" data-company-back href="${escape(options.listHref || '#company-info')}"><span aria-hidden="true">←</span> 목록으로</a>`
  if (!company) {
    container.innerHTML = `<div class="cid-detail">${back}<section class="cid-card"><h1>기업을 찾을 수 없습니다</h1><p>목록에서 기업명이나 티커로 검색해 주세요.</p></section></div>`
    return noop
  }
  const tabs = [['overview', '기업 개요']]
  if (company.selection && company.analysis) tabs.push(['analysis', '심층 분석'])
  if (company.listed && company.listings.length) tabs.push(['quote', '시세·차트'])
  if (company.sources.length || company.dartSymbol) tabs.push(['sources', '공시·공식 자료'])
  const current = tabs.some(([id]) => id === tab) ? tab : 'overview'
  const discussion = discussionHref(company)
  let body
  switch (current) {
    case 'analysis':
      body = analysisBody(company.analysis)
      break
    case 'quote':
      body = '<section class="cid-card" aria-label="기업 시세와 차트" data-detail-quote></section>'
      break
    case 'sources':
      body = `<div class="cid-source-sections">
        ${company.sources.length ? `<section class="cid-card"><h2>공식 자료</h2>${evidenceList(company.sources)}</section>` : ''}
        ${company.dartSymbol ? '<section class="cid-card" aria-label="최근 수집 공시" data-detail-filings></section>' : ''}
      </div>`
      break
    default:
      body = overview(company, options)
  }
  container.innerHTML = `<article class="cid-detail">
    ${back}
    <div class="cid-header"><div class="cid-name"><h1>${escape(company.name)}</h1>
      ${company.englishName && company.englishName !== company.name ? `<span lang="en">${escape(company.englishName)}</span>` : ''}
      ${company.selection ? `<strong class="cid-core">${preview ? '재무 DB 분석 대상' : '핵심 기업'}</strong>` : ''}</div>
      <p class="cid-product">${escape(company.product)}</p>${metadata(company)}
    </div>
    <nav class="cid-tabs" aria-label="기업 상세 메뉴">${tabs.map(([id, label]) =>
      `<a href="${detailHref(company.id, id)}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      ${discussion ? `<a class="cid-discussion" href="${escape(discussion)}">종목 토론 <span aria-hidden="true">↗</span><span class="sr"> · AI·사용자 의견</span></a>` : ''}
    </nav>${body}</article>`
  if (current === 'quote') return mountQuote(container.querySelector('[data-detail-quote]'), company)
  if (current === 'sources' && company.dartSymbol) return mountSources(container.querySelector('[data-detail-filings]'), company)
  if (current === 'overview' && company.financialId) return mountCompanyFinancials(container.querySelector('[data-detail-financials]'), company)
  return noop
}
