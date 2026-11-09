import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createMemberAuthClient, MemberAuthError, memberAuthMessage, readMember, normalizeMemberNickname } from '../../assets/member-auth-core.js'

const account = { id: 'member-123', nickname: '사용자', needsNickname: false }
const pending = { id: 'member-123', nickname: null, needsNickname: true }
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('Google credential is sent only to the same-origin server as POST JSON with cookies', async () => {
  const calls = []
  const credential = 'header.payload.signature'
  const client = createMemberAuthClient({ fetcher: async (...args) => { calls.push(args); return reply({ user: account }) } })
  assert.deepEqual(await client.google(credential), account)
  assert.equal(calls.length, 1)
  const [url, options] = calls[0]
  assert.equal(url, '/api/auth/google')
  assert.equal(options.method, 'POST')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.redirect, 'error')
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(options.body), { credential })
  assert.ok(!url.includes(credential))
})

test('signed-in state comes from the server user, never from an unverified credential', async () => {
  const client = createMemberAuthClient({ fetcher: async () => reply({ token: 'not-a-server-member' }) })
  await assert.rejects(client.google('header.payload.signature'), { code: 'invalid_response' })
})

test('client excludes extra server fields from the display identity', () => {
  assert.deepEqual(readMember({ ...account, name: 'Google real name', email: 'private@example.com', token: 'sensitive', role: 'admin', picture: 'https://unexpected.example/' }), account)
  assert.deepEqual(readMember({ ...pending, name: 'Google real name', email: 'private@example.com' }), pending)
  assert.throws(() => readMember({ ...account, id: '' }), { code: 'invalid_response' })
  assert.throws(() => readMember({ ...account, nickname: { html: '<script>' } }), { code: 'invalid_response' })
  assert.throws(() => readMember({ ...account, needsNickname: true }), { code: 'invalid_response' })
  assert.throws(() => readMember({ ...pending, needsNickname: false }), { code: 'invalid_response' })
})

test('unconfigured auth does not expose or accept a placeholder client ID', async () => {
  const client = createMemberAuthClient({ fetcher: async () => reply({ enabled: false, clientId: 'placeholder' }) })
  assert.deepEqual(await client.config(), { enabled: false, clientId: '' })
  const bad = createMemberAuthClient({ fetcher: async () => reply({ enabled: true, clientId: 'not-google' }) })
  await assert.rejects(bad.config(), { code: 'invalid_response' })
  const valid = createMemberAuthClient({ fetcher: async () => reply({ enabled: true, clientId: '123-example.apps.googleusercontent.com' }) })
  assert.equal((await valid.config()).clientId, '123-example.apps.googleusercontent.com')
})

test('session restoration and logout use the cookie API, and logout must be acknowledged', async () => {
  const calls = []
  const client = createMemberAuthClient({ fetcher: async (url, options) => {
    calls.push({ url, options })
    return reply(url.endsWith('/me') ? { user: account } : { loggedOut: true })
  } })
  assert.deepEqual(await client.me(), account)
  await client.logout()
  assert.equal(calls[0].url, '/api/auth/me')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[1].url, '/api/auth/logout')
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(calls[1].options.body, '{}')
  const broken = createMemberAuthClient({ fetcher: async () => reply({ loggedOut: false }) })
  await assert.rejects(broken.logout(), { code: 'invalid_response' })
})

test('no session is represented explicitly by null and invalid payloads are rejected', async () => {
  assert.equal(await createMemberAuthClient({ fetcher: async () => reply({ user: null }) }).me(), null)
  await assert.rejects(createMemberAuthClient({ fetcher: async () => reply({}) }).me(), { code: 'invalid_response' })
  await assert.rejects(createMemberAuthClient({ fetcher: async () => reply([]) }).me(), { code: 'invalid_response' })
})

test('nonce must contain sufficient opaque challenge material', async () => {
  assert.equal(await createMemberAuthClient({ fetcher: async () => reply({ nonce: 'n'.repeat(64) }) }).nonce(), 'n'.repeat(64))
  await assert.rejects(createMemberAuthClient({ fetcher: async () => reply({ nonce: 'short' }) }).nonce(), { code: 'invalid_response' })
})

