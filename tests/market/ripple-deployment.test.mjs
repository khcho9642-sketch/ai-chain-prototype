import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveBuildRippleSnapshot, publicSnapshotFiles } from '../../scripts/build.mjs'
import { buildRippleSnapshot, validateRippleSnapshot } from '../../assets/ripple-core.js'
import rippleHandler from '../../api/ripple.js'

const now = Date.parse('2026-11-06T08:00:00Z')
const market = generatedAt => ({ schemaVersion: 1, generatedAt, mode: 'scheduled-close', quotes: [] })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ripple-release-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'data'))
  return { root, file: join(root, 'data', 'ripple.json') }
}

async function call(method, extra = {}) {
  const headers = {}, response = {
    statusCode: 200,
    setHeader(name, value) { headers[name.toLowerCase()] = value },
    end(body) { this.body = body },
  }
  await rippleHandler({ method, url: '/api/ripple', ...extra }, response)
  return { status: response.statusCode, headers, body: response.body }
}

test('legacy undated empty markets build an explicit unavailable feed without modifying source files', async t => {
  const { root } = await fixture(t)
  const value = validateRippleSnapshot(await resolveBuildRippleSnapshot(root, { quotes: [] }, { now }))
  assert.equal(value.status, 'unavailable')
  assert.equal(value.sourceSnapshotGeneratedAt, null)
  assert.deepEqual(value.triggers, [])
  assert.deepEqual(await readdir(join(root, 'data')), [])
  assert.ok(publicSnapshotFiles.includes('ripple.json'))
})

test('a valid ripple is retained only when it belongs to the exact market collection', async t => {
  const { root, file } = await fixture(t)
  const current = market('2026-11-05T23:20:00Z')
  const saved = buildRippleSnapshot({ marketSnapshot: current, now: now - 3600000 })
  await writeFile(file, JSON.stringify(saved))
  assert.deepEqual(await resolveBuildRippleSnapshot(root, current, { now }), saved)
  const newerMarket = market('2026-11-06T08:00:00Z')
  const rebuilt = await resolveBuildRippleSnapshot(root, newerMarket, { now })
  assert.equal(rebuilt.sourceSnapshotGeneratedAt, newerMarket.generatedAt)
  assert.equal(rebuilt.generatedAt, new Date(now).toISOString())
  assert.notEqual(rebuilt.sourceSnapshotGeneratedAt, saved.sourceSnapshotGeneratedAt)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), saved)
})

test('malformed derived data is never copied into a public build', async t => {
  const { root, file } = await fixture(t)
  await writeFile(file, 'PRIVATE invalid JSON')
  const current = market('2026-11-06T08:00:00Z')
  const result = await resolveBuildRippleSnapshot(root, current, { now })
  assert.equal(result.sourceSnapshotGeneratedAt, current.generatedAt)
  assert.equal(result.status, 'unavailable')
  assert.deepEqual(result.ripples, [])
  assert.equal(await readFile(file, 'utf8'), 'PRIVATE invalid JSON')
})

test('ripple endpoint reads the fixed precomputed feed for GET and HEAD', async () => {
  for (const method of ['GET', 'HEAD']) {
    const result = await call(method)
    assert.equal(result.status, 307)
    assert.equal(result.body, undefined)
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.headers['x-content-type-options'], 'nosniff')
    const url = new URL(result.headers.location)
    assert.equal(url.origin, 'https://khcho9642-sketch.github.io')
    assert.equal(url.pathname, '/ai-chain-prototype/data/ripple.json')
    assert.match(url.searchParams.get('t'), /^\d+$/)
    assert.deepEqual([...url.searchParams.keys()], ['t'])
  }
})

test('request-controlled URLs or private headers never affect the ripple feed target', async () => {
  const result = await call('GET', {
    url: '/api/ripple?next=https://attacker.invalid/&t=secret',
    headers: { cookie: 'secret-cookie', authorization: 'Bearer secret-token' },
  })
  assert.equal(result.status, 307)
  assert.doesNotMatch(JSON.stringify(result), /attacker|secret|Bearer|cookie|authorization/)
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const rejected = await call(method)
    assert.equal(rejected.status, 405)
    assert.equal(rejected.headers.allow, 'GET, HEAD')
    assert.equal(rejected.headers.location, undefined)
    assert.equal(typeof JSON.parse(rejected.body).error, 'string')
  }
})

test('deployment derives its ripple from the downloaded market rather than racing a remote ripple file', async t => {
  const { prepareDeployment } = await import('../../scripts/deployment/prepare-deployment.mjs')
  const { instruments } = await import('../../assets/instruments.js')
  const { root, file } = await fixture(t)
  await writeFile(file, 'old derived source must not be reused')
  const current = { ...market('2026-11-06T08:00:00Z'), quotes: instruments.map(({ symbol }) => ({ symbol })) }
  const requested = [], restored = []
  let built = false
  const result = await prepareDeployment({
    root, now: () => now, logger: {},
    fetcher: async url => {
      requested.push(url)
      return new Response(JSON.stringify(new URL(url).pathname.endsWith('/market.json') ? current : { schemaVersion: 1, sources: [], series: [] }))
    },
    restoreSnapshots: async options => { restored.push(options); return [] },
    buildSite: async sourceRoot => {
      built = true
      assert.equal(sourceRoot, root)
      const derived = validateRippleSnapshot(JSON.parse(await readFile(file, 'utf8')))
      assert.equal(derived.sourceSnapshotGeneratedAt, current.generatedAt)
      assert.equal(derived.status, 'unavailable')
      assert.deepEqual(JSON.parse(await readFile(join(root, 'data', 'market.json'), 'utf8')), current)
      return join(root, 'dist')
    },
  })
  assert.equal(result, join(root, 'dist'))
  assert.equal(built, true)
  assert.equal(restored.length, 1)
  assert.equal(restored[0].root, root)
  assert.equal(restored[0].includeComparison, true)
  assert.deepEqual(requested.map(url => new URL(url).pathname), ['/ai-chain-prototype/data/market.json', '/ai-chain-prototype/data/industry.json'])
})

test('deployment rejects an incomplete market before modifying existing derived data or building', async t => {
  const { prepareDeployment } = await import('../../scripts/deployment/prepare-deployment.mjs')
  const { root, file } = await fixture(t)
  await writeFile(file, 'preserved prior source')
  let built = false
  await assert.rejects(prepareDeployment({
    root, now: () => now, logger: {},
    fetcher: async () => new Response(JSON.stringify(market('2026-11-06T08:00:00Z'))),
    buildSite: async () => { built = true },
    restoreSnapshots: async () => [],
  }), /통합 종목/)
  assert.equal(built, false)
  assert.equal(await readFile(file, 'utf8'), 'preserved prior source')
  assert.deepEqual(await readdir(join(root, 'data')), ['ripple.json'])
})
