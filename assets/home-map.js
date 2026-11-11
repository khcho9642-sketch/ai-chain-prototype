import { realtimeEnabled, staticHost } from './site-runtime.js'
import {DISPLAY_SECTORS,SECTORS,getReturn,filterCompanies,treemap,bubbleLayout} from './home-map-core.js';
import { instruments } from './instruments.js';
import { companyHrefForTicker } from './company-links.js';
import { focusCompanies } from './home-focus.js';
import { MARKET_DATA_POLICY } from './market-data-policy.js';
import { buildSectorReturns } from './home-performance.js';
import { buildActualMap, buildMapCatalogue } from './home-map-data.js';
import { MAP_UNIVERSE } from './home-map-universe.js';
import { validateRippleSnapshot, rippleMatchesSelection } from './ripple-core.js';

const autoRefreshEnabled = realtimeEnabled && MARKET_DATA_POLICY.autoRefreshEnabled
const liveRequestsEnabled = realtimeEnabled && MARKET_DATA_POLICY.liveRequestsEnabled
const collectionEnabled = realtimeEnabled && MARKET_DATA_POLICY.collectionEnabled
const MAP_CATALOGUE = buildMapCatalogue();
const MAP_LISTED_COUNT = MAP_CATALOGUE.filter(company => company.listed).length;
const MAP_PRIVATE_COUNT = MAP_CATALOGUE.length - MAP_LISTED_COUNT;
const host = document.getElementById('v-home');
const root = host.attachShadow({mode:'open'});
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('./home-map.css', import.meta.url).href;
root.append(stylesheet);
const content = document.createElement('div');
content.innerHTML = `<div class="map-main">
    <section class="intro" aria-label="시장 지도">
      <div class="home-title-row"><div class="home-title-copy"><div class="eyebrow">THE AI ECONOMY, AT A GLANCE</div><h1>AI 시장 지도<span>.</span></h1></div></div>
      <div class="home-intro-meta"><p>반도체에서 모델까지, AI 산업의 움직임을 한눈에.</p><div class="home-badges"><span class="home-badge" data-home-market-policy>${MARKET_DATA_POLICY.statusLabel}</span><span class="home-badge" data-home-close-date>종가 수집 확인 중</span><span class="home-badge" data-home-coverage>원장 확인 중 · 핵심 ${MAP_CATALOGUE.length}개</span></div></div>
    </section>
    <section id="home-sector-summary" class="home-sector-summary" aria-label="AI 밸류체인 업종별 수익률">
      <div class="sector-summary-heading"><div><h2>업종별 수익률</h2><p data-home-card-caption>선정 ${MAP_CATALOGUE.length}개 중 상장 ${MAP_LISTED_COUNT}개의 최근 90일 종가 수익률</p></div><div class="home-summary-controls"><label class="home-card-period-label">기간 <select aria-label="업종 수익률 기간" data-home-card-period><option value="1d">1일</option><option value="1w">1주</option><option value="1m">1개월</option><option value="3mo" selected>3개월</option><option value="1y">1년</option></select></label><div class="home-weight-switch" role="group" aria-label="업종별 수익률 가중 방식"><button type="button" data-home-weight="eq" aria-pressed="true">동일가중</button><button type="button" data-home-weight="cap" aria-pressed="false">시총가중</button></div></div></div>
      <p class="sector-summary-meta" data-home-summary-meta role="status">수집된 종가를 확인하고 있습니다.</p>
      <div class="sector-summary-grid" data-home-sector-cards role="group" aria-label="${DISPLAY_SECTORS.length}개 섹터 선택"></div>
      <p class="sector-summary-status" data-home-summary-status hidden></p>
      <details class="sector-summary-details"><summary>계산 기준·구성 종목 보기</summary><p class="sector-methodology">선정표의 ${MAP_CATALOGUE.length}개 기업 중 상장 ${MAP_LISTED_COUNT}개의 현지통화 종가 수익률을 평균합니다. 시총가중은 기간 시작일 시총을 확인할 수 있는 종목만 사용합니다. 비상장 ${MAP_PRIVATE_COUNT}개는 이름과 역할을 별도 표시하고 시총·수익률 계산에서 제외합니다. 배당 재투자와 환율 변동은 제외하며 결측을 0으로 채우지 않습니다. 아래 지도의 크기는 최근 관측 시총 USD, 색상은 확정 종가 수익률입니다. <a data-home-selection-source target="_blank" rel="noopener noreferrer" hidden>선정표 보기 ↗</a></p><div class="sector-member-groups" data-home-sector-members></div></details>
    </section>
    <section id="home-ripple" class="home-ripple" aria-labelledby="ripple-title">
      <div class="ripple-heading"><div><p class="ripple-eyebrow">TODAY'S CO-MOVEMENT</p><h2 id="ripple-title">오늘의 파급</h2></div><div class="ripple-chips" data-ripple-chips role="group" aria-label="크게 움직인 기업 선택"></div></div>
      <p class="ripple-status" data-ripple-status role="status">종가와 함께 움직인 종목을 확인하고 있습니다.</p>
      <div class="ripple-time" data-ripple-time></div>
      <div class="ripple-flow" data-ripple-flow></div>
      <p class="ripple-foot">같은 날 함께 움직인 종목 · 인과관계 아님 · 동조율 = 최근 60거래일 중 트리거 ±2% 이상인 날 같은 방향 비율</p>
    </section>
    <section class="workspace" aria-label="기업 지도 탐색">
      <div class="toolbar">
        <div class="view-switch" role="group" aria-label="지도 보기 방식">
          <button class="active" data-view="heatmap" aria-pressed="true"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 2h8v8H2zM12 2h4v8h-4zM2 12h5v4H2zM9 12h7v4H9z"/></svg>히트맵</button>
          <button data-view="bubble" aria-pressed="false"><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="6" cy="6" r="4"/><circle cx="12.5" cy="11.5" r="3.5"/><circle cx="4" cy="14" r="2"/></svg>버블</button>
        </div>
        <div class="search-wrap"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="search" type="search" aria-label="기업명 또는 티커 검색" placeholder="기업명 · 티커 검색" autocomplete="off"><kbd>/</kbd></div>
        <div class="country-wrap"><label for="country">국가</label><select id="country" aria-label="국가"><option value="all">전체 국가</option></select></div>
        <div class="period-switch" role="group" aria-label="수익률 기간"><button data-period="1d" class="active" aria-pressed="true">1일</button><button data-period="1w" aria-pressed="false">1주</button><button data-period="1m" aria-pressed="false">1개월</button><button data-period="1y" aria-pressed="false">1년</button></div>
      </div>
      <div class="sector-row"><div class="sector-chips" id="sector-chips" role="group" aria-label="분야 선택"></div><button class="reset" id="reset" aria-label="조회 조건 초기화"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 6a6 6 0 1 1-.2 5M3 2v4h4"/></svg><span>초기화</span></button></div>
      <div class="chart-data-note map-breadth"><span class="data-label">확정 종가</span><span data-map-coverage>지도 선정 ${MAP_CATALOGUE.length} · 상장 ${MAP_LISTED_COUNT} · 비상장 ${MAP_PRIVATE_COUNT} · 수집 확인 중</span><span>상장 표시 <b id="company-count">—</b>개</span><span class="positive">상승 <b id="up-count">—</b></span><span class="negative">하락 <b id="down-count">—</b></span></div>
      <p class="map-data-status" id="map-data-status" role="status">시총과 확정 종가를 확인하고 있습니다.</p>
      <details class="map-data-details" id="map-data-details" hidden><summary>미반영·수집 상태 보기</summary><ul id="map-exclusions"></ul></details>
      <section class="map-private-roster" data-map-private aria-labelledby="map-company-news-heading" hidden><div class="map-private-heading"><h2 id="map-company-news-heading">핵심기업 최신 소식</h2><p>2026.11.09 확인</p></div><div class="map-private-grid" data-map-private-cards></div></section>
      <div class="chart-meta"><div class="breadcrumb"><button id="overview">전체 산업</button><span id="crumb-sector"></span></div><div id="chart-explainer">크기: <b>최근 관측 시총 USD</b><span>·</span>색상: <b>확정 종가 등락률</b></div></div>
      <div class="chart-stage" id="chart-stage" aria-label="히트맵 차트">
        <div class="heatmap" id="heatmap"></div>
        <div class="bubble-chart" id="bubble-chart" hidden><div class="bubble-scroll" id="bubble-scroll"><svg id="bubble-svg" role="group" aria-label="분야별 기업 등락률과 시가총액 버블 차트"></svg></div><svg class="fixed-axis" id="fixed-axis" aria-hidden="true"></svg><span class="scroll-hint">좌우로 밀어 분야를 살펴보세요 →</span></div>
        <div class="empty-state" id="empty-state" hidden><div class="empty-icon">⌕</div><h2>시총과 종가를 확인하고 있어요</h2><p>확인된 자료가 준비되면 지도에 표시합니다.</p><button id="empty-reset">조건 초기화</button></div>
        <div class="tooltip" id="tooltip" role="status" hidden></div>
      </div>
      <div class="chart-footer"><span id="chart-hint"><span class="hint-dot"></span>분야 확대·기업 검색으로 작은 기업 찾기 · 기업을 누르면 정보 확인</span><button type="button" class="map-zoom" id="map-zoom" aria-pressed="false">지도 확대</button><div class="return-legend" id="return-legend"><span>−3%</span><div class="gradient"></div><span>0</span><div class="gradient positive-gradient"></div><span>+3%</span><span class="missing-legend">회색 — 미확보</span></div><span id="bubble-legend" hidden>가로: 분야 · 세로·색상: 확정 종가 등락률 · 면적: 최근 관측 시총 USD</span></div>
      <aside class="selection" id="selection" aria-label="선택 기업 정보" hidden></aside>
    </section>
    <footer class="page-footer"><span>AI VALUE CHAIN</span><p>크기: 최근 관측 시총 USD · 색상: 확정 종가 등락률. 기업별 시총·환율과 종가의 기준일은 다를 수 있습니다.</p><span class="footer-note">9개 분야 · 지도 선정 ${MAP_CATALOGUE.length}개</span></footer>
</div>`;
root.append(content);
const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
const state={view:new URLSearchParams(location.search).get('view')==='bubble'?'bubble':'heatmap',country:'all',sector:'all',period:'1d',query:'',selected:null,zoom:1};
let marketSnapshot = window.aiChainSnapshot || null;
let marketError = '';
let weightMode = 'eq';
let summaryPeriod = '3mo';
try { if (localStorage.getItem('ai-chain.home-weight.v1') === 'cap') weightMode = 'cap'; } catch {}
let rippleSnapshot = null, rippleError = '', rippleBusy = false, rippleAttempted = false, selectedRipple = null, rippleRequest = 0;
const sectorCardNodes = new Map();
const COUNTRY_NAMES={US:'미국',KR:'한국',TW:'대만',JP:'일본',CN:'중국',NL:'네덜란드',DE:'독일',FR:'프랑스',GB:'영국',IE:'아일랜드',CH:'스위스',HK:'홍콩',SG:'싱가포르',MY:'말레이시아',BE:'벨기에',IL:'이스라엘',IN:'인도',TH:'태국',AU:'호주',AT:'오스트리아',CA:'캐나다',FI:'핀란드',DK:'덴마크',BR:'브라질',SE:'스웨덴',ES:'스페인',IT:'이탈리아',ZA:'남아프리카공화국',NZ:'뉴질랜드',BH:'바레인',VN:'베트남',SA:'사우디아라비아',ID:'인도네시아',QA:'카타르',TR:'튀르키예',PH:'필리핀',RU:'러시아',AE:'아랍에미리트'};
const EUROPE_COUNTRIES = new Set(['NL','DE','FR','GB','IE','CH','BE','AT','FI','DK','SE','ES','IT']);
const SEARCH_NAMES = new Map(instruments.map(instrument => [instrument.symbol, instrument.name]));
const NS='http://www.w3.org/2000/svg';
let currentItems=[],resizeFrame=0;
const sign=v=>v==null?'—':`${v>0?'+':''}${v.toFixed(2)}%`;
const capText=cap=>cap>=1000?`$${(cap/1000).toFixed(2)}조`:`$${(cap*10).toLocaleString('ko-KR',{maximumFractionDigits:0})}억`;
const pctClass=v=>v>0?'positive':v<0?'negative':'';
const labelFor=c=>/^\d/.test(c.ticker)?c.name:c.ticker;
const textUnits=s=>Array.from(s).reduce((n,ch)=>n+(ch.codePointAt(0)>127?1:.64),0);
const periodName=()=>({'1d':'1일','1w':'1주','1m':'1개월','1y':'1년'}[state.period]);
function node(tag,attrs={},content){const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(content!=null)el.textContent=content;return el;}
function returnColor(v){if(v==null)return '#4e5967';const start=[51,68,83],end=v>0?[21,122,80]:[164,57,72],t=Math.min(Math.abs(v)/3,1);return `rgb(${start.map((n,i)=>Math.round(n+(end[i]-n)*t)).join(',')})`;}
const mapModels = new WeakMap();
let mapBuildError = '';
function actualMapModel() {
  if (!marketSnapshot || typeof marketSnapshot !== 'object') return null;
  try {
    const minute = Math.floor(Date.now() / 60000);
    let cached = mapModels.get(marketSnapshot);
    if (!cached || cached.minute !== minute) { cached = { minute, periods: new Map() }; mapModels.set(marketSnapshot, cached); }
    if (!cached.periods.has(state.period)) cached.periods.set(state.period, buildActualMap({ snapshot: marketSnapshot, companies: MAP_CATALOGUE, period: state.period }));
    mapBuildError = '';
    return cached.periods.get(state.period);
  } catch {
    mapBuildError = '지도 자료의 기준과 단위를 확인하지 못했습니다.';
    return null;
  }
}
function filterMapCompanies(companies) {
  let result = filterCompanies(companies, { country: 'all', sector: state.sector, query: '' });
  if (state.country !== 'all') result = result.filter(company => {
    const countries = company.countryCodes?.length ? company.countryCodes : [company.country];
    return countries.some(country => state.country === 'EU' ? EUROPE_COUNTRIES.has(country) : country === state.country);
  });
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const terms = state.query.trim().split(/\s+/).filter(Boolean).map(normalize);
  if (terms.length) result = result.filter(company => {
    const tickers = [company.ticker, company.primaryTicker, ...(company.candidateTickers || [])];
    const searchable = normalize([company.id, company.name, company.englishName, company.ticker, company.primaryTicker, company.sector, company.countryName,
      ...tickers.map(ticker => SEARCH_NAMES.get(ticker)),
      ...(company.aliases || []), ...(company.candidateTickers || []), ...(company.listings || []).map(listing => listing.ticker)].join(' '));
    return terms.every(term => searchable.includes(term));
  });
  return result;
}
function renderCountryOptions() {
  const names = new Map();
  for (const company of MAP_CATALOGUE) for (const country of company.countryCodes?.length ? company.countryCodes : [company.country]) {
    if (country) names.set(country, COUNTRY_NAMES[country] || company.countryName || country);
  }
  const select = $('#country');
  select.replaceChildren();
  for (const [value, label] of [['all', '전체 국가'], ...[...names].sort((a, b) => a[1].localeCompare(b[1], 'ko')), ['EU', '유럽 전체']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }
  select.value = state.country;
}
function observedLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '미확보';
  return value.length > 10 ? `${value.slice(0, 16).replace('T', ' ')}${value.endsWith('Z') ? ' UTC' : ''}` : value;
}
function provenanceLines(company) {
  const comparisonDate = company.returnDates?.[state.period]?.startDate || (state.period === '1d' ? company.previousCloseDate : null);
  const lines = [
    `확정 종가 ${company.closeDate || '미확보'}${company.timezone ? ` (${company.timezone})` : ''}${comparisonDate ? ` · 비교 종가 ${comparisonDate}` : ''}`,
    `시총 관측 ${observedLabel(company.capObservedAt)} · ${company.capSource || company.source || '출처 미확보'}`,
    company.capCurrency === 'USD' ? '시총 원통화 USD · 환산 불필요' : `시총 원통화 ${company.capCurrency || '미확보'} → USD · 환율 ${company.fxDate || '미확보'}${company.fxSource ? ` · ${company.fxSource}` : ''}`,
    `종가 출처 ${company.source || '미확보'} · 수집 ${observedLabel(company.fetchedAt)}`,
  ];
  if (getReturn(company, state.period) == null) lines.push(`${periodName()} 등락률 미확보 · ${company.returnReasons?.[state.period] || '비교할 확정 종가가 부족합니다.'}`);
  if (company.stale || company.status === 'stale' || company.capStatus === 'stale') lines.push('이전 수집값 · 최신 자료 수집 상태를 확인해 주세요.');
  if (company.error) lines.push(`수집 상태 · ${company.error}`);
  if (company.capError) lines.push(`시총 수집 상태 · ${company.capError}`);
  if (company.identityStatus === 'unverified') lines.push('종목 연결 검토 중 · 기업과 시세 종목의 연결을 확인하고 있습니다.');
  if (marketError) lines.push('최신 파일 조회 실패 · 마지막으로 확인한 자료를 표시합니다.');
  return lines;
}
function appendProvenance(container, company, className) {
  const block = document.createElement('div'); block.className = className;
  for (const line of provenanceLines(company)) block.append(htmlElement('small', '', line));
  if (className === 'selection-provenance') {
    const links = htmlElement('div', 'selection-source-links');
    const seen = new Set();
    for (const [label, value] of [['종가·시총 출처', company.sourceUrl], ['시총 출처', company.capSourceUrl], ['환율 출처', company.fxSourceUrl]]) {
      if (!value || seen.has(value)) continue;
      let url; try { url = new URL(value); } catch { continue; }
      if (!['https:', 'http:'].includes(url.protocol)) continue;
      const link = htmlElement('a', '', label); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      links.append(link); seen.add(value);
    }
    if (links.childNodes.length) block.append(links);
  }
  container.append(block);
}
function setSector(name){state.sector=name;render();}
function renderChips(){const container=$('#sector-chips');container.replaceChildren();for(const s of [{name:'전체',id:'all'},...DISPLAY_SECTORS]){const b=document.createElement('button'),value=s.id==='all'?'all':s.name;b.className=state.sector===value?'active':'';b.setAttribute('aria-pressed',String(state.sector===value));if(s.color){const dot=document.createElement('span');dot.className='sector-dot';dot.style.setProperty('--sector',s.color);b.append(dot);}b.append(document.createTextNode(s.name));b.addEventListener('click',()=>setSector(value));container.append(b);}}
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
  const cap=document.createElement('span');cap.textContent=`최근 관측 시총 ${capText(c.cap)} USD`;
  const change=document.createElement('span');change.className=pctClass(r);change.textContent=`${periodName()} ${sign(r)}`;
  data.append(cap,change);
  const actions=document.createElement('div');actions.className='selection-actions';
  const companyHref = companyHrefForTicker(c.ticker);
  if (companyHref) {
    const info = document.createElement('a');
    info.href = companyHref;
    info.textContent = '신기업정보';
    actions.append(info);
  }
  const quoteHref = companyHrefForTicker(c.ticker, 'quote');
  if (quoteHref) {
    const chart = document.createElement('a');
    chart.href = quoteHref;
    chart.textContent = '시세·차트 보기';
    actions.append(chart);
  } else {
    const chart = document.createElement('button');
    chart.type = 'button';
    chart.textContent = '시세·차트 보기';
    chart.addEventListener('click', () => window.dispatchEvent(new CustomEvent('market-symbol-open', { detail: { symbol: c.ticker } })));
    actions.append(chart);
  }
  if(instruments.some(item=>item.symbol===c.ticker&&item.chains.some(chain=>chain>0))){
    const talk=document.createElement('a');talk.href='#talk/'+encodeURIComponent(c.ticker);talk.textContent='종목 토론';actions.append(talk);
  }
  const today=document.createElement('a');today.href='#today';today.textContent='오늘의 변화';actions.append(today);
  const scenario=document.createElement('a');scenario.href='#scenario';scenario.textContent='시나리오 분석';actions.append(scenario);
  const close=document.createElement('button');close.type='button';close.className='selection-close';close.textContent='×';close.setAttribute('aria-label','기업 선택 닫기');
  close.addEventListener('click',()=>{state.selected=null;renderSelection();$$('.tile,.bubble-node').forEach(element=>{element.classList.remove('selected');element.setAttribute('aria-pressed','false');});});
  el.append(title,data,actions,close);
  appendProvenance(el,c,'selection-provenance');
}
function showTooltip(c,e){if(matchMedia('(max-width:720px)').matches)return;const tooltip=$('#tooltip'),r=getReturn(c,state.period);tooltip.replaceChildren();const title=document.createElement('strong');title.textContent=`${c.ticker} · ${c.name}`;const sub=document.createElement('small');sub.textContent=`${c.sector} / ${COUNTRY_NAMES[c.country]??c.country}`;const vals=document.createElement('div');vals.className='tooltip-values';const cap=document.createElement('span');cap.textContent=`최근 시총 ${capText(c.cap)} USD`;const val=document.createElement('b');val.className=pctClass(r);val.textContent=`${periodName()} ${sign(r)}`;vals.append(cap,val);tooltip.append(title,sub,vals);appendProvenance(tooltip,c,'tooltip-provenance');tooltip.hidden=false;const bounds=$('#chart-stage').getBoundingClientRect();const x=Math.max(8,Math.min(e.clientX-bounds.left+15,bounds.width-tooltip.offsetWidth-8)),y=Math.max(8,Math.min(e.clientY-bounds.top+15,bounds.height-tooltip.offsetHeight-8));tooltip.style.left=`${x}px`;tooltip.style.top=`${y}px`;}
function hideTooltip(){$('#tooltip').hidden=true;}
function wireCompany(el,c){el.dataset.id=c.id;el.dataset.ticker=c.ticker;el.dataset.closeDate=c.closeDate||'';el.dataset.capUsd=String(c.capUSD);el.dataset.return=getReturn(c,state.period)??'';el.setAttribute('aria-label',`${c.name} ${c.ticker}, ${c.sector}, ${periodName()} ${getReturn(c,state.period)==null?'등락률 미확보':sign(getReturn(c,state.period))}, 최근 관측 시가총액 ${capText(c.cap)} USD, 종가 기준 ${c.closeDate||'미확보'}`);el.setAttribute('aria-pressed',String(state.selected===c.id));el.classList.toggle('selected',state.selected===c.id);el.addEventListener('click',()=>selectCompany(c));el.addEventListener('pointermove',e=>showTooltip(c,e));el.addEventListener('pointerleave',hideTooltip);el.addEventListener('blur',hideTooltip);}
function drawHeatmap(){const host=$('#heatmap'),bounds=$('#chart-stage').getBoundingClientRect(),width=bounds.width*state.zoom,height=bounds.height*state.zoom;host.replaceChildren();host.classList.toggle('is-zoomed',state.zoom>1);if(!width||!height)return;const groups=DISPLAY_SECTORS.map(s=>({...s,companies:currentItems.filter(c=>c.sector===s.name)})).filter(s=>s.companies.length);const layouts=treemap(groups,0,0,width,height,s=>s.companies.reduce((sum,c)=>sum+c.cap,0));for(const g of layouts){const group=document.createElement('div');group.className='sector-group';Object.assign(group.style,{left:g.x+'px',top:g.y+'px',width:g.w+'px',height:g.h+'px'});const innerWidth=Math.max(0,g.w-4),innerHeight=Math.max(0,g.h-4),boxes=treemap(g.data.companies,0,0,innerWidth,innerHeight,c=>c.cap);for(const box of boxes){const c=box.data,r=getReturn(c,state.period),tile=document.createElement('button');tile.type='button';tile.className='tile';Object.assign(tile.style,{left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'});tile.style.setProperty('--tile-color',returnColor(r));wireCompany(tile,c);const available=box.h-(box.y<23?23:0);if(box.w>29&&available>23){const font=Math.max(9,Math.min(29,(box.w-8)/textUnits(labelFor(c)),available/3.7));if(box.w>130&&available>95){const name=document.createElement('span');name.className='company-name';name.textContent=c.name;tile.append(name);}const ticker=document.createElement('span');ticker.className='ticker';ticker.style.fontSize=font+'px';ticker.textContent=labelFor(c);const val=document.createElement('span');val.className='return';val.style.fontSize=Math.max(8,Math.min(18,font*.67))+'px';val.textContent=sign(r);tile.append(ticker,val);if(box.y<23)tile.style.paddingTop='21px';}group.append(tile);}const heading=document.createElement('button');heading.className='sector-heading';heading.title=g.data.name;heading.setAttribute('aria-label',`${g.data.name} 분야 확대`);heading.textContent=g.data.name;const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent=state.sector==='all'?'↗':'↙';heading.append(arrow);heading.addEventListener('click',()=>setSector(state.sector==='all'?g.data.name:'all'));group.append(heading);host.append(group);}host.classList.remove('fade-in');requestAnimationFrame(()=>host.classList.add('fade-in'));}
function drawBubbles(){const stage=$('#chart-stage');if(!stage.clientWidth||!stage.clientHeight)return;const svg=$('#bubble-svg'),axis=$('#fixed-axis'),height=stage.clientHeight,width=Math.max(stage.clientWidth,state.sector==='all'?1040:stage.clientWidth);const layout=bubbleLayout(currentItems,width,height,{period:state.period,sector:state.sector});const p=layout.plotBounds,[min,max]=layout.yDomain;svg.replaceChildren();axis.replaceChildren();svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);axis.setAttribute('viewBox',`0 0 48 ${height}`);const yFor=v=>p.top+(max-v)/(max-min)*p.height;const rawStep=(max-min)/5,magnitude=10**Math.floor(Math.log10(rawStep)),step=([1,2,2.5,5,10].find(v=>v>=rawStep/magnitude)??10)*magnitude;const ticks=[];for(let value=Math.ceil(min/step)*step;value<=max+.0001;value+=step)ticks.push(value);for(const value of ticks){const y=yFor(value),isZero=Math.abs(value)<.001;svg.append(node('line',{x1:p.left,y1:y,x2:p.right,y2:y,stroke:isZero?'#607a91':'#233445','stroke-width':isZero?1:.6}));axis.append(node('text',{x:39,y:y+3,'text-anchor':'end',class:'axis-label'},`${value>0?'+':''}${value.toFixed(Math.abs(value)%1>.01?1:0)}%`));}if(min<0&&max>0&&!ticks.some(v=>Math.abs(v)<.001)){const y=yFor(0);svg.append(node('line',{x1:p.left,y1:y,x2:p.right,y2:y,stroke:'#607a91','stroke-width':1}));}
for(const center of layout.sectorCenters){svg.append(node('line',{x1:center.x,y1:p.top,x2:center.x,y2:p.bottom,stroke:'#1b2b3b','stroke-width':.6}));const label=node('text',{x:center.x,y:p.bottom+23,fill:center.color,class:'sector-axis-label',tabindex:0,role:'button','aria-label':`${center.sector} 분야 확대`});const parts=center.sector==='클라우드·GPU 컴퓨팅'?['클라우드·','GPU 컴퓨팅']:center.sector==='파운드리·패키징'?['파운드리·','패키징']:center.sector==='반도체 소부장'?['반도체','소부장']:[center.sector];for(let i=0;i<parts.length;i++)label.append(node('tspan',{x:center.x,dy:i?13:0},parts[i]));label.addEventListener('click',()=>setSector(state.sector==='all'?center.sector:'all'));label.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSector(state.sector==='all'?center.sector:'all');}});svg.append(label);}
for(const b of [...layout.nodes].sort((a,b)=>b.r-a.r)){const color=returnColor(getReturn(b.data,state.period)),g=node('g',{class:'bubble-node',tabindex:0,role:'button'});g.append(node('circle',{cx:b.x,cy:b.y,r:b.r,fill:color,'fill-opacity':.7,stroke:color,'stroke-width':1.2}));if(b.r>=14&&textUnits(labelFor(b.data))*7<=b.r*1.8){const label=node('text',{x:b.x,y:b.y-1,class:'bubble-label','font-size':Math.min(12,Math.max(8,b.r/2.5))},labelFor(b.data));label.style.fontSize=Math.min(12,b.r*1.8/textUnits(labelFor(b.data)))+'px';g.append(label);if(b.r>=21)g.append(node('text',{x:b.x,y:b.y+12,class:'bubble-label bubble-return'},sign(getReturn(b.data,state.period))));}wireCompany(g,b.data);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCompany(b.data);}});svg.append(g);}svg.classList.remove('fade-in');requestAnimationFrame(()=>svg.classList.add('fade-in'));}
function htmlElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
// Official publications reviewed on 2026-11-09. Dates belong to the original sources.
const CORE_COMPANY_NEWS = {
  C0351: {
    date: '2026-11-06',
    title: 'Hacktron과 보안 협력 발표',
    summary: '외부 서비스와 연동되는 OpenAI 시스템의 취약점을 Hacktron과 함께 점검할 계획입니다.',
    url: 'https://openai.com/index/partnering-with-hacktron/',
  },
  C0037: {
    date: '2026-11-06',
    title: 'Claude 에이전트 메모리 연구 공개',
    summary: 'Claude가 이전 작업 기록을 검토해 기억을 정리하고 오류를 수정하는 방법과 실험 결과를 공개했습니다.',
    url: 'https://www.anthropic.com/research/components-of-agent-memory',
  },
  C0128: {
    date: '2026-10-17',
    title: 'V4.1-Flash-1017 출시',
    summary: '업데이트 모델을 웹·앱·API에 적용하고 웹 검색과 페이지 가져오기 API를 공개했습니다.',
    url: 'https://api-docs.deepseek.com/news/news261017/',
  },
  C0587: {
    date: '2026-11-05',
    correction: true,
    title: '마이크로소프트 GPU 공급 발표 정정',
    summary: '텍사스 700MW 2단계 증설에 마이크로소프트 옵션이 있다는 2025년 발표의 설명을 정정했습니다.',
    url: 'https://www.nscale.com/press-releases/nscale-microsoft-2025',
  },
};

