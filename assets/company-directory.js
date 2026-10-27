import { instruments } from './instruments.js'
import { companyProfiles } from './company-profiles.js'
import { dartCompanies } from './company-disclosure-sources.js'
import { validateCompanyDisclosures } from './company-disclosures-core.js'

const CHAIN_NAMES=['소부장','파운드리·패키징','메모리','AI 칩','전력','인프라','모델','애플리케이션']
const chains=CHAIN_NAMES.map((name,index)=>({id:index+1,name}))
const companies=instruments.filter(item=>item.chains.some(id=>id>=1&&id<=8))
const PAGE_SIZE=12
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const number=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{maximumFractionDigits:2}):'—'
const searchText=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g,'')
const profileFor=symbol=>companyProfiles[symbol]||{}
const membershipCount=companies.reduce((sum,item)=>sum+item.chains.filter(id=>id>=1&&id<=8).length,0)
let search='',chain=0,market='전체',limit=PAGE_SIZE,snapshot=window.aiChainSnapshot||null
let quoteMap=new Map((snapshot?.quotes||[]).map(quote=>[quote.symbol,quote]))
const dartBySymbol=new Map(dartCompanies.map(company=>[company.symbol,company]))
const staticHost=location.hostname.endsWith('.github.io')||location.protocol==='file:'
const expandedFilings=new Set()
let disclosures=null,disclosureError='',disclosureBusy=false,disclosureReadAt=0
let disclosureMap=new Map()

function filingTime(value){
  return value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' KST':'성공 확인 전'
}
function disclosureStatus(){
  if(!disclosures)return disclosureBusy?'국내 18개 기업의 공식 공시 수집 상태를 읽고 있습니다.':disclosureError||'공시 수집 상태를 아직 확인하지 못했습니다.'
  const checked=disclosures.companies.filter(company=>company.status==='ok').length
  const count=disclosures.companies.reduce((total,company)=>total+company.items.length,0)
  const success=disclosures.collection.lastSuccessAt
  const stale=success&&Date.now()-Date.parse(success)>90*60000
  return `${disclosureBusy?'공시 자료 읽는 중 · ':''}DART 공식 공시 · ${checked}/${dartCompanies.length}개 기업 확인 · 보존한 공시 ${count}건 · 전체 성공 ${filingTime(success)}${stale?' · 수집 지연':''}${disclosures.collection.status==='partial'||disclosures.collection.status==='error'?' · 조회 실패가 있어 이전 성공 자료를 함께 표시합니다.':''}${disclosureError?' · '+disclosureError:''}`
}
function disclosureCard(item){
  const definition=dartBySymbol.get(item.symbol)
  if(!definition)return ''
  const company=disclosureMap.get(item.symbol),items=company?.items||[]
  const pending=!company?.lastSuccessAt
  const stale=company?.lastSuccessAt&&Date.now()-Date.parse(company.lastSuccessAt)>90*60000
  const badge=pending?'확인 전':`${items.length}건 보존`
  const state=company?.status==='error'?'조회 실패 · 이전 성공 자료':stale?'수집 지연 · 이전 성공 자료':pending?'아직 성공한 수집 자료가 없습니다.':`최근 성공 확인 ${filingTime(company.lastSuccessAt)}`
  return `<details class="company-filings" data-company-filings="${esc(item.symbol)}"${expandedFilings.has(item.symbol)?' open':''}><summary>공식 공시 <span>${esc(badge)}</span></summary><p class="company-filing-status">${esc(state)}</p>${items.length?`<ul>${items.slice(0,5).map(filing=>`<li><a href="${esc(filing.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(filing.title)}<span class="sr">: ${esc(item.name)}, DART 원문, 새 창</span></a><time datetime="${esc(filing.publishedAt)}">${esc(filingTime(filing.publishedAt))}</time></li>`).join('')}</ul>${items.length>5?`<p class="company-filing-status">보존한 ${items.length}건 중 최근 5건 표시</p>`:''}`:pending?'':`<p class="company-filing-status">현재 RSS 수집 범위에서 보존한 공시가 없습니다. 전체 공시 이력은 아닙니다.</p>`}<p class="company-filing-status">최근 5영업일 RSS를 수집하며, 수집을 시작한 뒤 확보한 공시만 최대 90일 보존합니다. <a href="${esc(definition.rssUrl)}" target="_blank" rel="noopener noreferrer">DART 공식 RSS ↗</a></p></details>`
}
async function loadDisclosures(){
  if(disclosureBusy)return
  disclosureBusy=true;disclosureError='';renderResults()
  try{
    let value,fallback=false
    const request=async path=>{
      const response=await fetch(path+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)})
      if(!response.ok)throw new Error('공시 자료 HTTP '+response.status)
      return validateCompanyDisclosures(await response.json())
    }
    if(staticHost)value=await request('./data/company-disclosures.json')
    else{
      try{value=await request('./api/company-disclosures')}
      catch{value=await request('./data/company-disclosures.json');fallback=true}
    }
    disclosures=value;disclosureMap=new Map(value.companies.map(company=>[company.symbol,company]))
    if(fallback)disclosureError='API를 확인하지 못해 함께 배포된 공시 자료를 표시합니다.'
  }catch{disclosureError='공시 자료를 읽지 못했습니다. 이전에 확인한 자료가 있으면 유지합니다.'}
  finally{disclosureBusy=false;disclosureReadAt=Date.now();renderResults()}
}

