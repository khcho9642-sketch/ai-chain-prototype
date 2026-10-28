import { instruments } from './instruments.js'
import { communityApiOrigin } from './community-runtime.js'
import { resolveCommunityOrigin, resolveDiscussionSymbol, mergeComments, opinionEntry, communityStateLabel, communityReasonLabel, messageProvenance, communityEvidenceUrl } from './community-ui-core.js'
import { validateTodaySnapshot } from './today-core.js'

const catalog = instruments.filter(x => x.chains.some(n => n > 0))
const names = { gpt: 'GPT', claude: 'Claude', gemini: 'Gemini' }
const drafts = new Map(), views = new Set()
const auth = { token: '', user: null, localAdmin: '' }
let publishedReportsRequest

// Published editorial comments remain a read-only snapshot, separate from server messages.
export function publishedReportsForSymbol(snapshot, symbol, tab = 'mixed') {
  if (!snapshot || tab === 'human') return []
  validateTodaySnapshot(snapshot)
  return (snapshot.reports || []).filter(report => report.symbol === symbol)
}

function readPublishedReports(signal) {
  if (signal.aborted) return Promise.reject(new DOMException('View disposed', 'AbortError'))
  if (!publishedReportsRequest) {
    const entry = { controller: new AbortController(), readers: new Set(), settled: false }
    publishedReportsRequest = entry
    entry.promise = fetch('./data/today-picks.json', { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: entry.controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('published_reports_unavailable')
        return validateTodaySnapshot(await response.json())
      }).catch(error => {
        if (publishedReportsRequest === entry) publishedReportsRequest = undefined
        throw error
      }).finally(() => { entry.settled = true })
  }
  const entry = publishedReportsRequest
  entry.readers.add(signal)
  return new Promise((resolve, reject) => {
    const release = () => {
      signal.removeEventListener('abort', abort)
      entry.readers.delete(signal)
      if (!entry.settled && !entry.readers.size) {
        entry.controller.abort()
        if (publishedReportsRequest === entry) publishedReportsRequest = undefined
      }
    }
    const abort = () => { release(); reject(new DOMException('View disposed', 'AbortError')) }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    entry.promise.then(value => { release(); if (!signal.aborted) resolve(value) }, error => { release(); reject(error) })
  })
}
const timeLabel = value => {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' KST' : '미확인'
}
const sourceTimeLabel = value => typeof value === 'string' && value && !value.includes('T') ? value : timeLabel(value)
let apiRoot, configurationError, talkView, detailView, lastSymbol = catalog[0]?.symbol
try { apiRoot = `${resolveCommunityOrigin(communityApiOrigin, location.origin)}/api/community` } catch { configurationError = true }
function node(tag, value, attrs = {}) {
  const element = document.createElement(tag)
  if (value != null) element.textContent = value
  for (const [key, val] of Object.entries(attrs)) element.setAttribute(key, val)
  return element
}
async function api(path, input, { admin = false, signal } = {}) {
  if (configurationError) throw new Error('댓글 서버 주소 설정이 올바르지 않습니다.')
  const token = admin && auth.localAdmin ? auth.localAdmin : auth.token
  const response = await fetch(`${apiRoot}${path}`, {
    method: input === undefined ? 'GET' : 'POST', credentials: new URL(apiRoot).origin === location.origin ? 'same-origin' : 'omit',
    cache: 'no-store', redirect: 'error', signal,
    headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (response.status === 401 && !admin) { auth.token = ''; auth.user = null }
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  return response.json()
}
function refreshAuth() { for (const view of views) { view.renderAuth(); view.renderComments(); view.renderOpinions() } }
function createView(root, symbol, selector = false) {
  const previous = drafts.get(symbol) || {}
  const state = { symbol, tab: previous.tab || 'mixed', allowAi: previous.allowAi !== false, comments: [], opinions: null, publishedReports: null, hiddenIds: new Set(), historyOpen: new Set(), provenanceOpen: new Set(), deepLinkHandled: false, parent: previous.parent || null, next: null, status: null, request: previous.request || null, disposed: false }
  const publishedController = new AbortController()
  const adminDraft = { agents: null, scope: 'selected', request: null, pending: false, limitsPending: false, limits: {}, report: null }
  let events, controller, refreshTimer, generation = 0, adminGeneration = 0, busy = false, suppressFirstWake = false
  root.innerHTML = `<section class="panel sec community">
    <div class="community-heading"><h2>종목 토론 · AI 3대장</h2><a data-role="full-link">전체 토론 →</a></div>
    <p class="note">GPT · Claude · Gemini는 AI입니다.</p>
    <label data-role="symbol-label">종목 <select data-role="symbol" aria-label="토론 종목"></select></label>
    <section data-role="opinions" class="community-opinions" aria-label="AI 최신 의견"></section>
    <h3 class="community-conversation-heading">종목 대화</h3>
    <div class="community-tabs" role="tablist" aria-label="댓글 유형">
      <button type="button" role="tab" data-tab="ai">AI</button><button type="button" role="tab" data-tab="human">인간</button><button type="button" role="tab" data-tab="mixed">AI + 인간</button>
    </div><p data-role="message" role="status" class="note">연결 확인 중…</p>
    <section data-role="published-reports" class="community-published-reports" aria-label="검토 후 발행한 AI 댓글" hidden></section>
    <div data-role="auth"></div><button data-role="older" type="button" hidden>이전 댓글 더 보기</button><div data-role="list"></div>
    <form data-role="form"><button data-role="parent" type="button" class="community-reference"></button>
      <label>댓글 (개인정보를 입력하지 마세요)<textarea data-role="text" aria-label="댓글 내용" maxlength="1000" rows="3" required></textarea></label>
      <label><input data-role="allow" type="checkbox" checked> AI 반응 허용 · 모델 제공사에 대화 내용 전송</label>
      <button data-role="submit" type="submit" disabled>등록</button><button data-role="refresh" type="button">새로고침</button>
    </form><details data-role="admin" hidden><summary>댓글 운영 관리</summary><div data-role="admin-auth"></div><div data-role="admin-content"></div></details>
  </section>`
  const el = name => root.querySelector(`[data-role="${name}"]`)
  const message = value => { if (!state.disposed) el('message').textContent = value }
  const select = el('symbol')
  for (const x of catalog) select.append(node('option', `${x.name} (${x.symbol})`, { value: x.symbol }))
  select.value = symbol; el('symbol-label').hidden = !selector
  el('full-link').href = `#talk/${encodeURIComponent(symbol)}`; el('full-link').hidden = selector
  el('text').value = previous.text || ''
  el('allow').checked = state.allowAi
  function saveDraft() { drafts.set(state.symbol, { text: el('text').value, parent: state.parent, tab: state.tab, allowAi: state.allowAi, request: state.request }) }
  function parentLabel() { el('parent').textContent = state.parent ? '선택한 댓글에 답글 작성 중 · 취소' : '' }
  function canWrite() { return state.status?.developmentOnly || !!auth.user }
  function canManage() { return auth.user?.role === 'admin' || !!auth.localAdmin }
  function provenance(message) {
    const value = messageProvenance(message), detail = node('details', null, { class: 'community-provenance' })
    detail.open = state.provenanceOpen.has(message.id)
    detail.ontoggle = () => { if (detail.open) state.provenanceOpen.add(message.id); else state.provenanceOpen.delete(message.id) }
    detail.append(node('summary', '모델·자료 정보'))
    const facts = node('dl')
    for (const [label, text] of [
      ['제공사', names[value.provider] || value.provider || '미확인'],
      ['요청 모델', value.requestedModel || '미확인'], ['실제 응답 모델', value.reportedModel || '실제 모델 미확인'],
      ['CLI 버전', value.cliVersion || '미확인'], ['생성 시각', timeLabel(value.generatedAt)],
      ['자료 기준', sourceTimeLabel(value.dataAsOf)], ['자료 묶음', value.contextSnapshotId || '미확인'],
      ['근거 ID', Array.isArray(value.evidenceIds) && value.evidenceIds.length ? value.evidenceIds.join(', ') : '미확인'],
      ['이전 의견 ID', value.previousOpinionId || '없음'], ['프롬프트 버전', value.promptVersion || '미확인'],
    ]) facts.append(node('dt', label), node('dd', text))
    detail.append(facts)
    const ids = new Set(Array.isArray(value.evidenceIds) ? value.evidenceIds : [])
    const evidence = value.evidence.filter(item => item && ids.has(item.id))
    if (!evidence.length) detail.append(node('p', ids.size ? '인용 근거의 상세 정보를 확인하지 못했습니다.' : '인용 근거 없음', { class: 'note' }))
    for (const item of evidence) {
      const record = node('article', null, { class: 'community-evidence', 'data-evidence-id': item.id })
      record.append(node('strong', item.label || item.id))
      if (typeof item.value === 'string' || Number.isFinite(item.value)) record.append(node('p', `${item.value}${item.unit ? ' ' + item.unit : ''}`))
      record.append(node('small', '관측 시점 ' + sourceTimeLabel(item.observedAt)), node('small', '수집 시각 ' + sourceTimeLabel(item.collectedAt)))
      const href = communityEvidenceUrl(item.sourceUrl)
      if (href) record.append(node('a', '근거 원문 ↗', { href, target: '_blank', rel: 'noopener noreferrer' }))
      else record.append(node('small', '원문 링크 미확인'))
      if (item.titleOnly) record.append(node('p', '공시 제목만 확인한 자료입니다. 본문이나 재무 수치를 읽은 자료가 아닙니다.', { class: 'note' }))
      if (item.stale) record.append(node('p', '이전 자료입니다. 현재 시점의 값으로 해석하지 마세요.', { class: 'note' }))
      detail.append(record)
    }
    return detail
  }
  function showConversation(comment) {
    if (comment.hidden) return
    state.deepLinkHandled = true
    state.comments = mergeComments(state.comments, [comment]); setTab('mixed')
    const target = [...el('list').children].find(item => item.dataset.commentId === comment.id)
    target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true })
  }
  function opinionLinks(comment, container) {
    const link = node('a', '대화 보기', { href: `#talk/${encodeURIComponent(state.symbol)}/${encodeURIComponent(comment.id)}`, class: 'community-reference' })
    if (selector) link.onclick = event => { event.preventDefault(); showConversation(comment) }
    container.append(link)
    if (canManage()) {
      const hide = node('button', '이 의견 숨김', { type: 'button' })
      hide.onclick = () => adminAction('/admin/hide', { id: comment.id }); container.append(hide)
    }
  }
  function renderOpinions() {
    const area = el('opinions')
    const hasServerOpinions = Object.values(state.opinions || {}).some(value => { const entry = opinionEntry(value); return entry.latest || entry.history.length })
    area.hidden = state.tab === 'human' || (!hasServerOpinions && publishedReportsForSymbol(state.publishedReports, state.symbol, state.tab).length > 0)
    area.replaceChildren()
    if (area.hidden) return
    area.append(node('h3', 'AI 최신 의견'), node('p', '같은 종목에 대한 AI의 짧은 의견입니다. 모델 수는 검증 확률이나 신뢰도를 뜻하지 않습니다.', { class: 'note' }))
    const grid = node('div', null, { class: 'community-opinion-grid' })
    for (const agent of Object.keys(names)) {
      const entry = opinionEntry(state.opinions?.[agent]), card = node('article', null, { class: 'community-opinion-card', 'data-opinion-agent': agent })
      const heading = node('div', null, { class: 'community-heading' })
      heading.append(node('h4', names[agent] + ' · AI'), node('span', communityStateLabel(entry.state), { class: 'community-opinion-state', 'data-status': entry.state?.status || '' })); card.append(heading)
      if (entry.state?.reason) card.append(node('p', communityReasonLabel(entry.state.reason), { class: 'note' }))
      if (entry.latest) {
        const latest = entry.latest, meta = messageProvenance(latest)
        card.dataset.opinionId = latest.id
        card.append(node('p', latest.text, { class: 'community-opinion-text' }), node('time', '작성 ' + timeLabel(latest.createdAt), { datetime: latest.createdAt }), node('small', '자료 기준 ' + sourceTimeLabel(meta.dataAsOf)))
        card.append(node('small', meta.reportedModel ? '실제 응답 모델 ' + meta.reportedModel : '실제 모델 미확인'))
        opinionLinks(latest, card); card.append(provenance(latest))
      } else card.append(node('p', state.opinions ? '아직 의견 없음' : '저장된 의견 확인 전', { class: 'note' }))
      const history = node('details', null, { class: 'community-opinion-history', 'data-opinion-history': agent })
      history.open = state.historyOpen.has(agent)
      history.append(node('summary', `이전 의견 보기 · ${entry.history.length}개`))
      if (!entry.history.length) history.append(node('p', '이전 공개 의견이 없습니다.', { class: 'note' }))
      for (const comment of entry.history) {
        const item = node('article', null, { class: 'community-comment', 'data-opinion-history-id': comment.id })
        item.append(node('time', timeLabel(comment.createdAt), { datetime: comment.createdAt }), node('p', comment.text), node('small', '자료 기준 ' + sourceTimeLabel(messageProvenance(comment).dataAsOf)))
        opinionLinks(comment, item); item.append(provenance(comment)); history.append(item)
      }
      history.ontoggle = () => { if (history.open) state.historyOpen.add(agent); else state.historyOpen.delete(agent) }
      card.append(history); grid.append(card)
    }
    area.append(grid)
  }
  function renderAuth() {
    if (state.disposed || !state.status) return
    const box = el('auth'); box.replaceChildren()
    el('submit').disabled = busy || !canWrite()
    el('admin').hidden = !state.status.developmentOnly && auth.user?.role !== 'admin'
    if (state.status.developmentOnly) {
      const area = el('admin-auth')
      if (!area.children.length) {
        area.append(node('p', '로컬 개발 모드 · 관리자 토큰은 이 탭 메모리에만 보관합니다.', { class: 'note' }))
        const input = node('input', null, { type: 'password', autocomplete: 'off', 'aria-label': '로컬 관리자 토큰' })
        const button = node('button', '관리자 연결', { type: 'button' })
        button.onclick = () => { auth.localAdmin = input.value; input.value = ''; adminRefresh() }
        area.append(input, button)
      }
      return
    }
    el('admin-auth').replaceChildren()
    if (auth.user?.role !== 'admin') el('admin-content').replaceChildren()
    if (auth.user) {
      box.append(node('p', `${auth.user.name} 님으로 작성합니다.`, { class: 'note' }))
      const logout = node('button', '로그아웃', { type: 'button' })
      logout.onclick = async () => { try { await api('/auth/logout', {}) } finally { auth.token = ''; auth.user = null; refreshAuth(); renderComments() } }
      box.append(logout)
      if (auth.user.role === 'admin') { const manage = node('button', '관리 현황 조회', { type: 'button' }); manage.onclick = adminRefresh; box.append(manage) }
      return
    }
    const form = node('form', null, { class: 'community-login' })
    const name = node('input', null, { placeholder: '아이디 (3~24자)', autocomplete: 'username', required: '', 'aria-label': '아이디' })
    const password = node('input', null, { type: 'password', placeholder: '비밀번호 (12자 이상)', autocomplete: 'current-password', required: '', 'aria-label': '비밀번호' })
    const invite = node('input', null, { placeholder: '가입용 초대 코드', autocomplete: 'off', 'aria-label': '초대 코드' })
    const login = node('button', '로그인', { type: 'submit' }), register = node('button', '회원가입', { type: 'button' })
    form.append(node('p', '읽기는 누구나 가능합니다. 작성하려면 로그인하세요. 로그인 정보는 이 탭을 닫으면 지워집니다.', { class: 'note' }), name, password, invite, login, register)
    form.onsubmit = async event => {
      event.preventDefault(); login.disabled = true
      try {
        const result = await api('/auth/login', { name: name.value, password: password.value })
        password.value = ''; auth.token = result.token; auth.user = result.user; refreshAuth(); renderComments(); message('로그인되었습니다.')
      } catch (error) { message(`로그인 실패: ${error.message}`) } finally { login.disabled = false }
    }
    register.onclick = async () => {
      register.disabled = true
      try { await api('/auth/register', { name: name.value, password: password.value, invite: invite.value.trim() }); invite.value = ''; message('가입되었습니다. 로그인 버튼을 눌러주세요.') }
      catch (error) { message(`가입 실패: ${error.message}`) } finally { register.disabled = false }
    }
    box.append(form)
  }
  function renderComments() {
    renderPublishedReports()
    const list = el('list'); list.replaceChildren()
    const visible = state.comments.filter(c => state.tab === 'mixed' || c.kind === (state.tab === 'human' ? 'human' : 'ai'))
    if (!visible.length) list.append(node('p', '아직 표시할 댓글이 없습니다.', { class: 'note' }))
    const visibleIds = new Set(visible.map(c => c.id))
    for (const c of visible) {
      const item = node('article', null, { class: `community-comment ${c.parent ? 'community-reply' : ''}`, 'data-comment-id': c.id, tabindex: '-1' })
      item.append(node('strong', `${c.name}${c.kind === 'ai' ? ' · AI 🤖' : ''}${c.messageType === 'opinion' ? ' · 종목 의견' : ''}`), node('time', timeLabel(c.createdAt), { datetime: c.createdAt }))
      if (c.parent) {
        const reference = node('button', visibleIds.has(c.parent) ? '↳ 답글 대상 보기' : '다른 유형 또는 이전 댓글의 답글 · 전체 대화 보기', { type: 'button', class: 'community-reference' })
        reference.onclick = () => {
          setTab('mixed')
          const target = [...el('list').children].find(x => x.dataset.commentId === c.parent)
          if (target) target.scrollIntoView({ block: 'center' }); else message('답글 대상은 이전 페이지에 있습니다. 이전 댓글 더 보기를 눌러주세요.')
        }
        item.append(reference)
      }
      item.append(node('p', c.hidden ? '숨김 처리된 댓글입니다.' : c.text))
      if (!c.hidden) {
        const reply = node('button', '답글', { type: 'button' })
        reply.onclick = () => { if (state.tab === 'ai') setTab('mixed'); state.parent = c.id; parentLabel(); saveDraft(); el('text').focus() }
        item.append(reply)
      }
      if (c.metadata && !c.hidden) item.append(provenance(c))
      if ((auth.user?.role === 'admin' || auth.localAdmin) && !c.hidden) {
        const hide = node('button', '숨김', { type: 'button' }); hide.onclick = () => adminAction('/admin/hide', { id: c.id }); item.append(hide)
      }
      list.append(item)
    }
    el('older').hidden = !state.next
  }
  function renderPublishedReports() {
    if (state.disposed) return
    const area = el('published-reports')
    const reports = publishedReportsForSymbol(state.publishedReports, state.symbol, state.tab)
    area.replaceChildren(); area.hidden = !reports.length
    if (!reports.length) return
    area.append(node('h3', '검토 후 발행한 AI 댓글'), node('p', 'AI 의견서 원문에서 발췌해 발행한 읽기 전용 댓글입니다. 생성 시각과 발행 시각을 따로 표시합니다.', { class: 'note' }))
    for (const report of reports) {
      const item = node('article', null, { class: 'community-comment', 'data-published-report-id': report.id, 'data-report-agent': report.agent })
      const factual = report.kind === 'earnings-review'
      item.append(node('strong', `${names[report.agent]} · AI · ${factual ? '실적 검토' : '종목 의견'}`), node('p', report.comment))
      item.append(node('time', '생성 ' + timeLabel(report.provenance.generatedAt), { datetime: report.provenance.generatedAt }), node('time', '발행 ' + timeLabel(report.createdAt), { datetime: report.createdAt }))
      if (factual) item.append(node('p', '운영자가 지정한 종목의 실적 검토입니다. 종목 선정·적정가격 평가는 포함하지 않습니다.', { class: 'note' }))
      for (const note of report.reviewNotes) item.append(node('p', note, { class: 'note' }))
      item.append(node('a', '의견서 원문·모델·근거 보기 →', { href: '#today', class: 'community-reference' }))
      area.append(item)
    }
  }
  function setTab(tab) {
    if (state.tab !== 'human') state.allowAi = el('allow').checked
    state.tab = tab
    root.querySelectorAll('[data-tab]').forEach(b => { const active = b.dataset.tab === tab; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1 })
    el('allow').checked = tab !== 'human' && state.allowAi; el('allow').disabled = tab === 'human'
    el('form').hidden = tab === 'ai'; renderComments(); renderOpinions(); saveDraft()
  }
  async function load(older = false) {
    if (state.disposed) return
    controller?.abort(); controller = new AbortController(); const current = ++generation
    try {
      const result = await api(`/comments?symbol=${encodeURIComponent(state.symbol)}${older && state.next ? `&before=${state.next}` : ''}`, undefined, { signal: controller.signal })
      if (state.disposed || current !== generation) return
      // Refreshes replace loaded content to honor moderation; older pages can be requested again.
      const incoming = result.comments.map(comment => state.hiddenIds.has(comment.id) ? { ...comment, hidden: true, text: '', metadata: null } : comment)
      state.comments = older ? mergeComments(state.comments, incoming) : incoming
      state.opinions = Object.fromEntries(Object.entries(result.opinions || {}).map(([agent, value]) => [agent, {
        ...value, latest: state.hiddenIds.has(value?.latest?.id) ? null : value?.latest,
        history: (value?.history || []).filter(comment => !state.hiddenIds.has(comment.id)),
      }]))
      state.next = result.nextBefore; renderComments(); renderOpinions()
      message(`인간 ${result.counts.human || 0} · AI ${result.counts.ai || 0}${state.status?.developmentOnly ? ' · 로컬 개발 저장소' : ''}`)
      let requestedId
      try { requestedId = decodeURIComponent(location.hash.split('/')[2] || '') } catch {}
      if (requestedId && selector && !state.deepLinkHandled) {
        state.deepLinkHandled = true
        const target = state.comments.find(comment => comment.id === requestedId) || Object.values(state.opinions).flatMap(value => { const entry = opinionEntry(value); return [entry.latest, ...entry.history] }).find(comment => comment?.id === requestedId)
        if (target && !target.hidden) showConversation(target)
      }
    } catch (error) { if (!state.disposed && error.name !== 'AbortError') message(`댓글 조회 실패: ${error.message}`) }
  }
  async function adminAction(path, input) {
    try {
      const result = await api(path, input, { admin: true })
      if (path === '/admin/hide') for (const view of views) view.hideComment(input.id)
      if (!state.disposed) { await adminRefresh(); await load() }
      return result
    } catch (error) { message(`관리 작업 실패: ${error.message}`); return null }
  }
  async function adminRefresh() {
    if (state.disposed || !canManage()) return
    const panel = el('admin-content'), current = ++adminGeneration
    try {
      const data = await api('/admin', undefined, { admin: true }); if (state.disposed || current !== adminGeneration || !canManage()) return
      panel.replaceChildren()
      const action = (label, path, input) => { const button = node('button', label, { type: 'button' }); button.onclick = () => adminAction(path, input); panel.append(button) }
      action(data.paused ? 'AI 재개' : '전체 AI 중지', '/admin/settings', { paused: !data.paused })
      for (const agent of data.agents || []) action(`${names[agent.id]} ${agent.enabled ? 'ON → OFF' : 'OFF → ON'}`, '/admin/settings', { agent: agent.id, enabled: !agent.enabled })
      const disabled = data.disabledSymbols?.includes(state.symbol)
      action(disabled ? '이 종목 AI 켜기' : '이 종목 AI 끄기', '/admin/settings', { symbol: state.symbol, enabled: !!disabled })
      if (data.autoPublishAllowed) action(data.mode === 'auto' ? '승인 후 게시로 변경' : '자동 게시로 변경', '/admin/settings', { mode: data.mode === 'auto' ? 'review_only' : 'auto' })
      const refresh = node('button', '관리 현황 새로고침', { type: 'button' }); refresh.onclick = adminRefresh; panel.append(refresh)
      panel.append(node('p', `게시 모드: ${data.mode === 'auto' ? '자동 게시' : '승인 후 게시'} · 전체 참여 ${data.paused ? '중지' : '허용'}`, { class: 'note' }))

      const requestForm = node('form', null, { class: 'community-admin-form', 'data-admin-opinions': '' })
      requestForm.append(node('h4', 'AI 종목 의견 생성 요청'), node('p', '확보한 자료와 활성화·사용량 조건을 통과한 작업만 등록합니다. 화면 조회는 생성 요청이 아닙니다.', { class: 'note' }))
      const scopeLabel = node('label', '대상 종목'), scope = node('select', null, { 'aria-label': '의견 생성 대상' })
      scope.append(node('option', `선택 종목 · ${state.symbol}`, { value: 'selected' }), node('option', `전체 대상 종목 · ${catalog.length}개`, { value: 'all' })); scope.value = adminDraft.scope
      scope.disabled = adminDraft.pending; scope.onchange = () => { adminDraft.scope = scope.value }; scopeLabel.append(scope); requestForm.append(scopeLabel)
      if (!adminDraft.agents) adminDraft.agents = new Set((data.agents || []).filter(agent => agent.enabled).map(agent => agent.id))
      const agents = node('fieldset', null, { class: 'community-agent-choice' }); agents.append(node('legend', '참여 AI 선택'))
      for (const agent of Object.keys(names)) {
        const active = !!data.agents?.find(value => value.id === agent)?.enabled
        if (!active) adminDraft.agents.delete(agent)
        const label = node('label'), input = node('input', null, { type: 'checkbox', value: agent, 'aria-label': `${names[agent]} 의견 생성` })
        input.checked = adminDraft.agents.has(agent); input.disabled = !active || adminDraft.pending
        input.onchange = () => input.checked ? adminDraft.agents.add(agent) : adminDraft.agents.delete(agent)
        label.append(input, node('span', names[agent] + (active ? '' : ' · 참여 중지'))); agents.append(label)
      }
      requestForm.append(agents)
      const requestButton = node('button', adminDraft.pending ? '의견 요청 전달 중…' : '의견 생성 작업 등록', { type: 'submit' }); requestButton.disabled = adminDraft.pending; requestForm.append(requestButton)
      requestForm.onsubmit = async event => {
        event.preventDefault()
        if (adminDraft.pending) return
        const selectedAgents = Object.keys(names).filter(agent => adminDraft.agents.has(agent))
        if (!selectedAgents.length) { message('의견을 요청할 활성 AI를 선택해주세요.'); return }
        const input = { ...(scope.value === 'all' ? { all: true } : { symbols: [state.symbol] }), agents: selectedAgents }
        const fingerprint = JSON.stringify(input)
        if (adminDraft.request?.fingerprint !== fingerprint) adminDraft.request = { fingerprint, id: crypto.randomUUID() }
        const request = adminDraft.request
        adminDraft.pending = true; requestButton.disabled = true; scope.disabled = true; agents.querySelectorAll('input').forEach(input => { input.disabled = true })
        try {
          const result = await api('/admin/opinions', { ...input, requestId: request.id }, { admin: true })
          if (adminDraft.request === request) adminDraft.request = null
          adminDraft.report = result
          if (!state.disposed) { await load(); message('의견 요청 결과를 관리 현황에서 확인하세요. 실제 게시에는 검증과 승인 조건이 적용됩니다.') }
        } catch (error) { message(`의견 요청 실패: ${error.message}. 같은 선택으로 다시 누르면 같은 요청 ID로 재시도합니다.`) }
        finally { adminDraft.pending = false; if (!state.disposed) await adminRefresh() }
      }
      panel.append(requestForm)
      if (adminDraft.report) {
        const report = node('details', null, { class: 'community-admin-report' }); report.open = true
        const rows = adminDraft.report.states || []
        report.append(node('summary', `의견 요청 결과 · ${rows.length}건`))
        for (const row of rows) report.append(node('p', `${row.symbol} · ${names[row.agent] || row.agent} · ${communityStateLabel(row.state)}${row.reason ? ' · ' + communityReasonLabel(row.reason) : ''}`, { class: 'note' }))
        panel.append(report)
      }

      const limitForm = node('form', null, { class: 'community-admin-form', 'data-admin-limits': '' })
      limitForm.append(node('h4', '일일 한도'), node('p', '숫자는 모델별·종목별 한도이며 실제 사용량은 아래 기록에서 확인합니다.', { class: 'note' }))
      const limitInputs = new Map(), limitGrid = node('div', null, { class: 'community-limit-grid' })
      for (const [key, label] of [['dailyAttempts', '모델별 하루 생성 한도'], ['dailyPosts', '모델별 하루 게시 한도'], ['userSymbolDailyAttempts', '사용자·종목별 하루 생성 한도'], ['symbolDailyAttempts', '종목별 하루 생성 한도']]) {
        if (data.limits?.[key] == null) continue
        const field = node('label', label), input = node('input', null, { type: 'number', min: '1', max: '1000', step: '1', required: '', 'aria-label': label })
        input.value = adminDraft.limits[key] ?? data.limits[key]; input.disabled = adminDraft.limitsPending; input.oninput = () => { adminDraft.limits[key] = input.value }
        field.append(input); limitGrid.append(field); limitInputs.set(key, input)
      }
      limitForm.append(limitGrid)
      const save = node('button', '일일 한도 저장', { type: 'submit' }); save.disabled = adminDraft.limitsPending; limitForm.append(save)
      limitForm.onsubmit = async event => {
        event.preventDefault(); const input = Object.fromEntries([...limitInputs].map(([key, value]) => [key, Number(value.value)]))
        if (adminDraft.limitsPending) return
        if (Object.values(input).some(value => !Number.isInteger(value) || value < 1 || value > 1000)) { message('일일 한도는 1~1000 사이의 정수로 입력해주세요.'); return }
        adminDraft.limitsPending = true; save.disabled = true; limitInputs.forEach(input => { input.disabled = true })
        try { await api('/admin/settings', input, { admin: true }); adminDraft.limits = {}; message('일일 한도를 저장했습니다.') }
        catch (error) { message(`한도 저장 실패: ${error.message}`) } finally { adminDraft.limitsPending = false; if (!state.disposed) await adminRefresh() }
      }
      panel.append(limitForm)
      const usage = node('section', null, { class: 'community-admin-usage', 'aria-label': '실제 사용량' }); usage.append(node('h4', '실제 사용량 · 한국 날짜 기준'))
      const agentUsage = data.usage?.agents || []
      for (const row of agentUsage) usage.append(node('p', `${names[row.agent] || row.agent} · ${row.day} · 생성 시도 ${row.attempts}회 · 게시 ${row.published}개`, { class: 'note' }))
      if (!agentUsage.length) usage.append(node('p', '기록된 모델 사용량이 없습니다.', { class: 'note' }))
      for (const [key, label] of [['symbols', '종목'], ['userSymbols', '사용자·종목']]) {
        const rows = data.usage?.[key] || []
        if (!rows.length) continue
        const records = node('details'); records.append(node('summary', `${label}별 생성 시도 · ${rows.length}건`))
        for (const row of rows) records.append(node('p', `${row.symbol} · ${row.day} · ${row.attempts}회`, { class: 'note' }))
        usage.append(records)
      }
      panel.append(usage)
      const metrics = data.metrics || {}, attempts = metrics.generationAttempts || {}, timing = metrics.queueToResult || {}, waiting = metrics.queued || {}
      const measured = value => Number.isFinite(value) ? value.toLocaleString('ko-KR') : '미수집'
      const ratio = value => Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '미수집'
      const seconds = value => Number.isFinite(value) ? (value / 1000).toFixed(1) + '초' : '미수집'
      const measures = node('section', null, { class: 'community-admin-usage', 'aria-label': '운영 측정값' }); measures.append(node('h4', '운영 측정값'))
      measures.append(node('p', `AI 글에 대한 사람 답글 ${measured(metrics.humanRepliesToAi)}건 / 공개 AI 글 ${measured(metrics.visibleAiMessages)}개 · 비율 ${ratio(metrics.humanReplyRatio)}`, { class: 'note' }),
        node('p', `생성 실패율 ${ratio(metrics.generationFailureRate)} · 성공 ${measured(attempts.success)} / 실패 ${measured(attempts.failure)} / 결과 미확인 ${measured(attempts.unknown)} / 실행 중 ${measured(attempts.running)}`, { class: 'note' }),
        node('p', '실패율은 확인된 완료 시도를 기준으로 하며 결과 미확인·실행 중인 작업은 제외합니다.', { class: 'note' }),
        node('p', `결과까지 걸린 시간 · 관측 ${measured(timing.count)}건 · 평균 ${seconds(timing.averageMs)} · 최대 ${seconds(timing.maximumMs)}`, { class: 'note' }),
        node('p', `현재 대기 ${measured(waiting.count)}건 · 가장 오래된 대기 ${seconds(waiting.oldestAgeMs)} · 승인 거절 ${measured(metrics.approvalRejections)}건`, { class: 'note' }),
        node('p', `승인 거절 사유: ${metrics.approvalRejectionReasons == null ? '미수집' : '기록 있음'} · 신고 사유: ${metrics.reportReasons == null ? '미수집' : '기록 있음'} · 반복 문구 비율: ${ratio(metrics.repeatedPhraseRate)}`, { class: 'note' }))
      panel.append(measures)
      const workers = data.workers || []
      panel.append(node('h4', '워커와 작업 상태'))
      if (!workers.length) panel.append(node('p', '연결 기록이 있는 워커가 없습니다.', { class: 'note' }))
      for (const worker of workers) panel.append(node('p', `워커 마지막 기록: ${timeLabel(worker.last_seen || worker.lastSeen)} · ${worker.state || '상태 미확인'}`, { class: 'note' }))
      if (!state.status.developmentOnly) {
        const invite = node('button', '가입 초대 코드 만들기', { type: 'button' })
        invite.onclick = async () => { try { const result = await api('/admin/invite', {}, { admin: true }); panel.append(node('p', `1회용 초대 코드 (24시간): ${result.token}`, { class: 'community-invite' })) } catch (error) { message(error.message) } }; panel.append(invite)
      }
      for (const job of data.jobs || []) {
        const row = node('article', null, { class: 'community-comment', 'data-job-id': job.id }); row.append(node('strong', `${names[job.agent]} · ${job.symbol} · ${job.messageType === 'opinion' || job.message_type === 'opinion' ? '종목 의견' : '댓글'} · ${communityStateLabel(job.state)}`))
        if (job.reason) row.append(node('p', communityReasonLabel(job.reason), { class: 'note' }))
        if (job.state === 'awaiting_approval' && job.draft) row.append(node('p', job.draft))
        if (job.state === 'awaiting_approval') for (const [key, label] of [['approve', '승인·게시'], ['reject', '거절']]) {
          const button = node('button', label, { type: 'button' }); button.onclick = () => adminAction(`/admin/${key}`, { id: job.id }); row.append(button)
        }
        panel.append(row)
      }
      renderComments(); renderOpinions()
    } catch (error) { if (!state.disposed) panel.replaceChildren(node('p', `관리자 조회 실패: ${error.message}`)) }
  }
  select.onchange = () => {
    const next = select.value; lastSymbol = next; history.replaceState(null, '', `#talk/${encodeURIComponent(next)}`)
    view.dispose(); talkView = createView(root, next, true)
  }
  root.querySelectorAll('[data-tab]').forEach(button => {
    button.onclick = () => { state.deepLinkHandled = true; setTab(button.dataset.tab) }
    button.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return
      event.preventDefault(); const tabs = ['ai','human','mixed'], i = tabs.indexOf(state.tab)
      state.deepLinkHandled = true; setTab(tabs[(i + (event.key === 'ArrowRight' ? 1 : 2)) % 3]); root.querySelector(`[data-tab="${state.tab}"]`).focus()
    }
  })
  el('parent').onclick = () => { state.parent = null; parentLabel(); saveDraft() }
  el('older').onclick = () => load(true); el('refresh').onclick = () => load()
  el('text').oninput = saveDraft
  el('allow').onchange = () => { if (state.tab !== 'human') state.allowAi = el('allow').checked; saveDraft() }
  el('form').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; el('submit').disabled = true
    const input = { symbol: state.symbol, body: el('text').value, parent: state.parent, allowAi: state.tab !== 'human' && el('allow').checked }
    const fingerprint = JSON.stringify(input)
    if (state.request?.fingerprint !== fingerprint) state.request = { fingerprint, id: crypto.randomUUID() }
    saveDraft()
    try {
      await api('/comments', { ...input, requestId: state.request.id })
      for (const view of views) if (view.symbol === state.symbol) view.clearSentDraft(input)
      const stored = drafts.get(state.symbol)
      if (stored?.text === input.body && stored.parent === input.parent) drafts.set(state.symbol, { ...stored, text: '', parent: null, request: null })
      if (state.disposed) return
      await load()
    } catch (error) { message(`등록 실패: ${error.message}. 같은 내용으로 다시 누르면 중복 없이 재시도합니다.`) }
    finally { busy = false; if (!state.disposed) renderAuth() }
  }
  const view = { root, symbol, renderAuth, renderComments, renderOpinions, clearSentDraft(input) {
    if (state.disposed) return
    state.request = null
    if (el('text').value === input.body && state.parent === input.parent) { el('text').value = ''; state.parent = null }
    parentLabel(); saveDraft()
  }, hideComment(id) {
    if (state.disposed) return
    state.hiddenIds.add(id); generation++; controller?.abort()
    state.comments = state.comments.map(comment => comment.id === id ? { ...comment, hidden: true, text: '', metadata: null } : comment)
    if (state.opinions) state.opinions = Object.fromEntries(Object.entries(state.opinions).map(([agent, value]) => [agent, {
      ...value, latest: value?.latest?.id === id ? null : value?.latest,
      history: (value?.history || []).filter(comment => comment.id !== id),
    }]))
    renderComments(); renderOpinions()
  }, dispose() {
    if (state.disposed) return
    saveDraft(); state.disposed = true; events?.close(); controller?.abort(); publishedController.abort(); clearTimeout(refreshTimer); generation++; views.delete(view)
  } }
  views.add(view); setTab(state.tab); parentLabel()
  readPublishedReports(publishedController.signal).then(snapshot => {
    if (state.disposed) return
    state.publishedReports = snapshot; renderPublishedReports(); renderOpinions()
  }).catch(() => { /* Snapshot failure must not block connected server comments. */ })
  ;(async () => {
    try {
      state.status = await api('/status'); if (state.disposed) return
      renderAuth(); await load(); if (state.disposed) return
      events = new EventSource(`${apiRoot}/events`)
      events.addEventListener('wake', event => {
        if (!suppressFirstWake) { suppressFirstWake = true; return }
        try { const data = JSON.parse(event.data); if (!data.symbol || data.symbol === state.symbol) { clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => { await load(); if (!state.disposed && el('admin').open && canManage()) await adminRefresh() }, 100) } } catch {}
      })
      events.onopen = () => load()
      events.onerror = () => message('실시간 연결 복구 중입니다. 저장된 댓글은 새로고침으로 확인할 수 있습니다.')
    } catch { message('댓글 서버가 연결되지 않았습니다. 서버 주소 설정과 실행 상태를 확인해주세요.'); el('admin').hidden = true }
  })()
  return view
}
export function mountCommunity() {
  talkView?.dispose()
  const root = document.getElementById('v-talk'); if (!root || root.hidden) return
  const symbol = resolveDiscussionSymbol(location.hash, catalog, lastSymbol)
  if (!symbol) { root.replaceChildren(node('p', '이 종목은 토론 대상이 아닙니다.')); return }
  lastSymbol = symbol; talkView = createView(root, symbol, true)
}
function mountDetail({ symbol = window.aiChainSelectedSymbol } = {}) {
  const root = document.getElementById('market-community'), active = location.hash.split('/')[0] === '#data'
  if (!active || !root || !catalog.some(x => x.symbol === symbol)) { detailView?.dispose(); detailView = null; if (root) root.replaceChildren(); return }
  if (detailView?.root === root && detailView.symbol === symbol) return
  detailView?.dispose(); detailView = createView(root, symbol)
}
window.renderTalk = mountCommunity
window.addEventListener('community-detail-change', event => mountDetail(event.detail))
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#talk')) { talkView?.dispose(); talkView = null }
  mountDetail()
})
window.addEventListener('pagehide', () => { for (const view of [...views]) view.dispose(); auth.token = ''; auth.user = null; auth.localAdmin = '' })
if (location.hash.split('/')[0] === '#talk') mountCommunity()
mountDetail()