test('UI errors are actionable Korean messages and do not echo server data', async () => {
  const client = createMemberAuthClient({ fetcher: async () => reply({ error: 'SECRET INTERNAL DEBUG VALUE' }, 500) })
  let failure
  try { await client.me() } catch (error) { failure = error }
  assert.ok(failure instanceof MemberAuthError)
  assert.ok(!memberAuthMessage(failure).includes('SECRET'))
  assert.match(memberAuthMessage(new MemberAuthError('rate_limited', 429)), /잠시 후/)
  assert.match(memberAuthMessage(new MemberAuthError('invalid_credentials', 401)), /다시 시도/)
  const staticHost = createMemberAuthClient({ fetcher: async () => new Response('<html>404</html>', { status: 404 }) })
  try { await staticHost.config() } catch (error) { assert.match(memberAuthMessage(error), /연결을 준비 중/) }
})

test('request timeout aborts fetch and returns a stable message without leaking network detail', async () => {
  const client = createMemberAuthClient({ timeoutMs: 10, fetcher: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('private diagnostic')))
  }) })
  await assert.rejects(client.config(), { code: 'timeout' })
})


test('nickname normalization matches server Unicode rules without trimming spaces', () => {
  assert.equal(normalizeMemberNickname('한글'), '한글')
  assert.equal(normalizeMemberNickname('각'.repeat(20)), '각'.repeat(20))
  assert.throws(() => normalizeMemberNickname('각'.repeat(21)), { code: 'invalid_nickname' })
  assert.equal(normalizeMemberNickname('A\u0301_'), 'Á_')
  assert.equal(normalizeMemberNickname('사용자_12'), '사용자_12')
  assert.equal(normalizeMemberNickname('𐐀'.repeat(20)), '𐐀'.repeat(20))
  for (const value of ['', '가', 'a'.repeat(21), ' 앞공백', '뒤공백 ', '중간 공백', '점.', '별★', '\u0301a', '__\n', null]) {
    assert.throws(() => normalizeMemberNickname(value), { code: 'invalid_nickname' }, JSON.stringify(value))
  }
})

test('profile completion submits only the normalized nickname and accepts duplicate display names', async () => {
  const calls = []
  const client = createMemberAuthClient({ fetcher: async (url, options) => {
    calls.push({ url, options }); return reply({ user: { ...account, nickname: '한글' } })
  } })
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await client.profile('한글')).nickname, '한글')
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.url === '/api/auth/profile' && call.options.method === 'POST' && call.options.credentials === 'same-origin'))
  assert.deepEqual(calls.map(call => JSON.parse(call.options.body)), [{ nickname: '한글' }, { nickname: '한글' }])
  await assert.rejects(client.profile(' invalid '), { code: 'invalid_nickname' })
  assert.equal(calls.length, 2)
})

// A small DOM harness exercises the member interaction without a browser or
// provider network calls. It checks outcomes rather than source text patterns.
async function memberUi(client, { google } = {}) {
  const source = await readFile(new URL('../../assets/member-auth.js', import.meta.url), 'utf8')
  let activeElement = null
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.open = false; this.value = ''; this._text = '' }
    get textContent() { return this._text + this.children.map(child => child.textContent).join('') }
    set textContent(value) { this._text = String(value); this.children = [] }
    append(...items) { this.children.push(...items) }
    replaceChildren(...items) { this._text = ''; this.children = [...items] }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    removeAttribute(name) { this.attributes.delete(name) }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    addEventListener(name, listener) { const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list) }
    async emit(name, event = {}) { for (const listener of this.listeners.get(name) || []) await listener({ target: this, preventDefault() {}, ...event }) }
    focus() { activeElement = this }
    showModal() { this.open = true }
    close() { this.open = false; this.emit('close') }
    getBoundingClientRect() { return { width: 340 } }
  }
  const body = new Node('body'), head = new Node('head'), trigger = new Node('button')
  const document = { body, head, createElement: tag => new Node(tag), querySelectorAll: () => [trigger] }
  const context = vm.createContext({ document, window: { google }, createMemberAuthClient: () => client, memberAuthMessage, MemberAuthError, normalizeMemberNickname, setTimeout, clearTimeout })
  vm.runInContext(source.replace(/^import .+$/gmu, ''), context)
  await new Promise(resolve => setImmediate(resolve))
  const all = node => [node, ...node.children.flatMap(all)]
  return { body, trigger, find: predicate => all(body).find(predicate), all: () => all(body), focused: () => activeElement }
}

