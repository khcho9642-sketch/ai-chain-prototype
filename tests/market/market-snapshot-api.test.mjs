import test from 'node:test'
import assert from 'node:assert/strict'
import snapshotHandler from '../../api/snapshot.js'

async function call(method, extra = {}) {
  const headers = {}, response = {
    statusCode: 200,
    setHeader(name, value) { headers[name.toLowerCase()] = value },
    end(body) { this.body = body },
  }
  await snapshotHandler({ method, url: '/api/snapshot', ...extra }, response)
  return { status: response.statusCode, headers, body: response.body }
}

test('GET redirects full market histories to the fixed public snapshot without buffering a response', async () => {
  const result = await call('GET')
  assert.equal(result.status, 307)
  assert.equal(result.body, undefined)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.headers['x-content-type-options'], 'nosniff')
  const location = new URL(result.headers.location)
  assert.equal(location.origin, 'https://khcho9642-sketch.github.io')
  assert.equal(location.pathname, '/ai-chain-prototype/data/market.json')
  assert.match(location.searchParams.get('t'), /^\d+$/)
  assert.deepEqual([...location.searchParams.keys()], ['t'])
})

test('HEAD uses the same temporary redirect with an empty body', async () => {
  const result = await call('HEAD')
  assert.equal(result.status, 307)
  assert.equal(result.body, undefined)
  assert.match(result.headers.location, /^https:\/\/khcho9642-sketch\.github\.io\/ai-chain-prototype\/data\/market\.json\?t=\d+$/)
})

test('request URLs and private headers cannot alter the redirect target or enter its query', async () => {
  const result = await call('GET', {
    url: '/api/snapshot?next=https://attacker.invalid/&t=secret',
    headers: { cookie: 'secret-cookie', authorization: 'Bearer secret-token', host: 'attacker.invalid' },
  })
  assert.equal(result.status, 307)
  assert.equal(new URL(result.headers.location).hostname, 'khcho9642-sketch.github.io')
  assert.doesNotMatch(JSON.stringify(result), /attacker|secret|Bearer|cookie|authorization/)
})

test('unsupported methods retain the endpoint method contract and never redirect', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const result = await call(method)
    assert.equal(result.status, 405)
    assert.equal(result.headers.allow, 'GET, HEAD')
    assert.equal(result.headers.location, undefined)
    assert.equal(JSON.parse(result.body).error, 'GET 또는 HEAD 요청만 지원합니다.')
    assert.equal(result.headers['cache-control'], 'no-store')
  }
})
