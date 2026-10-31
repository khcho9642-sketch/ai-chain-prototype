import { instruments } from './instruments.js'
import { TODAY_AGENTS, kstDate, validateTodaySnapshot, todayCards, getTodayComment, getTodayPriceComparison, getTodayWebProvider } from './today-core.js'
import { communityEvidenceUrl } from './community-ui-core.js'

const root = document.getElementById('v-today')
const chains = ['소부장', '파운드리·패키징', '메모리', 'AI 칩', '전력', '인프라', '모델', '애플리케이션']
const state = { snapshot: null, marketSnapshot: window.aiChainSnapshot || null, marketError: false, busy: false, loaded: false, error: false }
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
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' KST'
}
const priceLabel = (price, currency) => Number.isFinite(price) && price > 0 && /^[A-Z]{3}$/u.test(currency || '')
  ? price.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + ' ' + currency : null
const quoteFor = symbol => {
  const quote = state.marketSnapshot?.quotes?.find(item => item.symbol === symbol)
  if (!quote || !priceLabel(quote.price, quote.currency) || !Number.isFinite(quote.marketTime) || quote.marketTime <= 0 || quote.marketTime * 1000 > Date.now() + 300000) return null
  return quote
}

function priceFields(pick, { showComparison = false } = {}) {
  const fields = node('dl', null, { class: 'today-price-fields' })
  const quote = pick ? quoteFor(pick.symbol) : null
  const field = (label, value, key, note) => {
    const row = node('div', null, { class: 'today-price-field', 'data-today-field': key })
    const description = node('dd', null)
    description.append(node('span', value, { class: 'today-price-value', [`data-today-${key}`]: '' }))
    if (note) description.append(node('small', note, { class: 'today-price-note' }))
    row.append(node('dt', label), description)
    fields.append(row)
  }
  const failed = state.marketError || (quote?.status && quote.status !== 'ok')
  const quoteNote = quote ? [failed ? '이전 확인값 · 조회 실패' : null, quote.delayed ? '지연 시세' : null, quote.source].filter(Boolean).join(' · ') : null
  field('현재 시가', quote ? priceLabel(quote.price, quote.currency) : pick ? '시세 미확인' : '—', 'price', quoteNote)
  field('시가 기준일', quote ? timeLabel(new Date(quote.marketTime * 1000).toISOString()) : '—', 'price-as-of')
  field('AI 추정 가격', pick?.kind === 'earnings-review' ? '가격 평가 없음' : pick?.fairValue ? priceLabel(pick.fairValue.price, pick.fairValue.currency) : '미산정', 'fair-value', pick?.fairValue ? 'AI 추정 · ' + timeLabel(pick.fairValue.asOf) : null)
  if (showComparison) {
    const comparison = getTodayPriceComparison(pick, quote, { marketError: state.marketError })
    const percent = comparison.differencePercent
    const value = percent === null ? '—' : percent === 0 ? '0.00%' : (percent > 0 ? '+' : '−') + (Math.abs(percent) < 0.01 ? '0.01% 미만' : Math.abs(percent).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%')
    const label = { above: '추정 가격이 시가보다 높음', below: '상승 여력 조건 미충족', equal: '상승 여력 조건 미충족', missing: '가격 추정 보류', unavailable: '비교 불가' }[comparison.status]
    field('시가 대비 추정 차이', value, 'estimate-gap', label)
    fields.querySelector('[data-today-field="estimate-gap"]').dataset.estimateState = comparison.status
  }
  return fields
}
const reasonLabel = value => ({
  verification_pending: '실제 응답 검증 대기', provider_verification_pending: '실제 응답 검증 대기',
  terms_unverified: '이용 조건 확인 대기', terms_pending: '이용 조건 확인 대기',
  usage_review_required: '이번 추천 용도의 이용 조건 확인 대기',
  terms_not_cleared: '현재 이용 조건으로 추천 참여 불가', authentication_required: 'Google 로그인 대기',
  consumer_client_retired: '개인용 Gemini CLI 지원 종료로 참여 불가',
  isolation_unverified: '도구 차단·격리 검증 대기',
  awaiting_manual_review: '실제 원고 검토·발행 대기',
  cli_unavailable: '공식 CLI 실행 환경 확인 대기', cli_not_installed: '공식 CLI 실행 환경 확인 대기',
  disabled: '현재 참여 중지', not_published: '검증된 추천이 아직 없습니다.',
  no_distinct_candidates: '아직 선택되지 않은 다른 종목의 근거가 없습니다.',
  duplicate_daily_pick_symbol: '이미 선택된 종목과 겹쳐 발행하지 않았습니다.',
})[value] || (typeof value === 'string' && /[가-힣]/u.test(value) ? value : '실제 응답 검증 대기')

function sourceDetails(pick) {
  const details = node('details', null, { class: 'today-sources' })
  details.append(node('summary', '근거 · 작성 출처'))
  const provenance = pick.provenance || {}, info = node('div', null, { class: 'today-source-content' })
  const webProvider = getTodayWebProvider(provenance), webName = TODAY_AGENTS[webProvider]?.name
  if (pick.conversationComment) {
    const comment = pick.conversationComment, author = comment.provenance
    const detail = node('article', null, { class: 'today-evidence' })
    detail.append(node('strong', '댓글 작성 출처'),
      node('p', '기존 의견을 같은 AI가 짧은 대화체로 다시 작성했습니다.'),
      node('p', '요청 모델 ' + author.requestedModel),
      node('p', author.reportedModel ? '실제 응답 모델 ' + author.reportedModel : '실제 모델명 미확인'),
      node('p', 'CLI ' + author.cliName + ' · ' + author.cliVersion),
      node('p', '댓글 생성 ' + timeLabel(author.generatedAt)),
      node('p', '댓글 발행 ' + timeLabel(comment.createdAt)),
      node('p', '댓글 SHA-256 ' + author.responseSha256, { class: 'today-response-digest mono' }))
    info.append(detail, node('strong', '원래 의견서 작성 출처'))
  }
  info.append(node('p', '제공사 ' + (TODAY_AGENTS[provenance.provider]?.name || provenance.provider || '미확인')),
    node('p', (webProvider ? '화면 선택 모델 ' : '요청 모델 ') + (provenance.requestedModel || '미확인')),
    node('p', provenance.reportedModel ? '실제 응답 모델 ' + provenance.reportedModel : '실제 모델명 미확인'),
    node('p', webProvider ? '실행 환경 ' + webName + ' 웹 · 앱 버전 미공개' : 'CLI ' + ([{ codex: 'Codex', 'claude-code': 'Claude Code', antigravity: 'Antigravity' }[provenance.cliName], provenance.cliVersion].filter(Boolean).join(' ') || '미확인')),
    node('p', (webProvider ? '웹 응답 확인 ' : '실제 생성 ') + timeLabel(provenance.generatedAt)),
    node('p', '검수 ' + timeLabel(provenance.reviewedAt)))
  if (provenance.execution === 'owner-reviewed-one-off') info.append(node('p', webProvider ? '공식 ' + webName + ' 웹에서 받은 응답 · 화면에서 복사한 원문을 검토 후 수동 발행' : '실제 CLI 응답 원문 · 운영자 검토 후 수동 발행'))
  if (provenance.responseSha256) info.append(node('p', '원문 SHA-256 ' + provenance.responseSha256, { class: 'today-response-digest mono' }))
  for (const evidence of pick.evidence || []) {
    const item = node('article', null, { class: 'today-evidence' })
    item.append(node('strong', evidence.label || '원문 자료'), node('small', '자료 기준 ' + timeLabel(evidence.observedAt)), node('small', '수집 ' + timeLabel(evidence.collectedAt)))
    const url = communityEvidenceUrl(evidence.sourceUrl)
    if (url) item.append(node('a', '근거 원문 ↗', { href: url, target: '_blank', rel: 'noopener noreferrer' }))
    info.append(item)
  }
  if (pick.comparisonSources?.length) {
    info.append(node('strong', '비교에 사용한 타사 원문'))
    for (const source of pick.comparisonSources) {
      const item = node('article', null, { class: 'today-evidence' }), url = communityEvidenceUrl(source.sourceUrl)
      item.append(node('strong', source.symbol + ' · ' + source.label), node('small', '확인 ' + timeLabel(source.observedAt)))
      if (url) item.append(node('a', '비교 자료 원문 ↗', { href: url, target: '_blank', rel: 'noopener noreferrer' }))
      info.append(item)
    }
  }
  if (pick.businessProfile) {
    const profile = pick.businessProfile, url = communityEvidenceUrl(profile.sourceUrl)
    const item = node('article', null, { class: 'today-evidence' })
    item.append(node('strong', profile.role), node('small', '사업 분류 검토일 ' + profile.reviewedAt))
    if (url) item.append(node('a', '기업 역할 공식 자료 ↗', { href: url, target: '_blank', rel: 'noopener noreferrer' }))
    info.append(item)
  }
  if (pick.fairValue) {
    const valuation = pick.fairValue, item = node('article', null, { class: 'today-evidence' })
    item.append(node('strong', 'AI 추정 가격 계산 근거'), node('small', '산정 기준 ' + timeLabel(valuation.asOf)), node('p', valuation.method))
    for (const assumption of valuation.assumptions) item.append(node('small', assumption))
    for (const evidenceId of valuation.evidenceIds) {
      const evidence = pick.evidence.find(item => item.id === evidenceId), url = communityEvidenceUrl(evidence?.sourceUrl)
      if (url) item.append(node('a', evidence.label + ' ↗', { href: url, target: '_blank', rel: 'noopener noreferrer' }))
    }
    info.append(item)
  }
  info.append(node('p', '근거 링크가 내용 전체의 사실 검증을 뜻하지는 않습니다.', { class: 'note' }))
  details.append(info)
  return details
}

function messageMeta(message) {
  const meta = node('div', null, { class: 'today-pick-meta' })
  const comment = getTodayComment(message)
  const generatedAt = message.kind ? comment.provenance.generatedAt : message.createdAt
  meta.append(node('time', (getTodayWebProvider(comment.provenance) ? '응답 확인 ' : '작성 ') + timeLabel(generatedAt), { datetime: generatedAt }))
  if (message.kind) meta.append(node('time', '발행 ' + timeLabel(comment.createdAt), { datetime: comment.createdAt }))
  meta.append(node('span', '자료 기준 ' + timeLabel(message.dataAsOf)))
  if (!comment.provenance?.reportedModel) meta.append(node('span', '실제 모델명 미확인'))
  return meta
}

function reportDetails(report) {
  const details = node('details', null, { class: 'today-report-original' })
  details.append(node('summary', report.kind === 'earnings-review' ? '실적 검토 원문 전체 보기' : '의견서 원문 전체 보기'))
  let structured
  const source = report.report.trim(), fenced = source.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/iu)
  try { structured = JSON.parse(fenced ? fenced[1] : source) } catch {}
  if (typeof structured?.opinion === 'string' && structured.opinion.trim()) {
    details.append(node('p', structured.opinion.replaceAll('\\n', '\n'), { class: 'today-report-text' }))
    const original = node('details', null, { class: 'today-native-response' })
    original.append(node('summary', '실제 응답 원문'), node('p', report.report, { class: 'today-report-text', 'data-today-report-original': report.id }))
    details.append(original)
  } else details.append(node('p', report.report, { class: 'today-report-text', 'data-today-report-original': report.id }))
  return details
}

