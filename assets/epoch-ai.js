import {EPOCH_DATASETS,validateEpochSnapshot,epochDatasetCsv} from './epoch-ai-core.js'

const PAGE_SIZES=[25,50]
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const number=value=>Number(value).toLocaleString('ko-KR')
const stamp=value=>{
  if(!value)return '아직 없음'
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value
  const date=new Date(value)
  return Number.isNaN(date.getTime())?'확인되지 않음':date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' KST'
}
const href=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:''}catch{return ''}}
const link=(url,label)=>href(url)?`<a href="${esc(href(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:esc(label)
const statusNames={ok:'수집 완료',partial:'일부 갱신 실패',error:'갱신 실패','not-connected':'자료 미연결'}
let snapshot=null,loadError='',busy=false,attempted=false,panelHost=null
let datasetId=EPOCH_DATASETS[0]?.id||'models',query='',page=1,pageSize=25
const definition=()=>EPOCH_DATASETS.find(item=>item.id===datasetId)||EPOCH_DATASETS[0]
const dataset=()=>snapshot?.datasets.find(item=>item.id===datasetId)
const textValue=value=>Array.isArray(value)?value.join(' · '):String(value??'')
function filteredRows(){
  const terms=query.trim().toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean)
  const columns=definition()?.columns||[]
  return (dataset()?.rows||[]).filter(row=>{
    const text=columns.map(column=>textValue(row[column.key])).join(' ').toLocaleLowerCase('ko-KR')
    return terms.every(term=>text.includes(term))
  })
}
function valueMarkup(value,column){
  if(value===null||value===undefined||value==='')return '<span class="epoch-missing" aria-label="자료 없음">—</span>'
  if(typeof value==='boolean')return column.key==='incomplete'?(value?'부분 집계':'표시 없음'):(value?'예':'아니요')
  if(typeof value==='number'){
    const magnitude=Math.abs(value)
    const formatted=magnitude>=1e12||(magnitude>0&&magnitude<0.001)?value.toExponential(3):value.toLocaleString('ko-KR',{maximumSignificantDigits:7})
    return `<span class="mono" title="${esc(value)}">${esc(formatted)}</span>`
  }
  const text=textValue(value)
  if(column.type==='url'||column.type==='link'||/^https:\/\/\S+$/.test(text))return link(text,'원문')
  return esc(text)
}
function paintStatus(){
  if(!panelHost?.isConnected)return
  const source=snapshot?.source,collection=snapshot?.collection
  panelHost.querySelector('[data-epoch-refresh]').disabled=busy
  panelHost.querySelector('[data-epoch-refresh]').textContent=busy?'읽는 중…':'최신 수집값 읽기'
  panelHost.querySelector('[data-epoch-status]').innerHTML=`${busy?'<span class="epoch-status-badge">저장된 자료 읽는 중</span>':collection?`<span class="epoch-status-badge${collection.status==='ok'?'':' epoch-status-warning'}">${esc(statusNames[collection.status]||collection.status)}</span>`:''}<span>마지막 성공 ${esc(stamp(collection?.lastSuccessAt))}</span>${collection?.lastAttemptAt?`<span>최근 수집 시도 ${esc(stamp(collection.lastAttemptAt))}</span>`:''}`
  panelHost.querySelector('[data-epoch-error]').innerHTML=loadError?`<p class="epoch-alert" role="alert">${esc(loadError)}${snapshot?' 이전에 읽은 자료를 표시합니다.':''}</p>`:''
  panelHost.querySelector('[data-epoch-license]').innerHTML=`${link(source?.url||'https://epoch.ai/data','Epoch AI')} · ${link(source?.licenseUrl||'https://creativecommons.org/licenses/by/4.0/','CC BY 4.0')}<br>${esc(source?.attribution||'출처: Epoch AI. 원자료의 일부 열을 선택하고 한국어 표제·검색·표시 형식을 적용했습니다.')}<br>원자료의 일부 열을 선택해 표시합니다. 빈칸은 공개된 값이 없는 항목이며 0을 뜻하지 않습니다.`
  const controls=panelHost.querySelector('[data-epoch-datasets]')
  controls.innerHTML=EPOCH_DATASETS.map(item=>{
    const value=snapshot?.datasets.find(entry=>entry.id===item.id)
    return `<button type="button" class="epoch-dataset${item.id===datasetId?' on':''}" data-epoch-dataset="${esc(item.id)}" aria-pressed="${item.id===datasetId}"><span>${esc(item.title)}</span><strong>${value?number(value.rows.length):'—'} <small>개 항목</small></strong>${value?.status==='error'?`<small class="epoch-status-warning">${value.rows.length?'이전 성공 자료':'갱신 실패'}</small>`:''}</button>`
  }).join('')
}
function paintResults(){
  if(!panelHost?.isConnected)return
  const current=dataset(),config=definition(),rows=filteredRows(),totalPages=Math.max(1,Math.ceil(rows.length/pageSize))
  page=Math.min(Math.max(1,page),totalPages)
  const start=(page-1)*pageSize,visible=rows.slice(start,start+pageSize)
  panelHost.querySelector('[data-epoch-csv]').disabled=!rows.length
  panelHost.querySelector('[data-epoch-csv]').textContent=query.trim()?'검색 결과 CSV':'데이터세트 CSV'
  panelHost.querySelector('[data-epoch-description]').innerHTML=`<h2>${esc(config?.title||'데이터')}</h2><p>${esc(config?.description||'')}</p><div class="epoch-source-links">${link(config?.sourceUrl,'자료 설명')}${link(config?.downloadUrl,'원본 CSV')}</div><p class="note">${current?`${esc(statusNames[current.status]||current.status)} · 마지막 성공 ${esc(stamp(current.lastSuccessAt))} · 표시 ${number(current.rows.length)}개${Number.isInteger(current.rawRowCount)&&current.rawRowCount!==current.rows.length?` / 원자료 ${number(current.rawRowCount)}개`:''}`:'저장된 자료를 확인하고 있습니다.'}</p>${current?.status==='error'?`<p class="epoch-alert">${current.rows.length?'이번 갱신에 실패해 마지막으로 수집한 자료를 표시합니다.':'이 데이터세트의 수집에 실패했습니다.'}${current.error?` ${esc(current.error)}`:''}</p>`:''}`
  panelHost.querySelector('[data-epoch-count]').textContent=`${number(rows.length)}개${query.trim()?` 검색 결과 / 전체 ${number(current?.rows.length||0)}개`:''}`
  const result=panelHost.querySelector('[data-epoch-results]')
  if(!visible.length){
    result.innerHTML=`<div class="epoch-empty">${busy&&!snapshot?'Epoch AI 자료를 읽고 있습니다.':query.trim()?'검색어에 맞는 항목이 없습니다. 다른 이름이나 기관으로 검색해 보세요.':current?.status==='not-connected'?'이 데이터세트는 아직 연결되지 않았습니다.':loadError&&!snapshot?'자료를 읽지 못했습니다. 최신 수집값 읽기로 다시 시도할 수 있습니다.':'표시할 자료가 없습니다.'}</div>`
  }else{
    result.innerHTML=`<div class="epoch-table-scroll" tabindex="0" role="region" aria-label="${esc(config.title)} 데이터 표, 좌우로 스크롤할 수 있습니다"><table class="tbl epoch-table"><caption class="sr">${esc(config.title)}: ${number(rows.length)}개 중 ${number(start+1)}–${number(start+visible.length)}개</caption><thead><tr>${config.columns.map(column=>`<th scope="col">${esc(column.label)}${column.unit?`<small>${esc(column.unit)}</small>`:''}</th>`).join('')}</tr></thead><tbody>${visible.map(row=>`<tr>${config.columns.map((column,index)=>`<${index?'td':'th scope="row"'}>${valueMarkup(row[column.key],column)}</${index?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`
  }
  panelHost.querySelector('[data-epoch-pagination]').innerHTML=`<span>${rows.length?`${number(start+1)}–${number(start+visible.length)} / ${number(rows.length)}개`:'0개'}</span><div><button type="button" class="f" data-epoch-page="previous" ${page===1?'disabled':''}>이전</button><span class="epoch-page-number">${page} / ${totalPages}</span><button type="button" class="f" data-epoch-page="next" ${page>=totalPages?'disabled':''}>다음</button></div>`
}
async function loadSnapshot(){
  if(busy)return
  busy=true;attempted=true;paintStatus();paintResults()
  try{
    const staticHost=location.hostname.endsWith('.github.io')||location.protocol==='file:'
    const url=staticHost?'./data/epoch-ai.json':'./api/epoch-ai'
    const response=await fetch(url+'?t='+Math.floor(Date.now()/60000),{cache:'no-store',signal:AbortSignal.timeout(20000)})
    if(!response.ok)throw new Error(`자료 HTTP ${response.status}`)
    snapshot=validateEpochSnapshot(await response.json())
    loadError=''
  }catch(error){loadError=`Epoch AI 자료를 불러오지 못했습니다. ${error.message}`}
  finally{busy=false;paintStatus();paintResults()}
}
function exportCsv(){
  const current=dataset(),config=definition(),rows=filteredRows()
  if(!current||!rows.length)return
  const csv=epochDatasetCsv({...current,rows},config)
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const anchor=document.createElement('a')
  anchor.href=url;anchor.download=`epoch-ai-${datasetId}${query.trim()?'-filtered':''}.csv`;anchor.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function renderEpochPanel(host){
  panelHost=host
  host.innerHTML=`<section class="panel sec epoch-header"><div class="industry-heading"><div><p class="industry-kicker">AI MODELS · COMPUTE · INFRASTRUCTURE</p><h1>Epoch AI 산업데이터</h1></div><button type="button" class="f" data-epoch-refresh>최신 수집값 읽기</button></div><p>모델의 학습 규모부터 AI 칩과 데이터센터까지, Epoch AI의 공개 데이터를 탐색하세요.</p><div class="epoch-collection" data-epoch-status role="status"></div><div data-epoch-error></div><div class="epoch-datasets" data-epoch-datasets aria-label="Epoch AI 데이터세트 선택"></div></section><section class="panel sec epoch-browser"><div class="epoch-description" data-epoch-description></div><div class="epoch-toolbar"><label class="epoch-search" for="epoch-search"><span>데이터 검색</span><input id="epoch-search" type="search" value="${esc(query)}" placeholder="모델·기관·제품·지역 검색" autocomplete="off"></label><label class="epoch-page-size" for="epoch-page-size">페이지당<select id="epoch-page-size">${PAGE_SIZES.map(size=>`<option value="${size}"${size===pageSize?' selected':''}>${size}개</option>`).join('')}</select></label><button type="button" class="f" data-epoch-csv>데이터세트 CSV</button></div><p class="note" data-epoch-count aria-live="polite"></p><div data-epoch-results></div><div class="epoch-pagination" data-epoch-pagination></div></section><section class="panel sec epoch-notes"><h2>출처와 데이터 범위</h2><p class="note" data-epoch-license></p><p class="note">데이터세트마다 포함 기준과 관측 시점이 다릅니다. 모델·시설·제품의 항목 수를 산업 전체의 규모나 시장점유율로 해석하지 마세요. 추정치와 계획 단계의 항목은 각 자료 설명을 함께 확인하세요.</p></section>`
  host.addEventListener('input',event=>{if(event.target.id==='epoch-search'){query=event.target.value;page=1;paintResults()}})
  host.addEventListener('change',event=>{if(event.target.id==='epoch-page-size'){const size=Number(event.target.value);if(PAGE_SIZES.includes(size)){pageSize=size;page=1;paintResults()}}})
  host.addEventListener('click',event=>{
    const target=event.target.closest('[data-epoch-dataset],[data-epoch-refresh],[data-epoch-csv],[data-epoch-page]')
    if(!target||!host.contains(target)||target.disabled)return
    if(target.dataset.epochDataset){datasetId=target.dataset.epochDataset;page=1;paintStatus();paintResults();host.querySelector('[data-epoch-dataset='+datasetId+']')?.focus()}
    if(target.hasAttribute('data-epoch-refresh'))loadSnapshot()
    if(target.hasAttribute('data-epoch-csv'))exportCsv()
    if(target.dataset.epochPage){const direction=target.dataset.epochPage;page+=direction==='next'?1:-1;paintResults();const next=host.querySelector('[data-epoch-page='+direction+']');if(next&&!next.disabled)next.focus();else host.querySelector('[data-epoch-pagination] button:not(:disabled)')?.focus()}
  })
  paintStatus();paintResults()
  if(!attempted)loadSnapshot()
}