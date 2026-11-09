import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose'
import { handleAuthRequest, hashToken } from '../../server/member/google-auth.mjs'
import { createMemberDatabase } from '../../server/member/sqlite.mjs'

const ORIGIN = 'https://members.example.test'
const CLIENT = '123456-test.apps.googleusercontent.com'
const NOW = Date.parse('2026-11-09T00:00:00Z')
const keys = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
const keyset = createLocalJWKSet({ keys: [jwk] })
const foreignKeys = await generateKeyPair('RS256')
function fixture(t, overrides = {}) {
  const db = createMemberDatabase()
  t.after(() => db.close())
  const env = { GOOGLE_CLIENT_ID: CLIENT, AUTH_ORIGIN: ORIGIN, MEMBER_DB: db, ...overrides }
  return { db, env, call(path, { method = 'GET', cookie = '', body, origin = ORIGIN, headers = {}, now = NOW, rawBody } = {}) {
    const init = { method, headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), 'CF-Connecting-IP': '192.0.2.1', ...headers } }
    if (method === 'POST') { init.headers['Content-Type'] ??= 'application/json'; init.body = rawBody ?? JSON.stringify(body ?? {}) }
    return handleAuthRequest(new Request(new URL(path, env.AUTH_ORIGIN || ORIGIN), init), env, { keyset, now })
  } }
}
function cookies(response) { return response.headers.getSetCookie() }
function cookieHeader(response) { return cookies(response).map(value => value.split(';')[0]).join('; ') }
function cookieValue(response, name) { return cookies(response).find(value => value.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1) }
async function signed(nonce, claims = {}, signer = keys.privateKey) {
  return new SignJWT({ nonce, email: 'person@example.test', email_verified: true, name: '테스트 회원', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(claims.iss ?? 'https://accounts.google.com').setAudience(claims.aud ?? CLIENT)
    .setSubject(claims.sub ?? 'google-subject-100').setIssuedAt(claims.iat ?? NOW / 1000)
    .setExpirationTime(claims.exp ?? NOW / 1000 + 3600).sign(signer)
}
async function login(f, { claims, cookie = '' } = {}) {
  const challenge = await f.call('/api/auth/nonce', { cookie })
  assert.equal(challenge.status, 200)
  const { nonce } = await challenge.json()
  const response = await f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(challenge) + (cookie ? `; ${cookie}` : ''), body: { credential: await signed(nonce, claims) } })
  return { response, nonce, challenge }
}

test('Google membership registers, restores, rotates and revokes a server session', async t => {
  const f = fixture(t)
  assert.deepEqual(await (await f.call('/api/auth/config')).json(), { enabled: true, clientId: CLIENT })
  assert.deepEqual(await (await f.call('/api/auth/me')).json(), { user: null })
  const { response, nonce } = await login(f)
  assert.equal(response.status, 200)
  const { user } = await response.json()
  assert.deepEqual(Object.keys(user).sort(), ['id', 'needsNickname', 'nickname'])
  assert.equal(user.nickname, null)
  assert.equal(user.needsNickname, true)
  const member = f.db.sqlite.prepare('SELECT name,email FROM member_users WHERE id=?').get(user.id)
  assert.equal(member.name, '회원')
  assert.equal(member.email, 'person@example.test')
  const session = cookieValue(response, '__Host-ai_chain_session')
  assert.match(session, /^[a-f0-9]{64}$/)
  assert.match(cookies(response)[0], /HttpOnly; SameSite=Lax; Max-Age=604800; Secure/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const stored = f.db.sqlite.prepare('SELECT token_hash FROM member_sessions').get()
  assert.equal(stored.token_hash, await hashToken(session))
  assert.notEqual(stored.token_hash, session)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_challenges').get().n, 0)
  assert.equal(JSON.stringify([...f.db.sqlite.prepare('SELECT * FROM member_users').all()]).includes(nonce), false)
  const authCookie = `__Host-ai_chain_session=${session}`
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie: authCookie })).json(), { user })
  const again = await login(f, { cookie: authCookie, claims: { name: '변경 이름', email: 'new@example.test' } })
  assert.equal(again.response.status, 200)
  assert.equal((await again.response.json()).user.id, user.id)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users').get().n, 1)
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie: authCookie })).json(), { user: null })
  const newCookie = cookieHeader(again.response)
  const logout = await f.call('/api/auth/logout', { method: 'POST', cookie: newCookie })
  assert.equal(logout.status, 200)
  assert.match(cookies(logout)[0], /Max-Age=0/)
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie: newCookie })).json(), { user: null })
})

