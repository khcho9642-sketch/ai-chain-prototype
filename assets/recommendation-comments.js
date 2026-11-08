import { realtimeEnabled } from './site-runtime.js'
const panels = new Map()
const nicknameKey = 'ai-chain.recommendation-comment.nickname'
let fieldSequence = 0
// The first read establishes a shared browser identity before another read can set it.
let readQueue = Promise.resolve()

const element = (tag, text, attributes = {}) => {
  const result = document.createElement(tag)
  if (text != null) result.textContent = String(text)
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, String(value))
  return result
}
const savedNickname = () => {
  try { return (localStorage.getItem(nicknameKey) || '').slice(0, 24) } catch { return '' }
}
const saveNickname = value => {
  try { localStorage.setItem(nicknameKey, value) } catch { /* Storage may be unavailable. */ }
}
const timeLabel = value => {
  if (!Number.isFinite(Date.parse(value))) return '작성 시각 미확인'
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
const errorMessage = (error, action) => {
  if (error.status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  if (error.status === 404) return '이 추천의 댓글을 찾을 수 없습니다. 새로고침 후 다시 확인해 주세요.'
  if (error.status === 403) return action === 'delete' ? '이 브라우저에서 작성한 댓글만 삭제할 수 있습니다.' : '작성 정보를 확인할 수 없습니다. 댓글을 새로 불러온 뒤 다시 시도해 주세요.'
  if (error.status === 400 || error.status === 422) return '닉네임 1~24자와 댓글 1~1,000자를 확인해 주세요.'
  if (error.status === 409) return '작성 내용이 변경되었습니다. 내용을 확인한 뒤 다시 시도해 주세요.'
  if (action === 'load') return '댓글을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.'
  if (action === 'delete') return '삭제를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  return '등록 여부를 확인하지 못했습니다. 같은 내용으로 다시 등록하면 중복 없이 확인합니다.'
}

export function recommendationComments(report) {
  const existing = panels.get(report.id)
  if (existing) return existing.details

  const details = element('details', null, { class: 'recommendation-comments', 'data-recommendation-comments': report.id })
  const summary = element('summary', '댓글')
  if (!realtimeEnabled) {
    details.append(summary, element('p', '댓글 기능을 일시 중지했습니다.', { class: 'recommendation-comments-status', role: 'status' }))
    panels.set(report.id, { details, disposed: false })
    return details
  }
  const content = element('div', null, { class: 'recommendation-comments-content' })
  const toolbar = element('div', null, { class: 'recommendation-comments-toolbar' })
  const refresh = element('button', '새로 불러오기', { type: 'button' })
  const list = element('ol', null, { class: 'recommendation-comments-list', 'aria-label': '이 추천의 댓글' })
  const listStatus = element('p', '', { class: 'recommendation-comments-status', role: 'status', 'aria-live': 'polite' })
  const more = element('button', '이전 댓글 더 보기', { type: 'button', class: 'recommendation-comments-more', hidden: '' })
  const form = element('form', null, { class: 'recommendation-comment-form', 'aria-label': `${report.symbol} 추천에 댓글 쓰기` })
  const prefix = `recommendation-comment-${++fieldSequence}`
  const name = element('input', null, { id: `${prefix}-name`, name: 'name', type: 'text', maxlength: '24', required: '', autocomplete: 'nickname', placeholder: '닉네임' })
  name.value = savedNickname()
  const body = element('textarea', null, { id: `${prefix}-body`, name: 'body', maxlength: '1000', required: '', rows: '3', placeholder: '이 추천에 대한 생각을 남겨 주세요.' })
  const formFooter = element('div', null, { class: 'recommendation-comment-form-footer' })
  const counter = element('span', '0 / 1,000', { class: 'recommendation-comment-counter' })
  const submit = element('button', '댓글 등록', { type: 'submit' })
  const formStatus = element('p', '', { class: 'recommendation-comments-status', role: 'status', 'aria-live': 'polite' })
  formFooter.append(counter, submit)
  form.append(element('label', '닉네임', { for: name.id }), name,
    element('label', '댓글', { for: body.id }), body, formFooter, formStatus)
  toolbar.append(element('span', '추천별 대화'), refresh)
  content.append(element('p', '닉네임과 댓글은 공개됩니다. 이 브라우저에서 쓴 댓글은 직접 삭제할 수 있어요.', { class: 'recommendation-comments-notice' }), toolbar, listStatus, list, more, form)
  details.append(summary, content)

  // This report's panel owns its in-memory draft and retry key across quote renders.
  const state = { details, comments: [], count: null, nextCursor: null, loaded: false, busy: false, request: null, controller: null, disposed: false }
  panels.set(report.id, state)

  const updateControls = () => {
    refresh.disabled = state.busy
    refresh.textContent = state.loaded ? '새로 불러오기' : '다시 불러오기'
    more.disabled = state.busy
    more.hidden = !state.nextCursor
    submit.disabled = state.busy || !state.loaded
    for (const button of list.querySelectorAll('button')) button.disabled = state.busy
    details.setAttribute('aria-busy', String(state.busy))
    summary.textContent = state.count === null ? '댓글' : `댓글 ${state.count.toLocaleString('ko-KR')}개`
  }
  const request = (method, payload) => {
    const perform = async () => {
      if (state.disposed) throw new DOMException('Panel disposed', 'AbortError')
      const controller = new AbortController()
      state.controller = controller
      const url = new URL('/api/recommendation-comments', location.origin)
      if (method === 'GET') {
        url.searchParams.set('reportId', report.id)
        if (payload?.before) url.searchParams.set('before', payload.before)
      }
      const response = await fetch(url, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: report.id, ...payload }) }),
      })
      let value
      try { value = await response.json() } catch { throw Object.assign(new Error('invalid_response'), { status: response.status }) }
      if (!response.ok) throw Object.assign(new Error(value.error || 'request_failed'), { status: response.status })
      return value
    }
    if (method !== 'GET') return perform()
    const pending = readQueue.then(perform)
    readQueue = pending.catch(() => {})
    return pending
  }
  const mergeComments = comments => {
    const all = new Map(state.comments.map(comment => [comment.id, comment]))
    for (const comment of comments) all.set(comment.id, comment)
    state.comments = [...all.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
  }
  const renderList = () => {
    const nodes = state.comments.map(comment => {
      const item = element('li', null, { class: 'recommendation-comment', 'data-recommendation-comment': comment.id })
      const meta = element('div', null, { class: 'recommendation-comment-meta' })
      meta.append(element('strong', comment.name), element('time', timeLabel(comment.createdAt), { datetime: comment.createdAt }))
      if (comment.isOwn) {
        const remove = element('button', '삭제', { type: 'button', 'aria-label': '내 댓글 삭제' })
        remove.addEventListener('click', () => deleteComment(comment.id))
        meta.append(element('span', '내 댓글', { class: 'recommendation-comment-own' }), remove)
      }
      item.append(meta, element('p', comment.body))
      return item
    })
    list.replaceChildren(...nodes)
  }
  const begin = () => { state.busy = true; updateControls() }
  const finish = () => { state.busy = false; state.controller = null; if (!state.disposed) updateControls() }
  const load = async (older = false) => {
    if (state.busy || state.disposed) return
    begin()
    listStatus.textContent = '댓글을 불러오고 있어요.'
    try {
      const value = await request('GET', older ? { before: state.nextCursor } : null)
      if (state.disposed) return
      if (!Array.isArray(value.comments) || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error('invalid_response')
      if (!older) state.comments = []
      mergeComments(value.comments)
      state.count = value.count
      state.nextCursor = typeof value.nextCursor === 'string' && value.nextCursor ? value.nextCursor : null
      state.loaded = true
      renderList()
      listStatus.textContent = state.count ? '' : '아직 댓글이 없어요. 첫 생각을 남겨 주세요.'
    } catch (error) {
      if (!state.disposed) listStatus.textContent = errorMessage(error, 'load')
    } finally { finish() }
  }
  async function deleteComment(commentId) {
    if (state.busy || state.disposed) return
    begin()
    listStatus.textContent = '댓글을 삭제하고 있어요.'
    try {
      const value = await request('DELETE', { commentId })
      if (state.disposed) return
      if (value.deleted !== true) throw new Error('invalid_response')
      state.comments = state.comments.filter(comment => comment.id !== commentId)
      state.count = Number.isSafeInteger(value.count) ? value.count : Math.max(0, state.count - 1)
      renderList()
      listStatus.textContent = '댓글을 삭제했습니다.'
    } catch (error) {
      if (!state.disposed) listStatus.textContent = errorMessage(error, 'delete')
    } finally { finish() }
  }
  name.addEventListener('input', () => { saveNickname(name.value); formStatus.textContent = '' })
  body.addEventListener('input', () => { counter.textContent = `${body.value.length.toLocaleString('ko-KR')} / 1,000`; formStatus.textContent = '' })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (state.busy || state.disposed || !state.loaded) return
    const submittedName = name.value.trim(), submittedBody = body.value.trim()
    if (!submittedName || submittedName.length > 24 || !submittedBody || submittedBody.length > 1000) {
      formStatus.textContent = '닉네임 1~24자와 댓글 1~1,000자를 입력해 주세요.'
      ;(!submittedName ? name : body).focus()
      return
    }
    const fingerprint = JSON.stringify([submittedName, submittedBody])
    if (state.request?.fingerprint !== fingerprint) state.request = { fingerprint, requestId: crypto.randomUUID() }
    const requestId = state.request.requestId
    saveNickname(submittedName)
    begin()
    submit.textContent = '등록 중…'
    formStatus.textContent = ''
    try {
      const value = await request('POST', { name: submittedName, body: submittedBody, requestId })
      if (state.disposed) return
      if (!value.comment?.id) throw new Error('invalid_response')
      const alreadyListed = state.comments.some(comment => comment.id === value.comment.id)
      mergeComments([value.comment])
      state.count = Number.isSafeInteger(value.count) ? value.count : state.count + (alreadyListed ? 0 : 1)
      renderList()
      listStatus.textContent = ''
      if (body.value.trim() === submittedBody) { body.value = ''; counter.textContent = '0 / 1,000' }
      if (state.request?.requestId === requestId) state.request = null
      formStatus.textContent = '댓글을 등록했습니다.'
    } catch (error) {
      if (!state.disposed) formStatus.textContent = errorMessage(error, 'post')
    } finally {
      submit.textContent = '댓글 등록'
      finish()
    }
  })
  refresh.addEventListener('click', () => load())
  more.addEventListener('click', () => load(true))
  details.addEventListener('toggle', () => { if (details.open && !state.loaded && !state.busy) load() })
  updateControls()
  return details
}

export function retainRecommendationComments(reportIds) {
  const retained = new Set(reportIds)
  for (const [id, state] of panels) {
    if (retained.has(id)) continue
    state.disposed = true
    state.controller?.abort()
    panels.delete(id)
  }
}
