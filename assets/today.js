import { instruments } from './instruments.js'
import { COMPANIES, SECTORS } from './home-map-core.js'
import { TODAY_AGENTS, validateTodaySnapshot, todayCards, getTodayComment, getTodayPriceComparison, getTodayWebProvider } from './today-core.js'
import { communityEvidenceUrl } from './community-ui-core.js'
import { recommendationComments, retainRecommendationComments } from './recommendation-comments.js'
import { validateTodayDiscussion, todayDiscussionForReport } from './today-discussion-core.js'
import { validateTodayPersonas, getPersonaForReport } from './today-persona-core.js'

const root = document.getElementById('v-today')
const chains = ['소부장', '파운드리·패키징', '메모리', 'AI 칩', '전력', '인프라', '모델', '애플리케이션']
const state = { snapshot: null, marketSnapshot: window.aiChainSnapshot || null, marketError: false, busy: false, loaded: false, error: false, discussion: null, discussionDocument: null, discussionBusy: false, discussionLoaded: false, discussionError: false, personas: null, personasDocument: null, personasBusy: false, personasLoaded: false, personasError: false }
let controller, generation = 0, dayTimer, discussionController, discussionGeneration = 0, personasController, personasGeneration = 0
const cardNodes = new Map()
const discussionNodes = new Map()
const personaNodes = new Map()
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

function renderResponse(response, parent) {
  const article = node('article', null, { class: `today-response today-agent-${response.agent}`, 'data-today-response': response.id,
    'data-parent-id': parent.id, 'data-today-message': response.id })
  const header = node('div', null, { class: 'today-agent-heading' })
  header.append(node('strong', TODAY_AGENTS[response.agent].name + ' · AI'), node('span', '답글', { class: 'today-ai-label' }))
  article.append(header, node('p', TODAY_AGENTS[parent.agent].name + '의 추천 댓글에 대한 답글', { class: 'today-message-label' }),
    node('p', response.comment, { class: 'today-response-comment', 'data-today-response-comment': '' }), sourceDetails(response))
  return article
}

function discussionSourceDetails(response) {
  const details = node('details', null, { class: 'today-cross-sources' })
  const info = node('div', null, { class: 'today-source-content' })
  const provenance = response.provenance
  const webProvider = getTodayWebProvider(provenance), webName = TODAY_AGENTS[webProvider]?.name
  details.setAttribute('data-today-discussion-source', response.id)
  details.append(node('summary', '작성 출처 · 원문'))
  info.append(node('p', '요청 모델 ' + provenance.requestedModel),
    node('p', provenance.reportedModel ? '실제 응답 모델 ' + provenance.reportedModel : '실제 모델명 미확인'),
    node('p', webProvider ? '실행 환경 ' + webName + ' 웹 · 앱 버전 미공개' : 'CLI ' + provenance.cliName + ' · ' + provenance.cliVersion),
    node('p', (webProvider ? '웹 응답 확인 ' : '작성 ') + timeLabel(provenance.generatedAt)),
    node('p', '발행 ' + timeLabel(response.createdAt)),
    node('p', '검수 ' + timeLabel(provenance.reviewedAt)),
    node('p', '원문 SHA-256 ' + provenance.responseSha256, { class: 'today-response-digest mono' }),
    node('pre', response.rawResponse, { class: 'today-cross-raw' }))
  details.append(info)
  return details
}