test('Different Google subjects never merge by email', async t => {
  const f = fixture(t)
  const first = (await (await login(f)).response.json()).user
  const second = (await (await login(f, { claims: { sub: 'different-google-subject' } })).response.json()).user
  assert.notEqual(first.id, second.id)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users').get().n, 2)
})

test('Nonce is bound to the browser cookie, signed claim and expiry, and single use', async t => {
  const f = fixture(t)
  const challenge = await f.call('/api/auth/nonce')
  const { nonce } = await challenge.json(), credential = await signed(nonce)
  for (const cookie of ['', '__Host-ai_chain_nonce=' + 'a'.repeat(64)]) {
    assert.equal((await f.call('/api/auth/google', { method: 'POST', cookie, body: { credential } })).status, 401)
  }
  assert.equal((await f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(challenge), body: { credential: await signed('wrong') } })).status, 401)
  const concurrent = await Promise.all([1, 2].map(() => f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(challenge), body: { credential } })))
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 401])
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions').get().n, 1)
  const expired = await f.call('/api/auth/nonce')
  const { nonce: expiredNonce } = await expired.json()
  assert.equal((await f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(expired), body: { credential: await signed(expiredNonce) }, now: NOW + 600001 })).status, 401)
})

test('Only authentic Google tokens for this app and verified email pass', async t => {
  const f = fixture(t)
  const challenge = await f.call('/api/auth/nonce'), { nonce } = await challenge.json()
  const invalid = [
    await signed(nonce, { aud: 'foreign-app.apps.googleusercontent.com' }),
    await signed(nonce, { iss: 'https://attacker.example' }),
    await signed(nonce, { azp: 'foreign-app.apps.googleusercontent.com' }),
    await signed(nonce, { exp: NOW / 1000 - 60 }),
    await signed(nonce, { iat: NOW / 1000 + 3600 }),
    await signed(nonce, { email_verified: false }),
    await signed(nonce, { email_verified: 'true' }),
    await signed(nonce, {}, foreignKeys.privateKey),
    'not.a.jwt',
  ]
  for (const credential of invalid) assert.equal((await f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(challenge), body: { credential } })).status, 401)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users').get().n, 0)
})

test('Missing Google configuration fails closed without making a session', async t => {
  for (const override of [{ GOOGLE_CLIENT_ID: '' }, { GOOGLE_CLIENT_ID: 'not-a-client' }, { MEMBER_DB: undefined }, { AUTH_ORIGIN: 'http://public.example' }, { AUTH_ORIGIN: 'https://example.test/path' }]) {
    const f = fixture(t, override)
    assert.deepEqual(await (await f.call('/api/auth/config')).json(), { enabled: false, clientId: null })
    assert.equal((await f.call('/api/auth/nonce')).status, 503)
    assert.equal((await f.call('/api/auth/google', { method: 'POST' })).status, 503)
    assert.equal((await f.call('/api/auth/profile', { method: 'POST', body: { nickname: '회원' } })).status, 503)
    assert.equal((await f.call('/api/auth/withdraw', { method: 'POST', body: { confirmation: '탈퇴' } })).status, 503)
  }
})