function safeSource(value){
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null}catch{return null}
}
function quoteTime(value){
  if(!Number.isFinite(value))return '기준 시각 미제공'
  const parsed=new Date(value*1000)
  return Number.isNaN(parsed.valueOf())?'기준 시각 미제공':`${parsed.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} KST`
}
function matches(){
  const needle=searchText(search)
  return companies.filter(item=>{
    const profile=profileFor(item.symbol)
    return (!chain||item.chains.includes(chain))&&(market==='전체'||item.group===market)&&(!needle||searchText([item.name,item.symbol,profile.role,profile.country,...item.chains.map(id=>CHAIN_NAMES[id-1])].join(' ')).includes(needle))
  })
}
function card(item){
  const profile=profileFor(item.symbol),quote=quoteMap.get(item.symbol),sourceUrl=safeSource(profile.sourceUrl)
  const percent=Number.isFinite(quote?.changePercent)?quote.changePercent:null
  const change=percent===null?'—':`${percent>0?'+':''}${percent.toFixed(2)}%`
  const changeClass=percent>0?'company-up':percent<0?'company-down':''
  const price=Number.isFinite(quote?.price)?`${number(quote.price)} ${esc(quote.currency||'')}`:'시세 미수집'
  return `<article class="company-card"><div class="company-card-heading"><div><h3>${esc(item.name)}</h3><p class="company-symbol mono">${esc(item.symbol)}</p></div><span class="company-region">${esc(profile.country||item.group)}</span></div><div class="company-tags">${item.chains.filter(id=>id>=1&&id<=8).map(id=>`<span>${esc(CHAIN_NAMES[id-1])}</span>`).join('')}${profile.exposure?`<span class="company-exposure">${esc(profile.exposure)}</span>`:''}</div><p class="company-role">${esc(profile.role||'사업 범위 확인 중')}</p><div class="company-price"><strong class="mono">${price}</strong><span class="mono ${changeClass}">${change}</span></div><p class="company-time">${quote?`시세 ${esc(quoteTime(quote.marketTime))}${quote.status&&quote.status!=='ok'?' · 이전 수집값':''}`:'다음 자동 수집에서 시세를 확인합니다.'}</p>${disclosureCard(item)}<div class="company-actions"><a href="#talk/${encodeURIComponent(item.symbol)}">토론</a><button class="company-open" data-market-symbol="${esc(item.symbol)}" data-directory-symbol="${esc(item.symbol)}">시세 · 차트 <span aria-hidden="true">↗</span><span class="sr">: ${esc(item.name)}</span></button>${sourceUrl?`<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(profile.sourceLabel||'기업 공식 자료')} <span aria-hidden="true">↗</span><span class="sr">: ${esc(item.name)}, 새 창</span></a>`:'<span class="company-source-pending">공식 사업 자료 확인 중</span>'}</div></article>`
}
function renderResults(){
  const host=document.getElementById('company-directory');if(!host)return
  const rows=matches(),shown=rows.slice(0,limit)
  const summary=host.querySelector('#company-result-count')
  if(summary)summary.textContent=`${chain?CHAIN_NAMES[chain-1]+' · ':''}${market} ${rows.length}개 기업${search?' · “'+search+'” 검색':''} · ${shown.length}개 표시`
  const filingStatus=host.querySelector('#company-disclosure-status')
  if(filingStatus)filingStatus.textContent=disclosureStatus()
  const refresh=host.querySelector('[data-directory-filings-refresh]')
  if(refresh){refresh.disabled=disclosureBusy;refresh.textContent=disclosureBusy?'공시 자료 읽는 중…':'공시 자료 다시 읽기'}
  const list=host.querySelector('#company-directory-list')
  if(list)list.innerHTML=shown.length?shown.map(card).join(''):'<p class="company-empty">검색 조건에 맞는 기업이 없습니다. 고리·시장 필터를 바꾸거나 다른 기업명으로 검색해 주세요.</p>'
  const more=host.querySelector('[data-directory-more]')
  if(more){more.hidden=shown.length>=rows.length;more.textContent=`기업 ${Math.min(PAGE_SIZE,rows.length-shown.length)}개 더 보기 (${shown.length}/${rows.length})`}
  host.querySelectorAll('[data-directory-chain]').forEach(button=>{
    const active=Number(button.dataset.directoryChain)===chain
    button.classList.toggle('on',active);button.setAttribute('aria-pressed',String(active))
  })
}
function render(){
  const parent=document.getElementById('v-data');if(!parent||parent.hidden)return
  let host=document.getElementById('company-directory')
  if(!host){host=document.createElement('div');host.id='company-directory';parent.prepend(host)}
  parent.prepend(host)
  if(!host.querySelector('#company-directory-search')){
    host.classList.add('panel','sec','company-directory')
    host.innerHTML=`<div class="company-heading"><div><p class="company-kicker">VALUE CHAIN · COMPANY DIRECTORY</p><h2>고리별 기업 찾기 <span>${companies.length}개</span></h2></div><a href="#compare">8개 고리 주가 흐름 비교 →</a></div><p class="company-description">기업의 사업과 고리를 함께 확인하세요. ${companies.length}개 상장기업 · 고리 편입 ${membershipCount}건${membershipCount>companies.length?' · 여러 고리에 속한 기업은 중복 편입':''}. 시세 비교에는 이 목록과 같은 기업 분류를 사용합니다.</p><div class="company-controls"><label for="company-directory-search"><span>기업 검색</span><input id="company-directory-search" type="search" autocomplete="off" placeholder="기업명 · 티커 · 사업 검색" value="${esc(search)}"></label><label for="company-directory-market"><span>상장 시장</span><select id="company-directory-market">${['전체','국내','해외'].map(value=>`<option value="${value}"${market===value?' selected':''}>${value}</option>`).join('')}</select></label></div><div class="company-chains" role="group" aria-label="기업 고리 필터"><button class="f" data-directory-chain="0" aria-pressed="${chain===0}">전체 <span>${companies.length}</span></button>${chains.map(item=>`<button class="f" data-directory-chain="${item.id}" aria-pressed="${chain===item.id}">${esc(item.name)} <span>${companies.filter(company=>company.chains.includes(item.id)).length}</span></button>`).join('')}</div><p id="company-result-count" class="company-count" role="status" aria-live="polite"></p><div id="company-directory-list" class="company-grid"></div><button class="f company-more" data-directory-more>기업 더 보기</button><p class="company-footnote">고리 분류는 공개된 사업 내용을 바탕으로 한 탐색용 목록입니다. 혼합사업 기업의 주가에는 다른 사업도 영향을 줍니다. 기업의 공식 사업 자료와 시세 출처를 함께 확인하세요. 시세: Yahoo Finance · 제공처 지연 가능 · 전일 대비는 현지 통화 기준.</p>`
  }
  if(!host.querySelector('#company-disclosure-status')){
    const toolbar=document.createElement('div');toolbar.className='company-filing-toolbar'
    toolbar.innerHTML='<p id="company-disclosure-status" class="company-count" role="status" aria-live="polite"></p><button class="f" type="button" data-directory-filings-refresh>공시 자료 다시 읽기</button>'
    host.querySelector('#company-result-count').before(toolbar)
  }
  renderResults()
  if(!disclosureBusy&&Date.now()-disclosureReadAt>15*60000)void loadDisclosures()
}

