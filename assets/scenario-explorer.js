import { DRIVER_DEFINITIONS } from './scenario-data.js'

const finite = Number.isFinite
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

const direction = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'flat'

function percent(value) {
  if (!finite(value)) return '산정 불가'
  if (value === 0) return '0.00%'
  const sign = value > 0 ? '+' : '−'
  const magnitude = Math.abs(value)
  return `${sign}${magnitude.toFixed(magnitude < 0.005 ? 4 : 2)}%`
}

function originsOf(segments) {
  return new Set(segments.filter(segment => segment.paths.some(path =>
    !path.mediatedBy && path.segments.length === 1 && path.segments[0] === segment.segmentId && path.impactPoints !== 0,
  )).map(segment => segment.segmentId))
}

function defaultSector(view, origins) {
  if (view.scenario.id === 'interest_rate') return 'SEG9'
  if (origins.size > 0) return origins.values().next().value
  // At neutral input there is no active origin. Open the sector the first control acts on.
  const firstDriver = view.scenario.drivers[0]
  return DRIVER_DEFINITIONS[firstDriver?.driverId]?.seeds.find(seed => seed.applyToSeed)?.segmentId
}

function sectorScale(segments) {
  const peak = Math.max(1, ...segments.map(segment => finite(segment.valueChangePct) ? Math.abs(segment.valueChangePct) : 0))
  const unit = 10 ** Math.floor(Math.log10(peak))
  return [1, 2, 5, 10].find(step => step * unit >= peak) * unit
}

export function sectorConclusion(view) {
  const segments = view?.segments || []
  const ordered = segments.filter(segment => finite(segment.valueChangePct))
    .sort((a, b) => b.valueChangePct - a.valueChangePct)
  if (!ordered.length) return '섹터 지수를 계산할 수 없습니다.'
  const high = ordered[0], low = ordered.at(-1)
  const ups = ordered.filter(segment => segment.valueChangePct > 0).length
  const downs = ordered.filter(segment => segment.valueChangePct < 0).length
  if (!ups && !downs) return `산정된 ${ordered.length}개 섹터 지수가 모두 기준 100입니다.`
  if (ups && downs) return `상승폭이 가장 큰 섹터는 ${high.name}(${percent(high.valueChangePct)}), 하락폭이 가장 큰 섹터는 ${low.name}(${percent(low.valueChangePct)})입니다.`
  const winner = ups ? high : low
  return `${ups || downs}개 섹터 지수가 ${ups ? '상승' : '하락'}했고, 가장 크게 움직인 섹터는 ${winner.name}(${percent(winner.valueChangePct)})입니다.`
}

function sectorCard(segment, selectedId, origin, scale, position) {
  const value = segment.valueChangePct
  const tone = direction(value)
  const height = finite(value) ? (50 * Math.abs(value) / scale).toFixed(3) : 0
  const edge = value < 0 ? 'top' : 'bottom'
  const name = escapeHtml(segment.name)
  const index = finite(segment.scenarioValueIndex) ? segment.scenarioValueIndex.toFixed(2) : '—'
  return `<button type="button" class="scenario-sector-tile" data-explore-sector="${escapeHtml(segment.segmentId)}" aria-pressed="${segment.segmentId === selectedId}" aria-controls="scenario-explorer-members">
    <span class="scenario-sector-meta"><span class="scenario-sector-id" aria-hidden="true">${String(position + 1).padStart(2, '0')}</span>${origin ? '<span class="scenario-sector-origin">충격 시작</span>' : ''}</span>
    <strong class="scenario-sector-title">${name}</strong>
    <span class="scenario-sector-meter" aria-hidden="true"><i class="${tone}" style="height:${height}%;${edge}:50%"></i></span>
    <strong class="scenario-sector-value ${tone}">${percent(value)}</strong>
    <small class="scenario-sector-index">지수 ${index}</small>
  </button>`
}

