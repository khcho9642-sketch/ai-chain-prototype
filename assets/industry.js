import { staticHost } from './site-runtime.js'
import { SECTORS } from './home-map-core.js'
import { validateIndustry, latestPoint, yearOnYear } from './industry-core.js'
import { safeSourceUrl, validateAiStatistics } from './ai-statistics-core.js'
import { validateEpochSnapshot } from './epoch-ai-core.js'
import { renderEpochPanel } from './epoch-ai.js'
import { renderAiStatisticsPanel } from './ai-statistics.js'
import { sectorMetrics } from './sector-metric-catalog.js'
import { metricDetailHTML, metricCsv, formatMetricValue } from './sector-metric-chart.js'

const root = document.getElementById('v-industry')
const sources = {
  industry: { label: '월별 산업통계', file: 'industry', validate: validateIndustry },
  ai: { label: 'AI 통계', file: 'ai-statistics', validate: validateAiStatistics },
  epoch: { label: 'Epoch AI', file: 'epoch-ai', validate: validateEpochSnapshot },
}
const snapshots = {}
const pending = new Map()
const warnings = new Map()
let sector = 'memory'
let chosenId = null
let months = 24
let metrics = []
let active = null

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function sourceLink(metric) {
  const url = safeSourceUrl(metric.sourceUrl)
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(metric.source)}</a>` : esc(metric.source)
}

function sourceLinks() {
  const links = [
    ['#industry', '섹터별 지표'], ['#industry/monthly', '월별 산업통계 전체'],
    ['#industry/ai/business', 'AI 통계 상세'], ['#industry/epoch', 'Epoch AI 상세'],
  ]
  return `<nav class="sector-source-links industry-links" aria-label="통계 탐색">${links.map(([url, title]) =>
    `<a href="${url}"${location.hash === url ? ' aria-current="page"' : ''}>${title}</a>`).join('')}</nav>`
}

// The value-chain map also uses the most recent verified industrial releases.
function updateMapMetrics(data) {
  const shared = [[2, 'TSMC', 'tsmc-revenue'], [3, '한국 반도체 수출', 'kr-semiconductor-export-usd'], [5, '변압기 수출', 'kr-transformer-volume']]
  const labels = { provisional: '잠정', final: '확정', unaudited: '미감사', published: '공표값' }
  for (const [groupId, label, id] of shared) {
    const group = window.S?.find(item => item.id === groupId)
    const series = data.series.find(item => item.id === id)
    const point = latestPoint(series)
    if (!group || !point) continue
    const source = data.sources.find(item => item.id === series.sourceId)
    const row = group.m.findIndex(item => item[0].includes(label) || item[0] === series.name)
    const change = yearOnYear(series, point)
    const percent = Number.isFinite(change) ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%` : '—'
    if (row >= 0) group.m[row] = [series.name, `${point.value.toLocaleString('ko-KR', {maximumFractionDigits: 2})} ${series.unit}`,
      `전년 동월 ${percent}`, `${source.name} · ${point.period} · ${labels[point.status]}`]
  }
  window.renderDetail?.()
  if (location.hash === '#data') window.renderData?.()
}

