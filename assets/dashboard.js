import { instruments } from './instruments.js'
import { normalizeSymbol, validSymbol, readSymbols, filterQuotes, snapshotBars, chooseBars, newestQuote } from './market-core.js'

const ranges={'1d':'1일','5d':'5일','1mo':'1개월','3mo':'3개월','1y':'1년','5y':'5년'}
const staticHost=location.hostname.endsWith('.github.io') || location.protocol==='file:'
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
let snapshot=null,snapshotError='',snapshotBusy=false,detailError='',detailBusy=false,formError=''
let range='3mo',group='전체',filter=0,search='',apiAvailable=!staticHost,controller=null
const live=new Map(),customQuotes=new Map()
let snapshotQuotes=new Map()
function quotes(){
  const catalog=[...instruments]
  for(const symbol of [...extra,...watch])if(!catalog.some(q=>q.symbol===symbol))catalog.push({symbol,name:symbol,chains:[],group:'직접추가'})
  return catalog.map(item=>({...item,...newestQuote(snapshotQuotes.get(item.symbol),customQuotes.get(item.symbol))}))
}
const current=()=>quotes().find(q=>q.symbol===selected)
function notifyCommunity(){window.aiChainSelectedSymbol=selected;window.dispatchEvent(new CustomEvent('community-detail-change',{detail:{symbol:selected}}))}
const barsFor=q=>chooseBars(snapshotQuotes.get(selected),range,live.get(`${selected}:${range}`))
const note=()=>apiAvailable?'선택한 종목은 서버에서 60초마다 조회합니다. 목록은 자동 수집된 스냅샷과 조회한 시세를 함께 표시합니다.':'약 30분마다 자동 수집·배포한 시세를 표시합니다. 브라우저는 60초마다 최신 배포값을 확인합니다.'
function status(){
  const failed=snapshot?.quotes?.filter(q=>q.status!=='ok').length||0
  const old=snapshot&&Date.now()-Date.parse(snapshot.generatedAt)>90*60000
  return `${snapshotBusy?'시세 파일 조회 중… · ':''}${snapshot?`수집 시각: ${text(new Date(snapshot.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} KST · ${snapshot.quotes.length-failed}/${snapshot.quotes.length}개 성공`:'시세를 불러오는 중입니다.'}${old?' · <span class="market-error">수집 지연</span>':''}${snapshotError?`<br><span class="market-error">${text(snapshotError)}</span>`:''}`
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
  div.innerHTML=`<b>대표 종목 실제 시세</b><div class="market-strip" style="margin-top:10px">${list.map(mini).join('')}</div><p class="market-note">${list.map(q=>`${text(q.name)}: ${date(q.marketTime)} KST · ${source(q)}`).join('<br>')}</p>`
  el.querySelector('.chips')?.after(div)
}
function syncWatch(){
  const button=document.querySelector('.mine-btn');if(button)button.textContent=`관심종목 ${watch.length}`
  window.S.forEach(s=>s.mine=quotes().some(q=>watch.includes(q.symbol)&&q.chains?.includes(s.id)))
  window.renderMap()
}
function chart(q,bars){
  if(!bars.length)return '<p class="market-empty">해당 기간의 시세 데이터가 없습니다. 다시 조회해 주세요.</p>'
  const w=800,h=250,l=85,r=20,t=20,b=42,values=bars.map(v=>v.close),lo=Math.min(...values),hi=Math.max(...values)
  const x=i=>l+i/Math.max(1,bars.length-1)*(w-l-r),y=v=>t+(hi-v)/(hi-lo||1)*(h-t-b)
  const path=bars.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v.close).toFixed(1)}`).join(' ')
  const label=v=>new Date(v*1000).toLocaleString('ko-KR',{timeZone:q.timezone||'UTC',year:'2-digit',month:'numeric',day:'numeric',...(['1d','5d'].includes(range)?{hour:'2-digit',minute:'2-digit'}:{})})
  return `<svg class="market-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${text(q.name)} ${ranges[range]} 실제 가격 차트">${[0,.5,1].map(n=>{const v=lo+(hi-lo)*n;return `<line x1="${l}" x2="${w-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l-8}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`}).join('')}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>${bars.length===1?`<circle cx="${x(0)}" cy="${y(bars[0].close)}" r="3" fill="var(--accent)"/>`:''}<text x="${l}" y="${h-10}">${label(bars[0].time)}</text><text x="${w-r}" y="${h-10}" text-anchor="end">${label(bars.at(-1).time)}</text></svg><p class="market-note">${text(q.currency)} · ${text(q.timezone||'UTC')} 기준 · ${bars.length}개 관측값 · ${live.has(`${selected}:${range}`)?'API 조회':'자동 수집 스냅샷'}</p>`
}
function detail(){
  const q=current();if(!q)return ''
  const bars=barsFor(q)
  return `<section class="market-detail" aria-label="선택 종목 상세"><div class="market-top"><h3>${text(q.name)} · ${text(q.symbol)}</h3><b class="mono ${color(q)}">${fmt(q.price)} ${text(q.currency)} (${pct(q)})</b>${star(q)}</div><div class="market-ranges">${Object.entries(ranges).map(([r,label])=>`<button class="f${range===r?' on':''}" data-market-range="${r}" aria-pressed="${range===r}">${label}</button>`).join('')}<button class="f" data-market-csv ${bars.length?'':'disabled'}>CSV 저장</button></div>${detailBusy?'<p class="market-status" role="status">실제 시세 조회 중…</p>':''}${detailError?`<p class="market-error" role="alert">${text(detailError)}</p>`:''}${!live.has(`${selected}:${range}`)&&snapshotQuotes.get(selected)?.historyErrors?.[range]?`<p class="market-error" role="alert">이 기간 수집 실패: ${text(snapshotQuotes.get(selected).historyErrors[range])}. 남아 있는 이전 차트는 최신 수집값이 아닐 수 있습니다.</p>`:''}${chart(q,bars)}<dl class="market-facts">${[['전일 종가',q.previousClose],['당일 고가',q.high],['당일 저가',q.low],['거래량',q.volume],['52주 고가',q.yearHigh],['52주 저가',q.yearLow]].map(([key,value])=>`<div><dt>${key}</dt><dd>${fmt(value)}</dd></div>`).join('')}</dl><p class="market-note">시세 기준: ${date(q.marketTime)} KST · 개별 조회: ${text(q.fetchedAt?new Date(q.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—')} KST<br>${source(q)} · ${text(q.exchange)} · 빈 값은 미제공입니다.${q.status&&q.status!=='ok'?' · 조회 실패로 이전 값을 표시합니다.':''}</p><h4>최근 OHLCV</h4><div class="market-scroll"><table class="tbl market-table"><thead><tr>${['일시(KST)','시가','고가','저가','종가','거래량'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${bars.slice(-10).reverse().map(b=>`<tr><td>${date(b.time)}</td>${['open','high','low','close','volume'].map(k=>`<td class="mono">${fmt(b[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`
}
function result(){
  const rows=filterQuotes(quotes(),{group,chain:filter,search,watch})
  return `<p class="market-status" role="status">${status()}</p><p class="market-note">관심종목은 이 브라우저에 저장됩니다. ★를 눌러 추가·해제하세요.</p><div class="market-scroll"><table class="tbl market-table"><thead><tr><th>관심</th><th>종목</th><th>가격</th><th>전일 대비</th><th>시세 기준·출처</th></tr></thead><tbody>${rows.map(q=>`<tr><td>${star(q)}</td><td><button class="market-pick" data-market-symbol="${text(q.symbol)}"><b>${text(q.name)}</b><small>${text(q.symbol)} · ${text(q.group)}</small></button></td><td class="mono">${fmt(q.price)} ${text(q.currency)}</td><td class="mono ${color(q)}">${pct(q)}</td><td class="market-time">${date(q.marketTime)} KST<br>${source(q)}${q.status&&q.status!=='ok'?`<br><span class="market-error">${text(q.error||'조회 실패')} · 이전값</span>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="market-empty">검색 결과가 없습니다. 관심종목이 없다면 ★로 추가하세요.</td></tr>'}</tbody></table></div><div id="market-selected">${detail()}</div>`
}
function renderSelected(){const el=document.getElementById('market-selected');if(el)el.innerHTML=detail();notifyCommunity()}
function mount(){
  const parent=document.getElementById('v-data');if(!parent||parent.hidden)return
  document.getElementById('market-data')?.remove()
  const el=document.createElement('section');el.id='market-data';el.className='panel sec market-section'
  el.innerHTML=`<div class="market-top"><h2>종목 · 시세 · 관심종목</h2><button class="f" data-market-refresh>다시 조회</button></div><p class="note">${note()} Yahoo Finance 공개 조회 경로로 지연·호출 제한이 있을 수 있습니다.</p><form id="market-add-form" class="market-controls"><input id="market-add" aria-label="추가할 티커" placeholder="직접 티커 조회: AAPL / 005930.KS / 247540.KQ" maxlength="24"><button class="f" type="submit">종목 조회</button></form><p id="market-form-status" class="market-error" role="status">${text(formError)}</p><div class="market-controls"><input id="market-search" aria-label="실제 시세 종목 검색" placeholder="종목명 또는 티커 검색" value="${text(search)}"><select id="market-group" aria-label="시장 선택">${['전체','국내','해외','시장','관심','직접추가'].map(g=>`<option${g===group?' selected':''}>${g}</option>`).join('')}</select><select id="market-filter" aria-label="시세 고리 선택"><option value="0">모든 고리</option>${window.S.map(s=>`<option value="${s.id}"${filter===s.id?' selected':''}>${text(s.name)}</option>`).join('')}</select></div><div id="market-results">${result()}</div><div id="market-community"></div>`
  parent.prepend(el)
  notifyCommunity()
}
function update(){preview();chainQuotes();const el=document.getElementById('market-results');if(el)el.innerHTML=result();notifyCommunity()}
async function loadSnapshot(){
  if(snapshotBusy)return
  snapshotBusy=true;update()
  try{
    const r=await fetch(`${apiAvailable?'./api/snapshot':'./data/market.json'}?t=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(20000)})
    if(!r.ok)throw new Error(`시세 파일 HTTP ${r.status}`)
    const body=await r.json();if(body.schemaVersion!==1||!Array.isArray(body.quotes))throw new Error('시세 파일 형식 오류')
    snapshot=body;snapshotQuotes=new Map(body.quotes.map(q=>[q.symbol,q]));snapshotError='';window.aiChainSnapshot=body;window.dispatchEvent(new CustomEvent('market-snapshot',{detail:body}))
  }catch(error){snapshotError=`시세 파일 조회 실패: ${error.message}. 기존 값이 있으면 유지합니다.`;window.dispatchEvent(new CustomEvent('market-snapshot-error',{detail:snapshotError}))}
  finally{snapshotBusy=false;syncWatch();update()}
}
async function request(symbol,r,signal){
  const response=await fetch(`./api/chart?symbol=${encodeURIComponent(symbol)}&range=${r}`,{signal})
  if(response.status===404&&!response.headers.get('content-type')?.includes('application/json')){apiAvailable=false;throw new Error('현재 사이트는 자동 수집된 종목을 조회할 수 있습니다.')}
  const body=await response.json();if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`)
  return {...body,changePercent:body.changePercent??(body.previousClose?body.change/body.previousClose*100:null),status:'ok'}
}
function rememberQuote(symbol,q){const {bars,histories,events,...meta}=q;const item=instruments.find(i=>i.symbol===symbol);customQuotes.set(symbol,{...item,...meta,name:item?.name||q.name||symbol,symbol,chains:item?.chains||[],group:item?.group||'직접추가'})}
async function loadDetail(force=false){
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
  const input=document.getElementById('market-add'),symbol=normalizeSymbol(input.value)
  const message=value=>{formError=value;const el=document.getElementById('market-form-status');if(el)el.textContent=value}
  if(!validSymbol(symbol)){message('올바른 티커를 입력하세요. 코스닥 종목은 .KQ를 붙이세요.');return}
  if(quotes().some(q=>q.symbol===symbol)){search='';filter=0;group='전체';choose(symbol);mount();return}
  if(!apiAvailable){message(`이 정적 배포에서는 자동 수집한 ${instruments.length}개 종목을 조회할 수 있습니다. 임의 티커는 통합 프로젝트의 npm run dev 또는 Vercel API에서 조회할 수 있습니다.`);return}
  message('실제 종목을 확인하고 있습니다…')
  try{const q=await request(symbol,'1mo',AbortSignal.timeout(30000));rememberQuote(symbol,q);live.set(`${symbol}:1mo`,q);extra=[...new Set([...extra,symbol])].slice(-100);write('ai-chain.symbols.v1',extra);range='1mo';search='';filter=0;group='전체';message('');choose(symbol);mount()}
  catch(error){message(`종목 조회 실패: ${error.message}`)}
}
function csv(){
  const q=current(),bars=barsFor(q);if(!q||!bars.length)return
  const rows=[['time_utc','open','high','low','close','volume'],...bars.map(b=>[new Date(b.time*1000).toISOString(),b.open,b.high,b.low,b.close,b.volume])]
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.join(',')).join('\n')],{type:'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download=`${selected}-${range}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
const oldDetail=window.renderDetail;window.renderDetail=function(){oldDetail();chainQuotes()}
const oldData=window.renderData;window.renderData=function(){oldData();mount()}
document.addEventListener('click',event=>{
  const target=event.target,w=target.closest('[data-market-watch]')
  if(w){const symbol=w.dataset.marketWatch;watch=watch.includes(symbol)?watch.filter(s=>s!==symbol):[...watch,symbol];write('ai-chain.watch.v1',watch);syncWatch();update();return}
  const s=target.closest('[data-market-symbol]');if(s){choose(s.dataset.marketSymbol);return}
  const r=target.closest('[data-market-range]');if(r){range=r.dataset.marketRange;renderSelected();loadDetail();return}
  if(target.closest('[data-market-refresh]')){loadSnapshot();loadDetail(true)}
  if(target.closest('[data-market-csv]'))csv()
  if(target.closest('.mine-btn')){group='관심';filter=0;search='';if(location.hash!=='#data')location.hash='data';else mount()}
})
document.addEventListener('submit',event=>{if(event.target.id==='market-add-form')add(event)})
document.addEventListener('input',event=>{if(event.target.id==='market-search'){search=event.target.value;const el=document.getElementById('market-results');if(el)el.innerHTML=result()}})
document.addEventListener('change',event=>{if(event.target.id==='market-group'){group=event.target.value;update()}if(event.target.id==='market-filter'){filter=Number(event.target.value);update()}})
document.getElementById('q')?.addEventListener('keydown',event=>{if(event.key==='Enter'){search=event.target.value;group='전체';filter=0;if(location.hash!=='#data')location.hash='data';else mount()}})
window.addEventListener('market-refresh-request',()=>loadSnapshot());
mount();syncWatch();loadSnapshot().then(()=>loadDetail())
setInterval(()=>{if(!document.hidden){loadSnapshot();loadDetail(true)}},60000)
