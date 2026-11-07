import { safeSourceUrl } from './ai-statistics-core.js'
import { catalog } from './company-catalog.js'
import { mountCompanyFinancials } from './company-financials.js'
import { discussionHref, mountQuote, mountSources } from './company-market.js'

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const sectorNames = new Map(catalog.sectors.map(sector => [sector.id, sector.name]))
const countryNames = new Intl.DisplayNames(['ko'], { type: 'region' })
const noop = () => {}

function detailHref(id, tab) {
  const base = '#company-info/company/' + encodeURIComponent(id)
  return tab === 'overview' ? base : base + '/' + tab
}

function evidenceList(sources) {
  const links = new Map()
  for (const source of sources) {
    const url = safeSourceUrl(source.url)
    if (!url || links.has(url)) continue
    const domain = new URL(url).hostname.replace(/^www\./, '')
    links.set(url, `<li><a class="cid-evidence" href="${escape(url)}" target="_blank" rel="noopener noreferrer">
      <span>${escape(source.label)} <span aria-hidden="true">↗</span></span>
      <small>${escape(domain)}</small><span class="sr">새 창</span></a></li>`)
  }
  return links.size ? `<ul class="cid-evidence-list">${[...links.values()].join('')}</ul>` : ''
}

function metadata(company) {
  const country = /^[A-Z]{2}$/.test(company.country) ? countryNames.of(company.country) : company.country
  const pairs = [
    ['국가', country], ['주 섹터', sectorNames.get(company.sectorId)],
    ['관련 섹터', company.secondarySectorIds.map(id => sectorNames.get(id)).filter(Boolean).join(' · ')],
    ['상장 여부', company.listed ? '상장' : '비상장'], ['대표 티커', company.listings[0]?.ticker],
  ]
  return `<dl class="cid-facts">${pairs.filter(([, value]) => value).map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`
}

function reference([label, url]) { return { label, url } }

function businessAnalysis(brief) {
  return `<div class="cid-business-grid">
    <section class="cid-card"><h2>사업 구조</h2><p>${escape(brief.business)}</p></section>
    <section class="cid-card"><h2>AI 밸류체인 내 역할</h2><p>${escape(brief.role)}</p></section>
    <section class="cid-card"><h2>주요 고객</h2><p>${escape(brief.buyers)}</p></section>
    <section class="cid-card"><h2>공급사와 조달 구조</h2><p>${escape(brief.supply)}</p></section>
  </div>`
}

function mountEditorial(container, company, sourcesOnly) {
  let active = true
  const sourceHost = container.querySelector('[data-detail-references]')
  const business = container.querySelector('[data-detail-business]')
  import('./company-core-briefs.js').then(({ coreBriefs }) => {
    if (!active) return
    const brief = coreBriefs[company.id]
    if (!brief) throw new Error('핵심 기업 분석 자료가 없습니다.')
    const refs = [reference(brief.source), ...company.sources]
    if (brief.observation) refs.push(reference(brief.observation.slice(1)))
    sourceHost.innerHTML = evidenceList(refs)
    if (sourcesOnly) return
    business.innerHTML = businessAnalysis(brief)
    container.querySelector('[data-detail-risk]').textContent = brief.risk
    if (brief.observation) {
      const [text, label, url] = brief.observation
      container.querySelector('[data-detail-operating]').innerHTML =
        `<h2>사업 지표 추이</h2><p>${escape(text)}</p>${evidenceList([{label, url}])}`
    }
  }).catch(() => {
    if (!active) return
    sourceHost.innerHTML = evidenceList(company.sources)
    if (business) business.textContent = '기업 분석을 불러오지 못했습니다. 기업 공식 자료를 확인해 주세요.'
  })
  return () => { active = false }
}

export function renderCompanyDetail(container, company, tab = 'overview', options = {}) {
  const back = `<a class="cid-back" data-company-back href="${escape(options.listHref || '#company-info')}"><span aria-hidden="true">←</span> 목록으로</a>`
  if (!company || !company.selection) {
    const message = company ? '이 기업은 전체 기업 표에서 확인할 수 있습니다.' : '기업을 찾을 수 없습니다.'
    container.innerHTML = `<div class="cid-detail">${back}<section class="cid-card"><h1>${message}</h1>
      <a class="cid-action" href="#company-info?tab=all">전체 기업 보기 →</a></section></div>`
    return noop
  }
  const tabs = [['overview', '기업 분석']]
  if (company.listed && company.listings.length) tabs.push(['quote', '시세·차트'])
  tabs.push(['sources', '공시·공식 자료'])
  const current = tabs.some(([id]) => id === tab) ? tab : 'overview'
  const discussion = discussionHref(company)
  const references = '<section class="cid-card"><h2>사업·거래 관계 근거</h2><div data-detail-references></div></section>'
  let body
  switch (current) {
    case 'quote':
      body = '<section class="cid-card" aria-label="기업 시세와 차트" data-detail-quote></section>'
      break
    case 'sources':
      body = `<div class="cid-source-sections">${references}
        ${company.dartSymbol ? '<section class="cid-card" aria-label="최근 수집 공시" data-detail-filings></section>' : ''}</div>`
      break
    default:
      body = `<div data-detail-business>기업 분석을 불러오고 있습니다.</div>
        ${company.listed ? '<section class="cid-card" data-detail-financials aria-label="기업 실적 추이"></section>'
          : '<section class="cid-card cid-story" data-detail-operating></section>'}
        <section class="cid-card cid-story"><h2>위험 요인과 확인할 지표</h2><p data-detail-risk></p></section>
        ${references}`
  }
  container.innerHTML = `<article class="cid-detail">
    ${back}
    <div class="cid-header"><div class="cid-name"><h1>${escape(company.name)}</h1>
      ${company.englishName && company.englishName !== company.name ? `<span lang="en">${escape(company.englishName)}</span>` : ''}
      <strong class="cid-core">핵심 기업</strong></div>
      <p class="cid-product">${escape(company.product)}</p>${metadata(company)}
    </div>
    <nav class="cid-tabs" aria-label="기업 상세 메뉴">${tabs.map(([id, label]) =>
      `<a href="${detailHref(company.id, id)}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      ${discussion ? `<a class="cid-discussion" href="${escape(discussion)}">종목 토론 <span aria-hidden="true">↗</span><span class="sr"> · AI·사용자 의견</span></a>` : ''}
    </nav>${body}</article>`
  if (current === 'quote') return mountQuote(container.querySelector('[data-detail-quote]'), company)
  const cleanupText = mountEditorial(container, company, current === 'sources')
  let cleanupData = noop
  if (current === 'sources' && company.dartSymbol) cleanupData = mountSources(container.querySelector('[data-detail-filings]'), company)
  if (current === 'overview' && company.listed) cleanupData = mountCompanyFinancials(container.querySelector('[data-detail-financials]'), company)
  return () => { cleanupText(); cleanupData() }
}
