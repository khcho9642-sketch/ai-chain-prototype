import { instruments } from './instruments.js'
import { TODAY_AGENTS, kstDate, validateTodaySnapshot, todayCards } from './today-core.js'
import { communityEvidenceUrl } from './community-ui-core.js'

const root = document.getElementById('v-today')
const chains = ['소부장', '파운드리·패키징', '메모리', 'AI 칩', '전력', '인프라', '모델', '애플리케이션']
const state = { snapshot: null, busy: false, loaded: false, error: false }
let controller, generation = 0, dayTimer
const node = (tag, content, attrs = {}) => {
  const element = document.createElement(tag)
  if (content != null) element.textContent = String(content)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
  return element
}
const active = () => root && !root.hidden
const timeLabel = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return '기준 시각 미확인'
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' KST'
}
const reasonLabel = value => ({
  verification_pending: '실제 응답 검증 대기', provider_verification_pending: '실제 응답 검증 대기',
  terms_unverified: '이용 조건 확인 대기', terms_pending: '이용 조건 확인 대기',
  usage_review_required: '이번 추천 용도의 이용 조건 확인 대기',
  cli_unavailable: '공식 CLI 실행 환경 확인 대기', cli_not_installed: '공식 CLI 실행 환경 확인 대기',
  disabled: '현재 참여 중지', not_published: '검증된 추천이 아직 없습니다.',
})[value] || (typeof value === 'string' && /[가-힣]/u.test(value) ? value : '실제 응답 검증 대기')

function sourceDetails(pick) {
  const details = node('details', null, { class: 'today-sources' })
  details.append(node('summary', '근거 · 작성 출처'))
  const provenance = pick.provenance || {}, info = node('div', null, { class: 'today-source-content' })
  info.append(node('p', '제공사 ' + (TODAY_AGENTS[provenance.provider]?.name || provenance.provider || '미확인')),
    node('p', '요청 모델 ' + (provenance.requestedModel || '미확인')),
    node('p', provenance.reportedModel ? '실제 응답 모델 ' + provenance.reportedModel : '실제 모델명 미확인'),
    node('p', 'CLI ' + (provenance.cliVersion || '미확인')),
    node('p', '실제 생성 ' + timeLabel(provenance.generatedAt)),
    node('p', '검수 ' + timeLabel(provenance.reviewedAt)))
  for (const evidence of pick.evidence || []) {
    const item = node('article', null, { class: 'today-evidence' })
    item.append(node('strong', evidence.label || '원문 자료'), node('small', '자료 기준 ' + timeLabel(evidence.observedAt)), node('small', '수집 ' + timeLabel(evidence.collectedAt)))
    const url = communityEvidenceUrl(evidence.sourceUrl)
    if (url) item.append(node('a', '근거 원문 ↗', { href: url, target: '_blank', rel: 'noopener noreferrer' }))
    info.append(item)
  }
  info.append(node('p', '근거 링크가 내용 전체의 사실 검증을 뜻하지는 않습니다.', { class: 'note' }))
  details.append(info)
  return details
}

function renderCard(card, { archived = false } = {}) {
  const article = node('article', null, { class: `today-card today-agent-${card.agent}`, [archived ? 'data-today-archive-agent' : 'data-today-agent']: card.agent })
  const header = node('div', null, { class: 'today-agent-heading' })
  header.append(node('div', card.name || TODAY_AGENTS[card.agent]?.name, { class: 'today-agent-name' }), node('span', 'AI', { class: 'today-ai-label' }))
  article.append(header, node('p', card.style || TODAY_AGENTS[card.agent]?.style || '', { class: 'today-agent-style' }))
  const pick = card.pick, published = !!pick && (archived || card.state === 'published')
  article.dataset.state = card.state
  if (!published) {
    const empty = node('div', null, { class: 'today-empty' })
    empty.append(node('span', '아직 발행되지 않았어요', { class: 'today-pick-kicker' }), node('h3', '추천 미발행'),
      node('p', state.error ? '발행 자료를 확인할 수 없습니다.' : card.state === 'previous-edition' ? '오늘의 추천은 아직 없습니다.' : reasonLabel(card.reason)))
    article.append(empty, node('p', card.state === 'previous-edition' && pick ? '이전 추천은 아래 지난 발행에서 확인할 수 있습니다.' : '검증된 실제 응답만 이 자리에 표시합니다.', { class: 'today-empty-note' }))
    return article
  }
  const company = instruments.find(item => item.symbol === pick.symbol)
  article.dataset.pickId = pick.id
  const title = node('div', null, { class: 'today-company' })
  title.append(node('p', archived ? '지난 추천 종목' : '오늘 고른 종목', { class: 'today-pick-kicker' }), node('h3', company?.name || pick.symbol), node('span', pick.symbol, { class: 'today-ticker mono' }))
  if (company?.chains?.length) title.append(node('p', company.chains.filter(id => id >= 1 && id <= 8).map(id => chains[id - 1]).join(' · '), { class: 'today-chain' }))
  article.append(title, node('p', pick.comment, { class: 'today-comment', 'data-today-comment': '' }))
  const meta = node('div', null, { class: 'today-pick-meta' })
  meta.append(node('time', '작성 ' + timeLabel(pick.createdAt), { datetime: pick.createdAt }), node('span', '자료 기준 ' + timeLabel(pick.dataAsOf)))
  if (!pick.provenance?.reportedModel) meta.append(node('span', '실제 모델명 미확인'))
  article.append(meta, sourceDetails(pick))
  const actions = node('div', null, { class: 'today-card-actions' })
  actions.append(node('button', '종목 · 차트', { type: 'button', 'data-market-symbol': pick.symbol, 'aria-label': `${company?.name || pick.symbol} 종목 · 차트` }),
    node('a', '생각 나누기 →', { href: `#talk/${encodeURIComponent(pick.symbol)}` }))
  article.append(actions)
  return article
}