test('Cross-origin writes, missing origin and cross-site nonce requests are rejected', async t => {
  const f = fixture(t)
  for (const path of ['/api/auth/google', '/api/auth/logout', '/api/auth/profile', '/api/auth/withdraw']) {
    assert.equal((await f.call(path, { method: 'POST', origin: 'https://attacker.example' })).status, 403)
    assert.equal((await f.call(path, { method: 'POST', origin: null })).status, 403)
  }
  assert.equal((await f.call('/api/auth/nonce', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await f.call('/api/auth/nonce', { origin: 'null' })).status, 403)
  assert.equal((await f.call('/api/auth/nonce', { origin: null, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200)
})

test('Only the exact auth allowlist and correct methods are handled', async t => {
  const f = fixture(t)
  assert.equal((await f.call('/api/community/auth/login', { method: 'POST' })).status, 404)
  assert.equal((await f.call('/api/auth/worker')).status, 404)
  assert.equal((await f.call('/api/auth/google')).status, 405)
  const result = await f.call('/api/auth/config', { method: 'POST' })
  assert.equal(result.status, 405); assert.equal(result.headers.get('allow'), 'GET')
})

test('Bodies are JSON only, bounded and object-shaped', async t => {
  const f = fixture(t)
  assert.equal((await f.call('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status, 415)
  assert.equal((await f.call('/api/auth/google', { method: 'POST', rawBody: 'x'.repeat(17000) })).status, 413)
  assert.equal((await f.call('/api/auth/google', { method: 'POST', rawBody: '{' })).status, 400)
  assert.equal((await f.call('/api/auth/google', { method: 'POST', body: [] })).status, 400)
})

test('Login and nonce rate limits persist in the database and expire', async t => {
  const f = fixture(t)
  for (let i = 0; i < 20; i++) assert.equal((await f.call('/api/auth/nonce')).status, 200)
  assert.equal((await f.call('/api/auth/nonce')).status, 429)
  assert.equal((await f.call('/api/auth/nonce', { now: NOW + 600001 })).status, 200)
  for (let i = 0; i < 20; i++) assert.equal((await f.call('/api/auth/google', { method: 'POST' })).status, 401)
  assert.equal((await f.call('/api/auth/google', { method: 'POST' })).status, 429)
  const rate = f.db.sqlite.prepare('SELECT key FROM member_rate_limits').all()
  assert.ok(rate.every(row => !row.key.includes('192.0.2.1')))
})

test('Expired and disabled member sessions are not accepted', async t => {
  const f = fixture(t)
  const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie, now: NOW + 604800001 })).json(), { user: null })
  f.db.sqlite.prepare('UPDATE member_users SET disabled=1 WHERE id=?').run(user.id)
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie })).json(), { user: null })
  assert.equal((await login(f)).response.status, 403)
})

test('Local HTTP needs both explicit opt-in and a loopback origin', async t => {
  const disabled = fixture(t, { AUTH_ORIGIN: 'http://localhost:5175' })
  assert.equal((await (await disabled.call('/api/auth/config')).json()).enabled, false)
  const remote = fixture(t, { AUTH_ORIGIN: 'http://example.test', AUTH_ALLOW_LOCAL_HTTP: '1' })
  assert.equal((await (await remote.call('/api/auth/config')).json()).enabled, false)
  const f = fixture(t, { AUTH_ORIGIN: 'http://127.0.0.1:5175', AUTH_ALLOW_LOCAL_HTTP: '1' })
  const response = await f.call('/api/auth/nonce', { origin: 'http://127.0.0.1:5175' })
  assert.equal(response.status, 200)
  assert.ok(cookies(response)[0].startsWith('ai_chain_dev_nonce='))
  assert.equal(cookies(response)[0].includes('; Secure'), false)
})

test('Database failures expose no SQL or credentials', async t => {
  const f = fixture(t)
  f.env.MEMBER_DB = { prepare() { throw new Error('private database credential detail') } }
  const response = await f.call('/api/auth/nonce')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'auth_unavailable' })
})

