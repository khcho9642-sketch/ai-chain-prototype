import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSiteServer } from '../../scripts/serve.mjs'
import { build } from '../../scripts/build.mjs'

test('paused hosting serves published snapshots and rejects every API without invoking live services', async t => {
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