function discussionPanel(report) {
  let entry = discussionNodes.get(report.id)
  if (!entry) {
    entry = { element: node('section', null, { class: 'today-cross-opinions', 'data-today-discussion': report.id, 'aria-label': 'AI 티키타카' }), signature: null }
    discussionNodes.set(report.id, entry)
  }
  const result = state.discussion ? todayDiscussionForReport(state.discussion, report) : { responses: [], states: [], followUps: [] }
  const signature = JSON.stringify([result, state.discussionError, state.discussionBusy])
  if (entry.signature === signature) return entry.element
  entry.signature = signature
  const openSources = new Set([...entry.element.querySelectorAll('details[data-today-discussion-source]')].filter(details => details.open).map(details => details.getAttribute('data-today-discussion-source')))
  const children = [node('h4', 'AI 티키타카', { class: 'today-cross-heading' })]
  for (const [agent, info] of Object.entries(TODAY_AGENTS)) {
    if (agent === report.agent) continue
    const response = result.responses.find(item => item.agent === agent)
    const article = node('article', null, { class: `today-cross-opinion today-agent-${agent}`, 'data-today-discussion-agent': agent })
    article.append(node('strong', info.name, { class: 'today-cross-name' }))
    if (response) {
      article.setAttribute('data-today-cross-response', response.id)
      article.append(node('p', response.text, { class: 'today-cross-text', 'data-today-cross-text': '' }), discussionSourceDetails(response))
      const followUp = result.followUps.find(item => item.replyToIds.length === 1 && item.replyToIds[0] === response.id)
      if (followUp) {
        const reply = node('article', null, { class: `today-cross-opinion today-cross-follow-up today-agent-${followUp.agent}`, 'data-today-follow-up': followUp.id, 'data-reply-to': response.id, 'aria-label': TODAY_AGENTS[followUp.agent].name + '의 ' + info.name + '에게 답글' })
        reply.append(node('strong', TODAY_AGENTS[followUp.agent].name + ' → ' + info.name, { class: 'today-cross-name' }),
          node('p', followUp.text, { class: 'today-cross-text', 'data-today-cross-text': '' }), discussionSourceDetails(followUp))
        article.append(reply)
      }
    } else article.append(node('p', '의견 대기', { class: 'today-cross-pending' }))
    children.push(article)
  }
  if (state.discussionError) {
    const error = node('div', null, { class: 'today-cross-error', role: 'status' })
    const retry = node('button', '다시 불러오기', { type: 'button' })
    retry.disabled = state.discussionBusy
    retry.addEventListener('click', readDiscussion)
    error.append(node('p', '다른 AI 의견을 불러오지 못했어요.'), retry)
    children.push(error)
  }
  entry.element.replaceChildren(...children)
  for (const details of entry.element.querySelectorAll('details[data-today-discussion-source]')) details.open = openSources.has(details.getAttribute('data-today-discussion-source'))
  return entry.element
}

