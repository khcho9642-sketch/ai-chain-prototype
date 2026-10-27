import test from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest, createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommunityStore } from '../../server/community/store.mjs'
import { CommunityAuth } from '../../server/community/auth.mjs'
import { createPublicCommunityHandler } from '../../server/community/public-http.mjs'
import { resolveCommunityOrigin, resolveDiscussionSymbol, mergeComments } from '../../assets/community-ui-core.js'
import { build } from '../../scripts/build.mjs'

const catalog = [{ symbol: '005930.KS', name: '삼성전자', chains: [2,3] }, { symbol: 'NVDA', name: '엔비디아', chains: [4] }]
const secret = 'correct horse battery staple', workerToken = 'w'.repeat(48)
const origin = 'https://api.example.test', browserOrigin = 'https://site.example.test'
function setup(t, options = {}) {
  let now = Date.parse('2026-10-26T01:00:00Z')
  const store = new CommunityStore({ catalog, now: () => now, ...options })
  const auth = new CommunityAuth(store)
  t.after(() => store.close())
  return { store, auth, advance(ms) { now += ms } }
}
function human(store, overrides = {}, actor = 'session') {
  return store.addHuman({ symbol: 'NVDA', body: '이건 어떤 분위기냐 ㅋㅋ', requestId: randomUUID(), ...overrides }, actor)
}
function finish(store, job, text = '이건 좀 더 지켜보자 ㅋㅋ') {
  return store.finish({ id: job.id, lease: job.lease, output: { action: 'reply', text }, model: 'fixture-only', cliVersion: 'fixture-v1' })
}
test('member passwords, sessions and invite tokens are not stored in plaintext', async t => {
  const { store, auth } = setup(t), invitation = auth.invite()
  const user = await auth.create({ name: '주주하나', password: secret, invite: invitation.token })
  const login = await auth.login({ name: '주주하나', password: secret })
  assert.equal(auth.user(login.token).id, user.id)
  const row = store.db.prepare('SELECT * FROM community_users').get()
  assert.notEqual(row.password_hash, secret)
  assert.notEqual(store.db.prepare('SELECT token_hash FROM community_member_sessions').get().token_hash, login.token)
  assert.notEqual(store.db.prepare('SELECT token_hash FROM community_invites').get().token_hash, invitation.token)
  assert.equal(row.role, 'member')
})
test('invites are single-use, expire, and are required by default', async t => {
  const { auth, advance } = setup(t), invitation = auth.invite()
  await auth.create({ name: 'invite_one', password: secret, invite: invitation.token })
  await assert.rejects(auth.create({ name: 'invite_two', password: secret, invite: invitation.token }), /valid_invite_required/)
  await assert.rejects(auth.create({ name: 'invite_three', password: secret }), /valid_invite_required/)
  const expired = auth.invite(); advance(86400001)
  await assert.rejects(auth.create({ name: 'invite_four', password: secret, invite: expired.token }), /valid_invite_required/)
})
test('concurrent registrations cannot consume one invitation twice', async t => {
  const { auth, store } = setup(t), { token } = auth.invite()
  const results = await Promise.allSettled([
    auth.create({ name: 'race_one', password: secret, invite: token }),
    auth.create({ name: 'race_two', password: secret, invite: token }),
  ])
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM community_users').get().n, 1)
})
test('reserved AI names, weak passwords, role escalation and wrong passwords fail', async t => {
  const { auth } = setup(t)
  await assert.rejects(auth.create({ name: 'GPT', password: secret }, { bootstrap: true }), /invalid_username/)
  await assert.rejects(auth.create({ name: 'human_one', password: 'abc' }, { bootstrap: true }), /password_requires/)
  await assert.rejects(auth.create({ name: 'human_one', password: secret }, { role: 'admin' }), /admin_creation_forbidden/)
  await auth.create({ name: 'human_one', password: secret }, { bootstrap: true })
  await assert.rejects(auth.login({ name: 'human_one', password: 'wrong' }), /invalid_credentials/)
  await assert.rejects(auth.login({ name: 'missing', password: secret }), /invalid_credentials/)
})
test('logout, expiry, disabled accounts and password reset revoke access', async t => {
  const { auth, store, advance } = setup(t)
  const user = await auth.create({ name: 'member_one', password: secret }, { bootstrap: true })
  let session = await auth.login({ name: 'member_one', password: secret })
  auth.logout(session.token); assert.throws(() => auth.user(session.token), /login_required/)
  session = await auth.login({ name: 'member_one', password: secret }); advance(12 * 3600000 + 1)
  assert.throws(() => auth.user(session.token), /login_required/)
  session = await auth.login({ name: 'member_one', password: secret })
  await auth.reset('member_one', 'new secure passphrase here')
  assert.throws(() => auth.user(session.token), /login_required/)
  session = await auth.login({ name: 'member_one', password: 'new secure passphrase here' })
  store.db.prepare('UPDATE community_users SET disabled=1 WHERE id=?').run(user.id)
  assert.throws(() => auth.user(session.token), /login_required/)
})
test('member identity and idempotency survive a new login session', async t => {
  const { auth, store } = setup(t)
  const user = await auth.create({ name: 'stable_user', password: secret }, { bootstrap: true })
  const requestId = randomUUID(), input = { requestId, body: '회원 댓글', allowAi: false }
  const first = human(store, input, `member:${user.id}`)
  await auth.login({ name: 'stable_user', password: secret })
  const retry = human(store, input, `member:${user.id}`)
  assert.equal(first.id, retry.id); assert.equal(first.name, 'stable_user')
})
test('rate limits are durable and reset at their defined window', t => {
  const { auth, store, advance } = setup(t)
  auth.limit('fixture-key', 2); auth.limit('fixture-key', 2)
  assert.throws(() => auth.limit('fixture-key', 2), /rate_limited/)
  const other = new CommunityAuth(store); assert.throws(() => other.limit('fixture-key', 2), /rate_limited/)
  advance(60001); other.limit('fixture-key', 2)
})
test('symbol pause cancels in-flight output and suppresses new jobs', t => {
  const { store } = setup(t); store.configure({ agent: 'gpt', enabled: true }); human(store)
  const job = store.claim(['gpt']).job
  store.configure({ symbol: 'NVDA', enabled: false })
  assert.throws(() => finish(store, job), /stale_lease/)
  human(store); assert.equal(store.claim(['gpt']).job, null)
  store.configure({ symbol: 'NVDA', enabled: true }); human(store)
  assert.ok(store.claim(['gpt']).job)
})
test('daily generation and posting limits are configurable and validated', t => {
  const { store } = setup(t)
  store.configure({ agent: 'gpt', enabled: true, dailyAttempts: 1, dailyPosts: 1 })
  human(store); let job = store.claim(['gpt']).job; finish(store, job); store.approve(job.id)
  human(store); assert.equal(store.claim(['gpt']).job, null)
  assert.equal(store.settings().limits.dailyAttempts, 1)
  assert.throws(() => store.configure({ dailyPosts: -1 }), /invalid_daily_limit/)
  assert.throws(() => store.configure({ mode: 'unknown' }), /invalid_mode/)
})
test('automatic mode publishes once and repeated finish is idempotent', t => {
  const { store } = setup(t); store.configure({ agent: 'gpt', enabled: true, mode: 'auto' }); human(store)
  const job = store.claim(['gpt']).job
  const result = finish(store, job); assert.equal(result.state, 'published')
  assert.equal(finish(store, job).state, 'published')
  assert.equal(store.comments('NVDA').counts.ai, 1)
})
test('reply to a human-only comment never re-enables AI for that branch', t => {
  const { store } = setup(t); store.configure({ agent: 'gpt', enabled: true })
  const parent = human(store, { allowAi: false })
  const child = human(store, { parent: parent.id, allowAi: true })
  assert.equal(child.allowAi, false); assert.equal(store.claim(['gpt']).job, null)
})
test('claim does not starve an available provider behind other queued providers', t => {
  const { store } = setup(t); store.configure({ agent: 'gpt', enabled: true })
  for (let i = 0; i < 101; i++) store.request('NVDA')
  store.configure({ agent: 'claude', enabled: true })
  store.db.prepare('UPDATE community_agents SET enabled=0 WHERE id=?').run('gpt')
  store.request('005930.KS')
  assert.equal(store.claim(['claude']).job.agent, 'claude')
})

