import { realtimeEnabled, staticHost } from './site-runtime.js'
import { instruments } from './instruments.js'
import { legacyChains } from './chain-order.js'
import { normalizeSymbol, validSymbol, readSymbols, filterQuotes, chooseBars, newestQuote } from './market-core.js'
import { companyHrefForTicker, companyHrefForQuery } from './company-links.js'
import { MARKET_DATA_POLICY } from './market-data-policy.js'

const autoRefreshEnabled = realtimeEnabled && MARKET_DATA_POLICY.autoRefreshEnabled
const liveRequestsEnabled = realtimeEnabled && MARKET_DATA_POLICY.liveRequestsEnabled
const collectionEnabled = realtimeEnabled && MARKET_DATA_POLICY.collectionEnabled

const ranges={'1d':'1일','5d':'5일','1mo':'1개월','3mo':'3개월','1y':'1년','5y':'5년'}
const text=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:2}):'—'
const date=v=>v?new Date(v*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—'
const pct=q=>Number.isFinite(q?.changePercent)?`${q.changePercent>0?'+':''}${q.changePercent.toFixed(2)}%`:'—'
const color=q=>q?.change>0?'price-up':q?.change<0?'price-down':''
const source=q=>`<a href="https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}/" target="_blank" rel="noopener noreferrer">Yahoo Finance</a>`
const read=key=>{try{return localStorage.getItem(key)}catch{return null}}
const write=(key,v)=>{try{localStorage.setItem(key,JSON.stringify(v))}catch{}}
let watch=readSymbols(read('ai-chain.watch.v1')||read('watch')),extra=readSymbols(read('ai-chain.symbols.v1'))
let selected=normalizeSymbol(read('ai-chain.selected.v1')?.replaceAll('"','')||'TSM')
if(!validSymbol(selected))selected='TSM'
let snapshot=null,snapshotError='',snapshotBusy=false,snapshotAttempted=false,detailError='',detailBusy=false,formError=''
let range='3mo',group='전체',filter=0,search='',apiAvailable=liveRequestsEnabled&&!staticHost,controller=null
const live=new Map(),customQuotes=new Map()
let snapshotQuotes=new Map()
let companyQuote=null
function quotes(){
  const catalog=[...instruments]
  for(const q of snapshotQuotes.values())if(!catalog.some(item=>item.symbol===q.symbol))catalog.push({symbol:q.symbol,name:q.name,chains:q.chains||[],group:q.group||'해외'})
  for(const symbol of [...extra,...watch])if(!catalog.some(q=>q.symbol===symbol))catalog.push({symbol,name:symbol,chains:[],group:'직접추가'})
  return catalog.map(item=>{
    const saved=snapshotQuotes.get(item.symbol)
    return {...item,...(saved?.priceBasis==='previous-completed-session'?saved:newestQuote(saved,customQuotes.get(item.symbol)))}
  })
}
function current(){
  const listing=companyQuote?.company.listings.find(item=>item.ticker===selected)
  if(!listing){
    const base=quotes().find(q=>q.symbol===selected)
    const value=newestQuote(snapshotQuotes.get(selected),customQuotes.get(selected))
    return base?{...base,...value,priceBasis:value.priceBasis||'live',closeDate:value.closeDate||null}:undefined
  }
  return {name:companyQuote.company.name,symbol:selected,currency:listing.currency,exchange:listing.exchange,
    ...newestQuote(snapshotQuotes.get(selected),customQuotes.get(selected))}
}
function notifyCommunity(){window.aiChainSelectedSymbol=selected;window.dispatchEvent(new CustomEvent('community-detail-change',{detail:{symbol:selected}}))}
const barsFor=q=>chooseBars(snapshotQuotes.get(selected),range,live.get(`${selected}:${range}`))
const closeLabel=q=>q?.priceBasis==='previous-completed-session'&&q.closeDate?`${text(q.closeDate)} 종가 · ${text(q.timezone||'현지 거래소')}`:`${date(q?.marketTime)} KST`
const note=()=>!collectionEnabled?'시세 수집과 자동 새로고침을 중지했습니다. 저장된 종가와 차트만 표시합니다.':snapshot?.mode==='scheduled-close'?'목록은 거래소별 마지막 거래일 종가입니다. 선택한 종목의 별도 API 차트는 장중 시세일 수 있습니다. 브라우저는 60초마다 새 수집 파일을 확인합니다.':apiAvailable?'선택한 종목은 서버에서 60초마다 조회합니다. 목록은 자동 수집된 스냅샷과 조회한 시세를 함께 표시합니다.':'자동 수집·배포한 시세를 표시합니다. 브라우저는 60초마다 최신 배포값을 확인합니다.'
function status(){
  const failed=snapshot?.quotes?.filter(q=>q.status!=='ok').length||0
  const old=snapshot&&Date.now()-Date.parse(snapshot.generatedAt)>(snapshot.mode==='scheduled-close'?96*3600000:90*60000)
  return `${!collectionEnabled?text(MARKET_DATA_POLICY.statusLabel)+' · ':''}${snapshotBusy?'저장된 시세 파일 확인 중… · ':''}${snapshot?`수집 시각: ${text(new Date(snapshot.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} KST · ${snapshot.quotes.length-failed}/${snapshot.quotes.length}개 성공`:'저장된 시세를 불러오는 중입니다.'}${old?' · <span class="market-error">수집 지연</span>':''}${snapshotError?`<br><span class="market-error">${text(snapshotError)}</span>`:''}`
}
const star=q=>`<button class="market-star${watch.includes(q.symbol)?' on':''}" data-market-watch="${text(q.symbol)}" aria-label="${text(q.name)} 관심종목" aria-pressed="${watch.includes(q.symbol)}">★</button>`
const mini=q=>`<span class="market-quote">${star(q)}<button data-market-symbol="${text(q.symbol)}">${text(q.name)}</button><b class="mono ${color(q)}">${fmt(q.price)} ${text(q.currency)}</b><span class="${color(q)}">${pct(q)}</span></span>`
function preview(){
  const el=document.getElementById('market-preview')
  if(el)el.innerHTML=`<div class="market-top"><h2>실제 시장 시세</h2><a href="#data">종목 · 차트 · 관심종목 →</a></div><p class="market-status">${status()}</p><div class="market-strip">${quotes().filter(q=>['^KS11','^IXIC','KRW=X','NVDA'].includes(q.symbol)).map(mini).join('')}</div><p class="note">${note()} 제공처 지연 가능 · 주가는 예시 신호 판정과 별도로 표시합니다.</p>`
}
function chainQuotes(){
  document.querySelector('#detail .chain-market')?.remove()
  const el=document.getElementById('detail');if(!el)return
  const list=quotes().filter(q=>q.chains?.includes(window.sel))
  const div=document.createElement('div');div.className='chain-market'
  div.innerHTML=`<b>대표 종목 실제 시세</b><div class="market-strip" style="margin-top:10px">${list.map(mini).join('')}</div><p class="market-note">${list.map(q=>`${text(q.name)}: ${closeLabel(q)} · ${source(q)}`).join('<br>')}</p>`
  el.querySelector('.chips')?.after(div)
}
function syncWatch(){
  const button=document.querySelector('.mine-btn');if(button)button.textContent=`관심종목 ${watch.length}`
  window.S.forEach(s=>s.mine=quotes().some(q=>watch.includes(q.symbol)&&q.chains?.includes(s.id)))
  window.renderMap()
}
function chart(q,bars){
  if(!bars.length)return `<p class="market-empty">${liveRequestsEnabled?'해당 기간의 시세 데이터가 없습니다.':'해당 기간의 저장된 차트가 없습니다. 시세 수집 중지로 추가 조회하지 않습니다.'}</p>`
  const w=800,h=250,l=85,r=20,t=20,b=42,values=bars.map(v=>v.close),lo=Math.min(...values),hi=Math.max(...values)
  const x=i=>l+i/Math.max(1,bars.length-1)*(w-l-r),y=v=>t+(hi-v)/(hi-lo||1)*(h-t-b)
  const path=bars.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v.close).toFixed(1)}`).join(' ')
  const label=v=>new Date(v*1000).toLocaleString('ko-KR',{timeZone:q.timezone||'UTC',year:'2-digit',month:'numeric',day:'numeric',...(['1d','5d'].includes(range)?{hour:'2-digit',minute:'2-digit'}:{})})
  return `<svg class="market-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${text(q.name)} ${ranges[range]} 실제 가격 차트">${[0,.5,1].map(n=>{const v=lo+(hi-lo)*n;return `<line x1="${l}" x2="${w-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l-8}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`}).join('')}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>${bars.length===1?`<circle cx="${x(0)}" cy="${y(bars[0].close)}" r="3" fill="var(--accent)"/>`:''}<text x="${l}" y="${h-10}">${label(bars[0].time)}</text><text x="${w-r}" y="${h-10}" text-anchor="end">${label(bars.at(-1).time)}</text></svg><p class="market-note">${text(q.currency)} · ${text(q.timezone||'UTC')} 기준 · ${bars.length}개 관측값 · ${live.has(`${selected}:${range}`)?'API 조회':'자동 수집 스냅샷'}</p>`
}
function detail(){
  const q=current();if(!q)return ''
  const bars=barsFor(q),storedCloseOnly=snapshot?.displayOnly===true
  return `<section class="market-detail" aria-label="선택 종목 상세"><div class="market-top"><h3>${text(q.name)} · ${text(q.symbol)}</h3><b class="mono ${color(q)}">${fmt(q.price)} ${text(q.currency)} (${pct(q)})</b>${star(q)}</div><div class="market-ranges">${Object.entries(ranges).map(([r,label])=>`<button class="f${range===r?' on':''}" data-market-range="${r}" aria-pressed="${range===r}">${label}</button>`).join('')}<button class="f" data-market-csv ${bars.length?'':'disabled'}>CSV 저장</button></div>${detailBusy?'<p class="market-status" role="status">실제 시세 조회 중…</p>':''}${detailError?`<p class="market-error" role="alert">${text(detailError)}</p>`:''}${!live.has(`${selected}:${range}`)&&snapshotQuotes.get(selected)?.historyErrors?.[range]?`<p class="market-error" role="alert">이 기간 수집 실패: ${text(snapshotQuotes.get(selected).historyErrors[range])}. 남아 있는 이전 차트는 최신 수집값이 아닐 수 있습니다.</p>`:''}${chart(q,bars)}<dl class="market-facts">${[['전일 종가',q.previousClose],['당일 고가',q.high],['당일 저가',q.low],['거래량',q.volume],['52주 고가',q.yearHigh],['52주 저가',q.yearLow]].map(([key,value])=>`<div><dt>${key}</dt><dd>${fmt(value)}</dd></div>`).join('')}</dl><p class="market-note">시세 기준: ${closeLabel(q)} · 개별 조회: ${text(q.fetchedAt?new Date(q.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—')} KST<br>${source(q)} · ${text(q.exchange)} · 빈 값은 미제공입니다.${q.status&&q.status!=='ok'?' · 조회 실패로 이전 값을 표시합니다.':''}</p><h4>${storedCloseOnly?'최근 저장 종가':'최근 OHLCV'}</h4><div class="market-scroll"><table class="tbl market-table"><thead><tr>${(storedCloseOnly?['일시(KST)','종가']:['일시(KST)','시가','고가','저가','종가','거래량']).map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${bars.slice(-10).reverse().map(b=>`<tr><td>${date(b.time)}</td>${(storedCloseOnly?['close']:['open','high','low','close','volume']).map(k=>`<td class="mono">${fmt(b[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`
}
function result(){
  const rows=filterQuotes(quotes(),{group,chain:filter,search,watch})
  return `<p class="market-status" role="status">${status()}</p><p class="market-note">관심종목은 이 브라우저에 저장됩니다. ★를 눌러 추가·해제하세요.</p><div class="market-scroll"><table class="tbl market-table"><thead><tr><th>관심</th><th>종목</th><th>가격</th><th>전일 대비</th><th>시세 기준·출처</th></tr></thead><tbody>${rows.map(q=>`<tr><td>${star(q)}</td><td><button class="market-pick" data-market-symbol="${text(q.symbol)}"><b>${text(q.name)}</b><small>${text(q.symbol)} · ${text(q.group)}</small></button></td><td class="mono">${fmt(q.price)} ${text(q.currency)}</td><td class="mono ${color(q)}">${pct(q)}</td><td class="market-time">${closeLabel(q)}<br>${source(q)}${q.status&&q.status!=='ok'?`<br><span class="market-error">${text(q.error||'조회 실패')} · 이전값</span>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="market-empty">검색 결과가 없습니다. 관심종목이 없다면 ★로 추가하세요.</td></tr>'}</tbody></table></div><div id="market-selected">${detail()}</div>`
}
function renderCompanyQuote(){
  const target=companyQuote?.target
  if(!target?.isConnected)return
  target.innerHTML=detail()
  if(snapshotError){
    const message=document.createElement('p')
    message.className='market-error';message.setAttribute('role','status');message.textContent=snapshotError
    target.append(message)
  }
}
function renderSelected(){const el=document.getElementById('market-selected');if(el)el.innerHTML=detail();renderCompanyQuote();notifyCommunity()}
function mount(){
  const parent=document.getElementById('v-data');if(!parent||parent.hidden)return
  document.getElementById('market-data')?.remove()
  const el=document.createElement('section');el.id='market-data';el.className='panel sec market-section'
  el.innerHTML=`<div class="market-top"><h2>종목 · 시세 · 관심종목</h2><button class="f" data-market-refresh>${autoRefreshEnabled?'다시 조회':'저장값 확인'}</button></div><p class="note">${note()}</p><form id="market-add-form" class="market-controls"><input id="market-add" aria-label="추가할 티커" placeholder="저장 종목 찾기: NVDA / 005930.KS" maxlength="24"><button class="f" type="submit">종목 찾기</button></form><p id="market-form-status" class="market-error" role="status">${text(formError)}</p><div class="market-controls"><input id="market-search" aria-label="실제 시세 종목 검색" placeholder="종목명 또는 티커 검색" value="${text(search)}"><select id="market-group" aria-label="시장 선택">${['전체','국내','해외','시장','관심','직접추가'].map(g=>`<option${g===group?' selected':''}>${g}</option>`).join('')}</select><select id="market-filter" aria-label="시세 고리 선택"><option value="0">모든 고리</option>${legacyChains.map(s=>`<option value="${s.id}"${filter===s.id?' selected':''}>${text(s.name)}</option>`).join('')}</select></div><div id="market-results">${result()}</div><div id="market-community"></div>`
  parent.prepend(el)
  notifyCommunity()
}
function update(){preview();chainQuotes();const el=document.getElementById('market-results');if(el)el.innerHTML=result();renderCompanyQuote();notifyCommunity()}
async function loadSnapshot(){
  if(snapshotBusy)return
  if(!autoRefreshEnabled&&snapshotAttempted){update();return}
  snapshotAttempted=true;snapshotBusy=true;update()
  try{
    const readSnapshot=async path=>{
      const r=await fetch(path,{cache:autoRefreshEnabled?'no-cache':'force-cache',signal:AbortSignal.timeout(20000)})
      if(!r.ok)throw new Error(`시세 파일 HTTP ${r.status}`)
      const body=await r.json()
      if(body.schemaVersion!==1||!Array.isArray(body.quotes))throw new Error('시세 파일 형식 오류')
      return body
    }
    let body,fallback=false
    if(!liveRequestsEnabled){body=await readSnapshot(MARKET_DATA_POLICY.snapshotUrl)}
    else if(apiAvailable){
      try{body=await readSnapshot('./api/snapshot')}
      catch{body=await readSnapshot('./data/market.json');fallback=true}
    }else body=await readSnapshot('./data/market.json')
    snapshotError=fallback?'시세 서버를 확인할 수 없어 저장된 스냅샷을 표시합니다.':''
    if(!snapshot||Date.parse(body.generatedAt)>=Date.parse(snapshot.generatedAt)){
      snapshot=body;snapshotQuotes=new Map(body.quotes.map(q=>[q.symbol,q]));window.aiChainSnapshot=body;window.dispatchEvent(new CustomEvent('market-snapshot',{detail:body}))
    }
  }catch(error){snapshotError=`시세 파일 조회 실패: ${error.message}. 기존 값이 있으면 유지합니다.`;window.dispatchEvent(new CustomEvent('market-snapshot-error',{detail:snapshotError}))}
  finally{snapshotBusy=false;syncWatch();update()}
}
async function request(symbol,r,signal){
  if(!liveRequestsEnabled)throw new Error('시세 수집을 중지하여 새 종목이나 차트를 추가 조회하지 않습니다.')
  const response=await fetch(`./api/chart?symbol=${encodeURIComponent(symbol)}&range=${r}`,{signal})
  if(response.status===404&&!response.headers.get('content-type')?.includes('application/json')){apiAvailable=false;throw new Error('현재 사이트는 자동 수집된 종목을 조회할 수 있습니다.')}
  const body=await response.json();if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`)
  return {...body,changePercent:body.changePercent??(body.previousClose?body.change/body.previousClose*100:null),status:'ok'}
}
function rememberQuote(symbol,q){const {bars,histories,events,...meta}=q;const item=instruments.find(i=>i.symbol===symbol);customQuotes.set(symbol,{...item,...meta,name:item?.name||q.name||symbol,symbol,chains:item?.chains||[],group:item?.group||'직접추가'})}
async function loadDetail(force=false){
  if(!liveRequestsEnabled){controller?.abort();detailBusy=false;detailError='';renderSelected();return}
  if(!apiAvailable){detailError='';renderSelected();return}
  detailError=''
  controller?.abort();controller=new AbortController()
  const signal=controller.signal,symbol=selected,r=range,key=`${symbol}:${r}`
  if(!force&&live.get(key)&&Date.now()-Date.parse(live.get(key).fetchedAt)<60000){detailBusy=false;renderSelected();return}
  detailBusy=true;detailError='';renderSelected()
  try{const q=await request(symbol,r,signal);if(signal.aborted)return;live.set(key,q);rememberQuote(symbol,q)}
  catch(error){if(!signal.aborted)detailError=`${error.message} 마지막 성공 조회값 또는 수집된 스냅샷이 있으면 표시합니다.`}
  finally{if(!signal.aborted){detailBusy=false;update()}}
}
function choose(symbol){selected=symbol;write('ai-chain.selected.v1',symbol);if(location.hash!=='#data')location.hash='data';else update();loadDetail()}
async function add(event){
  event.preventDefault()
  const input=document.getElementById('market-add').value
  const href=location.hash==='#data/quotes'&&companyHrefForQuery(input)
  if(href&&href.includes('/quote')){location.hash=href;return}
  return openSymbol(input)
}
async function openSymbol(rawSymbol){
  const symbol=normalizeSymbol(rawSymbol)
  const message=value=>{formError=value;const el=document.getElementById('market-form-status');if(el)el.textContent=value}
  if(!validSymbol(symbol)){message('올바른 티커를 입력하세요. 코스닥 종목은 .KQ를 붙이세요.');return}
  if(!liveRequestsEnabled&&!snapshotQuotes.has(symbol)){message('시세 수집을 중지했습니다. 저장된 자료가 있는 종목만 볼 수 있습니다.');return}
  if(quotes().some(q=>q.symbol===symbol)){search='';filter=0;group='전체';choose(symbol);mount();return}
  if(!apiAvailable){message('저장된 자료가 없는 종목은 추가 조회할 수 없습니다.');return}
  message('실제 종목을 확인하고 있습니다…')
  try{const q=await request(symbol,'1mo',AbortSignal.timeout(30000));rememberQuote(symbol,q);live.set(`${symbol}:1mo`,q);extra=[...new Set([...extra,symbol])].slice(-100);write('ai-chain.symbols.v1',extra);range='1mo';search='';filter=0;group='전체';message('');choose(symbol);mount()}
  catch(error){message(`종목 조회 실패: ${error.message}`)}
}
function csv(){
  const q=current(),bars=barsFor(q);if(!q||!bars.length)return
  const rows=snapshot?.displayOnly?[['time_utc','close'],...bars.map(b=>[new Date(b.time*1000).toISOString(),b.close])]:[['time_utc','open','high','low','close','volume'],...bars.map(b=>[new Date(b.time*1000).toISOString(),b.open,b.high,b.low,b.close,b.volume])]
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.join(',')).join('\n')],{type:'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=`${selected}-${range}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
const oldDetail=window.renderDetail;window.renderDetail=function(){oldDetail();chainQuotes()}
const oldData=window.renderData;window.renderData=function(){oldData();mount()}
document.addEventListener('click',event=>{
  const target=event.target,w=target.closest('[data-market-watch]')
  if(w){const symbol=w.dataset.marketWatch;watch=watch.includes(symbol)?watch.filter(s=>s!==symbol):[...watch,symbol];write('ai-chain.watch.v1',watch);syncWatch();update();return}
  const s=target.closest('[data-market-symbol]')
  if(s){
    const symbol=s.dataset.marketSymbol
    const href=group==='관심'&&location.hash==='#data/watchlist'&&companyHrefForTicker(symbol,'quote')
    if(href)location.hash=href
    else choose(symbol)
    return
  }
  const r=target.closest('[data-market-range]');if(r){range=r.dataset.marketRange;renderSelected();loadDetail();return}
  if(target.closest('[data-market-refresh]')){loadSnapshot();loadDetail(true)}
  if(target.closest('[data-market-csv]'))csv()
  if(target.closest('.mine-btn')){if(location.hash!=='#data/watchlist')location.hash='data/watchlist';else openDataTool()}
})
document.addEventListener('submit',event=>{if(event.target.id==='market-add-form')add(event)})
document.addEventListener('input',event=>{if(event.target.id==='market-search'){search=event.target.value;const el=document.getElementById('market-results');if(el)el.innerHTML=result()}})
document.addEventListener('change',event=>{if(event.target.id==='market-group'){group=event.target.value;update()}if(event.target.id==='market-filter'){filter=Number(event.target.value);update()}})
function openDataTool(){
  const route=location.hash
  if(route!=='#data/quotes'&&route!=='#data/watchlist')return
  group=route==='#data/watchlist'?'관심':'전체'
  filter=0;search='';mount()
  requestAnimationFrame(()=>{
    if(location.hash!==route)return
    const element=document.getElementById(group==='관심'?'market-group':'market-add')
    element?.focus({preventScroll:true})
    element?.scrollIntoView({block:'center'})
  })
}
window.addEventListener('hashchange',openDataTool)
document.getElementById('q')?.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.isComposing)return
  const query=event.target.value.trim()
  if(!query)return
  const symbol=normalizeSymbol(query)
  const href=companyHrefForQuery(query)
  if(href){location.hash=href;return}
  if(validSymbol(symbol)&&(quotes().some(q=>q.symbol===symbol)||!filterQuotes(quotes(),{search:query}).length)){
    window.dispatchEvent(new CustomEvent('market-symbol-open',{detail:{symbol}}));return
  }
  search=query;group='전체';filter=0
  if(location.hash!=='#data')location.hash='data';else mount()
})
// The home map shares this existing lookup, chart, watchlist and CSV flow.
window.addEventListener('market-symbol-open',event=>{
  const raw=event.detail?.symbol
  if(typeof raw!=='string'||!validSymbol(normalizeSymbol(raw)))return
  search='';filter=0;group='전체'
  if(location.hash!=='#data')location.hash='data'
  requestAnimationFrame(async()=>{
    mount()
    await openSymbol(raw)
    requestAnimationFrame(()=>document.getElementById('market-selected')?.scrollIntoView({behavior:'smooth',block:'start'}))
  })
})
window.addEventListener('market-refresh-request',()=>loadSnapshot());
mount();openDataTool();syncWatch();loadSnapshot().then(()=>loadDetail())
if(autoRefreshEnabled)setInterval(()=>{if(!document.hidden){loadSnapshot();loadDetail(true)}},60000)

// Both chapters share the chart cache, period/CSV controls and browser watchlist.
export function mountCompanyQuote(container,company){
  const listings=company.listings.filter(item=>validSymbol(item.ticker))
  if(!listings.length){container.textContent='연결된 시세 종목이 없습니다.';return ()=>{}}
  const previousSymbol=selected
  const previousRange=range
  const requested=new URLSearchParams(location.hash.split('?')[1]).get('listing')
  const listing=listings.find(item=>item.ticker===requested)??listings[0]
  selected=listing.ticker
  container.innerHTML='<div class="market-controls"><label>거래 종목 <select aria-label="거래 종목"></select></label></div><div data-company-price></div>'
  const select=container.querySelector('select')
  for(const row of listings){
    const option=document.createElement('option')
    option.value=row.ticker
    option.textContent=[row.ticker,row.exchange,row.currency].filter(Boolean).join(' · ')
    option.selected=row.ticker===selected
    select.append(option)
  }
  const mount={company,target:container.querySelector('[data-company-price]')}
  companyQuote=mount
  const refresh=()=>{
    selected=select.value
    if(listings.length>1)history.replaceState(history.state,'',companyHrefForTicker(selected,'quote'))
    renderCompanyQuote()
    void loadDetail()
  }
  select.addEventListener('change',refresh)
  refresh()
  return ()=>{
    select.removeEventListener('change',refresh)
    if(companyQuote!==mount)return
    companyQuote=null
    // A legacy action may already have selected another symbol during navigation.
    if(listings.some(item=>item.ticker===selected)){
      controller?.abort();detailBusy=false;detailError='';selected=previousSymbol;range=previousRange
      if(!document.getElementById('v-data')?.hidden){renderSelected();void loadDetail()}
    }
  }
}
