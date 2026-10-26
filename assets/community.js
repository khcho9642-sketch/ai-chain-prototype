import { instruments } from './instruments.js'

const catalog = instruments.filter(x => x.chains.some(n => n > 0))
const names = { gpt: 'GPT', claude: 'Claude', gemini: 'Gemini' }
const state = { symbol: catalog[0]?.symbol, tab: 'mixed', comments: [], parent: null, next: null, adminToken: '', request: null, generation: 0 }
const apiRoot = '/api/community'
let events, pending, mountVersion = 0
function node(tag, value, attrs = {}) {
  const element = document.createElement(tag)
  if (value != null) element.textContent = value
  for (const [key, val] of Object.entries(attrs)) element.setAttribute(key, val)
  return element
}
async function api(path, input, admin = false, signal) {
  const response = await fetch(`${apiRoot}${path}`, {
    method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...(admin ? { Authorization: `Bearer ${state.adminToken}` } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || `HTTP ${response.status}`) }
  return response.json()
}
function message(value) { const el = document.getElementById('community-message'); if (el) el.textContent = value }
function parentLabel() {
  const label = document.getElementById('community-parent')
  if (label) label.textContent = state.parent ? '선택한 댓글에 답글 작성 중 · 취소' : ''
}
function renderComments() {
  const list = document.getElementById('community-list'); if (!list) return
  list.replaceChildren()
  const visible = state.comments.filter(c => state.tab === 'mixed' || c.kind === (state.tab === 'human' ? 'human' : 'ai'))
  if (!visible.length) list.append(node('p', '아직 표시할 댓글이 없습니다. AI 답변은 생성·승인 후 나타납니다.', { class: 'note' }))
  const visibleIds = new Set(visible.map(c => c.id))
  for (const c of visible) {
    const item = node('article', null, { class: `community-comment ${c.parent ? 'community-reply' : ''}`, id: `comment-${c.id}` })
    item.append(node('strong', `${c.name}${c.kind === 'ai' ? ' · AI 🤖' : ''}`), node('time', new Date(c.createdAt).toLocaleString('ko-KR'), { datetime: c.createdAt }))
    if (c.parent) {
      const reference = node('button', visibleIds.has(c.parent) ? '↳ 답글 대상 보기' : '다른 유형 또는 이전 댓글의 답글 · 전체 대화 보기', { type: 'button', class: 'community-reference' })
      reference.onclick = () => { setTab('mixed'); document.getElementById(`comment-${c.parent}`)?.scrollIntoView({ block: 'center' }) }
      item.append(reference)
    }
    item.append(node('p', c.hidden ? '숨김 처리된 댓글입니다.' : c.text))
    if (!c.hidden) {
      const reply = node('button', '답글', { type: 'button' })
      reply.onclick = () => { if (state.tab === 'ai') setTab('mixed'); state.parent = c.id; parentLabel(); document.getElementById('community-text').focus() }
      item.append(reply)
    }
    if (c.metadata) {
      const detail = node('details'); detail.append(node('summary', '모델 정보'), node('small', `${c.metadata.model || 'unknown'} / CLI ${c.metadata.cli_version || 'unknown'} / ${c.metadata.prompt_version}`)); item.append(detail)
    }
    if (state.adminToken && !c.hidden) {
      const hide = node('button', '숨김', { type: 'button' }); hide.onclick = async () => { try { await api('/admin/hide', { id: c.id }, true); await load() } catch (e) { message(e.message) } }; item.append(hide)
    }
    list.append(item)
  }
  document.getElementById('community-older').hidden = !state.next
}
function setTab(tab) {
  state.tab = tab
  document.querySelectorAll('[data-community-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.communityTab === tab)))
  const consent = document.getElementById('community-allow')
  consent.checked = tab !== 'human'; consent.disabled = tab === 'human'
  document.getElementById('community-form').hidden = tab === 'ai'
  renderComments()
}
async function load(older = false) {
  pending?.abort(); pending = new AbortController(); const generation = ++state.generation
  try {
    const result = await api(`/comments?symbol=${encodeURIComponent(state.symbol)}${older && state.next ? `&before=${state.next}` : ''}`, undefined, false, pending.signal)
    if (generation !== state.generation) return
    state.comments = older ? [...result.comments, ...state.comments] : result.comments
    state.next = result.nextBefore
    renderComments(); message(`인간 ${result.counts.human || 0} · AI ${result.counts.ai || 0} · 로컬 개발 저장소`)
  } catch (e) { if (e.name !== 'AbortError') message(`댓글 조회 실패: ${e.message}`) }
}
async function adminRefresh() {
  const panel = document.getElementById('community-admin-content'); if (!panel) return
  try {
    const data = await api('/admin', undefined, true); panel.replaceChildren()
    const pause = node('button', data.paused ? 'AI 재개' : '전체 AI 중지', { type: 'button' })
    pause.onclick = () => adminAction('/admin/settings', { paused: !data.paused }); panel.append(pause)
    for (const agent of data.agents) {
      const toggle = node('button', `${names[agent.id]} ${agent.enabled ? 'ON → OFF' : 'OFF → ON'}`, { type: 'button' })
      toggle.onclick = () => adminAction('/admin/settings', { agent: agent.id, enabled: !agent.enabled }); panel.append(toggle)
    }
    const request = node('button', '선택 종목 AI 참여 요청', { type: 'button' }); request.onclick = () => adminAction('/admin/request', { symbol: state.symbol }); panel.append(request)
    panel.append(node('p', '승인 전용 모드입니다. 어댑터 사용 조건·격리·인증을 확인한 후 AI를 켜세요.', { class: 'note' }))
    for (const job of data.jobs) {
      const row = node('article', null, { class: 'community-comment' })
      row.append(node('strong', `${names[job.agent]} · ${job.symbol} · ${job.state}`), node('p', job.draft || job.reason || '대기 중'))
      if (job.state === 'awaiting_approval') for (const [action, label] of [['approve', '승인·게시'], ['reject', '거절']]) {
        const button = node('button', label, { type: 'button' }); button.onclick = () => adminAction(`/admin/${action}`, { id: job.id }); row.append(button)
      }
      panel.append(row)
    }
    renderComments()
  } catch (e) { panel.replaceChildren(node('p', `관리자 인증/조회 실패: ${e.message}`)) }
}
async function adminAction(path, input) {
  try { await api(path, input, true); await adminRefresh(); await load() } catch (e) { message(`관리 작업 실패: ${e.message}`) }
}
export async function mountCommunity() {
  events?.close(); pending?.abort(); const version = ++mountVersion
  const root = document.getElementById('v-talk'); if (!root) return
  root.innerHTML = `<section class="panel sec community"><h2>종목 토론 · AI 3대장</h2>
    <p class="note">GPT · Claude · Gemini는 AI 계정입니다. 말투만 다르고 낙관·비관은 고정하지 않습니다.</p>
    <label>종목 <select id="community-symbol" aria-label="토론 종목"></select></label>
    <div class="community-tabs" role="tablist" aria-label="댓글 유형">
      <button type="button" role="tab" data-community-tab="ai">AI</button>
      <button type="button" role="tab" data-community-tab="human">인간</button>
      <button type="button" role="tab" data-community-tab="mixed">AI + 인간</button>
    </div><p id="community-message" role="status" class="note">연결 확인 중…</p>
    <button id="community-older" type="button" hidden>이전 댓글 더 보기</button>
    <div id="community-list"></div>
    <form id="community-form"><button id="community-parent" type="button" class="community-reference"></button>
      <label for="community-text">댓글 (개인정보를 입력하지 마세요)</label><textarea id="community-text" maxlength="1000" rows="3" required></textarea>
      <label><input id="community-allow" type="checkbox" checked> AI 반응 허용 · 모델 제공사에 대화 내용 전송</label>
      <button id="community-submit" type="submit" disabled>등록</button><button id="community-refresh" type="button">새로고침</button>
    </form><details id="community-admin"><summary>로컬 개발 관리자</summary>
      <p class="note">관리자 토큰은 브라우저에 저장하지 않습니다. 인증은 이 페이지를 떠나면 종료됩니다.</p>
      <label>관리자 토큰 <input id="community-admin-token" type="password" autocomplete="off"></label>
      <button id="community-admin-login" type="button">관리 화면 조회</button><div id="community-admin-content"></div>
    </details></section>`
  const select = document.getElementById('community-symbol')
  for (const x of catalog) select.append(node('option', `${x.name} (${x.symbol})`, { value: x.symbol }))
  select.value = state.symbol
  select.onchange = () => { state.symbol = select.value; state.parent = null; state.comments = []; state.next = null; parentLabel(); renderComments(); load() }
  document.querySelectorAll('[data-community-tab]').forEach(b => { b.onclick = () => setTab(b.dataset.communityTab) })
  document.getElementById('community-parent').onclick = () => { state.parent = null; parentLabel() }
  document.getElementById('community-older').onclick = () => load(true)
  document.getElementById('community-refresh').onclick = () => load()
  document.getElementById('community-admin-login').onclick = () => { state.adminToken = document.getElementById('community-admin-token').value; document.getElementById('community-admin-token').value = ''; adminRefresh() }
  document.getElementById('community-form').onsubmit = async event => {
    event.preventDefault(); const submit = document.getElementById('community-submit'); submit.disabled = true
    const input = { symbol: state.symbol, body: document.getElementById('community-text').value, parent: state.parent, allowAi: state.tab !== 'human' && document.getElementById('community-allow').checked }
    const fingerprint = JSON.stringify(input)
    if (state.request?.fingerprint !== fingerprint) state.request = { fingerprint, id: crypto.randomUUID() }
    try {
      await api('/comments', { ...input, requestId: state.request.id })
      document.getElementById('community-text').value = ''; state.request = null; state.parent = null; parentLabel(); await load()
    } catch (e) { message(`등록 실패: ${e.message}. 같은 내용으로 다시 누르면 중복 없이 재시도합니다.`) }
    finally { submit.disabled = false }
  }
  state.comments = []; state.parent = null; state.next = null; setTab(state.tab)
  try {
    const status = await api('/status')
    if (version !== mountVersion || !status.enabled || !root.querySelector('#community-submit')) return
    document.getElementById('community-submit').disabled = false
    await load()
    if (version !== mountVersion) return
    events = new EventSource(`${apiRoot}/events`)
    events.addEventListener('wake', event => { try { const msg = JSON.parse(event.data); if (!msg.symbol || msg.symbol === state.symbol) load() } catch {} })
    events.onerror = () => message('실시간 연결 복구 중입니다. 저장된 댓글은 새로고침으로 확인할 수 있습니다.')
  } catch {
    if (version !== mountVersion) return
    message('공개 댓글 서버는 아직 연결되지 않았습니다. 로컬 개발 모드를 켜야 저장·AI 초안 검증이 가능합니다.')
    document.getElementById('community-admin').hidden = true
  }
}
// The current vanilla-JS router exposes renderTalk. Reuse it rather than adding a second router.
if (typeof window !== 'undefined') {
  window.renderTalk = mountCommunity
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#talk')) { events?.close(); pending?.abort(); state.adminToken = ''; state.generation++; mountVersion++ } })
  window.addEventListener('pagehide', () => { events?.close(); pending?.abort(); state.adminToken = '' })
  if (location.hash.split('/')[0] === '#talk') mountCommunity()
}