function fixtureClient(overrides = {}) {
  return { config: async () => ({ enabled: true, clientId: '123-test.apps.googleusercontent.com' }), me: async () => pending,
    profile: async nickname => ({ ...account, nickname }), withdraw: async () => {}, logout: async () => {}, nonce: async () => 'n'.repeat(64), google: async () => pending, ...overrides }
}

test('an incomplete signup opens one empty nickname field after reload and remains incomplete after Escape', async () => {
  const ui = await memberUi(fixtureClient())
  const dialog = ui.find(node => node.tag === 'dialog')
  const input = ui.find(node => node.tag === 'input')
  assert.equal(dialog.open, true)
  assert.equal(ui.trigger.textContent, '닉네임 설정')
  assert.equal(ui.all().filter(node => node.tag === 'input').length, 1)
  assert.equal(input.name, 'nickname')
  assert.equal(input.value, '')
  assert.equal(ui.focused(), input)
  dialog.close()
  assert.equal(dialog.open, false)
  assert.equal(ui.trigger.textContent, '닉네임 설정')
  await ui.trigger.emit('click')
  assert.equal(dialog.open, true)
  assert.equal(ui.find(node => node.tag === 'input').value, '')
})

test('nickname input survives a failed save; retry shows only the confirmed nickname', async () => {
  let attempts = 0
  const ui = await memberUi(fixtureClient({ profile: async nickname => {
    if (++attempts === 1) throw new MemberAuthError('network_error')
    return { ...account, nickname }
  } }))
  const form = ui.find(node => node.tag === 'form'), input = ui.find(node => node.tag === 'input')
  input.value = '선택한_닉네임'; await input.emit('input')
  await form.emit('submit')
  assert.equal(input.value, '선택한_닉네임')
  assert.equal(input.readOnly, false)
  assert.equal(ui.find(node => node.type === 'submit').disabled, false)
  assert.match(ui.body.textContent, /저장하지 못했습니다/)
  assert.equal(ui.trigger.textContent, '닉네임 설정')
  await form.emit('submit')
  assert.equal(attempts, 2)
  assert.equal(ui.trigger.textContent, '선택한_닉네임')
  assert.match(ui.body.textContent, /닉네임이 설정되었습니다/)
  assert.equal(ui.all().filter(node => node.tag === 'input').length, 0)
  assert.equal(ui.focused().tag, 'h2')
})

test('invalid or composing nickname input never submits; account view excludes Google name and email', async () => {
  let saves = 0
  const ui = await memberUi(fixtureClient({ profile: async () => { saves++; return account } }))
  const form = ui.find(node => node.tag === 'form'), input = ui.find(node => node.tag === 'input')
  input.value = '공백 포함'; await form.emit('submit')
  assert.equal(saves, 0); assert.equal(input.getAttribute('aria-invalid'), 'true')
  input.value = '사용자'; await input.emit('compositionstart'); await form.emit('submit')
  assert.equal(saves, 0)
  await input.emit('compositionend'); await form.emit('submit')
  assert.equal(saves, 1)
  const accountUi = await memberUi(fixtureClient({ me: async () => ({ ...account, name: 'PRIVATE REAL NAME', email: 'PRIVATE@example.com' }) }))
  assert.equal(accountUi.find(node => node.tag === 'dialog').open, false)
  await accountUi.trigger.emit('click')
  assert.match(accountUi.body.textContent, /사용자/)
  assert.doesNotMatch(accountUi.body.textContent, /PRIVATE/)
})

