import { instruments } from './instruments.js'
import { communityApiOrigin } from './community-runtime.js'
import { resolveCommunityOrigin, resolveDiscussionSymbol, mergeComments } from './community-ui-core.js'

const catalog = instruments.filter(x => x.chains.some(n => n > 0))
const names = { gpt: 'GPT', claude: 'Claude', gemini: 'Gemini' }
const drafts = new Map(), views = new Set()
const auth = { token: '', user: null, localAdmin: '' }
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
function refreshAuth() { for (const view of views) view.renderAuth() }
function createView(root, symbol, selector = false) {
  const previous = drafts.get(symbol) || {}
  const state = { symbol, tab: previous.tab || 'mixed', comments: [], parent: previous.parent || null, next: null, status: null, request: previous.request || null, disposed: false }
  let events, controller, refreshTimer, generation = 0, busy = false, suppressFirstWake = false
  root.innerHTML = `<section class="panel sec community">
    <div class="community-heading"><h2>종목 토론 · AI 3대장</h2><a data-role="full-link">전체 토론 →</a></div>
    <p class="note">GPT · Claude · Gemini는 AI입니다. 말투만 다르고 낙관·비관은 고정하지 않습니다.</p>
    <label data-role="symbol-label">종목 <select data-role="symbol" aria-label="토론 종목"></select></label>
    <div class="community-tabs" role="tablist" aria-label="댓글 유형">
      <button type="button" role="tab" data-tab="ai">AI</button><button type="button" role="tab" data-tab="human">인간</button><button type="button" role="tab" data-tab="mixed">AI + 인간</button>
    </div><p data-role="message" role="status" class="note">연결 확인 중…</p>
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
  function saveDraft() { drafts.set(state.symbol, { text: el('text').value, parent: state.parent, tab: state.tab, request: state.request }) }
  function parentLabel() { el('parent').textContent = state.parent ? '선택한 댓글에 답글 작성 중 · 취소' : '' }
  function canWrite() { return state.status?.developmentOnly || !!auth.user }
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
    const list = el('list'); list.replaceChildren()
    const visible = state.comments.filter(c => state.tab === 'mixed' || c.kind === (state.tab === 'human' ? 'human' : 'ai'))
    if (!visible.length) list.append(node('p', '아직 표시할 댓글이 없습니다.', { class: 'note' }))
    const visibleIds = new Set(visible.map(c => c.id))
    for (const c of visible) {
      const item = node('article', null, { class: `community-comment ${c.parent ? 'community-reply' : ''}`, 'data-comment-id': c.id })
      item.append(node('strong', `${c.name}${c.kind === 'ai' ? ' · AI 🤖' : ''}`), node('time', new Date(c.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }), { datetime: c.createdAt }))
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
      if (c.metadata) {
        const detail = node('details'); detail.append(node('summary', '모델 정보'), node('small', `${c.metadata.model || 'unknown'} / CLI ${c.metadata.cli_version || 'unknown'}`)); item.append(detail)
      }
      if ((auth.user?.role === 'admin' || auth.localAdmin) && !c.hidden) {
        const hide = node('button', '숨김', { type: 'button' }); hide.onclick = () => adminAction('/admin/hide', { id: c.id }); item.append(hide)
      }
      list.append(item)
    }
    el('older').hidden = !state.next
  }
  function setTab(tab) {
    state.tab = tab
    root.querySelectorAll('[data-tab]').forEach(b => { const active = b.dataset.tab === tab; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1 })
    el('allow').checked = tab !== 'human'; el('allow').disabled = tab === 'human'
    el('form').hidden = tab === 'ai'; renderComments(); saveDraft()
  }
  async function load(older = false) {
    if (state.disposed) return
    controller?.abort(); controller = new AbortController(); const current = ++generation
    try {
      const result = await api(`/comments?symbol=${encodeURIComponent(state.symbol)}${older && state.next ? `&before=${state.next}` : ''}`, undefined, { signal: controller.signal })
      if (state.disposed || current !== generation) return
      // Refreshes replace loaded content to honor moderation; older pages can be requested again.
      state.comments = older ? mergeComments(state.comments, result.comments) : result.comments
      state.next = result.nextBefore; renderComments()
      message(`인간 ${result.counts.human || 0} · AI ${result.counts.ai || 0}${state.status?.developmentOnly ? ' · 로컬 개발 저장소' : ''}`)
    } catch (error) { if (!state.disposed && error.name !== 'AbortError') message(`댓글 조회 실패: ${error.message}`) }
  }
  async function adminAction(path, input) {
    try { await api(path, input, { admin: true }); await adminRefresh(); await load() } catch (error) { message(`관리 작업 실패: ${error.message}`) }
  }
  async function adminRefresh() {
    const panel = el('admin-content')
    try {
      const data = await api('/admin', undefined, { admin: true }); if (state.disposed) return
      panel.replaceChildren()
      const action = (label, path, input) => { const button = node('button', label, { type: 'button' }); button.onclick = () => adminAction(path, input); panel.append(button) }
      action(data.paused ? 'AI 재개' : '전체 AI 중지', '/admin/settings', { paused: !data.paused })
      for (const agent of data.agents) action(`${names[agent.id]} ${agent.enabled ? 'ON → OFF' : 'OFF → ON'}`, '/admin/settings', { agent: agent.id, enabled: !agent.enabled })
      const disabled = data.disabledSymbols?.includes(state.symbol)
      action(disabled ? '이 종목 AI 켜기' : '이 종목 AI 끄기', '/admin/settings', { symbol: state.symbol, enabled: !!disabled })
      action('이 종목 AI 참여 요청', '/admin/request', { symbol: state.symbol })
      if (data.autoPublishAllowed) action(data.mode === 'auto' ? '승인 후 게시로 변경' : '자동 게시로 변경', '/admin/settings', { mode: data.mode === 'auto' ? 'review_only' : 'auto' })
      panel.append(node('p', `현재: ${data.mode === 'auto' ? '자동 게시' : '승인 후 게시'} · 일일 생성 ${data.limits?.dailyAttempts || 150}회 / 게시 ${data.limits?.dailyPosts || 100}개`, { class: 'note' }))
      const workers = data.workers || []
      panel.append(node('p', workers.length ? `워커 마지막 연결: ${new Date(workers[0].last_seen).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : '연결 기록이 있는 워커가 없습니다.', { class: 'note' }))
      if (!state.status.developmentOnly) {
        const invite = node('button', '가입 초대 코드 만들기', { type: 'button' })
        invite.onclick = async () => { try { const result = await api('/admin/invite', {}, { admin: true }); panel.append(node('p', `1회용 초대 코드 (24시간): ${result.token}`, { class: 'community-invite' })) } catch (error) { message(error.message) } }; panel.append(invite)
      }
      for (const job of data.jobs) {
        const row = node('article', null, { class: 'community-comment' }); row.append(node('strong', `${names[job.agent]} · ${job.symbol} · ${job.state}`), node('p', job.draft || job.reason || '대기 중'))
        if (job.state === 'awaiting_approval') for (const [key, label] of [['approve', '승인·게시'], ['reject', '거절']]) {
          const button = node('button', label, { type: 'button' }); button.onclick = () => adminAction(`/admin/${key}`, { id: job.id }); row.append(button)
        }
        panel.append(row)
      }
      renderComments()
    } catch (error) { if (!state.disposed) panel.replaceChildren(node('p', `관리자 조회 실패: ${error.message}`)) }
  }
  select.onchange = () => {
    const next = select.value; lastSymbol = next; history.replaceState(null, '', `#talk/${encodeURIComponent(next)}`)
    view.dispose(); talkView = createView(root, next, true)
  }
  root.querySelectorAll('[data-tab]').forEach(button => {
    button.onclick = () => setTab(button.dataset.tab)
    button.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return
      event.preventDefault(); const tabs = ['ai','human','mixed'], i = tabs.indexOf(state.tab)
      setTab(tabs[(i + (event.key === 'ArrowRight' ? 1 : 2)) % 3]); root.querySelector(`[data-tab="${state.tab}"]`).focus()
    }
  })
  el('parent').onclick = () => { state.parent = null; parentLabel(); saveDraft() }
  el('older').onclick = () => load(true); el('refresh').onclick = () => load()
  el('text').oninput = saveDraft
  el('form').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; el('submit').disabled = true
    const input = { symbol: state.symbol, body: el('text').value, parent: state.parent, allowAi: state.tab !== 'human' && el('allow').checked }
    const fingerprint = JSON.stringify(input)
    if (state.request?.fingerprint !== fingerprint) state.request = { fingerprint, id: crypto.randomUUID() }
    saveDraft()
    try {
      await api('/comments', { ...input, requestId: state.request.id })
      if (state.disposed) { drafts.delete(state.symbol); return }
      el('text').value = ''; state.request = null; state.parent = null; parentLabel(); saveDraft(); await load()
    } catch (error) { message(`등록 실패: ${error.message}. 같은 내용으로 다시 누르면 중복 없이 재시도합니다.`) }
    finally { busy = false; if (!state.disposed) renderAuth() }
  }
  const view = { root, symbol, renderAuth, dispose() {
    if (state.disposed) return
    saveDraft(); state.disposed = true; events?.close(); controller?.abort(); clearTimeout(refreshTimer); generation++; views.delete(view)
  } }
  views.add(view); setTab(state.tab); parentLabel()
  ;(async () => {
    try {
      state.status = await api('/status'); if (state.disposed) return
      renderAuth(); await load(); if (state.disposed) return
      events = new EventSource(`${apiRoot}/events`)
      events.addEventListener('wake', event => {
        if (!suppressFirstWake) { suppressFirstWake = true; return }
        try { const data = JSON.parse(event.data); if (!data.symbol || data.symbol === state.symbol) { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => load(), 100) } } catch {}
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