test('Session count is bounded while the newest login stays usable', async t => {
  const f = fixture(t)
  let newest
  for (let i = 0; i < 7; i++) {
    const { response } = await login(f)
    assert.equal(response.status, 200)
    newest = cookieHeader(response)
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions').get().n, 5)
  assert.ok((await (await f.call('/api/auth/me', { cookie: newest })).json()).user)
})

test('New challenge invalidates the previous browser challenge; logout revokes it', async t => {
  const f = fixture(t)
  const first = await f.call('/api/auth/nonce'), { nonce: oldNonce } = await first.json()
  const next = await f.call('/api/auth/nonce', { cookie: cookieHeader(first) })
  const { nonce } = await next.json()
  assert.equal((await f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(first), body: { credential: await signed(oldNonce) } })).status, 401)
  const stored = f.db.sqlite.prepare('SELECT token_hash FROM member_challenges').get()
  assert.equal(stored.token_hash, await hashToken(nonce))
  assert.notEqual(stored.token_hash, nonce)
  assert.equal((await f.call('/api/auth/logout', { method: 'POST', cookie: cookieHeader(next) })).status, 200)
  assert.equal((await f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(next), body: { credential: await signed(nonce) } })).status, 401)
})

test('An authenticated member can change a normalized nickname and keep it across Google logins', async t => {
  const f = fixture(t)
  const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
  let nickname = '가이드_É2'
  const saved = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: '가이드_E\u03012' } })
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), { user: { id: user.id, nickname, needsNickname: false } })
  assert.match(saved.headers.get('content-type'), /^application\/json/)
  assert.equal(saved.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(saved.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie })).json(), { user: { id: user.id, nickname, needsNickname: false } })
  const same = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: '가이드_E\u03012' } })
  assert.equal(same.status, 200)
  const changed = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: '다른닉네임' } })
  assert.equal(changed.status, 200)
  nickname = '다른닉네임'
  assert.deepEqual(await changed.json(), { user: { id: user.id, nickname, needsNickname: false } })
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie })).json(), { user: { id: user.id, nickname, needsNickname: false } })
  const again = await login(f, { cookie: '__Host-ai_chain_session=' + cookieValue(response, '__Host-ai_chain_session'), claims: { name: '<script>실명</script>', email: 'updated@example.test' } })
  assert.equal(again.response.status, 200)
  assert.deepEqual(await again.response.json(), { user: { id: user.id, nickname, needsNickname: false } })
  const member = f.db.sqlite.prepare('SELECT name,email,nickname FROM member_users WHERE id=?').get(user.id)
  assert.deepEqual({ ...member }, { name: '회원', email: 'updated@example.test', nickname })
})

test('Nickname validation rejects spaces, markup, leading marks and invalid lengths without changing the account', async t => {
  const f = fixture(t)
  const { response } = await login(f), cookie = cookieHeader(response)
  const invalid = [undefined, null, 123, [], {}, '', '가', 'a'.repeat(21), ' 회원', '회원 ', '회 원', '회\t원', '회\n원', '😀회원', '<b>회원</b>', '회원"', "회원'", '\u0301\u0301', '\u0301회원', '회\u200b원']
  for (const nickname of invalid) {
    const result = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname } })
    assert.equal(result.status, 400, `nickname ${JSON.stringify(nickname)}`)
    assert.deepEqual(await result.json(), { error: 'invalid_nickname' })
  }
  assert.equal(f.db.sqlite.prepare('SELECT nickname FROM member_users').get().nickname, null)
  const nickname = '𐐀'.repeat(20) // Unicode letters: length is code points, not UTF-16 code units.
  const valid = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname } })
  assert.equal(valid.status, 200)
  assert.equal((await valid.json()).user.nickname, nickname)
})

