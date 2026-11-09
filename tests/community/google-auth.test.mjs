import test from 'node:test'
import assert from 'node:assert/strict'
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
  assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'name'])
  assert.equal(user.name, '테스트 회원')
  assert.equal(user.email, 'person@example.test')
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
  }
})

test('Cross-origin writes, missing origin and cross-site nonce requests are rejected', async t => {
  const f = fixture(t)
  for (const path of ['/api/auth/google', '/api/auth/logout']) {
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
