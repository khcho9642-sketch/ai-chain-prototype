import { instruments } from './instruments.js'
import { buildMarketOverview } from './market-overview-core.js'
import { TODAY_AGENTS, todayCards, getTodayComment, validateTodaySnapshot } from './today-core.js'
import { validateCompanyDisclosures } from './company-disclosures-core.js'

const root = document.getElementById('market-overview')
const stages = (window.S || []).map(({ id, name }) => ({ id, name }))
const state = { market: window.aiChainSnapshot || null, marketError: '', busy: false, edition: null, disclosures: null, editionError: false, disclosureError: false, loaded: false, loading: false, selected: null }
const node = (tag, text, attrs = {}) => {
  const el = document.createElement(tag)
  if (text != null) el.textContent = String(text)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value))
  return el
}
const append = (parent, ...children) => { parent.append(...children); return parent }
const date = value => {
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value || '')
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' KST' : '시각 미제공'
}
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—'
const percent = value => typeof value === 'number' && Number.isFinite(value) ? (value > 0 ? '+' : '') + value.toFixed(2) + '%' : '—'
const tone = value => value == null ? 'is-missing' : value > 0 ? 'is-up' : value < 0 ? 'is-down' : 'is-flat'
const link = (label, href) => node('a', label, { href })
const chainFilter = () => {
  const value = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('stage'))
  return stages.some(stage => stage.id === value) ? value : 0
}
const active = () => root && !document.getElementById('v-today').hidden
const price = row => number(row.price) + (row.price != null && row.currency ? ' ' + row.currency : '')
function panel(title, href, label = '전체 보기 →') {
  const el = node('section', null, { class: 'mo-panel' }), heading = node('div', null, { class: 'mo-panel-head' })
  heading.append(node('h2', title))
  if (href) heading.append(link(label, href))
  el.append(heading)
  return el
}
function indices() {
  const el = node('div', null, { class: 'mo-indices', 'aria-label': '주요 지수와 환율' })
  for (const [symbol, name, unit] of [['^KS11','코스피','pt'],['^KQ11','코스닥','pt'],['^GSPC','S&P 500','pt'],['^IXIC','나스닥','pt'],['KRW=X','달러 / 원','KRW · 1 USD']]) {
    const q = (state.market?.quotes || []).filter(row => row.symbol === symbol).reduce((latest,row) => !latest || (Date.parse(row.fetchedAt) || -Infinity) >= (Date.parse(latest.fetchedAt) || -Infinity) ? row : latest, null)
    const available = typeof q?.price === 'number' && Number.isFinite(q.price) && q.price > 0 && typeof q.marketTime === 'number' && q.marketTime > 0 && q.marketTime * 1000 <= Date.now()
    const fetched = Date.parse(q?.fetchedAt || '')
    const valid = available && q.status === 'ok' && Number.isFinite(fetched) && fetched <= Date.now()
    const change = valid && typeof q.changePercent === 'number' && Number.isFinite(q.changePercent) ? q.changePercent : null
    const card = node('article', null, { class: 'mo-index', 'data-mo-index': symbol })
    card.append(node('span', name), node('strong', available ? number(q.price) : '—'), node('small', unit), node('b', percent(change), { class: tone(change) }), node('small', date(q?.marketTime)), node('small', valid ? '최근 거래값 · 지연 가능' : available ? '이전 확인값 · 갱신 실패' : '시세 미확인'))
    el.append(card)
  }
  return el
}
function tile(row) {
  return append(node('button', null, { type: 'button', class: 'mo-tile ' + tone(row.changePercent), 'data-mo-symbol': row.symbol, 'aria-pressed': state.selected === row.symbol, title: row.name + ' · ' + price(row) + ' · ' + percent(row.changePercent) + ' · ' + date(row.marketTime) }),
    node('strong', row.symbol), node('span', row.name), node('b', percent(row.changePercent)), node('small', row.valid ? '' : row.reason || '미제공'))
}
function map(model) {
  const el = panel('AI 밸류체인 등락', '#map', '연결 지도 →')
  el.classList.add('mo-map')
  el.append(node('p', '전일 대비 · 동일 크기 타일 · ' + model.displayedCount + '종목', { class: 'mo-note' }))
  const legend = node('div', null, { class: 'mo-legend', 'aria-label': '등락 색상 범례' })
  for (const [text, cls] of [['+ 상승','is-up'],['0 보합','is-flat'],['− 하락','is-down'],['— 미제공','is-missing']]) legend.append(node('span', text, { class: cls }))
  el.append(legend)
  const grid = node('div', null, { class: 'mo-tile-groups' })
  for (const stage of stages) {
    const rows = model.rows.filter(row => (model.chain || row.primaryChain) === stage.id)
    if (!rows.length) continue
    const group = node('section', null, { class: 'mo-tile-group', 'data-mo-stage': stage.id })
    group.append(append(node('h3'), node('button', stage.name + ' · ' + rows.length, { type: 'button', 'data-mo-chain': stage.id })), append(node('div', null, { class: 'mo-tiles' }), ...rows.map(tile)))
    grid.append(group)
  }
  if (!model.rows.length) grid.append(node('p', '표시할 기업이 없습니다.', { class: 'mo-empty' }))
  el.append(grid)
  const selected = model.rows.find(row => row.symbol === state.selected)
  if (selected) {
    const info = node('div', null, { class: 'mo-selected', 'data-mo-selected': selected.symbol, role: 'region', 'aria-label': '선택 종목 정보' })
    info.append(node('strong', selected.name + ' · ' + selected.symbol), node('p', price(selected) + ' · ' + percent(selected.changePercent), { class: tone(selected.changePercent) }), node('p', '거래 기준 ' + date(selected.marketTime) + ' · 수집 ' + date(selected.fetchedAt), { class: 'mo-note' }), node('button', '차트·종목 보기 →', { type: 'button', class: 'f', 'data-market-symbol': selected.symbol }), link('종목 토론 →', '#talk/' + encodeURIComponent(selected.symbol)))
    el.append(info)
  }
  el.append(node('p', '타일 면적은 시가총액을 나타내지 않습니다. 복수 고리 기업은 전체 화면에서 한 번 표시하며, 고리 선택 시 보조 편입도 포함합니다.', { class: 'mo-note' }))
  return el
}
function ranking(model) {
  const el = panel('고리별 순위', '#compare', '기간별 비교 →')
  el.classList.add('mo-ranking')
  el.append(node('p', '전일 대비 · 유효 종목 동일 비중 평균', { class: 'mo-note' }))
  const groups = model.chain ? model.groups.filter(group => group.id === model.chain) : model.groups
  const ordered = [...groups].sort((a,b) => Number(b.rankEligible)-Number(a.rankEligible) || (a.rankEligible ? b.averageChangePercent-a.averageChangePercent : a.id-b.id))
  const max = Math.max(1, ...ordered.filter(group => group.rankEligible).map(group => Math.abs(group.averageChangePercent || 0)))
  for (const group of ordered) {
    const row = node('button', null, { type: 'button', class: 'mo-rank-row', 'data-mo-chain': group.id })
    const label = node('div')
    label.append(node('strong', group.name), node('small', group.validCount + '/' + group.totalCount + '개 유효'))
    const track = node('span', null, { class: 'mo-rank-track' }), bar = node('span', null, { class: 'mo-rank-bar ' + tone(group.averageChangePercent) })
    bar.style.width = Math.min(100, Math.abs(group.averageChangePercent || 0) / max * 100) + '%'
    if (!group.rankEligible) bar.style.display = 'none'
    track.append(bar)
    row.append(label, track, node('b', group.rankEligible ? percent(group.averageChangePercent) : '표본 부족', { class: group.rankEligible ? tone(group.averageChangePercent) : 'is-missing' }))
    el.append(row)
  }
  el.append(node('p', '유효 3종목 이상만 순위에 포함합니다. 기업별 거래일이 다를 수 있으며, 장중 값이 포함될 수 있습니다.', { class: 'mo-note' }))
  return el
}
function movers(title, rows) {
  const el = panel(title), wrap = node('div', null, { class: 'mo-table-wrap' }), table = node('table', null, { class: 'mo-table' })
  const head = node('tr')
  for (const label of ['종목','최근 거래가','전일 대비']) head.append(node('th', label, { scope: 'col' }))
  table.append(append(node('thead'), head))
  const body = node('tbody')
  for (const row of rows) {
    const name = append(node('td'), append(node('button', null, { type: 'button', 'data-market-symbol': row.symbol }), node('strong', row.name), node('small', row.symbol)))
    const value = append(node('td'), node('span', price(row)), node('small', date(row.marketTime)))
    body.append(append(node('tr'), name, value, node('td', percent(row.changePercent), { class: tone(row.changePercent) })))
  }
  table.append(body); wrap.append(table); el.append(wrap)
  if (!rows.length) el.append(node('p', '해당하는 유효 종목이 없습니다.', { class: 'mo-empty' }))
  return el
}
function opinions(model) {
  const el = panel('최근 AI 의견', '#opinions', '의견 전체 →')
  const cards = state.edition ? todayCards(state.edition, { catalog: instruments, now: Date.now() }) : []
  let count = 0
  for (const card of cards) {
    const report = card.report || card.pick
    if (!report || !model.rows.some(row => row.symbol === report.symbol)) continue
    const company = instruments.find(row => row.symbol === report.symbol), article = node('article', null, { class: 'mo-opinion', 'data-mo-agent': card.agent })
    article.append(node('strong', (TODAY_AGENTS[card.agent]?.name || card.agent) + ' · ' + (company?.name || report.symbol)), node('small', 'AI 작성 · 발행 ' + date(report.createdAt)), node('p', String(getTodayComment(report).text || report.comment || '').slice(0,180)), link('원문·근거 보기 →', '#opinions'))
    el.append(article); count++
  }
  if (count && state.editionError) el.append(node('p','갱신 실패 · 이전 발행 자료를 표시합니다.',{class:'mo-error'}))
  if (!count) el.append(node('p', state.editionError ? '발행 자료를 읽지 못했습니다. 다시 읽기로 확인해 주세요.' : '이 고리에서 확인된 발행 의견이 없습니다.', { class: 'mo-empty' }))
  return el
}
function disclosures(model) {
  const el = panel('최근 수집 공시', '#industry', '산업통계 →')
  const symbols = new Set(model.rows.map(row => row.symbol))
  const records = (state.disclosures?.companies || []).filter(company => symbols.has(company.symbol)).flatMap(company => company.items.map(item => ({ ...item, company })))
  records.sort((a,b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
  for (const item of records.slice(0,5)) {
    const row = node('div', null, { class: 'mo-feed' })
    const url = item.url || item.sourceUrl
    if (!url || !/^https:\/\/dart\.fss\.or\.kr\//.test(url)) continue
    row.append(node('small', item.company.companyName + ' · ' + date(item.publishedAt)), node('a', item.title, { href: url, target: '_blank', rel: 'noopener noreferrer' }))
    el.append(row)
  }
  if (!records.length) el.append(node('p', state.disclosures ? '보관된 RSS 자료에 표시할 공시가 없습니다. 전체 공시가 없다는 뜻은 아닙니다.' : '공시 자료를 확인하지 못했습니다.', { class: 'mo-empty' }))
  if (state.disclosureError || (state.disclosures && state.disclosures.collection?.status !== 'ok')) el.append(node('p','공시 갱신 실패 · 마지막 확인 자료입니다.',{class:'mo-error'}))
  if (state.disclosures) el.append(node('p', 'DART RSS · 마지막 성공 ' + date(state.disclosures.collection?.lastSuccessAt), { class: 'mo-note' }))
  return el
}
function render() {
  if (!active()) return
  const focused = document.activeElement?.getAttribute('data-mo-chain')
  const refreshFocused = document.activeElement?.hasAttribute('data-mo-refresh')
  const model = buildMarketOverview({ quotes: state.market?.quotes || [], instruments, chains: stages, chain: chainFilter() })
  root.replaceChildren(); root.className = 'mo-page'
  const heading = node('div', null, { class: 'mo-heading' })
  heading.append(append(node('div'), node('p', 'AI VALUE CHAIN · MARKET OVERVIEW', { class: 'mo-eyebrow' }), node('h1', '시장 현황'), node('p', 'AI 산업의 흐름을, 종목에서 고리까지.', { class: 'mo-note' })), node('button', state.busy ? '읽는 중…' : '최신 수집값 읽기', { type: 'button', class: 'f', 'data-mo-refresh': '' }))
  heading.querySelector('button').disabled = state.busy
  root.append(heading, indices())
  const timeText = state.market ? '수집 기준 ' + date(state.market.generatedAt) + ' · Yahoo Finance · 제공처 지연 가능' : '수집된 시세를 읽고 있습니다.'
  root.append(node('p', state.marketError ? state.marketError + (state.market ? ' · 이전 수집값을 표시합니다.' : ' · 시세를 불러오지 못했습니다. 다시 읽기로 재시도하세요.') : timeText, { class: 'mo-status' + (state.marketError ? ' mo-error' : ''), role: 'status', 'data-mo-status': '' }))
  if (state.market) root.append(node('p', '각 수치는 표시된 거래·수집 시점의 값입니다. 개장·휴장 상태는 별도 확인이 필요합니다.', { class: 'mo-note' }))
  const toolbar = node('div', null, { class: 'mo-toolbar', role: 'group', 'aria-label': '시장 현황 고리 선택' })
  for (const stage of [{id:0,name:'전체'}, ...stages]) toolbar.append(node('button', stage.name, { type: 'button', 'data-mo-chain': stage.id, 'aria-pressed': model.chain === stage.id }))
  root.append(toolbar)
  const b = model.breadth, breadth = node('div', null, { class: 'mo-breadth', 'data-mo-breadth': '' })
  for (const [label, count, cls] of [['표시 종목',model.displayedCount,''],['상승',b.advancers,'is-up'],['하락',b.decliners,'is-down'],['보합',b.unchanged,'is-flat'],['미제공·제외',b.missingCount,'is-missing']]) breadth.append(append(node('span', null, { class: cls }), node('small',label), node('strong',count)))
  root.append(breadth, append(node('div', null, { class: 'mo-workspace' }), map(model), ranking(model)), append(node('div', null, { class: 'mo-bottom' }), movers('상승 종목',model.gainers), movers('하락 종목',model.losers), opinions(model)), disclosures(model))
  root.append(append(node('div', null, { class: 'mo-section-links' }), link('기업·시세 전체 →','#data'), link('고리·회사 3년 비교 →','#compare'), link('AI 사업·토큰 통계 →','#ai-stats'), link('전체 토론 →','#talk')))
  if (focused !== null && focused !== undefined) root.querySelector('[data-mo-chain="' + Number(focused) + '"]')?.focus({ preventScroll: true })
  if (refreshFocused) root.querySelector('[data-mo-refresh]')?.focus({ preventScroll: true })
}
async function supplements() {
  if (state.loading) return
  state.loading = true
  const load = async (url, validate) => {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!response.ok) throw new Error('snapshot_unavailable')
    const value = await response.json(); validate(value); return value
  }
  const results = await Promise.allSettled([load('./data/today-picks.json', value => validateTodaySnapshot(value,{catalog:instruments,now:Date.now()})), load('./data/company-disclosures.json',validateCompanyDisclosures)])
  state.editionError = results[0].status === 'rejected'; state.disclosureError = results[1].status === 'rejected'
  if (results[0].status === 'fulfilled') state.edition = results[0].value
  if (results[1].status === 'fulfilled') state.disclosures = results[1].value
  state.loaded = true; state.loading = false; render()
}
function mount() { if (active()) { render(); if (!state.loaded && !state.loading) supplements() } }
if (root) {
  root.addEventListener('click',event => {
    const chain = event.target.closest('[data-mo-chain]')
    if (chain) { const id=Number(chain.dataset.moChain); history.replaceState(null,'','#today'+(id?'?stage='+id:'')); state.selected=null; render(); return }
    const tile = event.target.closest('[data-mo-symbol]')
    if (tile) { state.selected=tile.dataset.moSymbol; render(); root.querySelector('[data-mo-selected]')?.scrollIntoView({block:'nearest'}); root.querySelector('[data-mo-selected] button')?.focus({preventScroll:true}); return }
    if (event.target.closest('[data-mo-refresh]')) { state.busy=true; render(); window.dispatchEvent(new Event('market-refresh-request')); supplements() }
  })
  window.renderMarketOverview = mount
  window.addEventListener('hashchange',mount)
  window.addEventListener('market-snapshot',event=>{ state.market=event.detail;state.marketError='';state.busy=false;render() })
  window.addEventListener('market-snapshot-error',()=>{state.marketError='시세 갱신 실패';state.busy=false;render()})
  mount()
}