function companyButton(company, { selectedCompanyId, renderBar, scale }) {
  const id = escapeHtml(company.companyId)
  const index = finite(company.scenarioValueIndex) ? `100 → ${company.scenarioValueIndex.toFixed(2)}` : '지수 산정 불가'
  const isPrivate = company.listingStatus === 'private'
  const basis = isPrivate ? '공개 재무 없음 · 섹터 가정' : company.symbol
  const tag = [basis, company.isBig7 ? 'Big 7' : ''].filter(Boolean).join(' · ')
  return `<button type="button" class="scenario-explorer-row${isPrivate ? ' private' : ''}" data-explore-company data-company-row data-company-id="${id}" aria-pressed="${company.companyId === selectedCompanyId}">
    <span class="scenario-explorer-company"><strong>${escapeHtml(company.name)}</strong><small>${escapeHtml(tag)}</small></span>
    ${renderBar(company, scale) || '<span class="scenario-explorer-no-bar" aria-hidden="true"></span>'}
    <span class="scenario-explorer-total ${direction(company.totalPct)}"><strong>${percent(company.totalPct)}</strong><small>${index}</small></span>
  </button>`
}

export function renderExplorer(view, options) {
  if (!view?.segments?.length) return ''
  const origins = originsOf(view.segments)
  const isBroadShock = origins.size === view.segments.length
  const preferred = options.selectedSegmentId || defaultSector(view, origins)
  const selected = view.segments.find(segment => segment.segmentId === preferred) || view.segments[0]
  const memberIds = new Set(selected.memberCompanyIds)
  const members = view.companies.filter(company => memberIds.has(company.companyId))
    .sort((a, b) => Number(b.primarySegmentId === selected.segmentId) - Number(a.primarySegmentId === selected.segmentId))
  const comparable = view.companies.filter(company => finite(company.totalPct))
  const top = comparable.filter(company => company.totalPct !== 0)
    .sort((a, b) => Math.abs(b.totalPct) - Math.abs(a.totalPct)).slice(0, 8)
  const bound = sectorScale(view.segments)
  const rows = companies => companies.map(company => companyButton(company, options)).join('')
  let originText = isBroadShock ? `충격 · ${view.segments.length}개 섹터에 직접 적용` : ''
  const transmission = view.scenario.rateCapexTransmission
  if (transmission) {
    if (transmission.rateChangePctPoints === 0) originText = '금리 변화 0%p · CAPEX 경유 전파 0%'
    else {
      const hasBudgetChange = Object.values(transmission.ownerChangesPct ?? {}).some(change => change !== 0) || transmission.derivedCapexChangePct !== 0
      const capexLabel = hasBudgetChange ? '빅테크 AI CAPEX 경유 전파' : 'CAPEX 민감도 0 · 전파효과 0%'
      originText = `금리 · ${view.segments.length}개 섹터에 직접 적용 · ${capexLabel}`
    }
  }
  const denominator = comparable.length === view.companies.length ? `전체 ${comparable.length}개사` : `산정 가능 ${comparable.length}/${view.companies.length}개사`
  return `<section class="scenario-explorer" aria-labelledby="scenario-explorer-heading">
    <div class="scenario-explorer-heading"><div><h2 id="scenario-explorer-heading">9개 섹터 가치 변화</h2><p>섹터별 가정으로 계산한 지수 · 기준 100 · 막대 눈금 ±${bound}%</p></div>${originText ? `<span class="scenario-explorer-origins">${originText}</span>` : ''}</div>
    <div class="scenario-sector-grid" role="group" aria-label="기업을 살펴볼 섹터">${view.segments.map((segment, position) => sectorCard(segment, selected.segmentId, !isBroadShock && origins.has(segment.segmentId), bound, position)).join('')}</div>
    <div class="scenario-explorer-panels">
      <section class="scenario-explorer-panel" id="scenario-explorer-members" aria-labelledby="scenario-explorer-members-heading">
        <div class="scenario-explorer-panel-heading"><h3 id="scenario-explorer-members-heading">${escapeHtml(selected.name)} 기업</h3><small>${members.length}개사 · 전사 EV 기준</small></div>
        <div class="scenario-explorer-list">${rows(members)}</div>
      </section>
      <section class="scenario-explorer-panel" aria-labelledby="scenario-explorer-ranking-heading">
        <div class="scenario-explorer-panel-heading"><h3 id="scenario-explorer-ranking-heading">가장 크게 움직이는 기업</h3><small>${denominator} · 절대 변화폭순</small></div>
        <div class="scenario-explorer-list">${top.length ? rows(top) : `<p class="scenario-explorer-empty">${comparable.length ? '현재 입력에서 기업가치 변화가 없습니다.' : '변화율을 산정할 수 있는 기업이 없습니다.'}</p>`}</div>
      </section>
    </div>
    <p class="scenario-explorer-legend">기업 막대는 진한색이 직접효과, 연한색이 전파효과입니다. 세로 표시는 두 효과를 합한 총 EV 변화입니다.</p>
  </section>`
}