function renderCoreCompanyNews(matchingCatalog) {
  const companies = matchingCatalog.filter(company => CORE_COMPANY_NEWS[company.id]);
  const section = $('[data-map-private]');
  const cards = $('[data-map-private-cards]');
  section.hidden = !companies.length;
  cards.replaceChildren();
  host.dataset.mapPrivateCount = companies.length;
  for (const company of companies) {
    const news = CORE_COMPANY_NEWS[company.id];
    const card = htmlElement('article', 'map-private-company');
    card.dataset.mapPrivateCompany = company.id;
    card.dataset.companyId = company.id;
    const name = htmlElement('h3', '', company.name);
    name.id = `map-private-${company.id}`;
    card.setAttribute('aria-labelledby', name.id);

    const meta = htmlElement('div', 'map-private-news-meta');
    const date = htmlElement('time', '', news.date.replaceAll('-', '.') + (news.correction ? ' 정정' : ''));
    date.dateTime = news.date;
    const source = htmlElement('a', 'map-private-news-source', '공식 원문 ↗');
    source.href = news.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.setAttribute('aria-label', `${company.name} 공식 원문 (새 창)`);
    meta.append(date, source);
    card.append(name, htmlElement('p', 'map-private-news-title', news.title),
      htmlElement('p', 'map-private-news-summary', news.summary), meta);
    cards.append(card);
  }
}
function shortDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5).replace('-', '.') : '—'; }
function marketName(value) { return ({KR:'한국',US:'미국',ETC:'기타 시장'})[value] || '기타 시장'; }
function summaryPeriodName() { return ({'1d':'최근 1거래일','1w':'최근 1주','1m':'최근 1개월','3mo':'최근 90일','1y':'최근 1년'})[summaryPeriod]; }
const summaryModels = new WeakMap();
function summaryModel() {
  if (!marketSnapshot) return null;
  try {
    let periods = summaryModels.get(marketSnapshot);
    if (!periods) { periods = new Map(); summaryModels.set(marketSnapshot, periods); }
    if (!periods.has(summaryPeriod)) periods.set(summaryPeriod, buildSectorReturns({ snapshot: marketSnapshot, companies: focusCompanies, period: summaryPeriod }));
    return periods.get(summaryPeriod);
  }
  catch { return null; }
}
function renderHeader() {
  const focusQuotes = focusCompanies.map(company => marketSnapshot?.quotes?.find(quote => quote.symbol === company.ticker));
  const dates = [...new Set(focusQuotes.filter(quote => quote?.priceBasis === 'previous-completed-session' && quote.closeDate).map(quote => quote.closeDate))].sort();
  const badge = $('[data-home-close-date]');
  const old = !!marketSnapshot && (Date.now() - Date.parse(marketSnapshot.generatedAt) > 96 * 3600000 || !!marketError || focusQuotes.some(quote => quote?.status === 'stale'));
  badge.textContent = dates.length ? `${shortDate(dates.at(-1))} 종가 기준${old ? ' · 이전 수집값' : ''}` : '확정 종가 수집 대기';
  badge.classList.toggle('is-stale', old);
  badge.title = dates.length ? `각 거래소 현지 종가 기준일: ${dates.join(', ')}` : '확정 종가를 수집한 뒤 기준일을 표시합니다.';
  const count = MAP_UNIVERSE.masterCompanyCount;
  $('[data-home-coverage]').textContent = `${Number.isInteger(count) && count > 0 ? '전체 ' + count.toLocaleString('ko-KR') + '개 기업' : '원장 확인 중'} · 핵심 ${MAP_CATALOGUE.length}개`;
}
function renderSectorSummary() {
  renderHeader();
  const model = summaryModel();
  $('[data-home-card-caption]').textContent = `선정 ${MAP_CATALOGUE.length}개 중 상장 ${MAP_LISTED_COUNT}개의 ${summaryPeriodName()} 종가 수익률`;
  const sourceLink = $('[data-home-selection-source]');
  sourceLink.hidden = !MAP_UNIVERSE.sourceUrl;
  if (MAP_UNIVERSE.sourceUrl) { sourceLink.href = MAP_UNIVERSE.sourceUrl; sourceLink.title = MAP_UNIVERSE.sourceSheet || '기업 선정표'; }
  const groups = new Map((model?.sectors || []).map(group => [group.sectorId, group]));
  $$('[data-home-weight]').forEach(button => {
    const active = button.dataset.homeWeight === weightMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const grid = $('[data-home-sector-cards]');
  if (!sectorCardNodes.size) {
    for (const [index, sector] of DISPLAY_SECTORS.entries()) {
      const button = htmlElement('button', 'sector-return-card');
      button.type = 'button';
      button.dataset.sector = sector.id;
      button.style.setProperty('--sector-color', sector.color);
      button.setAttribute('aria-controls', 'chart-stage');
      const identity = htmlElement('span', 'sector-return-identity');
      const name = htmlElement('span', 'sector-return-name');
      name.append(htmlElement('small', 'sector-return-step', String(index + 1).padStart(2, '0')), document.createTextNode(sector.name));
      const companies = MAP_CATALOGUE.filter(company => company.sectorId === sector.id);
      identity.append(name, htmlElement('span', 'sector-return-representatives', companies.slice(0, 2).map(company => company.name).join(' · ')));
      const value = htmlElement('strong', 'sector-return-value', '—');
      const gap = htmlElement('small', 'sector-return-gap');
      const coverage = htmlElement('small', 'sector-return-coverage');
      button.append(identity, value, gap, coverage);
      button.addEventListener('click', () => setSector(state.sector === sector.name ? 'all' : sector.name));
      grid.append(button);
      sectorCardNodes.set(sector.id, { button, value, gap, coverage });
    }
    const members = $('[data-home-sector-members]');
    for (const sector of DISPLAY_SECTORS) {
      const details = htmlElement('details', 'sector-member-group');
      const companies = MAP_CATALOGUE.filter(company => company.sectorId === sector.id);
      const listed = companies.filter(company => company.listed).length, privateCount = companies.length - listed;
      details.append(htmlElement('summary', '', `${sector.name} · 상장 ${listed}개${privateCount ? ` · 비상장 ${privateCount}개` : ''}`));
      const list = htmlElement('ul', 'sector-member-list');
      for (const company of companies) {
        const row = htmlElement('li');
        row.dataset.homeMember = company.id;
        const name = htmlElement('span', '', company.name);
        name.append(htmlElement('small', '', company.listed ? company.primaryTicker || company.ticker : '비상장 · 시총·수익률 계산 제외'));
        row.append(name);
        if (company.role) row.append(htmlElement('em', '', company.role));
        list.append(row);
      }
      details.append(list); members.append(details);
    }
  }
  let capMissing = false;
  for (const sector of DISPLAY_SECTORS) {
    const card = sectorCardNodes.get(sector.id), group = groups.get(sector.id);
    const value = weightMode === 'cap' ? group?.cap : group?.eq;
    card.button.setAttribute('aria-pressed', String(state.sector === sector.name));
    card.value.replaceChildren(document.createTextNode(Number.isFinite(value) ? sign(value) : '—'));
    card.value.className = 'sector-return-value' + (Number.isFinite(value) ? ' ' + pctClass(value) : '');
    if (weightMode === 'cap' && group?.capMissing) {
      const marker = htmlElement('small', 'sector-cap-marker', '*');
      marker.title = '기간 시작일 시총을 확인할 수 없는 종목은 제외했습니다.';
      marker.setAttribute('aria-label', marker.title);
      card.value.append(marker);
      capMissing = true;
    }
    const difference = Number.isFinite(group?.gap) ? group.gap : null;
    card.gap.textContent = difference !== null && Math.abs(difference) >= 3 ? difference < 0 ? '대형주 쏠림' : '중소형↑' : '';
    card.gap.hidden = !card.gap.textContent;
    const count = weightMode === 'cap' ? group?.capCount : group?.eqCount;
    const companies = MAP_CATALOGUE.filter(company => company.sectorId === sector.id);
    const total = companies.filter(company => company.listed).length, privateCount = companies.length - total;
    card.coverage.textContent = (Number.isInteger(count) ? `${count}/${total}개 반영` : `상장 ${total}개 · 종가 확인 중`) + (privateCount ? ` · 비상장 ${privateCount}개 별도` : '');
  }
  $('[data-home-summary-meta]').textContent = model ? `지도 선정 ${MAP_CATALOGUE.length}개 · 수익률 대상 상장 ${MAP_LISTED_COUNT}개 · ${summaryPeriodName()} · ${weightMode === 'cap' ? '기간 시작일 시총가중' : '동일가중'} · 카드를 누르면 아래 지도에서 보기` : `선정 ${MAP_CATALOGUE.length}개 중 상장 ${MAP_LISTED_COUNT}개의 확정 종가와 기간별 자료를 확인하고 있습니다.`;
  const warnings = [...(model?.warnings || [])];
  if (capMissing) warnings.push('* 기간 시작일 시총 미확인 종목 제외');
  if (marketError) warnings.push('최신 수집 파일을 읽지 못해 이전 확인값을 표시합니다.');
  const status = $('[data-home-summary-status]');
  status.textContent = [...new Set(warnings)].join(' · ');
  status.hidden = !status.textContent;
}
function rippleIdentity(node) { return `${node?.ticker || ''}:${node?.date || ''}`; }
function rippleSector(value) {
  return SECTORS.find(sector => sector.id === value) || (Number.isInteger(value) ? SECTORS[value - 1] : null);
}
function openRippleCompany(value) {
  const href = companyHrefForTicker(value.ticker);
  if (href) location.hash = href;
  else window.dispatchEvent(new CustomEvent('market-symbol-open', { detail: { symbol: value.ticker } }));
}
function rippleCompany(value, { trigger = false } = {}) {
  const sector = rippleSector(value.sectorId);
  const button = htmlElement('button', trigger ? 'ripple-trigger-card' : 'ripple-company');
  button.type = 'button';
  button.dataset.rippleNode = value.ticker;
  button.setAttribute('aria-label', `${value.name} ${value.ticker}, ${marketName(value.market)} ${value.date}, ${sign(value.changePct)}, 기업정보 보기`);
  button.addEventListener('click', () => openRippleCompany(value));
  if (trigger) button.append(htmlElement('span', 'ripple-trigger-label', '크게 움직인 기업'));
  const name = htmlElement('strong', 'ripple-company-name', value.name);
  const change = htmlElement('span', 'ripple-company-return ' + pctClass(value.changePct), sign(value.changePct));
  const classification = htmlElement('span', 'ripple-company-sector');
  const dot = htmlElement('i'); dot.style.backgroundColor = sector?.color || '#7e92a7'; dot.setAttribute('aria-hidden', 'true');
  classification.append(dot, document.createTextNode(sector?.name || '분야 확인 중'));
  const date = htmlElement('span', 'ripple-company-date', `${marketName(value.market)} ${shortDate(value.date)}${value.stale ? ' · 이전 수집값' : ''}`);
  button.append(name);
  if (trigger) button.append(htmlElement('span', 'ripple-company-ticker', value.ticker));
  button.append(change, classification, date);
  if (!trigger) {
    const sync = htmlElement('span', 'ripple-company-sync', Number.isFinite(value.syncRate) ? `동조율 ${value.syncRate.toFixed(0)}%` : '동조율 —');
    if (Number.isInteger(value.samples)) sync.title = `비교 가능한 ${value.samples}개 거래일 기준`;
    button.append(sync);
  }
  return button;
}
function renderRipple() {
  const chipHost = $('[data-ripple-chips]'), flow = $('[data-ripple-flow]'), status = $('[data-ripple-status]'), timeline = $('[data-ripple-time]');
  const entries = rippleSnapshot?.ripples || [], triggers = rippleSnapshot?.triggers || entries.map(entry => entry.trigger);
  const previousFocus = root.activeElement?.dataset?.rippleTrigger;
  chipHost.replaceChildren();
  if (!entries.some(entry => rippleIdentity(entry.trigger) === selectedRipple)) selectedRipple = entries[0] ? rippleIdentity(entries[0].trigger) : null;
  for (const trigger of triggers.slice(0, 3)) {
    const active = rippleIdentity(trigger) === selectedRipple;
    const chip = htmlElement('button', 'ripple-chip' + (active ? ' active' : ''));
    chip.type = 'button'; chip.dataset.rippleTrigger = trigger.ticker; chip.setAttribute('aria-pressed', String(active));
    chip.append(document.createTextNode(trigger.name), htmlElement('span', pctClass(trigger.changePct), sign(trigger.changePct)));
    chip.addEventListener('click', () => { selectedRipple = rippleIdentity(trigger); renderRipple(); });
    chipHost.append(chip);
  }
  const entry = entries.find(entry => rippleIdentity(entry.trigger) === selectedRipple);
  const mismatched = !!rippleSnapshot && !!marketSnapshot && rippleSnapshot.sourceSnapshotGeneratedAt !== marketSnapshot.generatedAt;
  status.classList.toggle('is-warning', !!rippleError || mismatched);
  status.textContent = rippleError ? (rippleSnapshot ? '이전 수집값 · 파급 자료 갱신을 확인할 수 없습니다.' : '파급 자료를 아직 확인할 수 없습니다.') : mismatched ? (autoRefreshEnabled ? '이전 수집값 · 종가 갱신 후 파급 자료 반영 대기' : '저장된 종가와 파급 자료의 기준 시각이 다릅니다.') : rippleBusy && !rippleSnapshot ? '종가와 함께 움직인 종목을 확인하고 있습니다.' : '';
  if (!collectionEnabled) status.textContent = [MARKET_DATA_POLICY.statusLabel, status.textContent].filter(Boolean).join(' · ');
  status.hidden = !status.textContent;
  timeline.replaceChildren(); flow.replaceChildren();
  if (!entry) {
    const message = rippleSnapshot?.reason === 'no-large-moves' ? '오늘은 크게 움직인 대장주가 없어요' : rippleSnapshot ? '확정 종가 이력이 충분하지 않아 함께 움직인 종목을 기다리고 있어요' : collectionEnabled ? '종가 수집 후 함께 움직인 종목을 표시합니다.' : '저장된 파급 자료가 없습니다. 시세 수집은 중지되어 있습니다.';
    flow.append(htmlElement('p', 'ripple-empty ripple-empty-wide', message));
    return;
  }
  timeline.append(htmlElement('span', '', entry.comparisonLabel || `${marketName(entry.trigger.market)} ${shortDate(entry.trigger.date)} 종가`));
  if (entry.pendingKoreanClose) timeline.append(htmlElement('span', 'ripple-pending', '한국 종가 반영 전'));
  const svg = node('svg', { class: 'ripple-lines', 'data-ripple-lines': '', 'aria-hidden': 'true' });
  flow.append(svg);
  for (const side of ['upstream', 'trigger', 'downstream']) {
    if (side === 'trigger') { flow.append(rippleCompany(entry.trigger, { trigger: true })); continue; }
    const column = htmlElement('div', `ripple-column ripple-${side}`); column.dataset.rippleSide = side;
    column.append(htmlElement('h3', '', side === 'upstream' ? '상류 · 앞선 고리' : '하류 · 뒤쪽 고리'));
    const candidates = (entry[side] || []).filter(value => !Number.isFinite(value.syncRate) || value.syncRate >= 50).slice(0, 3);
    if (!candidates.length) column.append(htmlElement('p', 'ripple-empty', '함께 움직인 종목 없음'));
    else for (const candidate of candidates) column.append(rippleCompany(candidate));
    flow.append(column);
  }
  requestAnimationFrame(drawRippleLines);
  if (previousFocus) chipHost.querySelector(`[data-ripple-trigger="${CSS.escape(previousFocus)}"]`)?.focus({preventScroll:true});
}
function drawRippleLines() {
  const svg = $('[data-ripple-lines]'), flow = $('[data-ripple-flow]'), trigger = flow?.querySelector('.ripple-trigger-card');
  if (!svg || !trigger || matchMedia('(max-width:820px)').matches || host.hidden) { if (svg) svg.replaceChildren(); return; }
  const frame = flow.getBoundingClientRect(), center = trigger.getBoundingClientRect();
  if (!frame.width || !frame.height) return;
  svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  const cy = center.top - frame.top + center.height / 2;
  for (const side of ['upstream', 'downstream']) for (const company of flow.querySelectorAll(`[data-ripple-side="${side}"] .ripple-company`)) {
    const bounds = company.getBoundingClientRect();
    const start = side === 'upstream' ? {x:bounds.right-frame.left,y:bounds.top-frame.top+bounds.height/2} : {x:center.right-frame.left,y:cy};
    const end = side === 'upstream' ? {x:center.left-frame.left,y:cy} : {x:bounds.left-frame.left,y:bounds.top-frame.top+bounds.height/2};
    const bend = Math.max(12, (end.x - start.x) / 2);
    svg.append(node('path', {d:`M ${start.x},${start.y} C ${start.x+bend},${start.y} ${end.x-bend},${end.y} ${end.x},${end.y}`,fill:'none',stroke:'#335b7b','stroke-width':1.5}));
  }
}

async function loadRipple() {
  if (rippleBusy || !autoRefreshEnabled && rippleAttempted) return;
  rippleAttempted = true; rippleBusy = true; renderRipple();
  const current = ++rippleRequest;
  const read = async path => {
    const response = await fetch(path, { cache: autoRefreshEnabled ? 'no-cache' : 'force-cache', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('파급 자료 수신 실패');
    const value = validateRippleSnapshot(await response.json());
    if (!rippleMatchesSelection(value)) throw new Error('현재 선정표와 파급 대상이 다릅니다.');
    return value;
  };
  try {
    let value;
    if (liveRequestsEnabled && !staticHost) {
      try { value = await read('./api/ripple'); } catch { value = await read('./data/ripple.json'); }
    } else value = await read('./data/ripple.json');
    if (current !== rippleRequest) return;
    if (!rippleSnapshot || Date.parse(value.generatedAt) >= Date.parse(rippleSnapshot.generatedAt)) rippleSnapshot = value;
    rippleError = '';
  } catch { if (current === rippleRequest) rippleError = '파급 자료를 읽지 못했습니다.'; }
  finally { if (current === rippleRequest) { rippleBusy = false; renderRipple(); } }
}

function renderMapStatus(model, matchingCatalog, sizedItems) {
  const coverage = model?.coverage;
  const count = coverage?.catalogCount ?? MAP_CATALOGUE.length;
  const listed = coverage?.listedCompanyCount ?? MAP_LISTED_COUNT;
  const unlisted = coverage?.unlistedCompanyCount ?? MAP_PRIVATE_COUNT;
  const universe = `지도 선정 ${count} · 상장 ${listed} · 비상장 ${unlisted}`;
  const reflected = coverage?.renderableCount ?? model?.companies?.length ?? 0;
  $('[data-map-coverage]').textContent = model
    ? `${universe} · 실제 반영 ${reflected} · 시총 미확보 ${coverage?.missingCap || 0} · 환율 미확보 ${coverage?.missingFx || 0} · 종가 미확보 ${coverage?.missingPrice || 0} · 코드 미연결 ${coverage?.unmappedCompanyCount || 0}`
    : `${universe} · ${marketError || mapBuildError ? '자료 조회 실패' : '수집 확인 중'}`;
  const status = $('#map-data-status');
  status.classList.toggle('is-stale', !!marketError || !!mapBuildError || !!coverage?.staleCount);
  const missingReturns = sizedItems.filter(company => getReturn(company, state.period) == null).length;
  if (!model) status.textContent = mapBuildError || (marketError ? '시총·종가 자료를 읽지 못했습니다. 확인되지 않은 값은 표시하지 않습니다.' : '최근 관측 시총·환율과 확정 종가를 확인하고 있습니다.');
  else {
    const dates = model.dates || [];
    const dateText = dates.length ? `종가 ${dates[0]}${dates.length > 1 ? ` ~ ${dates.at(-1)}` : ''} · 시장별 현지 기준` : '확정 종가 미확보';
    const notes = [MARKET_DATA_POLICY.statusLabel, dateText, `현재 조건 ${matchingCatalog.length}개 · 시총 반영 ${sizedItems.length}개 · ${periodName()} 등락률 미확보 ${missingReturns}개${missingReturns ? state.view === 'bubble' ? ' · 버블 제외' : ' · 회색 — 표시' : ''}`];
    if (coverage?.staleCount) notes.push(`이전 수집값 ${coverage.staleCount}개`);
    if (marketError) notes.push('최신 파일 조회 실패 · 마지막 확인 자료 표시');
    status.textContent = notes.join(' / ');
  }
  const matchingIds = new Set(matchingCatalog.map(company => company.id));
  const matchingTickers = new Set(matchingCatalog.flatMap(company => [company.ticker, company.primaryTicker, ...(company.candidateTickers || [])]).filter(Boolean));
  const matches = entry => entry.id || entry.companyId ? matchingIds.has(entry.id || entry.companyId) : matchingTickers.has(entry.ticker);
  const catalogueExclusions = model ? coverage?.exclusions || [] : matchingCatalog.filter(company => !company.listed || company.unmappedReason).map(company => ({
    id:company.id, ticker:company.ticker, name:company.name, kind:company.listed ? 'unmapped' : 'unlisted', reason:company.listed ? company.unmappedReason : '비상장 기업 · 공개 주가와 시가총액 없음',
  }));
  const issues = [
    ...catalogueExclusions.filter(matches).map(entry => ({...entry, type:entry.kind === 'unlisted' ? '비상장' : entry.kind === 'unmapped' ? '코드 미연결' : '지도 제외'})),
    ...(coverage?.returnExclusions || []).filter(matches).map(entry => ({...entry, type:`${periodName()} 등락률 미확보`})),
    ...sizedItems.filter(company => company.stale || company.status === 'stale' || company.capStatus === 'stale' || company.error || company.capError).map(company => ({id:company.id,ticker:company.ticker,name:company.name,type:'이전 수집값',reason:company.error || company.capError || '최신 자료 수집 상태를 확인해 주세요.'})),
  ];
  const details = $('#map-data-details'), list = $('#map-exclusions');
  details.hidden = !issues.length;
  details.querySelector('summary').textContent = `미반영·수집 상태 ${issues.length}건 보기`;
  list.replaceChildren();
  for (const issue of issues) {
    const item = htmlElement('li', '', `${issue.name}${issue.ticker ? ` (${issue.ticker})` : ''} · ${issue.type} · ${issue.reason}`);
    if (issue.id || issue.companyId) item.dataset.companyId = issue.id || issue.companyId;
    list.append(item);
  }
  if (!currentItems.length && state.query.trim() && matchingCatalog.length <= 5) details.open = true;
}
function renderEmptyState(model, matchingCatalog, sizedItems) {
  const empty = $('#empty-state');
  empty.hidden = !!currentItems.length;
  if (currentItems.length) return;
  let title, message;
  if (!matchingCatalog.length) {
    title = '조건에 맞는 기업이 없어요';
    message = '검색어를 바꾸거나 조회 조건을 초기화해 보세요.';
  } else if (matchingCatalog.every(company => !company.listed)) {
    title = '검색 조건에 맞는 비상장 기업입니다';
    message = '위에서 공개된 공식 소식과 자료 상태를 확인할 수 있습니다.';
  } else if (matchingCatalog.every(company => !company.listed || company.unmappedReason)) {
    title = '시세 종목코드가 연결되지 않았어요';
    message = '기업 이름과 코드 미연결 사유를 위의 수집 상태에서 확인할 수 있습니다.';
  } else if (!model) {
    title = marketError || mapBuildError ? '지도 자료를 읽지 못했어요' : '시총과 종가를 확인하고 있어요';
    message = marketError || mapBuildError ? '자료가 확인되면 실제 시총과 종가로 표시합니다.' : '확인된 자료가 준비되면 지도에 표시합니다.';
  } else if (!sizedItems.length) {
    title = '지도로 표시할 자료가 부족해요';
    message = `조건에 맞는 ${matchingCatalog.length}개 기업의 시총·USD 환율·확정 종가 중 필요한 자료를 확인하지 못했습니다.`;
  } else {
    title = `${periodName()} 등락률을 확보한 기업이 없어요`;
    message = '비교할 확정 종가가 있는 기업만 버블에 표시합니다. 히트맵에서는 시총과 미확보 상태를 확인할 수 있습니다.';
  }
  empty.querySelector('h2').textContent = title;
  empty.querySelector('p').textContent = message;
  $('#empty-reset').hidden = state.country === 'all' && state.sector === 'all' && !state.query.trim();
}
function render() {
  renderSectorSummary();
  renderRipple();
  const model = actualMapModel();
  const matchingCatalog = filterMapCompanies(MAP_CATALOGUE);
  renderCoreCompanyNews(matchingCatalog);
  const sizedItems = filterMapCompanies(model?.companies || []).filter(company => Number.isFinite(company.capUSD) && company.capUSD > 0 && Number.isFinite(company.cap) && company.cap > 0);
  currentItems = state.view === 'bubble' ? sizedItems.filter(company => Number.isFinite(getReturn(company, state.period))) : sizedItems;
  if (!currentItems.some(company => company.id === state.selected)) state.selected = null;
  host.dataset.view = state.view;
  host.dataset.mapPeriod = state.period;
  host.dataset.mapCount = currentItems.length;
  $$('[data-view]').forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $$('[data-period]').forEach(button => {
    const active = button.dataset.period === state.period;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  renderChips();
  $('#company-count').textContent = currentItems.length;
  $('#up-count').textContent = model ? currentItems.filter(company => getReturn(company, state.period) > 0).length : '—';
  $('#down-count').textContent = model ? currentItems.filter(company => getReturn(company, state.period) < 0).length : '—';
  $('#crumb-sector').textContent = state.sector === 'all' ? '' : `/ ${state.sector}`;
  $('#heatmap').hidden = state.view !== 'heatmap' || !currentItems.length;
  $('#bubble-chart').hidden = state.view !== 'bubble' || !currentItems.length;
  $('#return-legend').hidden = state.view !== 'heatmap';
  $('#bubble-legend').hidden = state.view !== 'bubble';
  $('#map-zoom').hidden = state.view !== 'heatmap';
  $('#map-zoom').setAttribute('aria-pressed', String(state.zoom > 1));
  $('#map-zoom').textContent = state.zoom > 1 ? '지도 맞춤' : '지도 확대';
  $('#chart-explainer').innerHTML = '크기: <b>최근 관측 시총 USD</b><span>·</span>색상: <b>확정 종가 등락률</b>';
  $('#chart-stage').setAttribute('aria-label', state.view === 'heatmap' ? '확정 종가 히트맵 차트' : '확정 종가 버블 차트');
  renderMapStatus(model, matchingCatalog, sizedItems);
  renderEmptyState(model, matchingCatalog, sizedItems);
  hideTooltip();
  if (currentItems.length) { if (state.view === 'heatmap') drawHeatmap(); else drawBubbles(); }
  else { $('#heatmap').replaceChildren(); $('#bubble-svg').replaceChildren(); $('#fixed-axis').replaceChildren(); }
  renderSelection();
}
function reset(){Object.assign(state,{country:'all',sector:'all',period:'1d',query:'',selected:null,zoom:1});$('#search').value='';$('#country').value='all';render();}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;render();}));$$('[data-period]').forEach(b=>b.addEventListener('click',()=>{state.period=b.dataset.period;render();}));$('#search').addEventListener('input',e=>{state.query=e.target.value;render();});$('#country').addEventListener('change',e=>{state.country=e.target.value;render();});$('#map-zoom').addEventListener('click',()=>{state.zoom=state.zoom>1?1:2;render();});$('#reset').addEventListener('click',reset);$('#empty-reset').addEventListener('click',reset);$('#overview').addEventListener('click',()=>setSector('all'));root.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes((root.activeElement?.tagName??''))){e.preventDefault();$('#search').focus();}if(e.key==='Escape'){state.selected=null;renderSelection();$$('.tile,.bubble-node').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});hideTooltip();}});new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(currentItems.length){if(state.view==='heatmap')drawHeatmap();else drawBubbles();}drawRippleLines();});}).observe($('#chart-stage'));renderCountryOptions();render();

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


$('#home-sector-summary [data-home-card-period]').addEventListener('change', event => {
  if (!['1d','1w','1m','3mo','1y'].includes(event.target.value)) return;
  summaryPeriod = event.target.value;
  renderSectorSummary();
});
$$('[data-home-weight]').forEach(button => button.addEventListener('click', () => {
  weightMode = button.dataset.homeWeight === 'cap' ? 'cap' : 'eq';
  try { localStorage.setItem('ai-chain.home-weight.v1', weightMode); } catch {}
  renderSectorSummary();
}));
window.addEventListener('market-snapshot', event => {
  marketSnapshot = event.detail;
  marketError = '';
  render();
  if (rippleSnapshot?.sourceSnapshotGeneratedAt !== marketSnapshot?.generatedAt) void loadRipple();
});
window.addEventListener('market-snapshot-error', () => {
  marketError = '수집 파일 조회 실패';
  render();
});
window.addEventListener('resize', drawRippleLines);
window.addEventListener('hashchange', () => requestAnimationFrame(drawRippleLines));
void loadRipple();
if (autoRefreshEnabled) setInterval(() => { if (!document.hidden && !host.hidden) void loadRipple(); }, 60000);