async function httpFixture(t, options = {}) {
  const handler = createPublicCommunityHandler({ catalog, origin, browserOrigins: [browserOrigin], workerToken, trustLoopbackProxy: true, ...options })
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); handler.close() })
  async function call(path, input, token, headers = {}, method) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: `/api/community${path}`,
        method: method || (input === undefined ? 'GET' : 'POST'), headers: {
          Host: new URL(origin).host, 'X-Forwarded-Proto': 'https', Origin: browserOrigin,
          ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
        } }, response => {
          let raw = ''; response.on('data', x => { raw += x }); response.on('end', () => {
            let body; try { body = JSON.parse(raw) } catch { body = raw }
            resolve({ status: response.statusCode, headers: response.headers, body })
          })
        }); req.on('error', reject); req.end(input === undefined ? undefined : JSON.stringify(input))
    })
  }
  async function member(name = 'test_member', admin = false) {
    await handler.auth.create({ name, password: secret }, { bootstrap: true, role: admin ? 'admin' : 'member' })
    return (await handler.auth.login({ name, password: secret })).token
  }
  return { handler, server, call, member }
}
test('public API validates HTTPS, Host and exact CORS origins before data access', async t => {
  const { call } = await httpFixture(t)
  assert.equal((await call('/status')).status, 200)
  assert.equal((await call('/status', undefined, null, { Host: 'evil.test' })).status, 403)
  assert.equal((await call('/status', undefined, null, { 'X-Forwarded-Proto': 'http' })).status, 403)
  assert.equal((await call('/status', undefined, null, { Origin: 'https://evil.test' })).status, 403)
  const preflight = await call('/comments', undefined, null, {}, 'OPTIONS')
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], browserOrigin)
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined)
})
test('forwarded TLS headers are not accepted unless proxy trust is explicitly configured', async t => {
  const { call } = await httpFixture(t, { trustLoopbackProxy: false })
  assert.equal((await call('/status')).status, 403)
})
test('anonymous reading works; member/admin/worker scopes cannot impersonate each other', async t => {
  const { call, member } = await httpFixture(t)
  assert.equal((await call('/comments?symbol=NVDA')).status, 200)
  assert.equal((await call('/comments', { symbol: 'NVDA', body: 'hello', requestId: randomUUID() })).status, 401)
  const user = await member(), admin = await member('test_operator', true)
  assert.equal((await call('/admin', undefined, user)).status, 403)
  assert.equal((await call('/admin', undefined, workerToken)).status, 401)
  assert.equal((await call('/worker/claim', { agents: ['gpt'] }, user)).status, 401)
  assert.equal((await call('/worker/claim', { agents: ['gpt'] }, admin)).status, 401)
  assert.equal((await call('/admin', undefined, admin)).status, 200)
  assert.equal((await call('/worker/claim', { agents: ['gpt'] }, workerToken)).status, 200)
  const comment = await call('/comments', { symbol: 'NVDA', body: '회원의 실제 댓글', allowAi: false, requestId: randomUUID(), kind: 'ai', author: 'gpt' }, user)
  assert.equal(comment.status, 201); assert.equal(comment.body.kind, 'human'); assert.equal(comment.body.name, 'test_member')
})
test('HTTP registration requires invitation, ignores role input and login is functional', async t => {
  const { call, member } = await httpFixture(t), admin = await member('operator_one', true)
  const invitation = await call('/admin/invite', {}, admin)
  const registered = await call('/auth/register', { name: 'normal_user', password: secret, role: 'admin', invite: invitation.body.token })
  assert.equal(registered.status, 201); assert.equal(registered.body.user.role, 'member')
  const login = await call('/auth/login', { name: 'normal_user', password: secret })
  assert.equal(login.status, 200)
  assert.equal((await call('/auth/me', undefined, login.body.token)).body.user.name, 'normal_user')
  await call('/auth/logout', {}, login.body.token)
  assert.equal((await call('/auth/me', undefined, login.body.token)).status, 401)
})
test('automatic publishing requires server opt-in plus admin action', async t => {
  const { call, member } = await httpFixture(t)
  const token = await member('operator_two', true)
  assert.equal((await call('/admin/settings', { mode: 'auto' }, token)).status, 403)
  assert.equal((await call('/admin/settings', { symbol: 'NVDA', enabled: false }, token)).status, 200)
})
test('server disallowing auto mode resets persisted automatic mode at startup', async t => {
  const store = new CommunityStore({ catalog }); store.configure({ mode: 'auto' })
  const handler = createPublicCommunityHandler({ store, origin, workerToken })
  t.after(() => handler.close())
  assert.equal(store.settings().mode, 'review_only')
})
test('server opt-in permits explicitly authenticated auto-mode setup', async t => {
  const { call, member } = await httpFixture(t, { allowAutoPublish: true })
  const token = await member('operator_three', true)
  const result = await call('/admin/settings', { mode: 'auto' }, token)
  assert.equal(result.status, 200); assert.equal(result.body.mode, 'auto')
})
test('public API refuses oversized, non-JSON input and invalid cursors', async t => {
  const { call } = await httpFixture(t)
  assert.equal((await call('/comments?symbol=NVDA&before=NaN')).status, 400)
  assert.equal((await call('/auth/login', { password: 'x'.repeat(17000) })).status, 413)
  assert.equal((await call('/auth/login', {}, null, { 'Content-Type': 'text/plain' })).status, 415)
})
test('offline worker leaves durable jobs that another process can recover', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'shared-api-')), path = join(dir, 'community.sqlite')
  t.after(() => rm(dir, { recursive: true, force: true }))
  let store = new CommunityStore({ catalog, path })
  store.configure({ agent: 'gpt', enabled: true }); human(store); store.close()
  store = new CommunityStore({ catalog, path })
  try { assert.equal(store.comments('NVDA').comments.length, 1); assert.ok(store.claim(['gpt']).job) } finally { store.close() }
})
test('worker activity is recorded without credentials or raw addresses', async t => {
  const { call, handler } = await httpFixture(t)
  await call('/worker/claim', { agents: ['gpt'] }, workerToken, { 'X-Worker-Id': 'fixture-worker' })
  const workers = handler.store.admin().workers
  assert.equal(workers[0].id, 'fixture-worker')
  assert.equal(JSON.stringify(workers).includes(workerToken), false)
})
test('API origins permit HTTPS and loopback development only; paths and credentials are forbidden', () => {
  assert.equal(resolveCommunityOrigin('https://api.example.test', ''), 'https://api.example.test')
  assert.equal(resolveCommunityOrigin('http://127.0.0.1:5175', ''), 'http://127.0.0.1:5175')
  for (const value of ['http://remote.test', 'https://user:password@api.example.test', 'https://api.example.test/path', 'https://api.example.test?token=abc', 'https://api.example.test/#fragment']) assert.throws(() => resolveCommunityOrigin(value, ''))
})
test('discussion deep links resolve exact symbols and legacy chain links', () => {
  assert.equal(resolveDiscussionSymbol('#talk/NVDA', catalog, '005930.KS'), 'NVDA')
  assert.equal(resolveDiscussionSymbol('#talk/3', catalog), '005930.KS')
  assert.equal(resolveDiscussionSymbol('#talk/UNKNOWN', catalog), null)
  assert.equal(resolveDiscussionSymbol('#talk/%', catalog), null)
  assert.equal(resolveDiscussionSymbol('#talk', catalog, 'NVDA'), 'NVDA')
})
test('comment merge deduplicates updates and preserves chronological order', () => {
  const result = mergeComments([{ id: 'b', seq: 2, text: 'old' }], [{ id: 'a', seq: 1 }, { id: 'b', seq: 2, text: 'new' }])
  assert.deepEqual(result.map(x => x.id), ['a', 'b']); assert.equal(result[1].text, 'new')
})
test('public service configuration rejects insecure origins before creating a store', () => {
  assert.throws(() => createPublicCommunityHandler({ catalog, workerToken, origin: 'http://remote.test' }), /https_origin_required/)
  assert.throws(() => createPublicCommunityHandler({ catalog, workerToken, origin: 'https://api.example.test/path' }), /https_origin_required/)
})