test('Nickname setup requires an active session and respects account suspension', async t => {
  const f = fixture(t)
  const body = { nickname: '회원_2' }
  const unauthenticated = await f.call('/api/auth/profile', { method: 'POST', body })
  assert.equal(unauthenticated.status, 401)
  assert.deepEqual(await unauthenticated.json(), { error: 'login_required' })
  const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
  assert.equal((await f.call('/api/auth/profile', { method: 'POST', cookie, body, now: NOW + 604800001 })).status, 401)
  f.db.sqlite.prepare('UPDATE member_users SET disabled=1 WHERE id=?').run(user.id)
  const disabled = await f.call('/api/auth/profile', { method: 'POST', cookie, body })
  assert.equal(disabled.status, 401)
  assert.deepEqual(await disabled.json(), { error: 'login_required' })
  assert.equal(f.db.sqlite.prepare('SELECT nickname FROM member_users').get().nickname, null)
})

test('Concurrent valid nickname changes leave one complete value and same-value retries succeed', async t => {
  const f = fixture(t)
  const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
  const nicknames = ['첫닉네임', '다른닉네임']
  const raced = await Promise.all(nicknames.map(nickname => f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname } })))
  assert.deepEqual(raced.map(result => result.status), [200, 200])
  const saved = await Promise.all(raced.map(result => result.json()))
  assert.deepEqual(saved.map(result => result.user), nicknames.map(nickname => ({ id: user.id, nickname, needsNickname: false })))
  const nickname = f.db.sqlite.prepare('SELECT nickname FROM member_users').get().nickname
  assert.ok(nicknames.includes(nickname))
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie })).json(), { user: { id: user.id, nickname, needsNickname: false } })
  const repeated = await Promise.all([1, 2].map(() => f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname } })))
  assert.deepEqual(repeated.map(result => result.status), [200, 200])
  assert.equal(f.db.sqlite.prepare('SELECT nickname FROM member_users').get().nickname, nickname)
})
test('Duplicate nicknames are permitted and body IDs cannot select another member', async t => {
  const f = fixture(t)
  const first = await login(f), second = await login(f, { claims: { sub: 'other-member' } })
  const firstUser = (await first.response.json()).user, secondUser = (await second.response.json()).user
  const nickname = '_2'
  const saved = await f.call('/api/auth/profile', { method: 'POST', cookie: cookieHeader(first.response), body: { nickname, id: secondUser.id } })
  assert.equal((await saved.json()).user.id, firstUser.id)
  assert.equal(f.db.sqlite.prepare('SELECT nickname FROM member_users WHERE id=?').get(secondUser.id).nickname, null)
  const duplicate = await f.call('/api/auth/profile', { method: 'POST', cookie: cookieHeader(second.response), body: { nickname } })
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).user.id, secondUser.id)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users WHERE nickname=?').get(nickname).n, 2)
  const changed = await f.call('/api/auth/profile', { method: 'POST', cookie: cookieHeader(first.response), body: { nickname: '변경회원', id: secondUser.id } })
  assert.equal(changed.status, 200)
  assert.deepEqual(await changed.json(), { user: { id: firstUser.id, nickname: '변경회원', needsNickname: false } })
  assert.equal(f.db.sqlite.prepare('SELECT nickname FROM member_users WHERE id=?').get(secondUser.id).nickname, nickname)
})

test('Existing members choose a nickname while stored legacy names remain internal and unchanged', async t => {
  const f = fixture(t)
  f.db.sqlite.prepare('INSERT INTO member_users(id,google_sub,name,email,created,last_login) VALUES(?,?,?,?,?,?)')
    .run('legacy-user', 'google-subject-100', '기존 실명', 'old@example.test', NOW - 10000, NOW - 10000)
  const { response } = await login(f, { claims: { name: '변경된 실명' } }), cookie = cookieHeader(response)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { user: { id: 'legacy-user', nickname: null, needsNickname: true } })
  const saved = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: '기존회원' } })
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), { user: { id: 'legacy-user', nickname: '기존회원', needsNickname: false } })
  assert.equal(f.db.sqlite.prepare('SELECT name FROM member_users WHERE id=?').get('legacy-user').name, '기존 실명')
})