function personaContent(report) {
  let entry = personaNodes.get(report.id)
  if (!entry) {
    entry = { element: node('div', null, { class: 'today-persona-content', 'data-today-persona': report.id }), signature: null }
    personaNodes.set(report.id, entry)
  }
  const rewrite = state.personas ? getPersonaForReport(state.personas, report) : null
  const error = report.kind === 'stock-opinion' && state.personasError
  const signature = JSON.stringify([rewrite, error, state.personasBusy])
  if (entry.signature === signature) return entry.element
  entry.signature = signature
  const analysisOpen = entry.element.querySelector('[data-today-persona-analysis]')?.open || false
  const children = [node('p', rewrite?.comment || getTodayComment(report).text, { class: 'today-comment', 'data-today-comment': '' })]
  if (rewrite) {
    entry.element.setAttribute('data-persona-rewrite', rewrite.id)
    const analysis = node('details', null, { class: 'today-persona-analysis', 'data-today-persona-analysis': '' })
    const body = node('div', null, { class: 'today-persona-analysis-body' })
    analysis.append(node('summary', '분석글 읽기'))
    body.append(node('h4', rewrite.headline, { 'data-today-persona-headline': '' }))
    for (const paragraph of rewrite.analysis.split(/\n\s*\n/u).filter(Boolean)) body.append(node('p', paragraph))
    body.append(discussionSourceDetails(rewrite))
    analysis.append(body)
    analysis.open = analysisOpen
    children.push(analysis)
  } else entry.element.removeAttribute('data-persona-rewrite')
  if (error) {
    const notice = node('div', null, { class: 'today-persona-error', role: 'status' })
    const retry = node('button', '다시 불러오기', { type: 'button' })
    retry.disabled = state.personasBusy
    retry.addEventListener('click', readPersonas)
    notice.append(node('p', '새 분석글을 불러오지 못했어.'), retry)
    children.push(notice)
  }
  entry.element.replaceChildren(...children)
  return entry.element
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
    empty.append(node('h3', '추천 미발행'), priceFields(null),
      node('p', '의견', { class: 'today-message-label' }), node('p', state.error ? '발행 자료를 확인할 수 없습니다.' : card.state === 'previous-edition' ? '오늘의 추천은 아직 없습니다.' : reasonLabel(card.reason)))
    article.append(empty, node('p', card.state === 'previous-edition' && pick ? '이전 추천은 아래 지난 발행에서 확인할 수 있습니다.' : '검증된 실제 응답만 이 자리에 표시합니다.', { class: 'today-empty-note' }))
    return article
  }
  const company = instruments.find(item => item.symbol === pick.symbol)
  article.dataset.pickId = pick.id
  const factualReview = pick.kind === 'earnings-review'
  let content = article
  if (factualReview && !archived) {
    article.dataset.recommendationState = 'unpublished'
    article.append(node('h3', '추천 미발행'),
      node('p', '현재 이용 조건으로 종목 추천에 참여하지 않습니다.', { class: 'today-empty-note' }))
    content = node('details', null, { class: 'today-review-only', 'data-today-factual-review': '' })
    content.append(node('summary', '기존 실적 검토 · 댓글 보기'))
    article.append(content)
  }
  const title = node('div', null, { class: 'today-company' })
  title.append(node('h3', company?.name || pick.symbol), node('span', pick.symbol, { class: 'today-ticker mono' }))
  if (company?.chains?.length) title.append(node('p', company.chains.filter(id => id >= 1 && id <= 8).map(id => chains[id - 1]).join(' · '), { class: 'today-chain' }))
  const primarySectorName = COMPANIES.find(item => item.ticker === pick.symbol)?.sector
  const sector = SECTORS.find(item => item.name === primarySectorName)
  if (sector) {
    const link = node('a', sector.name + ' 섹터 비교 →', { href: '#sector-compare/' + encodeURIComponent(sector.id) })
    const sectorLink = node('p', null, { class: 'today-chain' })
    sectorLink.append(link)
    title.append(sectorLink)
  }
  content.append(title, priceFields(pick, { showComparison: !archived && !factualReview }))
  const thread = node('section', null, { class: 'today-comment-thread', 'data-today-thread': pick.id, 'aria-label': `${card.name}의 AI 댓글` })
  const initial = node('article', null, { class: 'today-initial-comment', 'data-today-message': pick.id })
  initial.append(node('p', pick.kind ? `${card.name} · AI` : '의견', { class: 'today-message-label' }), personaContent(pick))
  initial.append(sourceDetails(pick))
  thread.append(initial, ...(!card.report ? card.responses || [] : []).map(response => renderResponse(response, pick)))
  content.append(thread)
  if (pick.kind === 'stock-opinion') content.append(discussionPanel(pick))
  content.append(recommendationComments(pick))
  return article
}

// Reuse publication nodes so live quote updates cannot replace an open comment form.
function cachedCard(card, { archived = false } = {}, retainedCards) {
  const pick = card.report || card.pick
  const key = `${archived ? 'archive' : 'current'}:${pick?.id || card.agent}`
  retainedCards.add(key)
  const signature = JSON.stringify([card, archived, state.error])
  let entry = cardNodes.get(key)
  if (!entry || entry.signature !== signature) {
    entry = { signature, article: renderCard(card, { archived }) }
    cardNodes.set(key, entry)
  } else {
    const previous = entry.article.querySelector('.today-price-fields')
    const publishedPick = entry.article.dataset.pickId ? pick : null
    if (previous) previous.replaceWith(priceFields(publishedPick, { showComparison: !!publishedPick && !archived && publishedPick.kind !== 'earnings-review' }))
    if (publishedPick) personaContent(publishedPick)
    if (publishedPick?.kind === 'stock-opinion') discussionPanel(publishedPick)
  }
  return entry.article
}