test('static build emits only the public API origin and rejects URL credentials', async () => {
  const dir = await build(undefined, { communityOrigin: 'https://community.example.test/' })
  const runtime = await readFile(join(dir, 'assets', 'community-runtime.js'), 'utf8')
  assert.match(runtime, /https:\/\/community\.example\.test/)
  assert.equal(runtime.includes('TOKEN'), false)
  await assert.rejects(build(undefined, { communityOrigin: 'https://secret@community.example.test' }), /invalid_community_api_origin/)
  await build(undefined, { communityOrigin: '' })
})
test('online backup includes committed WAL and refuses to overwrite an existing backup', async t => {
  const { spawnSync } = await import('node:child_process')
  const dir = await mkdtemp(join(tmpdir(), 'community-backup-')), source = join(dir, 'source.sqlite'), dest = join(dir, 'backup.sqlite')
  const store = new CommunityStore({ catalog, path: source })
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }) })
  human(store, { allowAi: false })
  const child = spawnSync(process.execPath, ['scripts/community/community-backup.mjs', dest], { env: { ...process.env, COMMUNITY_DB: source }, encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  const restored = new CommunityStore({ catalog, path: dest })
  assert.equal(restored.comments('NVDA').comments.length, 1); restored.close()
  const before = createHash('sha256').update(await readFile(dest)).digest('hex')
  const again = spawnSync(process.execPath, ['scripts/community/community-backup.mjs', dest], { env: { ...process.env, COMMUNITY_DB: source }, encoding: 'utf8' })
  assert.notEqual(again.status, 0)
  assert.equal(createHash('sha256').update(await readFile(dest)).digest('hex'), before)
})
