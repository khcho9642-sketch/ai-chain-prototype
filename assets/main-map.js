import {SECTORS,COMPANIES,getReturn,filterCompanies,treemap,bubbleLayout} from './main-map-engine.js';
const root=typeof document!=='undefined'?document.getElementById('v-home'):null;
const $=s=>root?.querySelector(s)??null, $$=s=>root?[...root.querySelectorAll(s)]:[];
const state={view:typeof location!=='undefined'&&new URLSearchParams(location.search).get('view')==='bubble'?'bubble':'heatmap',country:'all',sector:'all',period:'1d',query:'',selected:null};
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
function renderChips(){const container=$('#main-map-sector-chips');container.replaceChildren();for(const s of [{name:'전체',id:'all'},...SECTORS]){const b=document.createElement('button'),value=s.id==='all'?'all':s.name;b.className=state.sector===value?'active':'';b.setAttribute('aria-pressed',String(state.sector===value));if(s.color){const dot=document.createElement('span');dot.className='sector-dot';dot.style.setProperty('--sector',s.color);b.append(dot);}b.append(document.createTextNode(s.name));b.addEventListener('click',()=>setSector(value));container.append(b);}}
function selectCompany(company){state.selected=state.selected===company.id?null:company.id;renderSelection();$$('.tile,.bubble-node').forEach(e=>{const selected=e.dataset.id===state.selected;e.classList.toggle('selected',selected);e.setAttribute('aria-pressed',String(selected));});hideTooltip();}
function renderSelection(){const el=$('#main-map-selection'),c=currentItems.find(c=>c.id===state.selected);el.hidden=!c;if(!c)return;const r=getReturn(c,state.period);el.replaceChildren();const title=document.createElement('div');title.className='selected-title';const name=document.createElement('div');const b=document.createElement('b');b.textContent=c.ticker;name.append(b,document.createTextNode('  '+c.name));const sub=document.createElement('small');sub.textContent=`${c.sector} · ${COUNTRY_NAMES[c.country]??c.country}`;name.append(sub);title.append(name);const data=document.createElement('div');data.className='selection-data';const cap=document.createElement('span');cap.textContent=`시가총액 ${capText(c.cap)}`;const change=document.createElement('span');change.className=pctClass(r);change.textContent=`${periodName()} ${sign(r)}`;data.append(cap,change);const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','기업 선택 닫기');close.addEventListener('click',()=>{state.selected=null;renderSelection();$$('.tile,.bubble-node').forEach(e=>{e.classList.remove('selected');e.setAttribute('aria-pressed','false');});});el.append(title,data,close);}
function showTooltip(c,e){if(matchMedia('(max-width:760px)').matches)return;const tooltip=$('#main-map-tooltip'),r=getReturn(c,state.period);tooltip.replaceChildren();const title=document.createElement('strong');title.textContent=`${c.ticker} · ${c.name}`;const sub=document.createElement('small');sub.textContent=`${c.sector} / ${COUNTRY_NAMES[c.country]??c.country}`;const vals=document.createElement('div');vals.className='tooltip-values';const cap=document.createElement('span');cap.textContent=capText(c.cap);const val=document.createElement('b');val.className=pctClass(r);val.textContent=sign(r);vals.append(cap,val);tooltip.append(title,sub,vals);tooltip.hidden=false;const bounds=$('#main-map-chart-stage').getBoundingClientRect();const x=Math.min(Math.max(8,e.clientX-bounds.left+15),bounds.width-tooltip.offsetWidth-8),y=Math.min(Math.max(8,e.clientY-bounds.top+15),bounds.height-tooltip.offsetHeight-8);tooltip.style.left=`${x}px`;tooltip.style.top=`${y}px`;}
function hideTooltip(){$('#main-map-tooltip').hidden=true;}
function wireCompany(el,c){el.dataset.id=c.id;el.setAttribute('aria-label',`${c.name} ${c.ticker}, ${c.sector}, ${periodName()} ${sign(getReturn(c,state.period))}, 시가총액 ${capText(c.cap)}`);el.setAttribute('aria-pressed',String(state.selected===c.id));el.classList.toggle('selected',state.selected===c.id);el.addEventListener('click',()=>selectCompany(c));el.addEventListener('pointermove',e=>showTooltip(c,e));el.addEventListener('pointerleave',hideTooltip);el.addEventListener('blur',hideTooltip);}
function drawHeatmap(){const host=$('#main-map-heatmap'),{width,height}=$('#main-map-chart-stage').getBoundingClientRect();host.replaceChildren();if(!width||!height)return;const groups=SECTORS.map(s=>({...s,companies:currentItems.filter(c=>c.sector===s.name)})).filter(s=>s.companies.length);const layouts=treemap(groups,0,0,width,height,s=>s.companies.reduce((sum,c)=>sum+c.cap,0));for(const g of layouts){const group=document.createElement('div');group.className='sector-group';Object.assign(group.style,{left:g.x+'px',top:g.y+'px',width:g.w+'px',height:g.h+'px'});const innerWidth=Math.max(0,g.w-4),innerHeight=Math.max(0,g.h-4),boxes=treemap(g.data.companies,0,0,innerWidth,innerHeight,c=>c.cap);for(const box of boxes){const c=box.data,r=getReturn(c,state.period),tile=document.createElement('button');tile.type='button';tile.className='tile';Object.assign(tile.style,{left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'});tile.style.setProperty('--tile-color',returnColor(r));wireCompany(tile,c);const available=box.h-(box.y<23?23:0);if(box.w>29&&available>23){const font=Math.max(9,Math.min(29,(box.w-8)/textUnits(labelFor(c)),available/3.7));if(box.w>130&&available>95){const name=document.createElement('span');name.className='company-name';name.textContent=c.name;tile.append(name);}const ticker=document.createElement('span');ticker.className='ticker';ticker.style.fontSize=font+'px';ticker.textContent=labelFor(c);const val=document.createElement('span');val.className='return';val.style.fontSize=Math.max(8,Math.min(18,font*.67))+'px';val.textContent=sign(r);tile.append(ticker,val);if(box.y<23)tile.style.paddingTop='21px';}group.append(tile);}const heading=document.createElement('button');heading.className='sector-heading';heading.title=g.data.name;heading.setAttribute('aria-label',`${g.data.name} 분야 확대`);heading.textContent=g.data.name;const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent=state.sector==='all'?'↗':'↙';heading.append(arrow);heading.addEventListener('click',()=>setSector(state.sector==='all'?g.data.name:'all'));group.append(heading);host.append(group);}host.classList.remove('fade-in');requestAnimationFrame(()=>host.classList.add('fade-in'));}
function drawBubbles(){const stage=$('#main-map-chart-stage'),svg=$('#main-map-bubble-svg'),axis=$('#main-map-fixed-axis'),height=stage.clientHeight,width=Math.max(360,stage.clientWidth,state.sector==='all'?1040:stage.clientWidth);const layout=bubbleLayout(currentItems,width,height,{period:state.period,sector:state.sector});$('.scroll-hint').hidden=width<=stage.clientWidth+2;const p=layout.plotBounds,[min,max]=layout.yDomain;svg.replaceChildren();axis.replaceChildren();svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);axis.setAttribute('viewBox',`0 0 48 ${height}`);const yFor=v=>p.top+(max-v)/(max-min)*p.height;const rawStep=(max-min)/5,magnitude=10**Math.floor(Math.log10(rawStep)),step=([1,2,2.5,5,10].find(v=>v>=rawStep/magnitude)??10)*magnitude;const ticks=[];for(let value=Math.ceil(min/step)*step;value<=max+.0001;value+=step)ticks.push(value);for(const value of ticks){const y=yFor(value),isZero=Math.abs(value)<.001;svg.append(node('line',{x1:p.left,y1:y,x2:p.right,y2:y,stroke:isZero?'#607a91':'#233445','stroke-width':isZero?1:.6}));axis.append(node('text',{x:39,y:y+3,'text-anchor':'end',class:'axis-label'},`${value>0?'+':''}${value.toFixed(Math.abs(value)%1>.01?1:0)}%`));}if(min<0&&max>0&&!ticks.some(v=>Math.abs(v)<.001)){const y=yFor(0);svg.append(node('line',{x1:p.left,y1:y,x2:p.right,y2:y,stroke:'#607a91','stroke-width':1}));}
for(const center of layout.sectorCenters){svg.append(node('line',{x1:center.x,y1:p.top,x2:center.x,y2:p.bottom,stroke:'#1b2b3b','stroke-width':.6}));const label=node('text',{x:center.x,y:p.bottom+23,fill:center.color,class:'sector-axis-label',tabindex:0,role:'button','aria-label':`${center.sector} 분야 확대`});const parts=center.sector==='클라우드·GPU 컴퓨팅'?['클라우드·','GPU 컴퓨팅']:center.sector==='파운드리·패키징'?['파운드리·','패키징']:center.sector==='반도체 소부장'?['반도체','소부장']:[center.sector];for(let i=0;i<parts.length;i++)label.append(node('tspan',{x:center.x,dy:i?13:0},parts[i]));label.addEventListener('click',()=>setSector(state.sector==='all'?center.sector:'all'));label.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSector(state.sector==='all'?center.sector:'all');}});svg.append(label);}
for(const b of [...layout.nodes].sort((a,b)=>b.r-a.r)){const sector=SECTORS.find(s=>s.name===b.data.sector),g=node('g',{class:'bubble-node',tabindex:0,role:'button'});g.append(node('circle',{cx:b.x,cy:b.y,r:b.r,fill:sector?.color??'#6ba8e5','fill-opacity':.27,stroke:sector?.color??'#6ba8e5','stroke-width':1.2}));if(b.r>=14&&textUnits(labelFor(b.data))*7<=b.r*1.8){const label=node('text',{x:b.x,y:b.y-1,class:'bubble-label','font-size':Math.min(12,Math.max(8,b.r/2.5))},labelFor(b.data));label.style.fontSize=Math.min(12,b.r*1.8/textUnits(labelFor(b.data)))+'px';g.append(label);if(b.r>=21)g.append(node('text',{x:b.x,y:b.y+12,class:'bubble-label bubble-return'},sign(getReturn(b.data,state.period))));}wireCompany(g,b.data);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCompany(b.data);}});svg.append(g);}svg.classList.remove('fade-in');requestAnimationFrame(()=>svg.classList.add('fade-in'));}
function render(){if(!isVisible())return;let result=filterCompanies(COMPANIES,{country:state.country==='EU'?'all':state.country,sector:state.sector,query:state.query});if(state.country==='EU')result=result.filter(c=>['NL','DE','FR','GB','IE','CH'].includes(c.country));currentItems=result.filter(c=>Number.isFinite(c.cap)&&c.cap>0);if(!currentItems.some(c=>c.id===state.selected))state.selected=null;root.dataset.view=state.view;$$('[data-view]').forEach(b=>{const active=b.dataset.view===state.view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$$('[data-period]').forEach(b=>{const active=b.dataset.period===state.period;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});renderChips();$('#main-map-company-count').textContent=currentItems.length;$('#main-map-up-count').textContent=currentItems.filter(c=>getReturn(c,state.period)>0).length;$('#main-map-down-count').textContent=currentItems.filter(c=>getReturn(c,state.period)<0).length;$('#main-map-crumb-sector').textContent=state.sector==='all'?'':`/ ${state.sector}`;$('#main-map-heatmap').hidden=state.view!=='heatmap'||!currentItems.length;$('#main-map-bubble-chart').hidden=state.view!=='bubble'||!currentItems.length;$('#main-map-empty-state').hidden=!!currentItems.length;$('#main-map-return-legend').hidden=state.view!=='heatmap';$('#main-map-bubble-legend').hidden=state.view!=='bubble';$('#main-map-chart-explainer').innerHTML=state.view==='heatmap'?'면적 <b>시가총액</b><span>·</span>색상 <b>등락률</b>':'가로 <b>분야</b><span>·</span>세로 <b>등락률</b>';$('#main-map-chart-stage').setAttribute('aria-label',state.view==='heatmap'?'히트맵 차트':'버블 차트');hideTooltip();if(currentItems.length){if(state.view==='heatmap')drawHeatmap();else drawBubbles();}renderSelection();}
function reset(){Object.assign(state,{country:'all',sector:'all',period:'1d',query:'',selected:null});$('#main-map-search').value='';$('#main-map-country').value='all';render();}

let connected=false;
let observer=null;
function isVisible(){return Boolean(root&&!root.hidden&&root.isConnected);}
function isHomeRoute(){
  if(typeof location==='undefined')return false;
  const route=location.hash.replace(/^#/,'').split('/')[0];
  return route===''||route==='home';
}
function scheduleRender(){
  cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{if(isVisible())render();});
}
function handleKeyboard(event){
  if(event.defaultPrevented||!isHomeRoute()||!isVisible())return;
  const target=event.target;
  const editing=target instanceof Element&&(target.matches('input,select,textarea')||target.isContentEditable);
  if(event.key==='/'&&!editing&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    event.preventDefault();
    $('#main-map-search').focus();
  }
  if(event.key==='Escape'&&(!editing||root.contains(target))){
    state.selected=null;
    renderSelection();
    $$('.tile,.bubble-node').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
    hideTooltip();
  }
}
/** Attach once. Repeated calls preserve filters, period, selected company, and view. */
export function mountMainMap(){
  if(!root||!$('#main-map-chart-stage'))return false;
  if(!connected){
    connected=true;
    $$('[data-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.view;render();}));
    $$('[data-period]').forEach(button=>button.addEventListener('click',()=>{state.period=button.dataset.period;render();}));
    $('#main-map-search').addEventListener('input',event=>{state.query=event.target.value;render();});
    $('#main-map-country').addEventListener('change',event=>{state.country=event.target.value;render();});
    $('#main-map-reset').addEventListener('click',reset);
    $('#main-map-empty-reset').addEventListener('click',reset);
    $('#main-map-overview').addEventListener('click',()=>setSector('all'));
    document.addEventListener('keydown',handleKeyboard);
    window.addEventListener('hashchange',()=>{
      if(isVisible())scheduleRender();
      else hideTooltip();
    });
    if(typeof ResizeObserver!=='undefined'){
      observer=new ResizeObserver(()=>{if(isVisible())scheduleRender();});
      observer.observe($('#main-map-chart-stage'));
    }else window.addEventListener('resize',()=>{if(isVisible())scheduleRender();});
  }
  if(isVisible())scheduleRender();
  return true;
}
mountMainMap();
