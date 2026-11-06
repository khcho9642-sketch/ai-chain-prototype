const numberFormat = new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 12 })
const tickFormat = new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 3 })
const compactTickFormat = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumSignificantDigits: 3 })
const operators = { eq: '', approx: '≈ ', gt: '> ', lt: '< ' }
const ranges = [12, 24, 36]
const tableStatus = {
  provisional: '잠정', final: '확정', unaudited: '미감사', published: '공표값',
  official: '공식 발표', reported: '보도 수치', estimated: '추정치', research: '연구·조사',
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function sourceLink(label, url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) {
      return `<a href="${escapeText(parsed.href)}" target="_blank" rel="noopener noreferrer">${escapeText(label || parsed.hostname)} ↗</a>`
    }
  } catch { /* Some original records name a source without a link. */ }
  return escapeText(label || '출처 미상')
}

export function formatMetricValue(point) {
  if (!Number.isFinite(point?.value)) return '—'
  return (operators[point.operator] ?? '') + numberFormat.format(point.value)
}

function validPoints(metric) {
  return metric.points.filter(point => Number.isFinite(point.value) && point.label)
}

function monthlyWindow(points, months) {
  if (!points.length) return points
  const end = Math.max(...points.map(point => point.ordinal))
  return points.filter(point => point.ordinal > end - months).sort((a, b) => a.ordinal - b.ordinal)
}

function tooltip(point, metric) {
  return `${point.label} · ${formatMetricValue(point)} ${metric.unit}`
}

function shortLabel(label) {
  const characters = Array.from(label)
  return characters.length > 24 ? characters.slice(0, 22).join('') + '…' : label
}

function timeChart(metric, points) {
  const values = points.map(point => point.value)
  let ymin = Math.min(0, ...values)
  let ymax = Math.max(0, ...values)
  if (ymax === ymin) ymax += 1
  const pad = (ymax - ymin) * .08
  if (ymin < 0) ymin -= pad
  if (ymax > 0) ymax += pad
  const y = value => `${100 * (ymax - value) / (ymax - ymin)}%`
  const dated = points.every(point => Number.isFinite(point.ordinal))
  const positions = points.map((point, index) => dated ? point.ordinal : index)
  const start = Math.min(...positions), end = Math.max(...positions)
  const x = index => start === end ? '50%' : `${100 * (positions[index] - start) / (end - start)}%`
  const grid = [0, .25, .5, .75, 1].map(fraction => {
    const value = ymin + (ymax - ymin) * fraction
    return `<line class="sector-chart-grid" x1="0%" x2="100%" y1="${y(value)}" y2="${y(value)}" stroke="var(--line)" />
      <text class="sector-chart-tick" x="0%" dx="-9" y="${y(value)}" dy="4" text-anchor="end" fill="var(--muted)" font-size="12">${escapeText((Math.abs(value) >= 10000 ? compactTickFormat : tickFormat).format(value))}</text>`
  }).join('')
  const markers = points.map((point, index) => {
    const previous = points[index - 1]
    const connect = metric.kind === 'monthly' && previous && point.ordinal === previous.ordinal + 1
    const segment = connect ? `<line class="sector-chart-line" x1="${x(index - 1)}" y1="${y(previous.value)}" x2="${x(index)}" y2="${y(point.value)}" stroke="var(--accent)" stroke-width="2.5" />` : ''
    const valueLabel = points.length <= 4
      ? `<text class="sector-chart-point-label" x="${x(index)}" y="${y(point.value)}" dy="-9" text-anchor="${labelAnchor(index, points.length)}" fill="var(--ink)" font-size="13">${escapeText(formatMetricValue(point))}</text>` : ''
    return `${segment}<circle class="sector-chart-point" cx="${x(index)}" cy="${y(point.value)}" r="${points.length <= 4 ? 5 : 3.5}" fill="var(--accent)"><title>${escapeText(tooltip(point, metric))}</title></circle>${valueLabel}`
  }).join('')
  const maxTicks = metric.kind === 'monthly' ? 5 : 3
  const tickCount = Math.min(points.length, maxTicks)
  const ticks = Array.from({ length: tickCount }, (_, tick) => {
    const index = tickCount === 1 ? 0 : Math.round(tick / (tickCount - 1) * (points.length - 1))
    const label = points[index].label
    const middle = tick > 0 && tick < tickCount - 1
    const sparseTick = metric.kind === 'monthly' && middle && (tickCount === 4 || tick % 2 === 1)
    const staggered = metric.kind !== 'monthly' && middle
    const tickClass = sparseTick ? ' sector-chart-minor-tick' : staggered ? ' sector-chart-staggered-tick' : ''
    return `<text class="sector-chart-tick${tickClass}" x="${x(index)}" y="100%" dy="23" text-anchor="${labelAnchor(index, points.length)}" fill="var(--muted)" font-size="13"><title>${escapeText(label)}</title>${escapeText(shortLabel(label))}</text>`
  }).join('')
  return `<div class="sector-chart-scroll"><svg class="sector-chart-svg" width="100%" height="180" role="img" aria-labelledby="sector-svg-title sector-svg-desc">
    <title id="sector-svg-title">${escapeText(metric.name)} · ${escapeText(metric.unit)}</title>
    <desc id="sector-svg-desc">${escapeText(points[0].label)}${points.length === 1 ? '' : ' ~ ' + escapeText(points.at(-1).label)} · 관측 ${points.length}개. 정확한 값은 아래 원자료 표에서 확인할 수 있습니다.</desc>
    ${grid}${markers}${ticks}</svg></div>`
}

