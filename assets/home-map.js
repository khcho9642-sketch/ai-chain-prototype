import {SECTORS,COMPANIES,getReturn,filterCompanies,treemap,bubbleLayout} from './home-map-core.js';
import { instruments } from './instruments.js';
import { mountHomeSectorSummary } from './home-sector-summary.js';
const host = document.getElementById('v-home');
const root = host.attachShadow({mode:'open'});
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('./home-map.css', import.meta.url).href;
root.append(stylesheet);
const content = document.createElement('div');
content.innerHTML = `<div class="map-main">
    <section class="intro" aria-label="시장 지도">
      <div><div class="eyebrow">THE AI ECONOMY, AT A GLANCE</div><h1>AI 시장 지도<span>.</span></h1><p>반도체에서 모델까지, AI 산업의 움직임을 한눈에.</p></div>
      <div class="market-breadth" aria-label="선택 기간 지도 예시 요약"><span class="data-label">지도 예시</span><span><b id="company-count">—</b>개 기업</span><i></i><span class="positive">상승 <b id="up-count">—</b></span><span class="negative">하락 <b id="down-count">—</b></span></div>
    </section>
    <section id="home-sector-summary"></section>
    <section class="workspace" aria-label="기업 지도 탐색">
      <div class="toolbar">
        <div class="view-switch" role="group" aria-label="지도 보기 방식">
          <button class="active" data-view="heatmap" aria-pressed="true"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2h8v8H2zM12 2h4v8h-4zM2 12h5v4H2zM9 12h7v4H9z"/></svg>히트맵</button>
          <button data-view="bubble" aria-pressed="false"><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="6" cy="6" r="4"/><circle cx="12.5" cy="11.5" r="3.5"/><circle cx="4" cy="14" r="2"/></svg>버블</button>
        </div>
        <div class="search-wrap"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="search" type="search" aria-label="기업명 또는 티커 검색" placeholder="기업명 · 티커 검색" autocomplete="off"><kbd>/</kbd></div>
        <div class="country-wrap"><label for="country">국가</label><select id="country" aria-label="국가"><option value="all">전체 국가</option><option value="US">미국</option><option value="KR">한국</option><option value="TW">대만</option><option value="JP">일본</option><option value="CN">중국</option><option value="EU">유럽</option><option value="SG">싱가포르</option></select></div>
        <div class="period-switch" role="group" aria-label="수익률 기간"><button data-period="1d" class="active" aria-pressed="true">1일</button><button data-period="1w" aria-pressed="false">1주</button><button data-period="1m" aria-pressed="false">1개월</button><button data-period="1y" aria-pressed="false">1년</button></div>
      </div>
      <div class="sector-row"><div class="sector-chips" id="sector-chips" role="group" aria-label="분야 선택"></div><button class="reset" id="reset" aria-label="조회 조건 초기화"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 6a6 6 0 1 1-.2 5M3 2v4h4"/></svg><span>초기화</span></button></div>
      <div class="chart-meta"><div class="breadcrumb"><button id="overview">전체 산업</button><span id="crumb-sector"></span></div><div id="chart-explainer">면적 <b>시가총액</b><span>·</span>색상 <b>등락률</b></div></div>
      <div class="chart-stage" id="chart-stage" aria-label="히트맵 차트">
        <div class="heatmap" id="heatmap"></div>
        <div class="bubble-chart" id="bubble-chart" hidden><div class="bubble-scroll" id="bubble-scroll"><svg id="bubble-svg" role="group" aria-label="분야별 기업 등락률과 시가총액 버블 차트"></svg></div><svg class="fixed-axis" id="fixed-axis" aria-hidden="true"></svg><span class="scroll-hint">좌우로 밀어 분야를 살펴보세요 →</span></div>
        <div class="empty-state" id="empty-state" hidden><div class="empty-icon">⌕</div><h2>조건에 맞는 기업이 없어요</h2><p>검색어를 바꾸거나 조회 조건을 초기화해 보세요.</p><button id="empty-reset">조건 초기화</button></div>
        <div class="tooltip" id="tooltip" role="status" hidden></div>
      </div>
      <div class="chart-footer"><span id="chart-hint"><span class="hint-dot"></span>분야 이름을 누르면 확대 · 기업을 누르면 정보 확인</span><div class="return-legend" id="return-legend"><span>−3%</span><div class="gradient"></div><span>0</span><div class="gradient positive-gradient"></div><span>+3%</span></div><span id="bubble-legend" hidden>원의 중심 = 등락률 · 원의 면적 = 시가총액</span></div>
      <aside class="selection" id="selection" aria-label="선택 기업 정보" hidden></aside>
    </section>
    <footer class="page-footer"><span>AI VALUE CHAIN</span><p>히트맵·버블의 시총과 등락률은 화면 체험용 합성 데이터입니다.</p><span class="footer-note">9개 분야 · 시가총액 USD 기준</span></footer>
</div>`;
root.append(content);
const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
const state={view:new URLSearchParams(location.search).get('view')==='bubble'?'bubble':'heatmap',country:'all',sector:'all',period:'1d',query:'',selected:null};
const sectorSummary = mountHomeSectorSummary($('#home-sector-summary'), { onSelect: setSector });
const COUNTRY_NAMES={US:'미국',KR:'한국',TW:'대만',JP:'일본',CN:'중국',NL:'네덜란드',DE:'독일',FR:'프랑스',GB:'영국',IE:'아일랜드',CH:'스위스',HK:'홍콩',SG:'싱가포르'};
const NS='http://www.w3.org/2000/svg';
let currentItems=[],resizeFrame=0;
const sign=v=>v==null?'미제공':`${v>0?'+':''}${v.toFixed(2)}%`;
const capText=cap=>cap>=1000?`$${(cap/1000).toFixed(2)}조`:`$${(cap*10).toLocaleString('ko-KR',{maximumFractionDigits:0})}억`;
const pctClass=v=>v>0?'positive':v<0?'negative':'';
const labelFor=c=>/^\d/.test(c.ticker)?c.name:c.ticker;
const textUnits=s=>Array.from(s).reduce((n,ch)=>n+(ch.codePointAt(0)>127?1:.64),0);
const periodName=()=>({'1d':'1일','1w':'1주','1m':'1개월','1y':'1년'}[state.period]);
function node(tag,attrs={},content){const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(content!=null)el.textContent=content;return el;}
function returnColor(v){if(v==null)return '#4e5967';const start=[51,68,83],end=v>0?[21,122,80]:[164,57,72],t=Math.min(Math.abs(v)/3,1);return `rgb(${start.map((n,i)=>Math.round(n+(end[i]-n)*t)).join(',')})`;}
function setSector(name){state.sector=name;render();}
function renderChips(){const container=$('#sector-chips');container.replaceChildren();for(const s of [{name:'전체',id:'all'},...SECTORS]){const b=document.createElement('button'),value=s.id==='all'?'all':s.name;b.className=state.sector===value?'active':'';b.setAttribute('aria-pressed',String(state.sector===value));if(s.color){const dot=document.createElement('span');dot.className='sector-dot';dot.style.setProperty('--sector',s.color);b.append(dot);}b.append(document.createTextNode(s.name));b.addEventListener('click',()=>setSector(value));container.append(b);}}
function selectCompany(company){state.selected=state.selected===company.id?null:company.id;renderSelection();$$('.tile,.bubble-node').forEach(e=>{const selected=e.dataset.id===state.selected;e.classList.toggle('selected',selected);e.setAttribute('aria-pressed',String(selected));});hideTooltip();}
function renderSelection(){
  const el=$('#selection'),c=currentItems.find(c=>c.id===state.selected);
  el.hidden=!c;
  if(!c)return;
  const r=getReturn(c,state.period);
  el.replaceChildren();
  const title=document.createElement('div');title.className='selected-title';
  const name=document.createElement('div'),b=document.createElement('b');
  b.textContent=c.ticker;name.append(b,document.createTextNode('  '+c.name));
  const sub=document.createElement('small');sub.textContent=`${c.sector} · ${COUNTRY_NAMES[c.country]??c.country}`;
  name.append(sub);title.append(name);
  const data=document.createElement('div');data.className='selection-data';
  const cap=document.createElement('span');cap.textContent=`시가총액 ${capText(c.cap)}`;
  const change=document.createElement('span');change.className=pctClass(r);change.textContent=`${periodName()} ${sign(r)}`;
  data.append(cap,change);
  const actions=document.createElement('div');actions.className='selection-actions';
  const chart=document.createElement('button');chart.type='button';chart.textContent='시세·차트 보기';
  chart.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('market-symbol-open',{detail:{symbol:c.ticker}})));
  actions.append(chart);
  if(instruments.some(item=>item.symbol===c.ticker&&item.chains.some(chain=>chain>0))){
    const talk=document.createElement('a');talk.href='#talk/'+encodeURIComponent(c.ticker);talk.textContent='종목 토론';actions.append(talk);
  }
  const today=document.createElement('a');today.href='#today';today.textContent='오늘의 변화';actions.append(today);
  const scenario=document.createElement('a');scenario.href='#scenario';scenario.textContent='시나리오 분석';actions.append(scenario);
  const close=document.createElement('button');close.type='button';close.className='selection-close';close.textContent='×';close.setAttribute('aria-label','기업 선택 닫기');
  close.addEventListener('click',()=>{state.selected=null;renderSelection();$$('.selected').forEach(e=>e.classList.remove('selected'));});
  el.append(title,data,actions,close);
}
function showTooltip(c,e){if(matchMedia('(max-width:720px)').matches)return;const tooltip=$('#tooltip'),r=getReturn(c,state.period);tooltip.replaceChildren();const title=document.createElement('strong');title.textContent=`${c.ticker} · ${c.name}`;const sub=document.createElement('small');sub.textContent=`${c.sector} / ${COUNTRY_NAMES[c.country]??c.country}`;const vals=document.createElement('div');vals.className='tooltip-values';const cap=document.createElement('span');cap.textContent=capText(c.cap);const val=document.createElement('b');val.className=pctClass(r);val.textContent=sign(r);vals.append(cap,val);tooltip.append(title,sub,vals);tooltip.hidden=false;const bounds=$('#chart-stage').getBoundingClientRect();const x=Math.min(Math.max(8,e.clientX-bounds.left+15),bounds.width-tooltip.offsetWidth-8),y=Math.min(Math.max(8,e.clientY-bounds.top+15),bounds.height-tooltip.offsetHeight-8);tooltip.style.left=`${x}px`;tooltip.style.top=`${y}px`;}
function hideTooltip(){$('#tooltip').hidden=true;}
function wireCompany(el,c){el.dataset.id=c.id;el.setAttribute('aria-label',`${c.name} ${c.ticker}, ${c.sector}, ${periodName()} ${sign(getReturn(c,state.period))}, 시가총액 ${capText(c.cap)}`);el.setAttribute('aria-pressed',String(state.selected===c.id));el.classList.toggle('selected',state.selected===c.id);el.addEventListener('click',()=>selectCompany(c));el.addEventListener('pointermove',e=>showTooltip(c,e));el.addEventListener('pointerleave',hideTooltip);el.addEventListener('blur',hideTooltip);}
function drawHeatmap(){const host=$('#heatmap'),{width,height}=$('#chart-stage').getBoundingClientRect();host.replaceChildren();if(!width||!height)return;const groups=SECTORS.map(s=>({...s,companies:currentItems.filter(c=>c.sector===s.name)})).filter(s=>s.companies.length);const layouts=treemap(groups,0,0,width,height,s=>s.companies.reduce((sum,c)=>sum+c.cap,0));for(const g of layouts){const group=document.createElement('div');group.className='sector-group';Object.assign(group.style,{left:g.x+'px',top:g.y+'px',width:g.w+'px',height:g.h+'px'});const innerWidth=Math.max(0,g.w-4),innerHeight=Math.max(0,g.h-4),boxes=treemap(g.data.companies,0,0,innerWidth,innerHeight,c=>c.cap);for(const box of boxes){const c=box.data,r=getReturn(c,state.period),tile=document.createElement('button');tile.type='button';tile.className='tile';Object.assign(tile.style,{left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'});tile.style.setProperty('--tile-color',returnColor(r));wireCompany(tile,c);const available=box.h-(box.y<23?23:0);if(box.w>29&&available>23){const font=Math.max(9,Math.min(29,(box.w-8)/textUnits(labelFor(c)),available/3.7));if(box.w>130&&available>95){const name=document.createElement('span');name.className='company-name';name.textContent=c.name;tile.append(name);}const ticker=document.createElement('span');ticker.className='ticker';ticker.style.fontSize=font+'px';ticker.textContent=labelFor(c);const val=document.createElement('span');val.className='return';val.style.fontSize=Math.max(8,Math.min(18,font*.67))+'px';val.textContent=sign(r);tile.append(ticker,val);if(box.y<23)tile.style.paddingTop='21px';}group.append(tile);}const heading=document.createElement('button');heading.className='sector-heading';heading.title=g.data.name;heading.setAttribute('aria-label',`${g.data.name} 분야 확대`);heading.textContent=g.data.name;const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent=state.sector==='all'?'↗':'↙';heading.append(arrow);heading.addEventListener('click',()=>setSector(state.sector==='all'?g.data.name:'all'));group.append(heading);host.append(group);}host.classList.remove('fade-in');requestAnimationFrame(()=>host.classList.add('fade-in'));}
function drawBubbles(){const stage=$('#chart-stage');if(!stage.clientWidth||!stage.clientHeight)return;const svg=$('#bubble-svg'),axis=$('#fixed-axis'),height=stage.clientHeight,width=Math.max(stage.clientWidth,state.sector==='all'?1040:stage.clientWidth);const layout=bubbleLayout(currentItems,width,height,{period:state.period,sector:state.sector});const p=layout.plotBounds,[min,max]=layout.yDomain;svg.replaceChildren();axis.replaceChildren();svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);axis.setAttribute('viewBox',`0 0 48 ${height}`);const yFor=v=>p.top+(max-v)/(max-min)*p.height;const rawStep=(max-min)/5,magnitude=10**Math.floor(Math.log10(rawStep)),step=([1,2,2.5,5,10].find(v=>v>=rawStep/magnitude)??10)*magnitude;const ticks=[];for(let value=Math.ceil(min/step)*step;value<=max+.0001;value+=step)ticks.push(value);for(const value of ticks){const y=yFor(value),isZero=Math.abs(value)<.001;svg.append(node('line',{x1:p.left,y1:y,x2:p.right,y2:y,stroke:isZero?'#607a91':'#233445','stroke-width':isZero?1:.6}));axis.append(node('text',{x:39,y:y+3,'text-anchor':'end',class:'axis-label'},`${value>0?'+':''}${value.toFixed(Math.abs(value)%1>.01?1:0)}%`));}if(min<0&&max>0&&!ticks.some(v=>Math.abs(v)<.001)){const y=yFor(0);svg.append(node('line',{x1:p.left,y1:y,x2:p.right,y2:y,stroke:'#607a91','stroke-width':1}));}
for(const center of layout.sectorCenters){svg.append(node('line',{x1:center.x,y1:p.top,x2:center.x,y2:p.bottom,stroke:'#1b2b3b','stroke-width':.6}));const label=node('text',{x:center.x,y:p.bottom+23,fill:center.color,class:'sector-axis-label',tabindex:0,role:'button','aria-label':`${center.sector} 분야 확대`});const parts=center.sector==='클라우드·GPU 컴퓨팅'?['클라우드·','GPU 컴퓨팅']:center.sector==='파운드리·패키징'?['파운드리·','패키징']:center.sector==='반도체 소부장'?['반도체','소부장']:[center.sector];for(let i=0;i<parts.length;i++)label.append(node('tspan',{x:center.x,dy:i?13:0},parts[i]));label.addEventListener('click',()=>setSector(state.sector==='all'?center.sector:'all'));label.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSector(state.sector==='all'?center.sector:'all');}});svg.append(label);}
for(const b of [...layout.nodes].sort((a,b)=>b.r-a.r)){const sector=SECTORS.find(s=>s.name===b.data.sector),g=node('g',{class:'bubble-node',tabindex:0,role:'button'});g.append(node('circle',{cx:b.x,cy:b.y,r:b.r,fill:sector?.color??'#6ba8e5','fill-opacity':.27,stroke:sector?.color??'#6ba8e5','stroke-width':1.2}));if(b.r>=14&&textUnits(labelFor(b.data))*7<=b.r*1.8){const label=node('text',{x:b.x,y:b.y-1,class:'bubble-label','font-size':Math.min(12,Math.max(8,b.r/2.5))},labelFor(b.data));label.style.fontSize=Math.min(12,b.r*1.8/textUnits(labelFor(b.data)))+'px';g.append(label);if(b.r>=21)g.append(node('text',{x:b.x,y:b.y+12,class:'bubble-label bubble-return'},sign(getReturn(b.data,state.period))));}wireCompany(g,b.data);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCompany(b.data);}});svg.append(g);}svg.classList.remove('fade-in');requestAnimationFrame(()=>svg.classList.add('fade-in'));}
function render(){sectorSummary.setSector(state.sector);let result=filterCompanies(COMPANIES,{country:state.country==='EU'?'all':state.country,sector:state.sector,query:state.query});if(state.country==='EU')result=result.filter(c=>['NL','DE','FR','GB','IE','CH'].includes(c.country));currentItems=result.filter(c=>Number.isFinite(c.cap)&&c.cap>0);if(!currentItems.some(c=>c.id===state.selected))state.selected=null;host.dataset.view=state.view;$$('[data-view]').forEach(b=>{const active=b.dataset.view===state.view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$$('[data-period]').forEach(b=>{const active=b.dataset.period===state.period;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});renderChips();$('#company-count').textContent=currentItems.length;$('#up-count').textContent=currentItems.filter(c=>getReturn(c,state.period)>0).length;$('#down-count').textContent=currentItems.filter(c=>getReturn(c,state.period)<0).length;$('#crumb-sector').textContent=state.sector==='all'?'':`/ ${state.sector}`;$('#heatmap').hidden=state.view!=='heatmap'||!currentItems.length;$('#bubble-chart').hidden=state.view!=='bubble'||!currentItems.length;$('#empty-state').hidden=!!currentItems.length;$('#return-legend').hidden=state.view!=='heatmap';$('#bubble-legend').hidden=state.view!=='bubble';$('#chart-explainer').innerHTML=state.view==='heatmap'?'면적 <b>시가총액</b><span>·</span>색상 <b>등락률</b>':'가로 <b>분야</b><span>·</span>세로 <b>등락률</b>';$('#chart-stage').setAttribute('aria-label',state.view==='heatmap'?'히트맵 차트':'버블 차트');hideTooltip();if(currentItems.length){if(state.view==='heatmap')drawHeatmap();else drawBubbles();}renderSelection();}
function reset(){Object.assign(state,{country:'all',sector:'all',period:'1d',query:'',selected:null});$('#search').value='';$('#country').value='all';render();}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;render();}));$$('[data-period]').forEach(b=>b.addEventListener('click',()=>{state.period=b.dataset.period;render();}));$('#search').addEventListener('input',e=>{state.query=e.target.value;render();});$('#country').addEventListener('change',e=>{state.country=e.target.value;render();});$('#reset').addEventListener('click',reset);$('#empty-reset').addEventListener('click',reset);$('#overview').addEventListener('click',()=>setSector('all'));root.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes((root.activeElement?.tagName??''))){e.preventDefault();$('#search').focus();}if(e.key==='Escape'){state.selected=null;renderSelection();$$('.tile,.bubble-node').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});hideTooltip();}});new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(currentItems.length){if(state.view==='heatmap')drawHeatmap();else drawBubbles();}});}).observe($('#chart-stage'));render();

// Routes hide rather than unmount the map, keeping its filters and selected company.
window.renderHomeMap = () => requestAnimationFrame(render);
stylesheet.addEventListener('load', render);

// Keep the visible shortcut usable before the map receives focus.
document.addEventListener('keydown', event => {
  if (host.hidden || event.defaultPrevented || event.key !== '/') return;
  const active = root.activeElement || document.activeElement;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(active?.tagName) || active?.isContentEditable) return;
  event.preventDefault();
  $('#search').focus();
});
