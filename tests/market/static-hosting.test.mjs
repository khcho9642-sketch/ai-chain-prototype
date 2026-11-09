import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSiteServer } from '../../scripts/serve.mjs'
import { build } from '../../scripts/build.mjs'

test('paused hosting serves published snapshots and rejects paused APIs without invoking live services', async t => {
  const root = await build()
  let calls = 0
  const unexpected = () => { calls++; throw new Error('live service must remain paused') }
  const server = createSiteServer({ root, liveApi: false, chartService: unexpected, community: unexpected, recommendationComments: unexpected })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  const market = await fetch(base + '/data/market.json')
  assert.equal(market.status, 200)
  assert.ok((await market.json()).quotes.length > 0)
  const page = await fetch(base + '/')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /AI/)
  for (const path of ['/api', '/api/chart?symbol=NVDA&range=1d', '/api/snapshot', '/api/community/events', '/api/community/auth/login', '/api/recommendation-comments']) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(base + path, { method })
      assert.equal(response.status, 503, method + ' ' + path)
      assert.deepEqual(await response.json(), { error: 'live_services_paused' })
    }
  }
  assert.equal(calls, 0)
  const hidden = await fetch(base + '/server/market.mjs')
  assert.equal(hidden.status, 404)
})

test('Cloudflare bundle carries security headers and a real missing-page response', async () => {
  const root = await build()
  const headers = await readFile(join(root, '_headers'), 'utf8')
  assert.match(headers, /X-Content-Type-Options: nosniff/)
  assert.match(headers, /Cache-Control:/)
  assert.match(await readFile(join(root, '404.html'), 'utf8'), /페이지를 찾을 수 없습니다/)
  assert.equal((await readFile(join(root, 'assets', 'community-runtime.js'), 'utf8')).trim(), 'export const communityApiOrigin = ""')
})


test('authentication routes are isolated from paused services and disabled when unconfigured', async t => {
  let authCalls = 0, liveCalls = 0
  const live = () => { liveCalls++; throw new Error('must remain paused') }
  const memberAuth = (_req, res) => { authCalls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ user: { id: 'fixture' } })) }
  const server = createSiteServer({ liveApi: false, memberAuth, community: live, chartService: live, debateVotes: live })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  assert.equal((await fetch(base + '/api/auth/me')).status, 200)
  for (const path of ['/api/community/auth/login', '/api/community/events', '/api/debate-votes', '/api/authentication', '/api/snapshot']) {
    assert.equal((await fetch(base + path)).status, 503, path)
  }
  assert.equal(authCalls, 1); assert.equal(liveCalls, 0)
  const disabled = createSiteServer({ liveApi: false })
  disabled.listen(0, '127.0.0.1'); await once(disabled, 'listening')
  t.after(() => new Promise(resolve => disabled.close(resolve)))
  const disabledBase = 'http://127.0.0.1:' + disabled.address().port
  assert.deepEqual(await (await fetch(disabledBase + '/api/auth/config')).json(), { enabled: false, clientId: null })
  assert.equal((await fetch(disabledBase + '/api/auth/google', { method: 'POST' })).status, 503)
})

test('Cloudflare only invokes Functions for auth and keeps account files out of public assets', async () => {
  const root = await build()
  assert.deepEqual(JSON.parse(await readFile(join(root, '_routes.json'), 'utf8')), { version: 1, include: ['/api/auth/*'], exclude: [] })
  const page = await readFile(join(root, 'index.html'), 'utf8')
  assert.match(page, /data-member-auth-open/)
  await assert.rejects(readFile(join(root, 'server', 'member', 'sqlite.mjs')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(root, 'deploy', 'auth', '0001-members.sql')), { code: 'ENOENT' })
})
