import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { createLocalMemberHandler } from '../../server/member/node-http.mjs'

test('local auth adapter preserves cookies, validates Host, and fails invalid credentials', async t => {
  let handler
  const server = createServer((req, res) => handler(req, res))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = 'http://127.0.0.1:' + server.address().port
  handler = createLocalMemberHandler({ path: ':memory:', origin, clientId: 'local-test.apps.googleusercontent.com' })
  t.after(() => new Promise(resolve => server.close(() => { handler.close(); resolve() })))
  const config = await fetch(origin + '/api/auth/config')
  assert.deepEqual(await config.json(), { enabled: true, clientId: 'local-test.apps.googleusercontent.com' })
  const nonce = await fetch(origin + '/api/auth/nonce')
  assert.equal(nonce.status, 200)
  assert.match(nonce.headers.get('set-cookie'), /HttpOnly/)
  const cookie = nonce.headers.get('set-cookie').split(';')[0]
  const login = await fetch(origin + '/api/auth/google', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ credential: 'invalid' }) })
  assert.equal(login.status, 401)
  const logout = await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })
  assert.equal(logout.headers.getSetCookie().length, 2)
  assert.ok(logout.headers.getSetCookie().every(value => value.includes('Max-Age=0')))
  const invalidHost = await new Promise((resolve, reject) => {
    const req = request(origin + '/api/auth/config', { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject); req.end()
  })
  assert.equal(invalidHost, 403)
  const crossOrigin = await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(crossOrigin.status, 403)
})
