import { catalog } from './company-catalog.js'
import { renderCompanyDetail } from './company-detail.js'
import { defaultList, listHref, matchCompanies, pageSize, parseCompanyRoute, readList } from './company-browse.js'
import { columns, columnIds, columnsFor, defaultDirection, esc, sortCompanies, tableHtml } from './company-table.js'
const root=document.querySelector('#v-company-info')
const sectors=new Map(catalog.sectors.map(s=>[s.id,s])), core=catalog.companies.filter(c=>c.selection)
const regions=new Intl.DisplayNames(['ko'],{type:'region'})
const countryName=code=>/^[A-Z]{2}$/.test(code)?regions.of(code):code
const countries=[...new Set(catalog.companies.map(c=>c.country))].sort((a,b)=>countryName(a).localeCompare(countryName(b),'ko'))
let state, origin, restoreOnReturn, detailCleanup, market, marketPending, marketError=false
let activeRoute=null, marketFor=()=>null

function loadMarket() {
  if(market || marketPending || marketError)return
  marketPending=import('./company-market-data.js').then(async mod=>{
    const snapshot=await mod.loadCompanyMarket()
    if(!snapshot)throw Error('empty market snapshot')
    market=snapshot;marketFor=id=>mod.getCompanyMarket(snapshot,id)
  }).catch(()=>{marketError=true}).finally(()=>{
    marketPending=null
    if(activeRoute?.kind==='list' && state.tab==='all')updateResults()
  })
}
function coreResults(rows) {
  return catalog.sectors.map(s=>{
    const members=rows.filter(c=>c.sectorId===s.id)
    if(!members.length)return ''
    return '<section class="ci-group" style="--sector:'+esc(s.color)+'"><h3><i></i>'+esc(s.name)+'<small>'+members.length+'개사</small></h3><div class="ci-card-grid">'+members.map(c=>
      '<a class="ci-core-card" href="#company-info/company/'+encodeURIComponent(c.id)+'"><small>'+esc(c.listings[0]?.ticker || '비상장')+'<span> · '+esc(countryName(c.country))+'</span></small><strong>'+esc(c.name)+'</strong><p>'+esc(c.selection.role || c.product)+'</p><span class="ci-read">기업 분석 <span aria-hidden="true">↗</span></span></a>').join('')+'</div></section>'
  }).join('')
}
function tableResults(rows) {
  const ordered=sortCompanies(rows,state,sectors,marketFor)
  return tableHtml(ordered,state,sectors,marketFor)+(rows.length>state.limit?'<button class="ci-more" data-ci-more>더 보기 <small>'+state.limit+' / '+rows.length+'개사</small></button>':'')
}
function updateResults() {
  const rows=matchCompanies(catalog.companies,state), all=state.tab==='all'
  const conditions=[state.q&&'“'+state.q+'”',sectors.get(state.sector)?.name,state.country&&countryName(state.country),state.listing&&(state.listing==='listed'?'상장':'비상장')].filter(Boolean)
  const pool=all?catalog.companies:core
  root.querySelector('.ci-sector-list').innerHTML=[{id:'',name:'전체 섹터',color:'var(--muted)'},...catalog.sectors].map(s=>
    '<button data-ci-sector="'+esc(s.id)+'" aria-pressed="'+(state.sector===s.id)+'" style="--sector:'+esc(s.color)+'"><i></i><span>'+esc(s.name)+'</span><small>'+(s.id?pool.filter(c=>c.sectorId===s.id).length:pool.length)+'</small></button>').join('')
  root.querySelectorAll('.ci-tabs [data-ci-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ciTab===state.tab)))
  root.querySelector('.ci-count').textContent=rows.length+'개사'
  root.querySelector('.ci-results-name').textContent=sectors.get(state.sector)?.name || (all?'전체 기업 비교':'섹터별 핵심 기업')
  root.querySelector('.ci-criteria').textContent=conditions.join(' · ')
  root.querySelector('[data-ci-reset]').hidden=!conditions.length
  root.querySelector('.ci-sort').textContent=all?(columns.find(c=>c.id===state.sort)?.label+' '+(state.dir==='asc'?'오름차순':'내림차순')):'사업 구조 · 거래 관계 · 실적 · 리스크'
  const settings=root.querySelector('.ci-columns')
  settings.hidden=!all
  settings.querySelector('summary').textContent='표시 열 '+columnsFor(state.hidden).length+' / '+columns.length
  settings.querySelectorAll('input').forEach(input=>{input.checked=!state.hidden.split(',').includes(input.value)})
  const foot=root.querySelector('.ci-market-note')
  foot.hidden=!all
  if(all) {
    foot.querySelector('strong').textContent=market?'시세 기준일 '+(market.asOf||'미확인')+' · USD 환율 기준일 '+(market.fxDate||'미확인'):marketError?'시세 자료를 불러오지 못했습니다.':'시세 자료를 불러오는 중입니다.'
    foot.querySelector('button').hidden=!marketError
    loadMarket()
  }
  const results=root.querySelector('.ci-items'), oldScroll=root.querySelector('.ci-scroll-table')?.scrollLeft || 0
  if(rows.length)results.innerHTML=all?tableResults(rows):coreResults(rows)
  else {
    const n=all?0:matchCompanies(catalog.companies,{...state,tab:'all'}).length
    results.innerHTML='<div class="ci-empty"><h3>조건에 맞는 기업이 없습니다</h3><p>'+esc(conditions.join(' · '))+'</p><button class="ci-small-action" data-ci-reset>필터 초기화</button>'+(n?'<button class="ci-small-action" data-ci-tab="all">전체 기업에서 '+n+'개 보기 →</button>':'')+'</div>'
  }
  const box=results.querySelector('.ci-scroll-table')
  if(box)box.scrollLeft=oldScroll
}
function renderList(snapshot) {
  root.innerHTML=`<div class="ci-shell"><div class="ci-heading"><div><span class="ci-kicker">AI VALUE CHAIN / COMPANIES</span><h1>신기업정보</h1><p>9개 섹터의 핵심 기업을 읽고, 전체 기업의 시장·재무 지표를 비교하세요.</p></div><nav class="ci-tools" aria-label="종목 도구"><a href="#data/quotes">시세 조회 ↗</a><a href="#data/watchlist">관심종목 ↗</a></nav></div>
    <div class="ci-tabs" role="group" aria-label="기업 범위"><button data-ci-tab="core">핵심 기업 <b>${core.length}</b></button><button data-ci-tab="all">전체 기업 <b>${catalog.companies.length}</b></button></div>
    <div class="ci-search-row"><label class="ci-searchbox"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg><span class="sr">기업 검색</span><input type="search" id="ci-query" autocomplete="off" placeholder="기업명, 영문명, 티커 또는 역할 검색" value="${esc(state.q)}"></label><button class="ci-filter-toggle" aria-controls="ci-filters" aria-expanded="${Boolean(snapshot?.open)}">필터</button></div>
    <div class="ci-conditions"><span class="ci-criteria"></span><button data-ci-reset>필터 초기화</button></div>
    <div class="ci-layout"><aside id="ci-filters" class="ci-filters" data-open="${Boolean(snapshot?.open)}" aria-label="기업 필터"><h2>섹터</h2><div class="ci-sector-list"></div><label>국가<select data-ci-filter="country"><option value="">전체 국가</option>${countries.map(code=>'<option value="'+esc(code)+'">'+esc(countryName(code))+'</option>').join('')}</select></label>
      <label>상장 여부<select data-ci-filter="listing"><option value="">전체</option><option value="listed">상장</option><option value="private">비상장</option></select></label></aside>
    <section class="ci-results" aria-label="검색 결과"><div class="ci-results-head"><h2><span class="ci-results-name"></span> <span class="ci-count" aria-live="polite"></span></h2><div class="ci-display"><small class="ci-sort"></small><details class="ci-columns" hidden><summary>표시 열</summary><div class="ci-column-options">${columns.map(c=>'<label><input type="checkbox" data-ci-column value="'+c.id+'" '+(c.id==='name'?'disabled ':'')+'checked> '+esc(c.label)+'</label>').join('')}<button type="button" data-ci-allcols>14개 열 모두 표시</button></div></details></div></div>
    <div class="ci-items"></div><div class="ci-market-note" hidden><strong aria-live="polite"></strong> <button data-ci-retry hidden>다시 불러오기</button><p>주가는 거래소 현지 통화의 확정 종가입니다. 시가총액과 최근 4분기 매출은 억 달러, 등락률은 현지 통화 기준입니다. 기준일의 종가가 없는 종목은 주가를 비워 둡니다. 매출 성장률은 전년 같은 기간 대비이며 비교 기간을 값 아래 표시합니다. 열 제목을 눌러 정렬하고 표를 좌우로 움직여 모든 지표를 볼 수 있습니다.</p><p>비상장 평가액은 출처와 평가일을 함께 표시하며, 시가총액 순위와 합계에서 제외합니다. — 는 확인된 값이 없다는 뜻입니다. <a href="#home">홈 업종 수익률</a>은 핵심 기업 중 상장사만을 대상으로 합니다.</p></div></section></div></div>`
  for(const select of root.querySelectorAll('[data-ci-filter]'))select.value=state[select.dataset.ciFilter]
  updateResults()
}
function listSnapshot() {
  return {href:listHref(state),y:window.scrollY,x:root.querySelector('.ci-scroll-table')?.scrollLeft||0,open:root.querySelector('#ci-filters')?.dataset.open==='true'}
}
function changeList(changes) {
  state={...state,limit:pageSize,...changes}
  history.replaceState({...history.state,companyList:listSnapshot()},'',listHref(state))
  updateResults()
}
function route() {
  const prior=activeRoute
  activeRoute=parseCompanyRoute(location.hash)
  detailCleanup?.();detailCleanup=null
  if(!activeRoute){origin=null;restoreOnReturn=null;return}
  if(activeRoute.kind==='list'){
    state=readList(location.hash,catalog)
    const restore=restoreOnReturn||history.state?.companyList
    restoreOnReturn=null
    renderList(restore)
    if(restore?.href===listHref(state)){
      history.replaceState({...history.state,companyList:restore},'')
      requestAnimationFrame(()=>{if(activeRoute?.kind==='list'){const box=root.querySelector('.ci-scroll-table');if(box)box.scrollLeft=restore.x||0;window.scrollTo(0,restore.y)}})
    }
    origin=null;return
  }
  origin=history.state?.companyOrigin||(prior?origin:null)
  if(origin)history.replaceState({...history.state,companyOrigin:origin},'')
  const company=catalog.companies.find(c=>c.id===activeRoute.id)
  if(company && !company.selection){
    history.replaceState(history.state,'',listHref({...defaultList,tab:'all',q:company.name}))
    route();return
  }
  detailCleanup=renderCompanyDetail(root,company,activeRoute.tab,{listHref:origin?.href||'#company-info',sectorHref:(sector,tab)=>listHref({...defaultList,sector,tab})})
  if(company)document.title=company.name+' · 신기업정보 | AI Value Chain'
}
root.addEventListener('input',e=>{if(e.target.id==='ci-query')changeList({q:e.target.value})})
root.addEventListener('change',e=>{
  if(e.target.matches('[data-ci-filter]'))changeList({[e.target.dataset.ciFilter]:e.target.value})
  if(e.target.hasAttribute('data-ci-column')){
    const hide=new Set(state.hidden.split(','))
    if(e.target.checked)hide.delete(e.target.value);else hide.add(e.target.value)
    changeList({hidden:columnIds.filter(id=>id!=='name'&&hide.has(id)).join(','),limit:state.limit})
  }
})
document.addEventListener('click',e=>{
  if(e.button!==0||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||!activeRoute)return
  const link=e.target.closest('a')
  if(activeRoute.kind==='list'&&link){origin=listSnapshot();history.replaceState({...history.state,companyList:origin},'')}
  else if(link?.hasAttribute('data-company-back')&&origin)restoreOnReturn=origin
  const b=e.target.closest('button')
  if(!b||!root.contains(b)||activeRoute.kind!=='list')return
  if(b.hasAttribute('data-ci-tab'))changeList({tab:b.dataset.ciTab})
  else if(b.hasAttribute('data-ci-sector')){
    changeList({sector:b.dataset.ciSector})
    root.querySelector('.ci-sector-list [aria-pressed="true"]')?.focus({preventScroll:true})
  }else if(b.hasAttribute('data-ci-sort')){
    const sort=b.dataset.ciSort, dir=state.sort===sort?(state.dir==='asc'?'desc':'asc'):defaultDirection(sort)
    changeList({sort,dir});root.querySelector('[data-ci-sort="'+sort+'"]')?.focus({preventScroll:true})
  }else if(b.hasAttribute('data-ci-more')){
    const old=state.limit;changeList({limit:Math.min(old+pageSize,catalog.companies.length)})
    const row=root.querySelectorAll('.ci-market-table tbody tr')[old];if(row){row.tabIndex=-1;row.focus({preventScroll:true})}
  }else if(b.hasAttribute('data-ci-allcols'))changeList({hidden:'',limit:state.limit})
  else if(b.hasAttribute('data-ci-retry')){marketError=false;updateResults()}
  else if(b.hasAttribute('data-ci-reset')){
    changeList({q:'',sector:'',country:'',listing:''})
    root.querySelector('#ci-query').value='';root.querySelectorAll('[data-ci-filter]').forEach(s=>{s.value=''})
    root.querySelector('#ci-query').focus()
  }else if(b.classList.contains('ci-filter-toggle')){
    const open=b.getAttribute('aria-expanded')!=='true'
    b.setAttribute('aria-expanded',String(open));root.querySelector('#ci-filters').dataset.open=String(open)
  }
})
window.addEventListener('hashchange',route)
route()