test('Local migration upgrades an existing member database without replacing rows or sessions and reopens safely', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'ai-chain-member-migration-')), path = join(folder, 'members.sqlite')
  let database
  t.after(() => { database?.close(); unlinkSync(path); rmdirSync(folder) })
  const legacy = new DatabaseSync(path)
  legacy.exec(readFileSync(new URL('../../deploy/auth/0001-members.sql', import.meta.url), 'utf8'))
  legacy.prepare('INSERT INTO member_users(id,google_sub,name,email,created,last_login) VALUES(?,?,?,?,?,?)')
    .run('legacy-user', 'legacy-sub', '기존 실명', 'legacy@example.test', NOW - 2000, NOW - 1000)
  legacy.prepare('INSERT INTO member_sessions(token_hash,user_id,created,expires) VALUES(?,?,?,?)')
    .run('a'.repeat(64), 'legacy-user', NOW - 1000, NOW + 600000)
  legacy.close()
  database = createMemberDatabase(path)
  assert.deepEqual({ ...database.sqlite.prepare('SELECT * FROM member_users').get() }, {
    id: 'legacy-user', google_sub: 'legacy-sub', name: '기존 실명', email: 'legacy@example.test', disabled: 0,
    created: NOW - 2000, last_login: NOW - 1000, nickname: null,
  })
  assert.equal(database.sqlite.prepare('SELECT token_hash FROM member_sessions').get().token_hash, 'a'.repeat(64))
  database.sqlite.prepare('UPDATE member_users SET nickname=? WHERE id=?').run('기존회원', 'legacy-user')
  database.close(); database = undefined
  database = createMemberDatabase(path)
  assert.equal(database.sqlite.prepare('SELECT nickname FROM member_users').get().nickname, '기존회원')
  assert.deepEqual(database.sqlite.prepare('SELECT name FROM member_local_migrations ORDER BY name').all().map(row => row.name), ['0001-members.sql', '0002-member-nicknames.sql'])
})
test('Profile changes are limited to 20 per address in ten minutes and resume after expiry', async t => {
  const f = fixture(t)
  const { response } = await login(f), cookie = cookieHeader(response)
  for (let i = 0; i < 20; i++) {
    const result = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: `회원_${i}` } })
    assert.equal(result.status, 200)
    assert.equal((await result.json()).user.nickname, `회원_${i}`)
  }
  const limited = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: '회원_19' } })
  assert.equal(limited.status, 429)
  assert.deepEqual(await limited.json(), { error: 'rate_limited' })
  assert.equal(f.db.sqlite.prepare('SELECT nickname FROM member_users').get().nickname, '회원_19')
  const rate = f.db.sqlite.prepare("SELECT key,count FROM member_rate_limits WHERE key LIKE 'profile:%'").get()
  assert.equal(rate.count, 21)
  assert.equal(rate.key.includes('192.0.2.1'), false)
  const resumed = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: '새닉네임' }, now: NOW + 600001 })
  assert.equal(resumed.status, 200)
  assert.equal((await resumed.json()).user.nickname, '새닉네임')
  assert.equal(f.db.sqlite.prepare("SELECT count FROM member_rate_limits WHERE key LIKE 'profile:%'").get().count, 1)
})

