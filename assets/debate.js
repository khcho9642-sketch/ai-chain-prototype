import { realtimeEnabled } from './site-runtime.js'
import { DEBATE_CHARACTERS, debateCharacterChange } from './debate-characters.js'
import { validateDebateDay, validateDebateIndex, debateStanceChanges, debateCharacterHistory, debateWritingDatesDiffer } from './debate-core.js'

const AGENTS = Object.keys(DEBATE_CHARACTERS)
const DAY = /^\d{4}-\d{2}-\d{2}$/u
const host = typeof document === 'undefined' ? null : document.getElementById('v-debate')
const state = { index: null, day: null, previous: null, cache: new Map(), archiveVotes: new Map(), error: null, loading: false, expanded: false, selectedDate: null, request: 0, historyComplete: false, vote: null, voteError: false, voteBusy: false, voteRequest: 0, activeSource: 'gpt', lastAvailable: false, marketNewer: false }
const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

export function debateRequestedDate(hash) {
  const route = String(hash).replace(/^#/u, '')
  if (route.split('?')[0] !== 'debate') return null
  const date = new URLSearchParams(route.split('?')[1] || '').get('date')
  return date && DAY.test(date) ? date : null
}

export function chronologicalDebateThread(thread = []) {
  return [...thread].sort((a, b) => Date.parse(a.writtenAt) - Date.parse(b.writtenAt) || String(a.id).localeCompare(String(b.id)))
}

export function visibleDebateThread(thread, expanded = false) {
  const ordered = chronologicalDebateThread(thread)
  return { visible: !expanded && ordered.length > 6 ? ordered.slice(0, 4) : ordered, remaining: !expanded && ordered.length > 6 ? ordered.length - 4 : 0 }
}

export function debateVotePresentation(vote) {
  if (!vote?.hasVoted) return { kind: 'unvoted', count: null, rows: [] }
  if (!Number.isInteger(vote.count) || vote.count < 0) return { kind: 'unavailable', count: null, rows: [] }
  if (vote.count < 10) return { kind: 'counting', count: vote.count, rows: [] }
  if (!vote.percentages || AGENTS.some(ai => !Number.isFinite(vote.percentages[ai]) || vote.percentages[ai] < 0 || vote.percentages[ai] > 100)) return { kind: 'unavailable', count: vote.count, rows: [] }
  return { kind: 'results', count: vote.count, rows: AGENTS.map(ai => ({ ai, percent: vote.percentages[ai] })) }
}

export function debateWritingPriceLabel(row, currency = 'USD') {
  if (!Number.isFinite(row?.priceAtWriting)) return null
  return `작성 당시 ${number(row.priceAtWriting)} ${currency} · ${shortDate(row.closeDate || row.writtenAt)}`
}

export function hasNewerDebateClose(day, snapshot) {
  if (!day || !Array.isArray(snapshot?.quotes)) return false
  return snapshot.quotes.some(quote => quote.timezone === 'America/New_York' && quote.priceBasis === 'previous-completed-session' && DAY.test(quote.closeDate || '') && quote.closeDate > day.date)
}

function node(tag, text, attrs = {}) {
  const element = document.createElement(tag)
  if (text !== undefined && text !== null) element.textContent = text
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined && value !== null) element.setAttribute(name, String(value))
  return element
}
function number(value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) }
function shortDate(value) { return String(value || '').slice(5, 10).replace('-', '.') }
function moment(value) { return Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) + ' KST' : '시각 확인 중' }
function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null } }
function link(label, href, attrs = {}) { return node('a', label, { href, ...attrs }) }
function sectionTitle(title, note) {
  const head = node('div', null, { class: 'debate-section-head' })
  head.append(node('h2', title))
  if (note) head.append(node('p', note))
  return head
}
function characterHeader(ai) {
  const character = DEBATE_CHARACTERS[ai]
  const header = node('div', null, { class: 'debate-character' })
  const identity = node('div')
  identity.append(node('strong', character.name, { class: 'debate-character-name' }), node('span', character.nickname, { class: 'debate-character-nickname' }))
  header.append(node('span', character.icon, { class: 'debate-character-icon', 'aria-hidden': 'true' }), identity)
  return header
}
function originalDetails(row, sources = []) {
  const details = node('details', null, { class: 'debate-source' })
  details.append(node('summary', '작성 출처 · 원문'))
  const body = node('div', null, { class: 'debate-source-body' })
  body.append(node('p', '작성 ' + moment(row.writtenAt)))
  const provenance = row.provenance
  if (provenance) {
    if (provenance.requestedModel) body.append(node('p', '요청 모델 ' + provenance.requestedModel))
    body.append(node('p', provenance.reportedModel ? '응답 모델 ' + provenance.reportedModel : '응답 모델명 미확인'))
    if (provenance.responseSha256) body.append(node('p', '원문 SHA-256 ' + provenance.responseSha256))
  }
  for (const source of sources) {
    const href = safeUrl(source.url)
    if (href) body.append(link(source.label || '자료 원문', href, { target: '_blank', rel: 'noopener noreferrer' }))
  }
  if (row.rawResponse) body.append(node('pre', row.rawResponse))
  details.append(body)
  return details
}
function renderHeading() {
  const heading = node('div', null, { class: 'debate-heading' })
  heading.append(node('h1', '오늘의 토론'), node('p', '한 쟁점, 세 시선. 숫자 앞에서는 편을 바꿔도 돼.'))
  if (state.day) heading.append(node('span', shortDate(state.day.date) + ' 종가 기준', { class: 'debate-edition' }))
  return heading
}
function renderTopic(day) {
  const section = node('section', null, { class: 'debate-topic', 'aria-label': '오늘의 쟁점' })
  const eyebrow = node('p', null, { class: 'debate-eyebrow' })
  eyebrow.append(node('strong', day.topic.ticker), node('span', day.headline || shortDate(day.date) + ' 종가 · 같은 자료를 놓고 나눈 세 시선'))
  section.append(eyebrow, node('h2', day.topic.title))
  const ripple = node('div', null, { class: 'debate-ripple' })
  if (day.ripple?.length) {
    ripple.append(node('span', '함께 움직인 종목'))
    for (const row of day.ripple.slice(0, 3)) ripple.append(node('span', `${row.name} ${row.changePct >= 0 ? '+' : ''}${Number(row.changePct).toFixed(1)}%`, { class: 'debate-ripple-item' }))
  }
  const rippleLink = link('파급 전체 보기 →', '#home/ripple')
  rippleLink.addEventListener('click', () => window.addEventListener('hashchange', () => requestAnimationFrame(() => document.getElementById('home-ripple')?.scrollIntoView({ behavior: 'smooth', block: 'start' })), { once: true }))
  ripple.append(rippleLink)
  section.append(ripple)
  if (day.issue) {
    const issue = node('div', null, { class: 'debate-issue' })
    issue.append(node('span', '쟁점'), node('p', day.issue)); section.append(issue)
  }
  if (debateWritingDatesDiffer(day)) section.append(node('p', 'AI별 작성일이 달라요 (' + [...new Set(day.stances.map(row => shortDate(row.writtenAt)))].join(' · ') + ')', { class: 'debate-writing-warning' }))
  return section
}
function renderStances(day) {
  const section = node('section', null, { 'aria-label': '세 AI의 입장' })
  section.append(sectionTitle('세 입장, 먼저 읽어봐', '캐릭터는 말투, 결론은 근거'))
  const grid = node('div', null, { class: 'debate-stances' })
  const changes = debateStanceChanges(day, state.previous)
  for (const ai of AGENTS) {
    const card = node('article', null, { class: 'debate-stance debate-agent-' + ai, 'data-debate-stance': ai })
    card.append(characterHeader(ai))
    const stance = day.stances.find(row => row.ai === ai)
    if (!stance) card.append(node('p', '오늘은 참여하지 않았어요', { class: 'debate-no-participant' }))
    else {
      const change = debateCharacterChange(ai, changes.find(row => row.ai === ai))
      if (change) card.append(node('p', change, { class: 'debate-change' }))
      card.append(node('h3', stance.stance), node('p', stance.reason, { class: 'debate-stance-reason' }))
      if (stance.scenario) card.append(node('p', `시나리오 ${number(stance.scenario.low)} ~ ${number(stance.scenario.high)} ${stance.scenario.currency}`, { class: 'debate-scenario' }))
      const priceLabel = debateWritingPriceLabel(stance, day.closePrice.currency)
      if (priceLabel) card.append(node('p', priceLabel, { class: 'debate-writing' }))
      card.append(node('p', '작성 ' + moment(stance.writtenAt), { class: 'debate-writing' }))
    }
    grid.append(card)
  }
  section.append(grid); return section
}
function renderThread(day) {
  const section = node('section', null, { 'aria-label': 'AI 티키타카' })
  section.append(sectionTitle('그래서, 그 가정은 버틸까?', '실제 발언을 작성순으로 이어 읽어봐'))
  if (!day.thread.length) { section.append(node('p', '이어지는 대화는 아직 준비 중이야.', { class: 'debate-no-participant' })); return section }
  const list = node('ol', null, { class: 'debate-thread' })
  const { visible, remaining } = visibleDebateThread(day.thread, state.expanded)
  for (const row of visible) {
    const character = DEBATE_CHARACTERS[row.ai]
    const item = node('li', null, { class: 'debate-message debate-agent-' + row.ai, id: 'debate-message-' + row.id, 'data-debate-message': row.id })
    const meta = node('div', null, { class: 'debate-message-meta' })
    meta.append(node('strong', character.name, { class: 'debate-message-name' }))
    if (row.to && DEBATE_CHARACTERS[row.to]) meta.append(node('span', '→ ' + DEBATE_CHARACTERS[row.to].name, { class: 'debate-message-target' }))
    if (row.kind === 'reply') meta.append(node('span', '답글', { class: 'debate-message-kind' }))
    meta.append(node('time', moment(row.writtenAt), { datetime: row.writtenAt, class: 'debate-message-time' }))
    item.append(node('span', character.icon, { class: 'debate-message-icon', 'aria-hidden': 'true' }), meta, node('p', row.text, { class: 'debate-message-text' }))
    const priceLabel = debateWritingPriceLabel(row, day.closePrice.currency)
    if (priceLabel) item.append(node('p', priceLabel, { class: 'debate-message-price' }))
    const stance = day.stances.find(stance => stance.ai === row.ai)
    item.append(originalDetails(row, stance?.sources)); list.append(item)
  }
  section.append(list)
  if (remaining) {
    const more = node('button', `반박 ${remaining}개 더 보기`, { type: 'button', class: 'debate-more', 'aria-expanded': 'false' })
    more.addEventListener('click', () => { state.expanded = true; const replacement = renderThread(day); section.replaceWith(replacement); replacement.querySelectorAll('li')[4]?.querySelector('summary')?.focus({ preventScroll: true }) })
    section.append(more)
  }
  return section
}
function renderVote(day) {
  const section = node('section', null, { class: 'debate-vote', 'aria-label': '논리 투표', 'data-debate-vote': '' })
  section.append(node('h2', '누구 논리가 더 설득력 있었나요?'), node('p', '주가 방향이 아니라 논리에 투표해요', { class: 'debate-vote-subtitle' }))
  const presentation = debateVotePresentation(state.vote)
  const options = node('div', null, { class: 'debate-vote-options' })
  for (const ai of AGENTS) {
    const character = DEBATE_CHARACTERS[ai]
    const button = node('button', null, { type: 'button', class: 'debate-vote-choice debate-agent-' + ai, 'aria-pressed': state.vote?.choice === ai ? 'true' : 'false' })
    button.append(node('span', character.icon, { 'aria-hidden': 'true' }), node('strong', character.name))
    button.disabled = !realtimeEnabled || state.voteBusy || state.voteError || !state.vote || Boolean(state.vote.hasVoted) || !day.stances.some(row => row.ai === ai)
    button.addEventListener('click', () => submitVote(ai))
    options.append(button)
  }
  section.append(options)
  const status = node('p', null, { class: 'debate-vote-status', role: 'status', 'aria-live': 'polite' })
  if (!realtimeEnabled) status.textContent = '투표 기능을 일시 중지했습니다.'
  else if (state.voteError || presentation.kind === 'unavailable') {
    status.append(node('span', '잠시 후 다시 시도'))
    const retry = node('button', '다시 불러오기', { type: 'button' }); retry.addEventListener('click', loadVotes); status.append(retry)
  } else if (state.voteBusy) status.textContent = state.vote ? '의견을 기록하고 있어요.' : '투표를 불러오고 있어요.'
  else if (presentation.kind === 'counting') status.textContent = `집계 중 (${presentation.count}표) · 네 선택은 ${DEBATE_CHARACTERS[state.vote.choice]?.name || ''}`
  else if (presentation.kind === 'results') status.textContent = `${presentation.count}명이 논리를 골랐어요. · 네 선택은 ${DEBATE_CHARACTERS[state.vote.choice]?.name || ''}`
  else status.textContent = '한 주제에 한 번, 마음에 남은 논리를 골라봐요.'
  section.append(status)
  if (realtimeEnabled && presentation.kind === 'results') {
    const results = node('div', null, { class: 'debate-vote-result' })
    for (const row of presentation.rows) {
      const result = node('div', null, { class: 'debate-vote-result-row debate-agent-' + row.ai })
      const track = node('div', null, { class: 'debate-vote-track', role: 'meter', 'aria-label': DEBATE_CHARACTERS[row.ai].name, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': row.percent })
      const fill = node('div', null, { class: 'debate-vote-fill' }); fill.style.width = row.percent + '%'; track.append(fill)
      result.append(node('span', DEBATE_CHARACTERS[row.ai].name), track, node('span', number(row.percent) + '%', { class: 'debate-vote-pct' })); results.append(result)
    }
    section.append(results)
  }
  return section
}
function updateVote() { const current = host?.querySelector('[data-debate-vote]'); if (current && state.day) current.replaceWith(renderVote(state.day)) }
async function voteRequest(method = 'GET', choice, day = state.day) {
  if (!realtimeEnabled) throw new Error('votes_paused')
  const url = './api/debate-votes' + (method === 'GET' ? '?debateId=' + encodeURIComponent(day.id) : '')
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000), ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ debateId: day.id, choice }) } : {}) })
  const result = await response.json()
  if ((!response.ok && response.status !== 409) || result.debateId !== day.id || typeof result.hasVoted !== 'boolean') throw new Error('votes_unavailable')
  if (result.hasVoted && !AGENTS.includes(result.choice)) throw new Error('invalid_vote')
  return result
}
async function loadVotes() {
  if (!realtimeEnabled || !state.day) return
  const request = ++state.voteRequest
  state.voteBusy = true; state.voteError = false; updateVote()
  try { const vote = await voteRequest(); if (request !== state.voteRequest) return; state.vote = vote }
  catch { if (request !== state.voteRequest) return; state.voteError = true }
  finally { if (request === state.voteRequest) { state.voteBusy = false; updateVote() } }
}
async function submitVote(choice) {
  if (!realtimeEnabled || state.voteBusy || state.vote?.hasVoted || !state.day) return
  const request = ++state.voteRequest
  state.voteBusy = true; state.voteError = false; updateVote()
  try {
    const vote = await voteRequest('POST', choice)
    if (request !== state.voteRequest) return
    state.vote = vote
    try { localStorage.setItem('ai-chain-debate-vote:' + state.day.id, vote.choice) } catch { /* The server remains authoritative when browser storage is unavailable. */ }
  } catch { if (request === state.voteRequest) state.voteError = true }
  finally { if (request === state.voteRequest) { state.voteBusy = false; updateVote() } }
}
function renderEvidence(day) {
  const details = node('details', null, { class: 'debate-evidence' })
  details.append(node('summary', '가격·계산 근거·분석 원문 펼치기'))
  const body = node('div', null, { class: 'debate-evidence-body' })
  const close = node('div', null, { class: 'debate-close' }), identity = node('div')
  identity.append(node('span', day.topic.name), node('small', '공통 입력 · ' + shortDate(day.closePrice.date) + ' 종가'))
  close.append(identity, node('strong', `${number(day.closePrice.value)} ${day.closePrice.currency}`))
  body.append(close)
  const tabs = node('div', null, { class: 'debate-source-tabs', role: 'tablist', 'aria-label': 'AI별 계산 근거' })
  const panels = node('div')
  if (!day.stances.some(row => row.ai === state.activeSource)) state.activeSource = day.stances[0]?.ai
  const select = ai => {
    state.activeSource = ai
    for (const button of tabs.querySelectorAll('button')) { button.setAttribute('aria-selected', button.dataset.ai === ai ? 'true' : 'false'); button.tabIndex = button.dataset.ai === ai ? 0 : -1 }
    for (const panel of panels.children) panel.hidden = panel.dataset.ai !== ai
  }
  for (const stance of day.stances) {
    const button = node('button', DEBATE_CHARACTERS[stance.ai].name, { type: 'button', class: 'debate-agent-' + stance.ai, role: 'tab', id: 'debate-tab-' + stance.ai, 'aria-controls': 'debate-panel-' + stance.ai, 'data-ai': stance.ai })
    button.addEventListener('click', () => select(stance.ai))
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const available = day.stances.map(row => row.ai), position = available.indexOf(stance.ai)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (position + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length
      select(available[next]); tabs.querySelector('[data-ai="' + available[next] + '"]').focus()
    })
    tabs.append(button)
    const panel = node('div', null, { class: 'debate-evidence-panel', role: 'tabpanel', id: 'debate-panel-' + stance.ai, 'aria-labelledby': 'debate-tab-' + stance.ai, 'data-ai': stance.ai })
    panel.append(node('h3', DEBATE_CHARACTERS[stance.ai].name + '의 계산 근거'))
    if (Number.isFinite(stance.pointEstimate)) panel.append(node('p', '단일 계산값 ' + number(stance.pointEstimate) + ' ' + day.closePrice.currency))
    panel.append(node('p', stance.basis), node('p', '작성 ' + moment(stance.writtenAt)))
    for (const paragraph of (stance.analysis || '').split(/\n\s*\n/u)) if (paragraph.trim()) panel.append(node('p', paragraph))
    for (const source of stance.sources || []) { const href = safeUrl(source.url); if (href) panel.append(link(source.label || '자료 원문', href, { target: '_blank', rel: 'noopener noreferrer' })) }
    panel.append(originalDetails(stance)); panels.append(panel)
  }
  select(state.activeSource)
  body.append(tabs, panels)
  if (safeUrl(day.closePrice.sourceUrl)) body.append(link('종가 자료 원문', day.closePrice.sourceUrl, { target: '_blank', rel: 'noopener noreferrer' }))
  details.append(body); return details
}
function renderArchives(day) {
  const section = node('section', null, { 'aria-label': '지난 토론' })
  section.append(sectionTitle('지난 토론', '그날의 가정과 대화를 다시 읽어봐'))
  const archives = (state.index?.days || []).filter(row => row.date !== day.date)
  if (!archives.length) section.append(node('p', '첫 토론부터 차곡차곡 쌓일 거야.', { class: 'debate-no-participant' }))
  else {
    const track = node('div', null, { class: 'debate-archives' })
    for (const row of archives) {
      const card = link(null, '#debate?date=' + row.date, { class: 'debate-archive-card' })
      card.append(node('time', row.date, { datetime: row.date }), node('strong', row.topic.title))
      if (row.issue) card.append(node('small', row.issue))
      const vote = debateVotePresentation(state.archiveVotes.get(row.id))
      if (vote.kind === 'results') {
        const best = Math.max(...vote.rows.map(row => row.percent)), winners = vote.rows.filter(row => row.percent === best)
        if (winners.length === 1) card.append(node('small', `논리 투표 1위 · ${DEBATE_CHARACTERS[winners[0].ai].name} ${number(best)}%`))
      }
      card.append(node('small', '대화 다시 읽기 →')); track.append(card)
    }
    section.append(track)
  }
  if (state.historyComplete) {
    const counts = debateCharacterHistory([...state.cache.values()])
    section.append(node('p', `GPT 항복 ${counts.gpt}회 · 하방 접음 ${counts.claude}회 · 간잽이 결정 ${counts.gemini}회`, { class: 'debate-character-history' }))
  }
  return section
}
function renderEmpty() {
  const panel = node('section', null, { class: 'debate-empty', role: 'status' })
  panel.append(node('h2', state.loading ? '오늘의 쟁점을 불러오는 중이야' : state.error ? '토론을 불러오지 못했어' : '오늘의 토론 준비 중'))
  panel.append(node('p', state.error ? '잠시 후 다시 읽어봐. 공개된 토론은 그대로 보관돼 있어.' : '같은 종목·같은 자료를 읽은 세 AI의 분석과 대화를 여기에 모을 거야.'))
  if (!state.loading) { const retry = node('button', '다시 불러오기', { type: 'button' }); retry.addEventListener('click', () => mount(true)); panel.append(retry) }
  panel.append(link('오늘의 변화 보기 →', '#today', { style: 'display:block;margin-top:18px' }))
  return panel
}
function render() {
  if (!host) return
  const children = [renderHeading()]
  if (!state.day) children.push(renderEmpty())
  else {
    if (state.lastAvailable || state.marketNewer) children.push(node('p', '오늘 토론 준비 중 · 마지막 ' + shortDate(state.day.date), { class: 'debate-freshness', role: 'status', 'data-debate-freshness': '' }))
    children.push(renderTopic(state.day), renderStances(state.day), renderThread(state.day), renderVote(state.day), renderEvidence(state.day), renderArchives(state.day))
  }
  children.push(node('p', '같은 자료에서 출발한 AI의 조건부 시나리오와 대화야. 숫자와 가정의 차이를 읽어봐. 원문에 담긴 가격은 작성 당시 자료이며, 새로운 종가와 구분해서 표시해.', { class: 'debate-footer' }))
  host.replaceChildren(...children)
}
async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('debate_unavailable')
  return response.json()
}
async function loadDay(date) {
  if (state.cache.has(date)) return state.cache.get(date)
  if (!DAY.test(date)) throw new Error('invalid_debate_date')
  const day = validateDebateDay(await loadJson('./data/debate/' + date + '.json'))
  if (day.date !== date) throw new Error('invalid_debate_date')
  state.cache.set(date, day); return day
}
async function loadHistory(request) {
  const summaries = state.index.days.slice(0, 60)
  const results = await Promise.allSettled(summaries.map(row => loadDay(row.date)))
  if (request !== state.request || !state.day) return
  const same = [...state.cache.values()].filter(row => row.date < state.day.date && row.topic.ticker === state.day.topic.ticker).sort((a, b) => b.date.localeCompare(a.date))
  state.previous = same[0] || null
  state.historyComplete = summaries.length === state.index.days.length && results.every(row => row.status === 'fulfilled')
  const currentStances = host.querySelector('[aria-label="세 AI의 입장"]')
  if (currentStances) currentStances.replaceWith(renderStances(state.day))
  const currentArchives = host.querySelector('[aria-label="지난 토론"]')
  if (currentArchives) currentArchives.replaceWith(renderArchives(state.day))
  if (!realtimeEnabled) return
  const archives = state.index.days.filter(row => row.date !== state.day.date).slice(0, 12)
  await Promise.allSettled(archives.map(async row => {
    if (state.archiveVotes.has(row.id)) return
    state.archiveVotes.set(row.id, null)
    state.archiveVotes.set(row.id, await voteRequest('GET', undefined, row))
  }))
  if (request === state.request && state.day) host.querySelector('[aria-label="지난 토론"]')?.replaceWith(renderArchives(state.day))
}
async function mount(force = false) {
  if (!host || location.hash.replace(/^#/u, '').split('?')[0] !== 'debate') return
  const requestedDate = debateRequestedDate(location.hash)
  if (!force && state.index && state.selectedDate === requestedDate && (state.day || state.loading)) return
  const request = ++state.request
  ++state.voteRequest
  state.selectedDate = requestedDate; state.loading = true; state.error = null; state.day = null; state.previous = null; state.expanded = false; state.vote = null; state.voteError = false; state.lastAvailable = false; state.marketNewer = false
  if (force) { state.index = null; state.cache.clear() }
  render()
  try {
    const index = state.index || validateDebateIndex(await loadJson('./data/debate/index.json'))
    if (request !== state.request) return
    state.index = index
    const date = requestedDate || index.latestDate
    if (!date) { state.loading = false; render(); return }
    if (!index.days.some(row => row.date === date)) throw new Error('unknown_debate_date')
    let day
    try { day = await loadDay(date) }
    catch (error) {
      if (requestedDate) throw error
      for (const earlier of index.days.filter(row => row.date < date)) {
        try { day = await loadDay(earlier.date); state.lastAvailable = true; break } catch { /* Try only published days, never invent a date. */ }
      }
      if (!day) throw error
    }
    if (request !== state.request) return
    state.day = day; state.marketNewer = !requestedDate && hasNewerDebateClose(day, window.aiChainSnapshot); state.loading = false; render(); loadVotes(); loadHistory(request)
  } catch { if (request === state.request) { state.error = 'debate_unavailable'; state.loading = false; render() } }
}
if (host) {
  window.renderDebate = mount
  window.addEventListener('market-snapshot', event => {
    if (!state.day || state.selectedDate) return
    state.marketNewer = hasNewerDebateClose(state.day, event.detail)
    const current = host.querySelector('[data-debate-freshness]')
    if (state.marketNewer || state.lastAvailable) {
      if (!current) host.querySelector('.debate-heading')?.after(node('p', '오늘 토론 준비 중 · 마지막 ' + shortDate(state.day.date), { class: 'debate-freshness', role: 'status', 'data-debate-freshness': '' }))
    } else current?.remove()
  })
  mount()
}
