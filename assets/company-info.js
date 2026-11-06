import { catalog } from './company-catalog.js'
import { renderCompanyDetail } from './company-detail.js'
import { defaultList, listHref, matchCompanies, pageSize, parseCompanyRoute, readList } from './company-browse.js'

const root = document.querySelector('#v-company-info')
const sectors = new Map(catalog.sectors.map(s => [s.id, s]))
const core = catalog.companies.filter(c => c.selection)
const published = core.filter(c => c.analysis).length
const regions = new Intl.DisplayNames(['ko'], { type: 'region' })
const countryName = code => /^[A-Z]{2}$/.test(code) ? regions.of(code) : code
const countries = [...new Set(catalog.companies.map(c => c.country))].sort((a,b) => countryName(a).localeCompare(countryName(b),'ko'))
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
const hrefFor = c => '#company-info/company/' + encodeURIComponent(c.id)
let state, origin, restoreOnReturn, detailCleanup
let activeRoute = null

function sectorTag(id) {
  const sector = sectors.get(id)
  return sector ? '<span class="ci-sector-tag" style="--sector:' + esc(sector.color) + '">' + esc(sector.name) + '</span>' : ''
}

function nameCell(company) {
  return '<a class="ci-company-link" href="' + hrefFor(company) + '">' + esc(company.name) + '</a>' +
    '<small>' + esc(company.listings[0]?.ticker || company.englishName) + '</small>'
}

function coreResults(rows) {
  return catalog.sectors.map(sector => {
    const members = rows.filter(c => c.sectorId === sector.id)
    if (!members.length) return ''
    return '<section class="ci-group" style="--sector:' + esc(sector.color) + '"><h3><i></i>' + esc(sector.name) +
      '<small>' + members.length + '개사</small></h3>' + members.map(c =>
        '<article class="ci-core-row"><div class="ci-identity">' + nameCell(c) + '</div><div class="ci-business"><strong>' + esc(c.product) +
        '</strong><p>' + esc(c.selection.reason) + '</p></div><div class="ci-entry">' +
        (c.analysis ? '<small>갱신 ' + esc(c.analysis.updatedAt) + '</small><a href="' + hrefFor(c) + '/analysis">분석 읽기 →</a>'
          : '<small>분석 준비 중</small><a href="' + hrefFor(c) + '">기본정보 보기 →</a>') + '</div></article>').join('') + '</section>'
  }).join('')
}

function tableResults(rows) {
  return '<table class="ci-table"><thead><tr><th>기업명</th><th>국가</th><th>주 섹터</th><th>주요 제품·서비스</th><th>상장 여부</th></tr></thead><tbody>' +
    rows.slice(0,state.limit).map(c => '<tr><td class="ci-identity">' + nameCell(c) + (c.selection ? '<span class="ci-core-label">핵심</span>' : '') +
    '</td><td class="ci-country">' + esc(countryName(c.country)) + '</td><td class="ci-sector-cell">' + sectorTag(c.sectorId) +
    (state.sector && c.sectorId !== state.sector ? '<small>관련 · ' + esc(sectors.get(state.sector)?.name) + '</small>' : '') +
    '</td><td class="ci-product">' + esc(c.product) + '</td><td class="ci-listed">' + (c.listed ? '상장' : '비상장') + '</td></tr>').join('') +
    '</tbody></table>' + (rows.length > state.limit ? '<button class="ci-more" data-ci-more>더 보기 <small>' + state.limit + ' / ' + rows.length + '</small></button>' : '')
}

function selectedConditions() {
  return [state.q && '“' + state.q + '”', sectors.get(state.sector)?.name, state.country && countryName(state.country),
    state.listing && (state.listing === 'listed' ? '상장' : '비상장')].filter(Boolean)
}

