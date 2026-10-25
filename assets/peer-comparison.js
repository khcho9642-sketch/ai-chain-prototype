import { instruments } from './instruments.js'
import { buildComparison } from './peer-comparison-core.js'

const COLORS=['#6ac9ff','#ffce62','#bbabff','#6ce0ce','#ff9e6d','#ff99c8','#b5d97e','#e3e9f2']
const DASHES=['','','','','9 4','9 4','3 4','12 4 3 4']
const CHAIN_NAMES=['소부장','파운드리·패키징','메모리','AI 칩','전력','인프라','모델','애플리케이션']
const chains=CHAIN_NAMES.map((name,index)=>({id:index+1,name}))
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const number=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{maximumFractionDigits:2}):'—'
const percent=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(2)}%`:'—'
const date=value=>value?String(value).replaceAll('-','. '):'—'
let snapshot=window.aiChainSnapshot||null,loadError='',days=90,visible=new Set(chains.map(c=>c.id)),model=null,cursor=-1
const color=id=>COLORS[id-1],dash=id=>DASHES[id-1]
function calculate(){
  const hadDates=Boolean(model?.dates.length)
  model=buildComparison({quotes:snapshot?.quotes||[],instruments,chains,days,generatedAt:snapshot?.generatedAt,source:'Yahoo Finance'})
  cursor=Math.min(cursor<0||!hadDates?Math.max(0,model.dates.length-1):cursor,Math.max(0,model.dates.length-1))
}
function sourceStamp(){
  return snapshot?.generatedAt?new Date(snapshot.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'수집 중'
}
function swatch(id){return `<svg width="25" height="10" aria-hidden="true"><line x1="0" y1="5" x2="25" y2="5" stroke="${color(id)}" stroke-width="3" ${dash(id)?`stroke-dasharray="${dash(id)}"`:''}/></svg>`}
function mini(){
  const el=document.getElementById('comparison-preview');if(!el)return
  el.innerHTML=`<div class="peer-heading"><div><p class="peer-kicker">PEER COMPARISON</p><h2>8개 고리, 한눈에 비교</h2></div><a class="peer-link" href="#compare">흐름 차트 · 피어 목록 보기 →</a></div><p class="note">최근 ${days}일 · 대표 종목의 주가 등락률을 동일 비중으로 평균 · 시작점 100</p><div class="peer-mini-grid">${model.groups.map(g=>`<a href="#compare" class="peer-mini" style="--peer-color:${color(g.id)}"><span>${esc(g.name)}</span><strong>${percent(g.returnPercent)}</strong><small>${g.includedCount}/${g.peerCount}개 피어</small></a>`).join('')}</div>`
}
function chart(){
  const active=model.groups.filter(g=>g.available&&visible.has(g.id))
  if(model.dates.length<2||!active.length)return '<p class="peer-empty">비교할 고리를 선택하거나, 같은 날짜의 종가 데이터가 수집될 때까지 기다려 주세요.</p>'
  const w=1100,h=410,left=60,right=174,top=24,bottom=42
  const values=active.flatMap(g=>g.series.map(p=>p.index))
  const low=Math.min(100,...values),high=Math.max(100,...values),padding=Math.max(2,(high-low)*.12)
  const min=low-padding,max=high+padding
  const start=Date.parse(model.startDate),end=Date.parse(model.endDate)
  const x=d=>left+(Date.parse(d)-start)/Math.max(1,end-start)*(w-left-right)
  const y=v=>top+(max-v)/(max-min)*(h-top-bottom)
  const endLabels=active.map(g=>({group:g,y:y(g.series.at(-1).index)})).sort((a,b)=>a.y-b.y)
  for(let i=0;i<endLabels.length;i++)endLabels[i].labelY=Math.max(endLabels[i].y,i?endLabels[i-1].labelY+17:top+8)
  if(endLabels.at(-1).labelY>h-bottom){const shift=endLabels.at(-1).labelY-(h-bottom);endLabels.forEach(e=>e.labelY-=shift)}
  const ticks=[...new Set([0,.25,.5,.75,1].map(f=>Math.round(f*(model.dates.length-1))))]
  return `<div class="peer-chart-scroll"><svg id="peer-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="8개 밸류체인 피어 주가 비교, 기준일 100" data-left="${left}" data-right="${right}" data-width="${w}"><title>대표 종목 동일 비중 주가 지수</title><desc>${date(model.startDate)}부터 ${date(model.endDate)}까지, 시작점을 100으로 맞춘 각 고리의 평균 주가 흐름. 상세 수치는 아래 표와 날짜 슬라이더에서 확인할 수 있습니다.</desc>${[0,.25,.5,.75,1].map(f=>{const v=min+(max-min)*f;return `<line x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${left-9}" y="${y(v)+4}" text-anchor="end">${number(v)}</text>`}).join('')}<line x1="${left}" x2="${w-right}" y1="${y(100)}" y2="${y(100)}" stroke="var(--muted)" stroke-dasharray="4 4"/><text x="${left+6}" y="${y(100)-7}">기준 100</text>${ticks.map(i=>`<text x="${x(model.dates[i])}" y="${h-12}" text-anchor="${i===0?'start':i===model.dates.length-1?'end':'middle'}">${date(model.dates[i])}</text>`).join('')}${active.map(g=>`<path d="${g.series.map((p,i)=>`${i?'L':'M'}${x(p.date).toFixed(1)},${y(p.index).toFixed(1)}`).join(' ')}" fill="none" stroke="${color(g.id)}" stroke-width="2.5" ${dash(g.id)?`stroke-dasharray="${dash(g.id)}"`:''}/>`).join('')}${endLabels.map(({group:g,y:endY,labelY})=>`<path d="M${w-right},${endY} L${w-right+12},${labelY} L${w-right+18},${labelY}" fill="none" stroke="${color(g.id)}" opacity=".6"/><text x="${w-right+22}" y="${labelY+4}" fill="${color(g.id)}" class="peer-end-label">${esc(g.name)} ${percent(g.returnPercent)}</text>`).join('')}<line id="peer-crosshair" x1="${x(model.dates[cursor])}" x2="${x(model.dates[cursor])}" y1="${top}" y2="${h-bottom}" stroke="var(--muted)" opacity=".6" stroke-dasharray="2 4"/></svg></div><div class="peer-inspect"><label for="peer-date-slider">날짜별 비교 <strong id="peer-inspect-date">${date(model.dates[cursor])}</strong></label><input id="peer-date-slider" type="range" min="0" max="${model.dates.length-1}" value="${cursor}" aria-label="비교 날짜" aria-valuetext="${model.dates[cursor]}"><div id="peer-date-values" class="peer-date-values">${cursorValues()}</div></div>`
}
function cursorValues(){return model.groups.filter(g=>visible.has(g.id)).map(g=>`<span>${swatch(g.id)}${esc(g.name)} <b>${percent(g.series[cursor]?.returnPercent)}</b></span>`).join('')}
function cards(){
  return `<div class="peer-card-grid">${model.groups.map(g=>`<article class="peer-card" style="--peer-color:${color(g.id)}"><div class="peer-heading"><h3>${swatch(g.id)}${esc(g.name)}</h3><small>${g.available?`${g.rank} / 8`:'미제공'}</small></div><strong class="peer-return">${percent(g.returnPercent)}</strong><p class="peer-card-note">동일 비중 평균 · ${g.includedCount}/${g.peerCount}개 포함</p>${g.stale?'<p class="peer-alert">이전 수집값 포함 · 시각 확인 필요</p>':''}${!g.available?`<p class="peer-alert">${esc(g.unavailableReason)}</p>`:''}<ul class="peer-list">${g.peers.map(p=>`<li><span>${esc(p.name)}<small>${esc(p.symbol)} · ${esc(p.currency||'통화 미제공')}</small></span><b>${p.included?percent(p.returnPercent):'제외'}</b>${!p.included?`<em>${esc(p.reason)}</em>`:''}</li>`).join('')}</ul><details><summary>계산에 사용한 종가·출처</summary><div class="peer-evidence"><table><thead><tr><th>피어</th><th>기준 종가</th><th>마지막 종가</th></tr></thead><tbody>${g.peers.map(p=>`<tr><td><a href="https://finance.yahoo.com/quote/${encodeURIComponent(p.symbol)}/" target="_blank" rel="noopener noreferrer">${esc(p.symbol)}</a></td><td>${number(p.startClose)}</td><td>${number(p.endClose)}</td></tr>`).join('')}</tbody></table></div></details></article>`).join('')}</div>`
}
function render(){
  if(!model)calculate()
  mini()
  const el=document.getElementById('v-compare');if(!el||el.hidden)return
  const warnings=[...new Set([...(model.metadata?.warnings||[]),...model.groups.flatMap(g=>g.warnings||[])])]
  el.innerHTML=`<section class="panel sec peer-comparison"><div class="peer-heading"><div><p class="peer-kicker">VALUE CHAIN · SAME START, SAME WEIGHT</p><h1>8개 고리 주가 흐름 비교</h1></div><button class="f" data-peer-refresh>최신 수집값 읽기</button></div><p class="peer-subtitle">고리별 피어 목록 → 각 종목의 같은 기간 주가 등락률 → 동일 비중 평균</p><div class="peer-toolbar"><div class="peer-periods" aria-label="비교 기간">${[[30,'1개월'],[90,'3개월'],[180,'6개월'],[365,'1년']].map(([n,label])=>`<button class="f${days===n?' on':''}" data-peer-period="${n}" aria-pressed="${days===n}">${label}</button>`).join('')}</div><div><button class="f" data-peer-all>8개 모두 표시</button><button class="f" data-peer-csv="index">고리 지수 CSV</button><button class="f" data-peer-csv="peers">피어 수익률 CSV</button></div></div><p class="peer-period-note">실제 비교: <b>${date(model.startDate)} ~ ${date(model.endDate)}</b> · 공통 거래일 ${model.dates.length}개 · 수집 ${esc(sourceStamp())}</p>${loadError?`<p class="peer-alert" role="alert">${esc(loadError)}</p>`:''}${warnings.length?`<ul class="peer-alert">${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}<div class="peer-legend">${model.groups.map(g=>`<button class="peer-legend-item${visible.has(g.id)?' selected':''}" data-peer-toggle="${g.id}" aria-pressed="${visible.has(g.id)}" style="--peer-color:${color(g.id)}">${swatch(g.id)}<span>${esc(g.name)}</span><b>${percent(g.returnPercent)}</b></button>`).join('')}</div>${chart()}<p class="peer-reading">100에서 110이 되면 해당 피어 묶음의 평균 주가 등락률은 +10%입니다. 범례를 눌러 고리를 숨길 수 있습니다. 선 위에서 마우스를 움직이거나 날짜 슬라이더로 같은 날짜의 8개 값을 확인하세요.</p></section>${cards()}<section class="panel sec peer-method"><h2>피어 평균은 이렇게 계산합니다</h2><p><b>고리 지수 = 평균(각 피어의 해당일 종가 ÷ 공통 기준일 종가 × 100)</b></p><p>고리 평균 등락률은 이 지수에서 100을 뺀 값입니다. 선택한 기간의 시작에 각 피어를 동일 비중으로 놓는 계산이며, 매일 비중을 재조정하는 지수가 아닙니다.</p><ul><li>현지 통화 기준의 주가 등락률입니다. 환율 변동·배당·거래비용·세금은 반영하지 않습니다. 리츠의 배당 포함 성과와는 다릅니다.</li><li>한국·미국 거래소의 현지 거래 날짜를 맞추고, 포함 피어 모두에게 종가가 있는 날짜만 사용합니다. 휴장일은 보간하지 않습니다. 거래소별 장 마감 시각은 다릅니다. 최신 일봉에는 장중 값이 포함될 수 있습니다.</li><li>삼성전자는 파운드리와 메모리에 함께 포함됩니다. 각 고리는 독립 비교이며, 8개 고리를 합쳐 하나의 분산 포트폴리오로 계산하지 않습니다.</li><li>현재 등록된 대표 종목으로 비교한 값입니다. 업종 전체 수익률이나 공인 지수가 아닙니다. 기간 안에서 피어와 분모는 고정하며, 계산에서 빠진 피어는 위에 이유와 함께 표시합니다.</li><li>출처: <a href="https://finance.yahoo.com/" target="_blank" rel="noopener noreferrer">Yahoo Finance</a> 제공 종가. 시세는 지연될 수 있고 현재 수집 파일의 최근 거래일까지 표시합니다. ${esc(warnings.length?'수집 지연 또는 일부 피어 제외가 있어 위 카드와 출처를 확인하세요.':'모든 포함 종목의 공통 날짜를 기준으로 비교했습니다.')}</li></ul></section>`
}
function inspect(index){
  cursor=Math.max(0,Math.min(model.dates.length-1,index))
  const label=document.getElementById('peer-inspect-date');if(label)label.textContent=date(model.dates[cursor])
  const values=document.getElementById('peer-date-values');if(values)values.innerHTML=cursorValues()
  const slider=document.getElementById('peer-date-slider');if(slider){slider.value=cursor;slider.setAttribute('aria-valuetext',model.dates[cursor])}
  const chart=document.getElementById('peer-chart'),cross=document.getElementById('peer-crosshair')
  if(chart&&cross){const x=Number(chart.dataset.left)+(Date.parse(model.dates[cursor])-Date.parse(model.startDate))/Math.max(1,Date.parse(model.endDate)-Date.parse(model.startDate))*(Number(chart.dataset.width)-Number(chart.dataset.left)-Number(chart.dataset.right));cross.setAttribute('x1',x);cross.setAttribute('x2',x)}
}
function download(kind){
  if(!model.dates.length)return
  let rows
  if(kind==='peers')rows=[['chain','symbol','name','included','start_date','end_date','start_close','end_close','local_currency_price_return_percent','reason'],...model.groups.flatMap(g=>g.peers.map(p=>[g.name,p.symbol,p.name,p.included,model.startDate,model.endDate,p.startClose,p.endClose,p.returnPercent,p.reason||'']))]
  else rows=[['date',...model.groups.map(g=>g.name)],...model.dates.map((d,i)=>[d,...model.groups.map(g=>g.series[i]?.index??'')])]
  const data='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n')
  const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`ai-chain-${kind}-${days}d.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
window.renderComparison=render
window.addEventListener('market-snapshot',event=>{snapshot=event.detail;loadError='';calculate();render()})
window.addEventListener('market-snapshot-error',event=>{loadError=event.detail;render()})
document.addEventListener('click',event=>{
  const p=event.target.closest('[data-peer-period]');if(p){days=Number(p.dataset.peerPeriod);cursor=-1;calculate();render();return}
  const toggle=event.target.closest('[data-peer-toggle]');if(toggle){const id=Number(toggle.dataset.peerToggle);visible.has(id)?visible.delete(id):visible.add(id);render();return}
  if(event.target.closest('[data-peer-all]')){visible=new Set(chains.map(c=>c.id));render()}
  if(event.target.closest('[data-peer-refresh]'))window.dispatchEvent(new Event('market-refresh-request'))
  const csv=event.target.closest('[data-peer-csv]');if(csv)download(csv.dataset.peerCsv)
})
document.addEventListener('input',event=>{if(event.target.id==='peer-date-slider')inspect(Number(event.target.value))})
document.addEventListener('pointermove',event=>{
  const svg=event.target.closest('#peer-chart');if(!svg||!model.dates.length)return
  const rect=svg.getBoundingClientRect(),fraction=((event.clientX-rect.left)/rect.width*Number(svg.dataset.width)-Number(svg.dataset.left))/(Number(svg.dataset.width)-Number(svg.dataset.left)-Number(svg.dataset.right))
  const time=Date.parse(model.startDate)+Math.max(0,Math.min(1,fraction))*(Date.parse(model.endDate)-Date.parse(model.startDate))
  let nearest=0;model.dates.forEach((d,i)=>{if(Math.abs(Date.parse(d)-time)<Math.abs(Date.parse(model.dates[nearest])-time))nearest=i});inspect(nearest)
})
calculate();render()