test('Google authentication starts nickname signup and logout clears the account label', async () => {
  let googleOptions, googleLoads = 0, logouts = 0
  const google = { accounts: { id: { initialize: options => { googleOptions = options; googleLoads++ }, renderButton() {}, disableAutoSelect() {}, cancel() {} } } }
  const ui = await memberUi(fixtureClient({ me: async () => null, logout: async () => { logouts++ } }), { google })
  assert.equal(ui.trigger.textContent, '로그인')
  await ui.trigger.emit('click')
  assert.equal(googleLoads, 1)
  await googleOptions.callback({ credential: 'header.payload.signature' })
  assert.equal(ui.trigger.textContent, '닉네임 설정')
  assert.equal(ui.find(node => node.tag === 'input').value, '')
  const logout = ui.all().find(node => node.tag === 'button' && node.textContent === '로그아웃')
  await logout.emit('click')
  assert.equal(logouts, 1)
  assert.equal(ui.trigger.textContent, '로그인')
})


test('nickname editing starts with the current value, updates the header, and restores the saved value after reload', async () => {
  let saved = account, saves = 0
  const client = fixtureClient({ me: async () => saved, profile: async nickname => {
    saves++; saved = { ...account, nickname }; return saved
  } })
  const ui = await memberUi(client)
  assert.equal(ui.find(node => node.tag === 'dialog').open, false)
  await ui.trigger.emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '닉네임 변경').emit('click')
  const input = ui.find(node => node.tag === 'input')
  assert.equal(input.value, '사용자')
  assert.equal(ui.find(node => node.tag === 'h2').textContent, '닉네임 변경')
  assert.equal(ui.find(node => node.type === 'submit').textContent, '완료')
  assert.equal(ui.focused(), input)
  input.value = '새로운_닉네임'; await input.emit('input')
  await ui.find(node => node.tag === 'form').emit('submit')
  assert.equal(saves, 1)
  assert.equal(ui.trigger.textContent, '새로운_닉네임')
  assert.match(ui.body.textContent, /닉네임이 변경되었습니다/)
  assert.equal(ui.find(node => node.tag === 'h2').textContent, '내 계정')
  assert.equal(ui.focused().tag, 'h2')
  const reloaded = await memberUi(client)
  assert.equal(reloaded.find(node => node.tag === 'dialog').open, false)
  assert.equal(reloaded.trigger.textContent, '새로운_닉네임')
  await reloaded.trigger.emit('click')
  await reloaded.find(node => node.tag === 'button' && node.textContent === '닉네임 변경').emit('click')
  assert.equal(reloaded.find(node => node.tag === 'input').value, '새로운_닉네임')
})

test('canceling a nickname change returns to the account without saving or retaining the abandoned draft', async () => {
  let saves = 0
  const ui = await memberUi(fixtureClient({ me: async () => account, profile: async () => { saves++; return account } }))
  await ui.trigger.emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '닉네임 변경').emit('click')
  const input = ui.find(node => node.tag === 'input')
  input.value = '취소할_입력'; await input.emit('input')
  await ui.find(node => node.tag === 'button' && node.textContent === '취소').emit('click')
  assert.equal(saves, 0)
  assert.equal(ui.trigger.textContent, '사용자')
  assert.equal(ui.find(node => node.tag === 'h2').textContent, '내 계정')
  assert.equal(ui.focused().tag, 'h2')
  assert.equal(ui.find(node => node.tag === 'input'), undefined)
  await ui.find(node => node.tag === 'button' && node.textContent === '닉네임 변경').emit('click')
  assert.equal(ui.find(node => node.tag === 'input').value, '사용자')
})

test('nickname editing preserves composition and failed input, then allows a successful retry', async () => {
  let attempts = 0
  const ui = await memberUi(fixtureClient({ me: async () => account, profile: async nickname => {
    if (++attempts === 1) throw new MemberAuthError('rate_limited', 429)
    return { ...account, nickname }
  } }))
  await ui.trigger.emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '닉네임 변경').emit('click')
  const form = ui.find(node => node.tag === 'form'), input = ui.find(node => node.tag === 'input')
  input.value = '변경할_닉네임'; await input.emit('compositionstart'); await form.emit('submit')
  assert.equal(attempts, 0)
  await input.emit('compositionend'); await form.emit('submit')
  assert.equal(attempts, 1)
  assert.equal(input.value, '변경할_닉네임')
  assert.equal(input.readOnly, false)
  assert.equal(ui.find(node => node.type === 'submit').disabled, false)
  assert.equal(ui.find(node => node.tag === 'button' && node.textContent === '취소').disabled, false)
  assert.match(ui.body.textContent, /잠시 후 다시 시도/)
  assert.equal(ui.trigger.textContent, '사용자')
  await form.emit('submit')
  assert.equal(attempts, 2)
  assert.equal(ui.trigger.textContent, '변경할_닉네임')
})