async function readSnapshot(path, validate) {
  const response = await fetch(path, { cache: 'no-cache', signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(String(response.status))
  return validate(await response.json())
}

async function requestSource(key) {
  const {file, validate, label} = sources[key]
  if (key !== 'ai' && !staticHost) {
    try {
      return await readSnapshot(`./api/${file}`, validate)
    } catch {
      warnings.set(key, `${label}은 저장된 스냅샷을 표시합니다.`)
    }
  }
  return readSnapshot(`./data/${file}.json`, validate)
}

function ensureSource(key, refresh = false) {
  if (pending.has(key) || (!refresh && (snapshots[key] || warnings.has(key)))) return
  warnings.delete(key)
  const task = requestSource(key).then(data => {
    snapshots[key] = data
    if (key === 'industry') updateMapMetrics(data)
  }).catch(() => {
    warnings.set(key, snapshots[key] ? `${sources[key].label} 갱신 실패 · 이전 자료 표시` : `${sources[key].label}을 불러오지 못했습니다.`)
  }).finally(() => {
    pending.delete(key)
    if (!root.hidden && root.querySelector('.sector-stat-view')) paintMetrics()
  })
  pending.set(key, task)
}

function metricRows() {
  return metrics.map(metric => {
    const value = metric.latestText ?? `${formatMetricValue(metric.latest)} ${metric.unit}`
    const scope = metric.relation === 'reference' ? '참고 지표' : '직접 지표'
    return `<tr data-sector-row="${esc(metric.id)}" data-selected="${active === metric}">
      <th scope="row"><button type="button" class="metric-choice" data-metric="${esc(metric.id)}" aria-controls="sector-chart" aria-pressed="${active === metric}">${esc(metric.name)}</button>
        <small class="metric-scope">${scope}</small></th>
      <td>${esc(value)}</td><td>${esc(metric.periodText ?? metric.latest.label)}</td><td>${sourceLink(metric)}</td>
    </tr>`
  }).join('')
}

function relevantKeys() {
  return sector === 'monthly' ? ['industry'] : Object.keys(sources)
}

function paintMetrics() {
  const list = root.querySelector('.sector-metric-list')
  if (!list) return
  const keys = relevantKeys()
  const loading = keys.some(key => pending.has(key))
  metrics = sectorMetrics(sector, snapshots)
  active = metrics.find(item => item.id === chosenId) || metrics[0] || null
  const title = sector === 'monthly' ? '월별 산업통계 전체' : `${SECTORS.find(item => item.id === sector).name} 지표`
  const focus = root.contains(document.activeElement) ? document.activeElement.dataset : {}
  const previousScroll = list.querySelector('.sector-table-wrap')?.scrollTop || 0
  const heading = `<h2>${esc(title)}</h2>`
  list.innerHTML = heading + (metrics.length ? `<div class="sector-table-wrap"><table class="sector-metric-table">
    <caption class="sr">${esc(title)} 최신값과 기준 시점</caption>
    <thead><tr><th scope="col">지표명</th><th scope="col">최신값·단위</th><th scope="col">기준 시점</th><th scope="col">출처</th></tr></thead>
    <tbody>${metricRows()}</tbody></table></div>` : `<p role="status">${loading ? '지표를 불러오는 중…' : keys.some(key => warnings.has(key) && !snapshots[key]) ? '자료를 불러오지 못했습니다.' : '연결된 지표 없음'}</p>`)
  const industry = snapshots.industry
  if ((sector === 'memory' || sector === 'monthly') && industry?.gaps?.some(gap => gap.id?.startsWith('kosis-'))) {
    const saved = industry.series.some(series => series.sourceId === 'kosis-mining-manufacturing' && series.points.length)
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = saved ? 'KOSIS 반도체 생산·출하·재고지수는 최근 저장한 자료를 표시합니다.' : 'KOSIS 반도체 생산·출하·재고지수는 첫 자료 수집을 기다리고 있습니다.'
    list.append(note)
  }
  if (['memory', 'power-cooling', 'monthly'].includes(sector) && industry?.gaps?.some(gap => gap.id?.startsWith('customs-itemtrade-'))) {
    const prefix = sector === 'memory' ? 'kr-memory-' : sector === 'power-cooling' ? 'kr-transformer-' : ''
    const saved = industry.series.some(series => series.sourceId === 'customs-itemtrade' && series.id.startsWith(prefix) && series.points.length)
    const label = sector === 'memory' ? '메모리' : sector === 'power-cooling' ? '변압기' : '품목별'
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = `관세청 ${label} 수출액·순중량은 ${saved ? '최근 저장한 자료를 표시합니다.' : '첫 자료 수집을 기다리고 있습니다.'}`
    list.append(note)
  }
  if (previousScroll && list.querySelector('.sector-table-wrap')) list.querySelector('.sector-table-wrap').scrollTop = previousScroll
  paintChart()
  root.querySelector('[data-load-status]').textContent = keys.map(key => warnings.get(key)).filter(Boolean).join(' ')
  const refresh = root.querySelector('[data-refresh-metrics]')
  refresh.disabled = loading
  refresh.textContent = loading ? '자료 읽는 중…' : '자료 다시 읽기'
  if (focus.metric) list.querySelector(`[data-metric="${CSS.escape(focus.metric)}"]`)?.focus({preventScroll: true})
  if (focus.sectorMonths) root.querySelector(`[data-sector-months="${CSS.escape(focus.sectorMonths)}"]`)?.focus({preventScroll: true})
}

function paintChart() {
  root.querySelector('#sector-chart').innerHTML = active ? metricDetailHTML(active, months) : ''
}

function picker() {
  return `<div class="sector-picker" role="group" aria-label="섹터 선택">${SECTORS.map(item =>
    `<button type="button" class="sector-choice" style="--sector-color:${esc(item.color)}" data-pick-sector="${esc(item.id)}" aria-pressed="${item.id === sector}">${esc(item.name)}</button>`).join('')}</div>`
}

function render() {
  if (!root || root.hidden) return
  const [, page, tab] = location.hash.slice(1).split('/')
  if (page === 'ai' || page === 'epoch') {
    root.innerHTML = sourceLinks() + '<div id="industry-content"></div>'
    const content = root.querySelector('#industry-content')
    if (page === 'ai') {
      content.className = 'aist-panel'
      renderAiStatisticsPanel(content, { tab, baseHash: '#industry/ai' })
    } else {
      content.className = 'epoch-panel'
      renderEpochPanel(content)
    }
    return
  }
  sector = page === 'monthly' ? 'monthly' : 'memory'
  chosenId = null
  months = 24
  root.innerHTML = `<div class="sector-stat-view">
    <header class="sector-stat-heading"><h1>산업·AI 통계</h1>${sector === 'monthly' ? '' : picker()}</header>
    <section class="panel sec sector-metric-list"></section>
    <div class="sector-metric-detail" id="sector-chart"></div>
    <footer>${sourceLinks()}<p class="note" data-load-status role="status"></p><button type="button" class="f" data-refresh-metrics>자료 다시 읽기</button></footer>
  </div>`
  relevantKeys().forEach(key => ensureSource(key))
  paintMetrics()
}

function downloadCsv() {
  const url = URL.createObjectURL(new Blob([metricCsv(active)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = active.id + '.csv'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

root.addEventListener('click', event => {
  const button = event.target.closest('button')
  if (button?.dataset.pickSector) {
    sector = button.dataset.pickSector
    months = 24
    chosenId = null
    for (const element of root.querySelectorAll('[data-pick-sector]')) element.setAttribute('aria-pressed', String(element === button))
    const wrapper = root.querySelector('.sector-table-wrap')
    if (wrapper) wrapper.scrollTop = 0
    paintMetrics()
    return
  }
  if (button?.hasAttribute('data-refresh-metrics')) {
    relevantKeys().forEach(key => ensureSource(key, true))
    paintMetrics()
    return
  }
  if (button?.hasAttribute('data-sector-csv') && active) {
    downloadCsv()
    return
  }
  if (button?.dataset.sectorMonths) {
    months = Number(button.dataset.sectorMonths)
    paintChart()
    root.querySelector(`[data-sector-months="${months}"]`)?.focus({preventScroll: true})
    return
  }
  const row = event.target.closest('[data-sector-row]')
  if (!row || event.target.closest('a')) return
  chosenId = row.dataset.sectorRow
  active = metrics.find(item => item.id === chosenId)
  months = 24
  for (const entry of row.parentElement.rows) {
    entry.dataset.selected = String(entry === row)
    entry.querySelector('.metric-choice').setAttribute('aria-pressed', String(entry === row))
  }
  paintChart()
  const chart = root.querySelector('#sector-chart')
  if (window.matchMedia('(max-width: 600px)').matches && chart.getBoundingClientRect().bottom > window.innerHeight) {
    chart.scrollIntoView({ block: 'start' })
  }
})

window.renderIndustry = render
ensureSource('industry')
render()
