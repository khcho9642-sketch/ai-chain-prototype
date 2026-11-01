import { instruments } from './instruments.js'
import { buildComparison, buildCompanyComparison } from './peer-comparison-core.js'
import { validateComparisonHistorySnapshot } from './comparison-history-core.js'

const COLORS=['#6ac9ff','#ffce62','#bbabff','#6ce0ce','#ff9e6d','#ff99c8','#b5d97e','#e3e9f2']
const DASHES=['','','','','9 4','9 4','3 4','12 4 3 4']
const CHAIN_NAMES=['소부장','파운드리·패키징','메모리','AI 칩','전력','인프라','모델','애플리케이션']
const PERIODS=[[30,'1개월'],[90,'3개월'],[180,'6개월'],[365,'1년'],[730,'2년'],[1095,'3년']]
const chains=CHAIN_NAMES.map((name,index)=>({id:index+1,name}))
const catalog=[...new Map(instruments.filter(item=>item.chains?.some(id=>Number(id)>0)).map(item=>[item.symbol,item])).values()]
const catalogMap=new Map(catalog.map(item=>[item.symbol,item]))
const symbolOrder=new Map(catalog.map((item,index)=>[item.symbol,index]))
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const number=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{maximumFractionDigits:2}):'—'
const percent=value=>Number.isFinite(value)?(value>0?'+':'')+value.toFixed(2)+'%':'—'
const date=value=>value?String(value).replaceAll('-','. '):'—'
let snapshot=window.aiChainSnapshot||null,loadError='',days=90,mode='companies'
let visible=new Set(chains.map(c=>c.id)),selected=new Set(['005930.KS','000660.KS'].filter(symbol=>catalogMap.has(symbol))),hiddenCompanies=new Set()
let sectorModel=null,companyModel=null,model=null,cursor=-1
let sectorFeed=null,sectorDays=null
let longSnapshot=null,longError='',longLoading=false,longRequest=null,longAttempted=false
const isCompany=()=>mode==='companies'
const activeFeed=()=>days>365?longSnapshot:snapshot
const items=()=>isCompany()?model.companies:model.groups
const isVisible=item=>isCompany()?!hiddenCompanies.has(item.symbol):visible.has(item.id)
const color=id=>typeof id==='number'?COLORS[id-1]:COLORS[(symbolOrder.get(id)||0)%COLORS.length]
const dash=id=>typeof id==='number'?DASHES[id-1]:['','7 3','2 3','12 3 2 3','5 3 2 3','10 3','2 2','14 4 3 4','4 2 1 2','9 2 2 2'][(Math.floor((symbolOrder.get(id)||0)/COLORS.length))%10]
const itemLabel=item=>isCompany()?item.name+' ('+item.symbol+')':item.name
function calculate(){
  const priorDate=cursor>=0?model?.dates[cursor]:null
  const feed=activeFeed(),options={quotes:feed?.quotes||[],instruments,days,generatedAt:feed?.generatedAt,source:feed?.source||'Yahoo Finance'}
  if(!sectorModel||sectorFeed!==feed||sectorDays!==days){
    sectorModel=buildComparison({...options,chains,requireFullPeriod:days>365})
    sectorFeed=feed;sectorDays=days
  }
  companyModel=buildCompanyComparison({...options,symbols:[...selected]})
  model=isCompany()?companyModel:sectorModel
  const priorIndex=priorDate?model.dates.indexOf(priorDate):-1
  cursor=priorIndex>=0?priorIndex:Math.max(0,model.dates.length-1)
}
function sourceStamp(){
  const stamp=activeFeed()?.generatedAt
  return stamp?new Date(stamp).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'미수집'
}
function swatch(id){
  return '<svg width="25" height="10" aria-hidden="true"><line x1="0" y1="5" x2="25" y2="5" stroke="'+color(id)+'" stroke-width="3"'+(dash(id)?' stroke-dasharray="'+dash(id)+'"':'')+'/></svg>'
}
// Long histories are a separate collected file. Reading them never invokes an upstream collector.
async function loadLongHistory(force=false){
  if(longRequest)return longRequest
  if(longAttempted&&!force)return
  longAttempted=true;longLoading=true;longError='';render()
  const staticHost=location.hostname.endsWith('.github.io')||location.protocol==='file:'
  const url=staticHost?'./data/comparison-history.json':'./api/comparison-history'
  longRequest=(async()=>{
    try{
      const response=await fetch(url+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)})
      if(!response.ok)throw new Error('HTTP '+response.status)
      const next=validateComparisonHistorySnapshot(await response.json())
      longSnapshot=next;longError=''
    }catch(error){
      longError='장기 일봉 수집값을 읽지 못했습니다: '+error.message+'. '+(longSnapshot?'마지막 성공 수집값을 유지합니다. 수집 시각을 확인하세요.':'2·3년 비교를 표시할 수 없습니다. 최신 수집값 읽기로 다시 확인하세요.')
    }finally{
      longLoading=false;longRequest=null;calculate();render()
    }
  })()
  return longRequest
}
function mini(){
  const el=document.getElementById('comparison-preview');if(!el)return
  el.innerHTML='<div class="peer-heading"><div><p class="peer-kicker">PEER COMPARISON</p><h2>8개 고리, 한눈에 비교</h2></div><a class="peer-link" href="#compare">흐름 차트 · 피어 목록 보기 →</a></div><p class="note">최근 '+days+'일 · 대표 종목의 주가 등락률을 동일 비중으로 평균 · 시작점 100</p><div class="peer-mini-grid">'+sectorModel.groups.map(g=>'<a href="#compare" class="peer-mini" style="--peer-color:'+color(g.id)+'"><span>'+esc(g.name)+'</span><strong>'+percent(g.returnPercent)+'</strong><small>'+g.includedCount+'/'+g.peerCount+'개 피어</small></a>').join('')+'</div>'
}
function chart(){
  const active=items().filter(item=>item.available&&isVisible(item))
  if(isCompany()&&!selected.size)return '<p class="peer-empty" data-peer-empty>회사 선택 목록에서 비교할 회사를 선택하세요. 서로 다른 고리의 회사도 함께 비교할 수 있습니다.</p>'
  if(model.dates.length<2||!active.length)return '<p class="peer-empty" data-peer-empty>'+(days>365&&!longSnapshot?'장기 일봉 수집값이 필요합니다. 1년 이력을 2·3년으로 대신 표시하지 않습니다.':'비교할 '+(isCompany()?'회사를':'고리를')+' 표시하거나, 같은 날짜의 유효 종가 데이터가 있는지 확인하세요.')+'</p>'
  const endLabelsEnabled=active.length<=12
  const w=1100,h=410,left=60,right=endLabelsEnabled?220:24,top=24,bottom=42
  let low=100,high=100
  for(const item of active)for(const point of item.series){low=Math.min(low,point.index);high=Math.max(high,point.index)}
  const padding=Math.max(2,(high-low)*.12),min=low-padding,max=high+padding
  const start=Date.parse(model.startDate),end=Date.parse(model.endDate)
  const x=d=>left+(Date.parse(d)-start)/Math.max(1,end-start)*(w-left-right)
  const y=v=>top+(max-v)/(max-min)*(h-top-bottom)
  const endLabels=endLabelsEnabled?active.map(item=>({item,y:y(item.series.at(-1).index)})).sort((a,b)=>a.y-b.y):[]
  for(let i=0;i<endLabels.length;i++)endLabels[i].labelY=Math.max(endLabels[i].y,i?endLabels[i-1].labelY+20:top+8)
  if(endLabels.length&&endLabels.at(-1).labelY>h-bottom){const shift=endLabels.at(-1).labelY-(h-bottom);endLabels.forEach(e=>e.labelY-=shift)}
  const ticks=[...new Set([0,.25,.5,.75,1].map(f=>Math.round(f*(model.dates.length-1))))]
  const title=isCompany()?'선택 회사별 주가 흐름, 기준일 100':'8개 밸류체인 피어 주가 비교, 기준일 100'
  return '<div class="peer-chart-scroll"><svg id="peer-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+title+'" data-left="'+left+'" data-right="'+right+'" data-width="'+w+'"><title>'+title+'</title><desc>'+date(model.startDate)+'부터 '+date(model.endDate)+'까지, 시작점을 100으로 맞춘 '+(isCompany()?'각 회사의 개별 주가 흐름':'각 고리의 평균 주가 흐름')+'. 상세 수치는 아래 표와 날짜 슬라이더에서 확인할 수 있습니다.</desc>'+
    [0,.25,.5,.75,1].map(f=>{const v=min+(max-min)*f;return '<line x1="'+left+'" x2="'+(w-right)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="var(--line)"/><text x="'+(left-9)+'" y="'+(y(v)+4)+'" text-anchor="end">'+number(v)+'</text>'}).join('')+
    '<line x1="'+left+'" x2="'+(w-right)+'" y1="'+y(100)+'" y2="'+y(100)+'" stroke="var(--muted)" stroke-dasharray="4 4"/><text x="'+(left+6)+'" y="'+(y(100)-7)+'">기준 100</text>'+
    ticks.map(i=>'<text x="'+x(model.dates[i])+'" y="'+(h-12)+'" text-anchor="'+(i===0?'start':i===model.dates.length-1?'end':'middle')+'">'+date(model.dates[i])+'</text>').join('')+
    active.map(item=>'<path data-peer-series="'+esc(item.id)+'" d="'+item.series.map((p,i)=>(i?'L':'M')+x(p.date).toFixed(1)+','+y(p.index).toFixed(1)).join(' ')+'" fill="none" stroke="'+color(item.id)+'" stroke-width="2.5"'+(dash(item.id)?' stroke-dasharray="'+dash(item.id)+'"':'')+'/>').join('')+
    endLabels.map(({item,y:endY,labelY})=>'<path d="M'+(w-right)+','+endY+' L'+(w-right+12)+','+labelY+' L'+(w-right+18)+','+labelY+'" fill="none" stroke="'+color(item.id)+'" opacity=".6"/><text x="'+(w-right+22)+'" y="'+(labelY+4)+'" class="peer-end-label">'+esc(isCompany()?item.symbol:item.name)+' '+percent(item.returnPercent)+'</text>').join('')+
    '<line id="peer-crosshair" x1="'+x(model.dates[cursor])+'" x2="'+x(model.dates[cursor])+'" y1="'+top+'" y2="'+(h-bottom)+'" stroke="var(--muted)" opacity=".6" stroke-dasharray="2 4"/></svg></div>'+
    (!endLabelsEnabled?'<p class="peer-reading">전체 '+active.length+'개 선을 표시합니다. 회사 이름과 수익률은 범례·날짜별 비교에서 확인하세요.</p>':'')+
    '<div class="peer-inspect"><label for="peer-date-slider">날짜별 비교 <strong id="peer-inspect-date">'+date(model.dates[cursor])+'</strong></label><input id="peer-date-slider" type="range" min="0" max="'+(model.dates.length-1)+'" value="'+cursor+'" aria-label="비교 날짜" aria-valuetext="'+model.dates[cursor]+'"><div id="peer-date-values" class="peer-date-values">'+cursorValues()+'</div></div>'
}
function cursorValues(){
  return items().filter(isVisible).map(item=>'<span>'+swatch(item.id)+'<span>'+esc(itemLabel(item))+'</span><b>'+percent(item.series[cursor]?.returnPercent)+'</b></span>').join('')
}
function selections(){
  if(!isCompany())return ''
  return '<div class="peer-selection"><div class="peer-heading"><p class="peer-selection-count" role="status">선택한 회사 <b>'+selected.size+'개</b> · 같은 종목은 한 번만 비교</p><button class="f" data-peer-clear-companies'+(!selected.size?' disabled':'')+'>선택 비우기</button></div>'+
    (selected.size?'<div class="peer-selection-chips">'+[...selected].map(symbol=>'<button class="peer-selection-chip" data-peer-remove-symbol="'+esc(symbol)+'" aria-label="'+esc(catalogMap.get(symbol)?.name||symbol)+' 비교에서 제거">'+esc(catalogMap.get(symbol)?.name||symbol)+' <small>'+esc(symbol)+'</small> <span aria-hidden="true">×</span></button>').join('')+'</div>':'<p class="note">소부장부터 애플리케이션까지, 회사 선택 목록의 체크박스로 회사를 골라 보세요.</p>')+'</div>'
}
function cards(){
  const companyMap=new Map(companyModel.companies.map(item=>[item.symbol,item]))
  return '<div class="peer-card-grid">'+sectorModel.groups.map(g=>{
    const selectedCount=g.peers.filter(p=>selected.has(p.symbol)).length
    const heading='<div class="peer-heading"><h3>'+swatch(g.id)+esc(g.name)+'</h3><small>'+(isCompany()?selectedCount+'개 선택':g.available?g.rank+' / 8':'미제공')+'</small></div>'
    const summary=isCompany()?'<p class="peer-card-note">회사를 선택해 개별 주가를 비교하세요.</p>':'<strong class="peer-return">'+percent(g.returnPercent)+'</strong><p class="peer-card-note">동일 비중 평균 · '+g.includedCount+'/'+g.peerCount+'개 포함</p>'+(g.stale?'<p class="peer-alert">이전 수집값 포함 · 시각 확인 필요</p>':'')+(!g.available?'<p class="peer-alert">'+esc(g.unavailableReason)+'</p>':'')
    const list=g.peers.map(peer=>{
      const chosen=selected.has(peer.symbol),p=isCompany()?companyMap.get(peer.symbol):peer
      const included=isCompany()?p?.available:p?.included
      const result=isCompany()&&!chosen?'선택하여 비교':included?percent(p.returnPercent):'미제공'
      const reason=isCompany()&&!chosen?'':p?.reason||(!included?'공통 거래일 부족':'')
      return '<li data-peer-row="'+esc(peer.symbol)+'"'+(chosen?' class="peer-company-selected"':'')+'><label class="peer-company-option"><input type="checkbox" data-peer-symbol="'+esc(peer.symbol)+'" aria-label="'+esc(peer.name)+' '+esc(peer.symbol)+' 비교 선택"'+(chosen?' checked':'')+'><span>'+esc(peer.name)+'<small>'+esc(peer.symbol)+' · '+esc(p?.currency||peer.currency||'통화 미제공')+'</small></span></label><b data-peer-company-return="'+esc(peer.symbol)+'">'+result+'</b>'+(reason?'<em>'+esc(reason)+'</em>':'')+(!included&&p?.firstDate?'<em data-peer-observed-period="'+esc(peer.symbol)+'">관측 이력: '+date(p.firstDate)+' ~ '+date(p.lastDate)+'</em>':'')+(p?.stale?'<em>이전 수집값 포함 · 수집 시각 확인 필요</em>':'')+'</li>'
    }).join('')
    const evidence=g.peers.map(p=>isCompany()?companyMap.get(p.symbol):p).filter(Boolean)
    return '<article class="peer-card" data-peer-chain="'+g.id+'" style="--peer-color:'+color(g.id)+'">'+heading+summary+'<ul class="peer-list">'+list+'</ul><details><summary>계산에 사용한 종가·출처</summary>'+(isCompany()?'<p class="note">선택한 회사만 표시 · 실제 비교 '+date(companyModel.startDate)+' ~ '+date(companyModel.endDate)+'</p>':'')+'<div class="peer-evidence"><table><thead><tr><th>피어</th><th>기준 종가</th><th>마지막 종가</th></tr></thead><tbody>'+evidence.map(p=>'<tr><td><a href="https://finance.yahoo.com/quote/'+encodeURIComponent(p.symbol)+'/" target="_blank" rel="noopener noreferrer">'+esc(p.symbol)+'</a><small>'+esc(p.currency||'')+' · '+esc(p.fetchedAt||'수집 시각 미제공')+'</small></td><td>'+number(p.startClose)+'</td><td>'+number(p.endClose)+'</td></tr>').join('')+'</tbody></table></div></details></article>'
  }).join('')+'</div>'
}
function companyPicker(open){
  if(!isCompany())return ''
  return '<details class="peer-company-picker" data-peer-company-picker'+(open?' open':'')+'><summary>회사 선택 목록 <span>'+selected.size+'개 선택 · 펼쳐서 회사 추가·제외</span></summary>'+selections()+'<div class="peer-picker-nav" role="group" aria-label="회사 목록 고리 바로가기">'+chains.map(chain=>'<button class="f" data-peer-jump="'+chain.id+'" aria-label="'+esc(chain.name)+' 회사 목록으로 이동">'+esc(chain.name)+'</button>').join('')+'</div><div class="peer-picker-list" data-peer-picker-list tabindex="0" role="region" aria-label="고리별 회사 선택 목록">'+cards()+'</div></details>'
}
function methodology(){
  return '<section class="panel sec peer-method"><h2>'+(isCompany()?'회사별 흐름은 이렇게 비교합니다':'피어 평균은 이렇게 계산합니다')+'</h2><p><b>'+(isCompany()?'회사 지수 = 해당일 종가 ÷ 공통 기준일 종가 × 100':'고리 지수 = 평균(각 피어의 해당일 종가 ÷ 공통 기준일 종가 × 100)')+'</b></p><p>'+(isCompany()?'회사의 가격 수준을 100으로 맞춰 각 회사를 별도의 선으로 그립니다. 선택 회사를 평균으로 묶지 않으며, 여러 고리에 있는 종목도 한 번만 비교합니다.':'고리 평균 등락률은 이 지수에서 100을 뺀 값입니다. 선택한 기간의 시작에 각 피어를 동일 비중으로 놓는 계산이며, 매일 비중을 재조정하는 지수가 아닙니다.')+'</p><ul><li>현지 통화 기준의 주가 등락률입니다. 환율 변동·배당·거래비용·세금은 반영하지 않습니다. 리츠의 배당 포함 성과와는 다릅니다.</li><li>한국·미국 거래소의 현지 거래 날짜를 맞추고, 포함 대상 모두에게 종가가 있는 날짜만 사용합니다. 휴장일은 보간하지 않습니다. 거래소별 장 마감 시각은 다릅니다. 최신 일봉에는 장중 값이 포함될 수 있습니다.</li><li>'+(isCompany()?'상장 이력이 짧은 회사를 고르면 실제 공통 비교 기간이 짧아질 수 있습니다. 위의 실제 날짜와 기간 경고를 확인하세요.':'삼성전자는 파운드리와 메모리에 함께 포함됩니다. 각 고리는 독립 비교이며, 8개 고리를 합쳐 하나의 분산 포트폴리오로 계산하지 않습니다. 2·3년 평균은 요청 시작일까지 이력이 있는 피어만 포함합니다.')+'</li><li>현재 등록된 대표 종목으로 비교한 값입니다. 업종 전체 수익률이나 공인 지수가 아닙니다. 기간 안에서 피어와 분모는 고정하며, 계산에서 빠진 대상은 위에 이유와 함께 표시합니다.</li><li>출처: <a href="https://finance.yahoo.com/" target="_blank" rel="noopener noreferrer">Yahoo Finance</a> 제공 종가. 시세는 지연될 수 있고 현재 수집 파일의 최근 거래일까지 표시합니다. 수집 파일 시각과 각 회사의 실제 수집 시각은 다를 수 있습니다.</li></ul></section>'
}
function render(){
  if(!model)calculate()
  mini()
  const el=document.getElementById('v-compare');if(!el||el.hidden)return
  const warnings=[...new Set([...(model.metadata?.warnings||[]),...items().flatMap(item=>item.warnings||[])])]
  const shortened=model.startDate&&model.metadata?.requestedStartDate&&Date.parse(model.startDate)-Date.parse(model.metadata.requestedStartDate)>7*86400000
  const title=isCompany()?'회사별 주가 흐름 비교':'8개 고리 주가 흐름 비교'
  const error=days>365?longError:loadError
  const previousPicker=el.querySelector('[data-peer-company-picker]')
  const pickerOpen=previousPicker?.open??false
  const pickerScroll=el.querySelector('[data-peer-picker-list]')?.scrollTop||0
  el.innerHTML='<section class="panel sec peer-comparison" data-peer-active-mode="'+mode+'"><div class="peer-heading"><div><p class="peer-kicker">VALUE CHAIN · SAME START</p><h1>'+title+'</h1></div><button class="f" data-peer-refresh'+(longLoading?' disabled':'')+'>최신 수집값 읽기</button></div><p class="peer-subtitle">'+(isCompany()?'같은 시작점 100으로 비교하는 회사별 주가 흐름 · 회사 선택 목록에서 추가·제외':'고리별 피어 목록 → 각 종목의 같은 기간 주가 등락률 → 동일 비중 평균')+'</p><p class="note"><a href="#data">기업 전체 목록·사업 설명 →</a> · <a href="#industry">수출·물량 산업통계 →</a></p>'+
    '<div class="peer-modes" role="group" aria-label="비교 방식">'+[['groups','고리 평균'],['companies','회사별 비교']].map(([id,label])=>'<button class="f'+(mode===id?' on':'')+'" data-peer-mode="'+id+'" aria-pressed="'+(mode===id)+'">'+label+'</button>').join('')+'</div>'+
    '<div class="peer-toolbar"><div class="peer-periods" role="group" aria-label="비교 기간">'+PERIODS.map(([n,label])=>'<button class="f'+(days===n?' on':'')+'" data-peer-period="'+n+'" aria-pressed="'+(days===n)+'">'+label+'</button>').join('')+'</div><div><button class="f" data-peer-all>'+ (isCompany()?'선택 회사 모두 표시':'8개 모두 표시')+'</button></div></div>'+
    companyPicker(pickerOpen)+'<p class="peer-period-note'+(shortened?' peer-period-short':'')+'" data-peer-actual-period>요청 기간: '+PERIODS.find(([n])=>n===days)[1]+' · 실제 비교: <b>'+date(model.startDate)+' ~ '+date(model.endDate)+'</b> · 공통 거래일 '+model.dates.length+'개 · 수집 '+esc(sourceStamp())+'</p>'+
    (shortened?'<p class="peer-alert peer-period-warning" role="status">'+(isCompany()?'선택한 회사의 상장·수집 이력이 짧아':'일부 피어의 이력이 짧아')+' 요청한 전체 기간을 비교하지 못합니다. 위 실제 시작일 이후의 흐름입니다.</p>':'')+
    (days>365?'<p class="peer-period-note">장기 비교 전용 일봉 수집값'+(longSnapshot?' · '+esc(longSnapshot.source):'')+'을 사용합니다.</p>':'')+
    (longLoading&&days>365?'<p class="peer-period-note" role="status">장기 일봉 수집값 읽는 중…</p>':'')+
    (error?'<p class="peer-alert" role="alert">'+esc(error)+'</p>':'')+
    (warnings.length?'<ul class="peer-alert">'+warnings.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul>':'')+
    '<div class="peer-legend">'+items().map(item=>'<button class="peer-legend-item'+(isVisible(item)?' selected':'')+'" data-peer-toggle="'+esc(item.id)+'" aria-pressed="'+isVisible(item)+'" style="--peer-color:'+color(item.id)+'">'+swatch(item.id)+'<span>'+esc(itemLabel(item))+'</span><b>'+percent(item.returnPercent)+'</b></button>').join('')+'</div>'+chart()+
    '<p class="peer-reading">100에서 110이 되면 '+(isCompany()?'그 회사의 주가 등락률':'해당 피어 묶음의 평균 주가 등락률')+'은 +10%입니다. 범례를 눌러 선을 숨길 수 있습니다. 선 위에서 마우스를 움직이거나 날짜 슬라이더로 같은 날짜의 값을 확인하세요.</p></section>'+(isCompany()?'':cards())+methodology()
  const pickerList=el.querySelector('[data-peer-picker-list]');if(pickerList)pickerList.scrollTop=pickerScroll
}
function inspect(index){
  if(!model.dates.length)return
  cursor=Math.max(0,Math.min(model.dates.length-1,index))
  const label=document.getElementById('peer-inspect-date');if(label)label.textContent=date(model.dates[cursor])
  const values=document.getElementById('peer-date-values');if(values)values.innerHTML=cursorValues()
  const slider=document.getElementById('peer-date-slider');if(slider){slider.value=cursor;slider.setAttribute('aria-valuetext',model.dates[cursor])}
  const chart=document.getElementById('peer-chart'),cross=document.getElementById('peer-crosshair')
  if(chart&&cross){const x=Number(chart.dataset.left)+(Date.parse(model.dates[cursor])-Date.parse(model.startDate))/Math.max(1,Date.parse(model.endDate)-Date.parse(model.startDate))*(Number(chart.dataset.width)-Number(chart.dataset.left)-Number(chart.dataset.right));cross.setAttribute('x1',x);cross.setAttribute('x2',x)}
}
function changeSelection(symbol,checked){
  if(!catalogMap.has(symbol))return
  const enteringCompanyMode=!isCompany()
  const focused=document.activeElement,focusSymbol=focused?.dataset?.peerSymbol
  const focusIndex=focusSymbol?[...document.querySelectorAll('[data-peer-symbol]')].filter(input=>input.dataset.peerSymbol===focusSymbol).indexOf(focused):-1
  if(checked){selected.add(symbol);hiddenCompanies.delete(symbol)}else{selected.delete(symbol);hiddenCompanies.delete(symbol)}
  mode='companies';calculate();render()
  if(focusIndex>=0)[...document.querySelectorAll('[data-peer-symbol]')].filter(input=>input.dataset.peerSymbol===focusSymbol)[focusIndex]?.focus({preventScroll:true})
  if(enteringCompanyMode){
    const picker=document.querySelector('[data-peer-company-picker]')
    if(picker)picker.open=true
    document.querySelector('[data-peer-symbol="'+CSS.escape(symbol)+'"]')?.focus({preventScroll:true})
  }
}
window.renderComparison=render
window.addEventListener('market-snapshot',event=>{snapshot=event.detail;loadError='';calculate();render()})
window.addEventListener('market-snapshot-error',event=>{loadError=event.detail;render()})
document.addEventListener('click',event=>{
  const jump=event.target.closest('[data-peer-jump]')
  if(jump){
    const list=document.querySelector('[data-peer-picker-list]')
    const target=list?.querySelector('[data-peer-chain="'+Number(jump.dataset.peerJump)+'"]')
    if(target)list.scrollTop+=target.getBoundingClientRect().top-list.getBoundingClientRect().top
    return
  }
  const period=event.target.closest('[data-peer-period]')
  if(period){days=Number(period.dataset.peerPeriod);cursor=-1;calculate();render();if(days>365)loadLongHistory();return}
  const modeButton=event.target.closest('[data-peer-mode]')
  if(modeButton){mode=modeButton.dataset.peerMode;calculate();render();return}
  const toggle=event.target.closest('[data-peer-toggle]')
  if(toggle){if(isCompany()){const symbol=toggle.dataset.peerToggle;hiddenCompanies.has(symbol)?hiddenCompanies.delete(symbol):hiddenCompanies.add(symbol)}else{const id=Number(toggle.dataset.peerToggle);visible.has(id)?visible.delete(id):visible.add(id)}render();return}
  const remove=event.target.closest('[data-peer-remove-symbol]')
  if(remove){changeSelection(remove.dataset.peerRemoveSymbol,false);return}
  if(event.target.closest('[data-peer-clear-companies]')){selected.clear();hiddenCompanies.clear();calculate();render();return}
  if(event.target.closest('[data-peer-all]')){if(isCompany())hiddenCompanies.clear();else visible=new Set(chains.map(c=>c.id));render();return}
  if(event.target.closest('[data-peer-refresh]')){window.dispatchEvent(new Event('market-refresh-request'));if(days>365)loadLongHistory(true);return}
})
document.addEventListener('change',event=>{
  const input=event.target.closest('[data-peer-symbol]');if(input)changeSelection(input.dataset.peerSymbol,input.checked)
})
document.addEventListener('input',event=>{if(event.target.id==='peer-date-slider')inspect(Number(event.target.value))})
document.addEventListener('pointermove',event=>{
  const svg=event.target.closest('#peer-chart');if(!svg||!model.dates.length)return
  const rect=svg.getBoundingClientRect(),fraction=((event.clientX-rect.left)/rect.width*Number(svg.dataset.width)-Number(svg.dataset.left))/(Number(svg.dataset.width)-Number(svg.dataset.left)-Number(svg.dataset.right))
  const time=Date.parse(model.startDate)+Math.max(0,Math.min(1,fraction))*(Date.parse(model.endDate)-Date.parse(model.startDate))
  let nearest=0;model.dates.forEach((d,i)=>{if(Math.abs(Date.parse(d)-time)<Math.abs(Date.parse(model.dates[nearest])-time))nearest=i});inspect(nearest)
})
calculate();render()