test('a failed nickname draft is never shown to a different member after reauthentication', async () => {
  let current = pending, googleOptions
  const nextMember = { id: 'another-member', nickname: null, needsNickname: true }
  const google = { accounts: { id: { initialize: options => { googleOptions = options }, renderButton() {}, cancel() {} } } }
  const ui = await memberUi(fixtureClient({ me: async () => current, profile: async () => {
    current = null; throw new MemberAuthError('login_required', 401)
  }, google: async () => nextMember }), { google })
  const input = ui.find(node => node.tag === 'input')
  input.value = '이전회원_초안'; await input.emit('input')
  await ui.find(node => node.tag === 'form').emit('submit')
  assert.equal(input.value, '이전회원_초안')
  await ui.find(node => node.tag === 'button' && node.textContent === '다시 로그인').emit('click')
  await googleOptions.callback({ credential: 'header.payload.signature' })
  assert.equal(ui.find(node => node.tag === 'input').value, '')
  assert.equal(ui.trigger.textContent, '닉네임 설정')
  assert.doesNotMatch(ui.body.textContent, /이전회원_초안/)
})


test('withdrawal sends only the fixed confirmation and requires a positive server acknowledgment', async () => {
  const calls = []
  const client = createMemberAuthClient({ fetcher: async (url, options) => {
    calls.push({ url, options }); return reply({ ok: true })
  } })
  await client.withdraw()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/auth/withdraw')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.deepEqual(JSON.parse(calls[0].options.body), { confirmation: '탈퇴' })
  const broken = createMemberAuthClient({ fetcher: async () => reply({ ok: false }) })
  await assert.rejects(broken.withdraw(), { code: 'invalid_response' })
})

test('opening withdrawal explains the effects and canceling sends no deletion request', async () => {
  let withdrawals = 0
  const ui = await memberUi(fixtureClient({ me: async () => ({ ...account, name: 'PRIVATE NAME', email: 'PRIVATE@example.com' }), withdraw: async () => { withdrawals++ } }))
  await ui.trigger.emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '회원탈퇴').emit('click')
  assert.equal(withdrawals, 0)
  assert.equal(ui.find(node => node.tag === 'h2').textContent, '회원탈퇴')
  assert.match(ui.body.textContent, /회원정보와 모든 기기의 로그인 세션이 삭제/)
  assert.match(ui.body.textContent, /복구할 수 없습니다/)
  assert.match(ui.body.textContent, /Google 계정은 삭제되지 않습니다/)
  assert.match(ui.body.textContent, /새로 가입/)
  assert.doesNotMatch(ui.body.textContent, /PRIVATE/)
  assert.equal(ui.focused().tag, 'h2')
  assert.equal(ui.find(node => node.tag === 'button' && node.textContent === '탈퇴하기').type, 'button')
  await ui.find(node => node.tag === 'button' && node.textContent === '취소').emit('click')
  assert.equal(withdrawals, 0)
  assert.equal(ui.find(node => node.tag === 'h2').textContent, '내 계정')
  assert.equal(ui.trigger.textContent, '사용자')
})