test('A session revoked or account disabled between authentication and nickname write cannot mutate a member', async t => {
  for (const revoke of ['session', 'member']) {
    const f = fixture(t)
    const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
    const original = f.db.prepare
    f.env.MEMBER_DB = { ...f.db, prepare(sql) {
      if (sql.startsWith('UPDATE member_users SET nickname=')) {
        if (revoke === 'session') f.db.sqlite.prepare('DELETE FROM member_sessions WHERE user_id=?').run(user.id)
        else f.db.sqlite.prepare('UPDATE member_users SET disabled=1 WHERE id=?').run(user.id)
      }
      return original(sql)
    } }
    const result = await f.call('/api/auth/profile', { method: 'POST', cookie, body: { nickname: '변경회원' } })
    assert.equal(result.status, 401)
    assert.deepEqual(await result.json(), { error: 'login_required' })
    assert.equal(f.db.sqlite.prepare('SELECT nickname FROM member_users').get().nickname, null)
  }
})
test('Withdrawal deletes only the authenticated member, all their sessions and the current challenge; rejoining starts fresh', async t => {
  const f = fixture(t)
  const first = await login(f), second = await login(f), other = await login(f, { claims: { sub: 'unrelated-google-subject' } })
  const { user } = await first.response.json(), otherUser = (await other.response.json()).user
  const session = '__Host-ai_chain_session=' + cookieValue(first.response, '__Host-ai_chain_session')
  assert.equal((await f.call('/api/auth/profile', { method: 'POST', cookie: session, body: { nickname: '떠나는회원' } })).status, 200)
  const challenge = await f.call('/api/auth/nonce'), { nonce } = await challenge.json()
  const otherChallenge = await f.call('/api/auth/nonce'), { nonce: otherNonce } = await otherChallenge.json()
  const cookie = session + '; ' + cookieHeader(challenge)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions WHERE user_id=?').get(user.id).n, 2)
  const removed = await f.call('/api/auth/withdraw', { method: 'POST', cookie, body: { confirmation: '탈퇴', id: otherUser.id } })
  assert.equal(removed.status, 200)
  assert.deepEqual(await removed.json(), { ok: true })
  assert.equal(removed.headers.get('cache-control'), 'no-store')
  assert.equal(cookies(removed).length, 2)
  for (const name of ['__Host-ai_chain_session', '__Host-ai_chain_nonce']) {
    assert.equal(cookieValue(removed, name), '')
    assert.match(cookies(removed).find(value => value.startsWith(name + '=')), /Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/)
  }
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users WHERE id=?').get(user.id).n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions WHERE user_id=?').get(user.id).n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_challenges WHERE token_hash=?').get(await hashToken(nonce)).n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_challenges WHERE token_hash=?').get(await hashToken(otherNonce)).n, 1)
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie: cookieHeader(first.response) })).json(), { user: null })
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie: cookieHeader(second.response) })).json(), { user: null })
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie: cookieHeader(other.response) })).json(), { user: otherUser })
  assert.equal((await f.call('/api/auth/google', { method: 'POST', cookie: cookieHeader(challenge), body: { credential: await signed(nonce) } })).status, 401)
  const joined = await login(f)
  assert.equal(joined.response.status, 200)
  const newUser = (await joined.response.json()).user
  assert.notEqual(newUser.id, user.id)
  assert.equal(newUser.nickname, null)
  assert.equal(newUser.needsNickname, true)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users').get().n, 2)
})

test('Withdrawal requires the exact explicit confirmation and never accepts a GET or a foreign origin', async t => {
  const f = fixture(t)
  const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
  for (const confirmation of [undefined, null, true, '', '탈퇴 ', ' 탈퇴', '탈 퇴', 'withdraw']) {
    const result = await f.call('/api/auth/withdraw', { method: 'POST', cookie, body: { confirmation } })
    assert.equal(result.status, 400)
    assert.deepEqual(await result.json(), { error: 'invalid_confirmation' })
    assert.equal(cookies(result).length, 0)
  }
  const get = await f.call('/api/auth/withdraw', { cookie })
  assert.equal(get.status, 405)
  assert.equal(get.headers.get('allow'), 'POST')
  for (const origin of [null, 'https://attacker.example']) {
    assert.equal((await f.call('/api/auth/withdraw', { method: 'POST', cookie, origin, body: { confirmation: '탈퇴' } })).status, 403)
  }
  const foreignHost = await handleAuthRequest(new Request('https://other.example/api/auth/withdraw', {
    method: 'POST', headers: { Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: '탈퇴' }),
  }), f.env, { keyset, now: NOW })
  assert.equal(foreignHost.status, 403)
  assert.equal((await f.call('/api/auth/withdraw', { method: 'POST', cookie, headers: { 'Content-Type': 'text/plain' }, body: { confirmation: '탈퇴' } })).status, 415)
  assert.equal((await f.call('/api/auth/withdraw', { method: 'POST', cookie, rawBody: 'x'.repeat(17000) })).status, 413)
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie })).json(), { user })
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions').get().n, 1)
})