function reconcileCards(container, cards) {
  cards.forEach((card, index) => {
    if (container.children[index] !== card) container.insertBefore(card, container.children[index] || null)
  })
  while (container.children.length > cards.length) container.lastElementChild.remove()
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
  const cards = cardsForSnapshot(), grid = root.querySelector('[data-today-cards]'), retainedCards = new Set()
  reconcileCards(grid, cards.map(card => cachedCard(card, {}, retainedCards)))
  const older = cards.filter(card => !card.report && card.state === 'previous-edition' && card.pick)
  for (const card of cards) {
    if (card.report && card.pick) older.push({ ...card, report: null, state: 'published' })
  }
  for (const report of state.snapshot?.reportHistory || []) older.push({ agent: report.agent, ...TODAY_AGENTS[report.agent], report, pick: null, responses: [], state: 'published' })
  const archive = root.querySelector('[data-today-archive]')
  archive.hidden = !older.length
  if (older.length) {
    archive.querySelector('summary').textContent = `이전 발행 보기 · 원래 작성·발행 시각 보존 · ${older.length}개`
    reconcileCards(archive.querySelector('[data-today-archive-cards]'), older.map(card => cachedCard(card, { archived: true }, retainedCards)))
  } else reconcileCards(root.querySelector('[data-today-archive-cards]'), [])
  for (const key of cardNodes.keys()) if (!retainedCards.has(key)) cardNodes.delete(key)
  const retainedReports = new Set([...cards, ...older].map(card => (card.report || card.pick)?.id).filter(Boolean))
  retainRecommendationComments(retainedReports)
  for (const id of discussionNodes.keys()) if (!retainedReports.has(id)) discussionNodes.delete(id)
  for (const id of personaNodes.keys()) if (!retainedReports.has(id)) personaNodes.delete(id)
}

function applyDiscussion() {
  if (!state.snapshot || !state.discussionDocument) return
  try {
    validateTodayDiscussion(state.discussionDocument, { today: state.snapshot, catalog: instruments, now: Date.now() })
    state.discussion = state.discussionDocument
    state.discussionError = false
  } catch {
    state.discussion = null
    state.discussionError = true
  }
}

async function readDiscussion() {
  if (state.discussionBusy) return
  state.discussionBusy = true; state.discussionError = false; render()
  discussionController?.abort(); discussionController = new AbortController(); const current = ++discussionGeneration
  try {
    const response = await fetch('./data/today-discussion.json', { cache: 'no-store', signal: AbortSignal.any([discussionController.signal, AbortSignal.timeout(15000)]), redirect: 'error' })
    if (!response.ok) throw new Error('discussion_unavailable')
    const value = await response.json()
    if (current !== discussionGeneration) return
    state.discussionDocument = value; state.discussionLoaded = true
    applyDiscussion()
  } catch (error) {
    if (current !== discussionGeneration || error.name === 'AbortError') return
    state.discussionError = true; state.discussion = null; state.discussionDocument = null
  } finally {
    if (current === discussionGeneration) { state.discussionBusy = false; render() }
  }
}

function applyPersonas() {
  if (!state.snapshot || !state.personasDocument) return
  try {
    validateTodayPersonas(state.personasDocument, { today: state.snapshot, catalog: instruments, now: Date.now() })
    state.personas = state.personasDocument
    state.personasError = false
  } catch {
    state.personas = null
    state.personasError = true
  }
}

async function readPersonas() {
  if (state.personasBusy) return
  state.personasBusy = true; state.personasError = false; render()
  personasController?.abort(); personasController = new AbortController(); const current = ++personasGeneration
  try {
    const response = await fetch('./data/today-personas.json', { cache: 'no-store', signal: AbortSignal.any([personasController.signal, AbortSignal.timeout(15000)]), redirect: 'error' })
    if (!response.ok) throw new Error('personas_unavailable')
    const value = await response.json()
    if (current !== personasGeneration) return
    state.personasDocument = value; state.personasLoaded = true
    applyPersonas()
  } catch (error) {
    if (current !== personasGeneration || error.name === 'AbortError') return
    state.personasError = true; state.personas = null; state.personasDocument = null
  } finally {
    if (current === personasGeneration) { state.personasBusy = false; render() }
  }
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
    applyDiscussion()
    applyPersonas()
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
  if (!state.discussionBusy && (!state.discussionLoaded || state.discussionError)) readDiscussion()
  if (!state.personasBusy && (!state.personasLoaded || state.personasError)) readPersonas()
}
if (root) {
  window.renderToday = mount
  window.addEventListener('hashchange', mount)
  window.addEventListener('market-snapshot', event => { state.marketSnapshot = event.detail; state.marketError = false; render() })
  window.addEventListener('market-snapshot-error', () => { state.marketError = true; render() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render() })
  window.addEventListener('pagehide', () => { clearTimeout(dayTimer); controller?.abort(); discussionController?.abort(); personasController?.abort() })
  window.addEventListener('pageshow', mount)
  document.querySelectorAll('.nav-more a').forEach(link => link.addEventListener('click', () => { link.closest('details').open = false }))
  mount()
}