function labelAnchor(index, length) {
  if (length === 1) return 'middle'
  if (index === 0) return 'start'
  return index === length - 1 ? 'end' : 'middle'
}

function comparisonChart(metric, points) {
  const shown = [...points].sort((a, b) => b.value - a.value).slice(0, 8)
  const maximum = Math.max(...shown.map(point => point.value), 0)
  const rows = shown.map(point => {
    const percent = maximum ? point.value / maximum * 100 : 0
    return `<li><span class="sector-comparison-name">${escapeText(point.label)}</span>
      <span class="sector-comparison-track" aria-hidden="true"><span style="width:${percent}%"></span></span>
      <span class="sector-comparison-value">${escapeText(formatMetricValue(point))}</span></li>`
  }).join('')
  return `<ol class="sector-comparison" aria-label="${escapeText(metric.name)} 값이 큰 순서">${rows}</ol>`
}

function rawTable(metric, points) {
  const header = metric.kind === 'comparison' ? '비교 항목' : '기준 시점'
  const hasYoy = points.some(point => 'yoy' in point)
  const hasStatus = points.some(point => point.status || point.evidence)
  const rows = points.map(point => {
    const status = point.status || point.evidence
    return `<tr><th scope="row">${escapeText(point.label)}</th><td>${escapeText(formatMetricValue(point))}</td>
      ${hasYoy ? `<td>${Number.isFinite(point.yoy) ? `${point.yoy.toLocaleString('ko-KR', {maximumFractionDigits: 2})}%` : '—'}</td>` : ''}
      ${hasStatus ? `<td>${escapeText(tableStatus[status] || status || '—')}</td>` : ''}
      <td>${sourceLink(point.source || metric.source, point.sourceUrl || metric.sourceUrl)}</td></tr>`
  }).join('')
  return `<div class="sector-raw-actions"><button type="button" class="f" data-sector-csv>원자료 CSV ↓</button></div>
    <details class="sector-raw"><summary>원자료 표 · 전체 ${points.length.toLocaleString('ko-KR')}개</summary>
      <div class="sector-raw-scroll"><table class="tbl"><caption class="sr">${escapeText(metric.name)} 전체 원자료</caption>
      <thead><tr><th scope="col">${header}</th><th scope="col">값 (${escapeText(metric.unit)})</th>${hasYoy ? '<th scope="col">전년 동월 증감</th>' : ''}${hasStatus ? '<th scope="col">근거·상태</th>' : ''}<th scope="col">출처</th></tr></thead><tbody>${rows}</tbody></table></div></details>`
}

export function metricDetailHTML(metric, months = 24) {
  if (!metric) return ''
  const all = validPoints(metric)
  const selectedMonths = ranges.includes(months) ? months : 24
  const monthly = metric.kind === 'monthly'
  const points = monthly ? monthlyWindow(all, selectedMonths) : all
  const comparison = metric.kind === 'comparison'
  const period = points.length > 1 ? `${points[0].label} ~ ${points.at(-1).label}` : points[0]?.label
  const caption = comparison ? `수치 공개 ${all.length.toLocaleString('ko-KR')}개 중 상위 ${Math.min(all.length, 8)}개 · ${metric.unit}`
    : `${period || ''} · ${metric.unit} · 관측 ${points.length}개`
  const buttons = monthly ? `<div class="sector-chart-ranges" role="group" aria-label="그래프 표시 기간">${ranges.map(range =>
    `<button type="button" class="f${range === selectedMonths ? ' on' : ''}" data-sector-months="${range}" aria-pressed="${range === selectedMonths}">${range}개월</button>`).join('')}</div>` : ''
  const figure = points.length ? `<figure class="sector-chart-figure"><figcaption class="sector-chart-caption">${escapeText(caption)}</figcaption>
      ${comparison ? comparisonChart(metric, points) : timeChart(metric, points)}</figure>` : '<p class="note">표시할 관측값이 없습니다.</p>'
  return `<section class="panel sec sector-detail" aria-labelledby="sector-chart-title">
    <div class="sector-detail-head"><div><h2 id="sector-chart-title">${escapeText(metric.name)}</h2>
      <p class="sector-chart-scope">${escapeText([metric.scope, metric.unit].filter(Boolean).join(' · '))}</p>
      <p class="sector-chart-source">${sourceLink(metric.source, metric.sourceUrl)}</p></div>${buttons}</div>
    ${figure}${all.length ? rawTable(metric, all) : ''}</section>`
}

function csvCell(value) {
  const text = String(value ?? '')
  const protect = typeof value !== 'number' && (/^\s*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
  return '"' + (protect ? "'" : '') + text.replaceAll('"', '""') + '"'
}

export function metricCsv(metric) {
  const header = ['metric_id', 'metric', 'period_or_item', 'operator', 'value', 'unit', 'scope', 'status', 'evidence', 'source', 'source_url', 'published_at', 'verified_at', 'yoy_percent']
  const rows = validPoints(metric).map(point => [metric.id, metric.name, point.label, point.operator || 'eq', point.value, metric.unit, metric.scope,
    point.status, point.evidence, point.source || metric.source, point.sourceUrl || metric.sourceUrl, point.publishedAt, point.verifiedAt ?? point.checkedAt, point.yoy])
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
}