test('Missing, expired and disabled member sessions cannot withdraw an account', async t => {
  const f = fixture(t)
  const body = { confirmation: '탈퇴' }
  const unauthenticated = await f.call('/api/auth/withdraw', { method: 'POST', body })
  assert.equal(unauthenticated.status, 401)
  assert.deepEqual(await unauthenticated.json(), { error: 'login_required' })
  const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
  assert.equal((await f.call('/api/auth/withdraw', { method: 'POST', cookie, body, now: NOW + 604800001 })).status, 401)
  f.db.sqlite.prepare('UPDATE member_users SET disabled=1 WHERE id=?').run(user.id)
  const disabled = await f.call('/api/auth/withdraw', { method: 'POST', cookie, body })
  assert.equal(disabled.status, 401)
  assert.deepEqual(await disabled.json(), { error: 'login_required' })
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users').get().n, 1)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions').get().n, 1)
})

test('Concurrent withdrawal succeeds once and rejects the remaining revoked session', async t => {
  const f = fixture(t)
  const first = await login(f), second = await login(f)
  const responses = await Promise.all([first.response, second.response].map(response =>
    f.call('/api/auth/withdraw', { method: 'POST', cookie: cookieHeader(response), body: { confirmation: '탈퇴' } })))
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401])
  assert.deepEqual(await responses.find(response => response.status === 200).json(), { ok: true })
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users').get().n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions').get().n, 0)
})

test('Withdrawal rechecks session revocation and suspension at deletion time', async t => {
  for (const revoke of ['session', 'member']) {
    const f = fixture(t)
    const { response } = await login(f), cookie = cookieHeader(response), { user } = await response.json()
    const original = f.db.prepare
    f.env.MEMBER_DB = { ...f.db, prepare(sql) {
      if (sql.startsWith('DELETE FROM member_users')) {
        if (revoke === 'session') f.db.sqlite.prepare('DELETE FROM member_sessions WHERE user_id=?').run(user.id)
        else f.db.sqlite.prepare('UPDATE member_users SET disabled=1 WHERE id=?').run(user.id)
      }
      return original(sql)
    } }
    const result = await f.call('/api/auth/withdraw', { method: 'POST', cookie, body: { confirmation: '탈퇴' } })
    assert.equal(result.status, 401)
    assert.deepEqual(await result.json(), { error: 'login_required' })
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users WHERE id=?').get(user.id).n, 1)
  }
})

test('Challenge deletion failure rolls back member and session removal without clearing cookies', async t => {
  const f = fixture(t)
  const { response } = await login(f), { user } = await response.json()
  const session = '__Host-ai_chain_session=' + cookieValue(response, '__Host-ai_chain_session')
  const challenge = await f.call('/api/auth/nonce'), { nonce } = await challenge.json()
  f.db.sqlite.exec("CREATE TRIGGER fail_challenge_delete BEFORE DELETE ON member_challenges BEGIN SELECT RAISE(ABORT, 'fixture cleanup failure'); END")
  const result = await f.call('/api/auth/withdraw', { method: 'POST', cookie: session + '; ' + cookieHeader(challenge), body: { confirmation: '탈퇴' } })
  assert.equal(result.status, 503)
  assert.deepEqual(await result.json(), { error: 'auth_unavailable' })
  assert.equal(cookies(result).length, 0)
  assert.deepEqual(await (await f.call('/api/auth/me', { cookie: session })).json(), { user })
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_users').get().n, 1)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_sessions').get().n, 1)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM member_challenges WHERE token_hash=?').get(await hashToken(nonce)).n, 1)
})