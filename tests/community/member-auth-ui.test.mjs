import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemberAuthClient, MemberAuthError, memberAuthMessage, readMember } from '../../assets/member-auth-core.js'

const account = { id: 'member-123', name: '사용자', email: 'person@example.com' }
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
  assert.deepEqual(readMember({ ...account, token: 'sensitive', role: 'admin', picture: 'https://unexpected.example/' }), account)
  assert.deepEqual(readMember({ ...account, name: '  ' }), { ...account, name: '회원' })
  assert.throws(() => readMember({ ...account, id: '' }), { code: 'invalid_response' })
  assert.throws(() => readMember({ ...account, name: { html: '<script>' } }), { code: 'invalid_response' })
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