function cardsForSnapshot() {
  if (state.snapshot) return todayCards(state.snapshot, { catalog: instruments, now: Date.now() })
  return Object.entries(TODAY_AGENTS).map(([agent, info]) => ({ agent, ...info, pick: null, state: 'unavailable', reason: state.busy ? '발행 결과를 확인하고 있습니다.' : '실제 응답 검증 대기' }))
}

function render() {
  clearTimeout(dayTimer)
  const nextMidnight = (Math.floor((Date.now() + 9 * 3600000) / 86400000) + 1) * 86400000 - 9 * 3600000
  dayTimer = setTimeout(render, Math.max(50, nextMidnight - Date.now() + 50))
  if (!active()) return
  const now = Date.now(), currentDate = kstDate(now)
  root.querySelector('[data-today-date]').textContent = new Date(now).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) + ' · KST'
  const cards = cardsForSnapshot(), grid = root.querySelector('[data-today-cards]')
  grid.replaceChildren(...cards.map(card => renderCard(card)))
  const published = cards.filter(card => card.state === 'published' && card.pick).length
  root.querySelector('[data-today-status]').textContent = state.error ? '발행 자료를 불러오지 못했습니다. 다시 읽기로 확인해주세요.' :
    state.busy ? '저장된 발행 자료를 읽고 있습니다.' : published ? `${currentDate} · ${published}개 AI의 추천 발행 · 실제 작성 시각과 근거를 확인하세요.` : '검증된 실제 응답이 발행되면 각 AI의 추천과 한마디가 표시됩니다.'
  const refresh = root.querySelector('[data-today-refresh]')
  refresh.disabled = state.busy; refresh.textContent = state.busy ? '읽는 중…' : '다시 읽기'
  const older = cards.filter(card => card.state === 'previous-edition' && card.pick), archive = root.querySelector('[data-today-archive]')
  archive.hidden = !older.length
  if (older.length) {
    archive.querySelector('summary').textContent = `지난 발행 보기 · ${state.snapshot.editionDate} · 오늘의 추천이 아닙니다`
    archive.querySelector('[data-today-archive-cards]').replaceChildren(...older.map(card => renderCard(card, { archived: true })))
  } else root.querySelector('[data-today-archive-cards]').replaceChildren()
}

async function readEdition() {
  if (state.busy) return
  state.busy = true; state.error = false; render()
  controller?.abort(); controller = new AbortController(); const current = ++generation
  try {
    const response = await fetch('./data/today-picks.json', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), redirect: 'error' })
    if (!response.ok) throw new Error('edition_unavailable')
    const value = await response.json()
    validateTodaySnapshot(value, { catalog: instruments, now: Date.now() })
    if (current !== generation) return
    state.snapshot = value; state.loaded = true
  } catch (error) {
    if (current !== generation || error.name === 'AbortError') return
    state.error = true; state.snapshot = null
  } finally {
    if (current === generation) { state.busy = false; render() }
  }
}
function mount() {
  if (!active()) return
  render()
  if (!state.loaded && !state.busy && !state.error) readEdition()
}
if (root) {
  root.querySelector('[data-today-refresh]').addEventListener('click', readEdition)
  window.renderToday = mount
  window.addEventListener('hashchange', mount)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render() })
  window.addEventListener('pagehide', () => { clearTimeout(dayTimer); controller?.abort() })
  window.addEventListener('pageshow', mount)
  document.querySelectorAll('.nav-more a').forEach(link => link.addEventListener('click', () => { link.closest('details').open = false }))
  mount()
}