test('withdrawal requires final confirmation, prevents duplicate requests and closing while pending, then clears the member', async () => {
  let withdrawals = 0, resolveWithdrawal, disableAutoSelect = 0
  const google = { accounts: { id: { disableAutoSelect() { disableAutoSelect++ }, cancel() {} } } }
  const ui = await memberUi(fixtureClient({ me: async () => account, withdraw: async () => {
    withdrawals++; await new Promise(resolve => { resolveWithdrawal = resolve })
  } }), { google })
  await ui.trigger.emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '회원탈퇴').emit('click')
  const confirm = ui.find(node => node.tag === 'button' && node.textContent === '탈퇴하기')
  const cancel = ui.find(node => node.tag === 'button' && node.textContent === '취소')
  const close = ui.find(node => node.getAttribute('aria-label') === '계정 창 닫기')
  const dialog = ui.find(node => node.tag === 'dialog')
  const request = confirm.emit('click')
  assert.equal(withdrawals, 1)
  assert.equal(confirm.disabled, true)
  assert.equal(cancel.disabled, true)
  assert.equal(close.disabled, true)
  await confirm.emit('click'); await cancel.emit('click'); await close.emit('click')
  let prevented = false
  await dialog.emit('cancel', { preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(dialog.open, true)
  assert.equal(withdrawals, 1)
  resolveWithdrawal(); await request
  assert.equal(ui.trigger.textContent, '로그인')
  assert.equal(ui.trigger.dataset.signedIn, 'false')
  assert.match(ui.body.textContent, /회원탈퇴가 완료되었습니다/)
  assert.equal(ui.find(node => node.tag === 'h2').textContent, '탈퇴 완료')
  assert.equal(ui.focused().tag, 'h2')
  assert.equal(disableAutoSelect, 1)
  assert.equal(close.disabled, false)
})

test('failed withdrawal keeps confirmation available for an explicit retry', async () => {
  let attempts = 0
  const ui = await memberUi(fixtureClient({ me: async () => account, withdraw: async () => {
    if (++attempts === 1) throw new MemberAuthError('network_error')
  } }))
  await ui.trigger.emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '회원탈퇴').emit('click')
  const confirm = ui.find(node => node.tag === 'button' && node.textContent === '탈퇴하기')
  await confirm.emit('click')
  assert.equal(attempts, 1)
  assert.equal(confirm.disabled, false)
  assert.equal(ui.trigger.textContent, '사용자')
  assert.match(ui.body.textContent, /완료했는지 확인하지 못했습니다/)
  assert.equal(ui.find(node => node.tag === 'button' && node.textContent === '취소').disabled, false)
  await confirm.emit('click')
  assert.equal(attempts, 2)
  assert.equal(ui.trigger.textContent, '로그인')
})

test('withdrawal is available before nickname completion, and canceling preserves that member draft', async () => {
  let withdrawals = 0
  const ui = await memberUi(fixtureClient({ withdraw: async () => { withdrawals++ } }))
  const input = ui.find(node => node.tag === 'input')
  input.value = '작성중_닉네임'; await input.emit('input')
  await ui.find(node => node.tag === 'button' && node.textContent === '회원탈퇴').emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '취소').emit('click')
  assert.equal(withdrawals, 0)
  assert.equal(ui.find(node => node.tag === 'input').value, '작성중_닉네임')
  await ui.find(node => node.tag === 'button' && node.textContent === '회원탈퇴').emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '탈퇴하기').emit('click')
  assert.equal(withdrawals, 1)
  assert.equal(ui.trigger.textContent, '로그인')
  assert.equal(ui.find(node => node.tag === 'input'), undefined)
})

test('withdrawal with an expired or already deleted session clears stale identity and offers sign-in recovery', async () => {
  let googleOptions
  const google = { accounts: { id: { initialize: options => { googleOptions = options }, renderButton() {}, cancel() {} } } }
  let current = account
  const ui = await memberUi(fixtureClient({ me: async () => current, withdraw: async () => {
    current = null; throw new MemberAuthError('login_required', 401)
  } }), { google })
  await ui.trigger.emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '회원탈퇴').emit('click')
  await ui.find(node => node.tag === 'button' && node.textContent === '탈퇴하기').emit('click')
  assert.equal(ui.trigger.textContent, '로그인')
  assert.equal(ui.find(node => node.tag === 'button' && node.textContent === '탈퇴하기'), undefined)
  assert.match(ui.body.textContent, /로그인 세션이 만료되었거나 이미 탈퇴한 계정/)
  assert.match(ui.body.textContent, /다시 로그인하면 새로 가입될 수 있습니다/)
  await ui.find(node => node.tag === 'button' && node.textContent === '다시 로그인').emit('click')
  assert.ok(googleOptions)
})