function updateResults() {
  const rows = matchCompanies(catalog.companies, state)
  const conditions = selectedConditions()
  const pool = state.tab === 'core' ? core : catalog.companies
  const sectorList = root.querySelector('.ci-sector-list')
  const sectorOptions = [{id:'', name:'전체 섹터', color:'var(--muted)'}, ...catalog.sectors]
  sectorList.innerHTML = sectorOptions.map(s => {
    const n = s.id ? pool.filter(c => c.sectorId === s.id || (state.tab === 'all' && c.secondarySectorIds.includes(s.id))).length : pool.length
    return '<button data-ci-sector="' + esc(s.id) + '" aria-pressed="' + (state.sector === s.id) + '" style="--sector:' + esc(s.color) +
      '"><i></i><span>' + esc(s.name) + '</span><small>' + n + '</small></button>'
  }).join('')
  root.querySelectorAll('[data-ci-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ciTab === state.tab)))
  root.querySelector('.ci-count').textContent = rows.length + '개사'
  root.querySelector('.ci-results-name').textContent = sectors.get(state.sector)?.name || (state.tab === 'core' ? '섹터별 핵심 기업' : '전체 기업 목록')
  root.querySelector('.ci-criteria').textContent = conditions.join(' · ')
  root.querySelector('[data-ci-reset]').hidden = !conditions.length
  root.querySelector('.ci-sort').textContent = state.tab === 'core' ? '분석 대상 ' + core.length + '개사 · 분석 공개 ' + published + '개사' : '기업명순'
  const results = root.querySelector('.ci-items')
  if (rows.length) {
    results.innerHTML = state.tab === 'core' ? coreResults(rows) : tableResults(rows)
    return
  }
  const allCount = state.tab === 'core' ? matchCompanies(catalog.companies, {...state, tab:'all'}).length : 0
  results.innerHTML = '<div class="ci-empty"><h3>조건에 맞는 기업이 없습니다</h3>' +
    (conditions.length ? '<p>' + esc(conditions.join(' · ')) + '</p>' : '') +
    '<button class="ci-small-action" data-ci-reset>필터 초기화</button>' +
    (allCount ? '<button class="ci-small-action" data-ci-tab="all">전체 기업에서 ' + allCount + '개 보기 →</button>' : '') + '</div>'
}

function renderList(snapshot) {
  root.innerHTML = `<div class="ci-shell">
    <div class="ci-heading"><div><h1>신기업정보</h1><p>${catalog.mode === 'approved' ? '공개 기업 원장' : '개발용 기업 목록'} · 9개 밸류체인 섹터</p></div>
      <nav class="ci-tools" aria-label="종목 도구"><a href="#data/quotes">시세 조회 ↗</a><a href="#data/watchlist">관심종목 ↗</a></nav></div>
    <div class="ci-tabs" role="group" aria-label="기업 범위"><button data-ci-tab="core">핵심 기업 <b>${core.length}</b></button>
      <button data-ci-tab="all">전체 기업 <b>${catalog.companies.length}</b></button></div>
    <div class="ci-search-row"><label class="ci-searchbox"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg>
      <span class="sr">기업 검색</span><input type="search" id="ci-query" autocomplete="off" placeholder="기업명, 영문명, 티커, 주요 제품 검색" value="${esc(state.q)}"></label>
      <button class="ci-filter-toggle" aria-controls="ci-filters" aria-expanded="${Boolean(snapshot?.open)}">필터</button></div>
    <div class="ci-conditions"><span class="ci-criteria"></span><button data-ci-reset>필터 초기화</button></div>
    <div class="ci-layout"><aside id="ci-filters" class="ci-filters" data-open="${Boolean(snapshot?.open)}" aria-label="기업 필터">
      <h2>섹터</h2><div class="ci-sector-list"></div>
      <label>국가<select data-ci-filter="country"><option value="">전체 국가</option>${countries.map(code => '<option value="' + esc(code) + '">' + esc(countryName(code)) + '</option>').join('')}</select></label>
      <label>상장 여부<select data-ci-filter="listing"><option value="">전체</option><option value="listed">상장</option><option value="private">비상장</option></select></label>
    </aside><section class="ci-results" aria-label="검색 결과"><div class="ci-results-head"><h2><span class="ci-results-name"></span> <span class="ci-count" aria-live="polite"></span></h2>
      <small class="ci-sort"></small></div><div class="ci-items"></div></section></div></div>`
  for (const select of root.querySelectorAll('[data-ci-filter]')) select.value = state[select.dataset.ciFilter]
  updateResults()
}

function listSnapshot() {
  return { href: listHref(state), y: window.scrollY, open: root.querySelector('#ci-filters')?.dataset.open === 'true' }
}

function changeList(changes) {
  state = {...state, limit:pageSize, ...changes}
  history.replaceState({...history.state, companyList:listSnapshot()}, '', listHref(state))
  updateResults()
}

function route() {
  const prior = activeRoute
  activeRoute = parseCompanyRoute(location.hash)
  detailCleanup?.()
  detailCleanup = null
  if (!activeRoute) { origin = null; restoreOnReturn = null; return }
  if (activeRoute.kind === 'list') {
    state = readList(location.hash, catalog)
    const restore = restoreOnReturn || history.state?.companyList
    restoreOnReturn = null
    renderList(restore)
    if (restore?.href === listHref(state)) {
      history.replaceState({...history.state, companyList:restore}, '')
      requestAnimationFrame(() => { if (activeRoute?.kind === 'list') window.scrollTo(0, restore.y) })
    }
    origin = null
    return
  }
  origin = history.state?.companyOrigin || (prior ? origin : null)
  if (origin) history.replaceState({...history.state, companyOrigin:origin}, '')
  const company = catalog.companies.find(c => c.id === activeRoute.id)
  detailCleanup = renderCompanyDetail(root, company, activeRoute.tab, {listHref:origin?.href || '#company-info',
    sectorHref:(sector,tab) => listHref({...defaultList, sector, tab})})
  if (company) document.title = company.name + ' · 신기업정보 | AI Value Chain'
}

root.addEventListener('input', e => {
  if (e.target.id === 'ci-query') changeList({q:e.target.value})
})
root.addEventListener('change', e => {
  if (e.target.matches('[data-ci-filter]')) changeList({[e.target.dataset.ciFilter]:e.target.value})
})
document.addEventListener('click', e => {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !activeRoute) return
  const link = e.target.closest('a')
  if (activeRoute.kind === 'list' && link) {
    origin = listSnapshot()
    history.replaceState({...history.state, companyList:origin}, '')
  } else if (link?.hasAttribute('data-company-back') && origin) restoreOnReturn = origin
  const b = e.target.closest('button')
  if (!b || !root.contains(b) || activeRoute.kind !== 'list') return
  if (b.hasAttribute('data-ci-tab')) changeList({tab:b.dataset.ciTab})
  if (b.hasAttribute('data-ci-sector')) {
    changeList({sector:b.dataset.ciSector})
    root.querySelector('.ci-sector-list [aria-pressed="true"]')?.focus({preventScroll:true})
  }
  if (b.hasAttribute('data-ci-more')) {
    const previousLimit = state.limit
    changeList({limit:Math.min(state.limit + pageSize, catalog.companies.length)})
    root.querySelectorAll('.ci-table .ci-company-link')[previousLimit]?.focus({preventScroll:true})
  }
  if (b.hasAttribute('data-ci-reset')) {
    changeList({...defaultList,tab:state.tab})
    root.querySelector('#ci-query').value = ''
    root.querySelectorAll('[data-ci-filter]').forEach(s => { s.value = '' })
    root.querySelector('#ci-query').focus()
  }
  if (b.classList.contains('ci-filter-toggle')) {
    const open = b.getAttribute('aria-expanded') !== 'true'
    b.setAttribute('aria-expanded', String(open))
    root.querySelector('#ci-filters').dataset.open = String(open)
  }
})
window.addEventListener('hashchange', route)
route()
