import { buildIndexCards } from './index-strip-core.js'

// Reuse the dashboard's saved snapshot. This strip never fetches prices,
// opens an API/event subscription, or schedules a refresh of its own.
const root = document.querySelector('[data-index-strip]')
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const number = value => Number.isFinite(value) ? value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const zones = { 'America/New_York': '뉴욕', 'Asia/Seoul': '한국' }
let saved = window.aiChainSnapshot || null
let error = ''
let attempted = Boolean(saved)

function render() {
  if (!root) return
  const cards = buildIndexCards(saved)
  const target = root.querySelector('[data-index-strip-cards]')
  const status = root.querySelector('[data-index-strip-status]')
  if (!target || !status) return
  status.textContent = error
    ? '저장 자료 조회 실패 · 남아 있는 값 표시'
    : !attempted ? '실시간 갱신 중지 · 저장 자료 확인 중' : '실시간 갱신 중지 · 저장된 종가'
  status.title = error
  target.innerHTML = cards.map(card => {
    const value = card.available ? card.price : null
    const change = card.available ? card.changePercent : null
    const direction = Number.isFinite(change) ? change > 0 ? 'up' : change < 0 ? 'down' : 'flat' : 'flat'
    const arrow = Number.isFinite(change) ? change > 0 ? '▲' : change < 0 ? '▼' : '—' : ''
    const rate = Number.isFinite(change) ? `${arrow} ${number(Math.abs(change))}%` : '—'
    const label = !attempted ? '저장 자료 확인 중' : !card.available ? card.reason || '저장 자료 없음' : card.stale ? '이전 저장값' : '저장 종가'
    const zone = zones[card.timezone] || card.timezone || '현지 기준'
    const close = card.available && card.closeDate ? `${card.closeDate} · ${zone}` : '확인된 종가 없음'
    const provenance = [card.source, card.fetchedAt ? `수집 시각 ${card.fetchedAt}` : '', card.lastAttemptAt ? `마지막 시도 ${card.lastAttemptAt}` : '', card.error || ''].filter(Boolean).join(' · ')
    const source = /^https?:\/\//.test(card.sourceUrl || '')
      ? `<a class="index-strip-source" href="${escape(card.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(card.name)} 저장 자료 출처">출처 ↗</a>` : ''
    return `<article class="index-strip-card${card.ai ? ' is-ai' : ''}${!card.available ? ' is-unavailable' : ''}" role="listitem" data-index-symbol="${escape(card.symbol)}" title="${escape(provenance)}">
      <div class="index-strip-name"><span class="index-strip-flag" aria-hidden="true">${escape(card.flag)}</span><span>${escape(card.name)}</span>${card.ai ? '<span class="index-strip-ai">AI</span>' : ''}</div>
      <div class="index-strip-value">${number(value)}</div>
      <div class="index-strip-change is-${direction}" aria-label="${Number.isFinite(change) ? `직전 저장 종가 대비 ${change > 0 ? '상승' : change < 0 ? '하락' : '보합'} ${number(Math.abs(change))}%` : '등락률 미확보'}">${rate}</div>
      <div class="index-strip-meta"><span><i class="index-strip-dot" aria-hidden="true"></i>${escape(label)}</span>${source}</div>
      <div class="index-strip-date">${escape(close)}</div>
    </article>`
  }).join('')
}

if (root) {
  render()
  window.addEventListener('market-snapshot', event => {
    saved = event.detail
    attempted = true
    error = ''
    render()
  })
  window.addEventListener('market-snapshot-error', event => {
    attempted = true
    error = String(event.detail || '저장 자료를 확인할 수 없습니다.')
    render()
  })
}