function reportReviewNotes(report) {
  const section = node('section', null, { class: 'today-review-notes', 'aria-label': '운영자 검토와 정정' })
  section.append(node('h4', '운영자 검토 · 정정'))
  const notes = node('ul', null)
  for (const note of report.reviewNotes) notes.append(node('li', note))
  section.append(notes)
  return section
}

function renderResponse(response, parent) {
  const article = node('article', null, { class: `today-response today-agent-${response.agent}`, 'data-today-response': response.id,
    'data-parent-id': parent.id, 'data-today-message': response.id })
  const header = node('div', null, { class: 'today-agent-heading' })
  header.append(node('strong', TODAY_AGENTS[response.agent].name + ' · AI'), node('span', '답글', { class: 'today-ai-label' }))
  article.append(header, node('p', TODAY_AGENTS[parent.agent].name + '의 추천 댓글에 대한 답글', { class: 'today-message-label' }),
    node('p', response.comment, { class: 'today-response-comment', 'data-today-response-comment': '' }), messageMeta(response), sourceDetails(response))
  return article
}

function renderCard(card, { archived = false } = {}) {
  const article = node('article', null, { class: `today-card today-agent-${card.agent}`, [archived ? 'data-today-archive-agent' : 'data-today-agent']: card.agent })
  const header = node('div', null, { class: 'today-agent-heading' })
  header.append(node('div', card.name || TODAY_AGENTS[card.agent]?.name, { class: 'today-agent-name' }), node('span', 'AI', { class: 'today-ai-label' }))
  article.append(header)
  const pick = card.report || card.pick, previousReport = !!card.report && card.state === 'previous-edition'
  const published = !!pick && (archived || card.state === 'published' || previousReport)
  article.dataset.state = card.state
  if (!published) {
    const empty = node('div', null, { class: 'today-empty' })
    empty.append(node('span', '고른 종목', { class: 'today-pick-kicker' }), node('h3', '추천 미발행'), priceFields(null),
      node('p', '의견', { class: 'today-message-label' }), node('p', state.error ? '발행 자료를 확인할 수 없습니다.' : card.state === 'previous-edition' ? '오늘의 추천은 아직 없습니다.' : reasonLabel(card.reason)))
    article.append(empty, node('p', card.state === 'previous-edition' && pick ? '이전 추천은 아래 지난 발행에서 확인할 수 있습니다.' : '검증된 실제 응답만 이 자리에 표시합니다.', { class: 'today-empty-note' }))
    return article
  }
  const company = instruments.find(item => item.symbol === pick.symbol)
  article.dataset.pickId = pick.id
  if (previousReport && !archived) article.append(node('p', '이전 발행 · ' + kstDate(Date.parse(pick.createdAt)), { class: 'today-empty-note', 'data-today-previous-report': '' }))
  const factualReview = pick.kind === 'earnings-review'
  let content = article
  if (factualReview && !archived) {
    article.dataset.recommendationState = 'unpublished'
    article.append(node('p', '고른 종목', { class: 'today-pick-kicker' }), node('h3', '추천 미발행'),
      node('p', '현재 이용 조건으로 종목 추천에 참여하지 않습니다.', { class: 'today-empty-note' }))
    content = node('details', null, { class: 'today-review-only', 'data-today-factual-review': '' })
    content.append(node('summary', '기존 실적 검토 · 댓글 보기'))
    article.append(content)
  }
  const title = node('div', null, { class: 'today-company' })
  const comparison = !archived && !factualReview ? getTodayPriceComparison(pick, quoteFor(pick.symbol), { marketError: state.marketError }) : null
  const kicker = factualReview ? '검토 대상 · 실적 검토' : comparison ? {
    above: '고른 종목 · 상승 여력 조건 충족', below: '참고 의견 · 상승 여력 조건 미충족', equal: '참고 의견 · 상승 여력 조건 미충족',
    missing: '관심 종목 · 가격 추정 보류', unavailable: '참고 의견 · 비교 불가',
  }[comparison.status] : '고른 종목'
  title.append(node('p', kicker, { class: 'today-pick-kicker' }), node('h3', company?.name || pick.symbol), node('span', pick.symbol, { class: 'today-ticker mono' }))
  if (company?.chains?.length) title.append(node('p', company.chains.filter(id => id >= 1 && id <= 8).map(id => chains[id - 1]).join(' · '), { class: 'today-chain' }))
  content.append(title, priceFields(pick, { showComparison: !archived && !factualReview }))
  const thread = node('section', null, { class: 'today-comment-thread', 'data-today-thread': pick.id, 'aria-label': `${card.name}의 AI 댓글` })
  const initial = node('article', null, { class: 'today-initial-comment', 'data-today-message': pick.id })
  initial.append(node('p', pick.kind ? `${card.name} · AI` : '의견', { class: 'today-message-label' }),
    node('p', getTodayComment(pick).text, { class: 'today-comment', 'data-today-comment': '' }))
  if (pick.kind) initial.append(reportReviewNotes(pick), reportDetails(pick))
  initial.append(messageMeta(pick), sourceDetails(pick))
  thread.append(initial, ...(!card.report ? card.responses || [] : []).map(response => renderResponse(response, pick)))
  content.append(thread)
  const actions = node('div', null, { class: 'today-card-actions' })
  actions.append(node('button', '종목 · 차트', { type: 'button', 'data-market-symbol': pick.symbol, 'aria-label': `${company?.name || pick.symbol} 종목 · 차트` }),
    node('a', '생각 나누기 →', { href: `#talk/${encodeURIComponent(pick.symbol)}` }))
  content.append(actions)
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
  const published = cards.filter(card => card.state === 'published' && (card.report || card.pick)).length
  const publishedReports = cards.filter(card => card.report)
  const stockOpinionCards = cards.filter(card => (card.report || card.state === 'published' && card.pick) && (card.report || card.pick).kind !== 'earnings-review')
  const stockOpinions = new Set(stockOpinionCards.map(card => (card.report || card.pick).symbol)).size
  const eligibleOpinions = new Set(stockOpinionCards.filter(card => {
    const pick = card.report || card.pick
    return getTodayPriceComparison(pick, quoteFor(pick.symbol), { marketError: state.marketError, now }).eligible
  }).map(card => (card.report || card.pick).symbol)).size
  const earningsReviews = publishedReports.filter(card => card.report.kind === 'earnings-review').length
  root.querySelector('[data-today-status]').textContent = state.error ? '발행 자료를 불러오지 못했습니다. 다시 읽기로 확인해주세요.' :
    state.busy ? '저장된 발행 자료를 읽고 있습니다.' : stockOpinions || earningsReviews ? `${currentDate} · 서로 다른 종목 의견 ${stockOpinions}개 · 오늘 발행 ${published}개 · 상승 여력 조건 충족 ${eligibleOpinions}개 · 실적 검토 ${earningsReviews}개` : '검증된 실제 응답이 발행되면 각 AI의 의견이 표시됩니다.'
  const refresh = root.querySelector('[data-today-refresh]')
  refresh.disabled = state.busy; refresh.textContent = state.busy ? '읽는 중…' : '다시 읽기'
  const older = cards.filter(card => !card.report && card.state === 'previous-edition' && card.pick)
  for (const card of cards) {
    if (card.report && card.pick) older.push({ ...card, report: null, state: 'published' })
  }
  for (const report of state.snapshot?.reportHistory || []) older.push({ agent: report.agent, ...TODAY_AGENTS[report.agent], report, pick: null, responses: [], state: 'published' })
  const archive = root.querySelector('[data-today-archive]')
  archive.hidden = !older.length
  if (older.length) {
    archive.querySelector('summary').textContent = `이전 발행 보기 · 원래 작성·발행 시각 보존 · ${older.length}개`
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
  window.addEventListener('market-snapshot', event => { state.marketSnapshot = event.detail; state.marketError = false; render() })
  window.addEventListener('market-snapshot-error', () => { state.marketError = true; render() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render() })
  window.addEventListener('pagehide', () => { clearTimeout(dayTimer); controller?.abort() })
  window.addEventListener('pageshow', mount)
  document.querySelectorAll('.nav-more a').forEach(link => link.addEventListener('click', () => { link.closest('details').open = false }))
  mount()
}