const originalData=window.renderData
if(typeof originalData==='function')window.renderData=function(...args){originalData.apply(this,args);render()}
window.renderCompanyDirectory=render
window.addEventListener('hashchange',render)
window.addEventListener('market-snapshot',event=>{
  snapshot=event.detail;quoteMap=new Map((snapshot?.quotes||[]).map(quote=>[quote.symbol,quote]));render()
})
document.addEventListener('input',event=>{
  if(event.target.id!=='company-directory-search')return
  search=event.target.value;limit=PAGE_SIZE;renderResults()
})
document.addEventListener('change',event=>{
  if(event.target.id!=='company-directory-market')return
  market=event.target.value;limit=PAGE_SIZE;renderResults()
})
document.addEventListener('click',event=>{
  if(event.target.closest('[data-directory-filings-refresh]')){void loadDisclosures();return}
  const button=event.target.closest('[data-directory-chain]')
  if(button){chain=Number(button.dataset.directoryChain);limit=PAGE_SIZE;renderResults();return}
  if(event.target.closest('[data-directory-more]')){limit+=PAGE_SIZE;renderResults();return}
  if(event.target.closest('[data-directory-symbol]'))requestAnimationFrame(()=>document.getElementById('market-selected')?.scrollIntoView({behavior:'smooth',block:'start'}))
})
document.addEventListener('toggle',event=>{
  const details=event.target
  if(!details.matches?.('[data-company-filings]'))return
  if(details.open)expandedFilings.add(details.dataset.companyFilings)
  else expandedFilings.delete(details.dataset.companyFilings)
},true)
render()
