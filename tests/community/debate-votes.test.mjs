import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { createDebateVotesHandler, debateVoteStorageConflict, DEBATE_VOTE_COOKIE_NAME } from '../../server/debate-votes.mjs'
import { createBlobDebateVoteStore, debateVotePath } from '../../server/debate-vote-store.mjs'

const secret = 'only-this-test-cookie-signing-secret'
const id = 'debate-2026-11-05-NVDA'
const otherId = 'debate-2026-11-04-NVDA'
const debate = { id, date: '2026-11-05', topic: { ticker: 'NVDA' }, stances: ['gpt', 'claude', 'gemini'].map(ai => ({ ai })) }
const history = { ...debate, id: otherId, date: '2026-11-04' }
const hmac = (purpose, value) => createHmac('sha256', secret).update(purpose + ':' + value).digest('hex')
const cookie = n => { const token = String(n).padStart(64, '0'); return DEBATE_VOTE_COOKIE_NAME + '=' + token + '.' + hmac('debate-cookie', token) }

class FakeCAS {
  rows = new Map()
  writes = 0
  conflicts = 0
  unavailable = false
  alwaysConflict = false
  loseNextResponse = false
  async read(key) {
    if (this.unavailable) throw new Error('private-blob-token-must-never-leak')
    return this.rows.has(key) ? structuredClone(this.rows.get(key)) : null
  }
  async write(key, value, { etag }) {
    this.writes++; await setImmediate()
    if (this.unavailable) throw new Error('private-blob-token-must-never-leak')
    const current = this.rows.get(key)
    if (this.alwaysConflict || (current?.etag || null) !== etag) { this.conflicts++; throw debateVoteStorageConflict() }
    this.rows.set(key, { value: structuredClone(value), etag: randomUUID() })
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new Error('lost response after commit') }
    return { etag: this.rows.get(key).etag }
  }
}
function fixture(options = {}) {
  const store = options.store || new FakeCAS()
  let instant = Date.parse('2026-11-06T00:00:00Z')
  const handler = createDebateVotesHandler({ store, debatesSource: () => ({ debates: [debate, history] }), identitySecret: secret,
    production: true, trustProxy: true, now: () => instant, ...options })
  async function call(method = 'GET', input, { voter = cookie(1), query, headers = {}, body, stream, ip = '198.51.100.1' } = {}) {
    const req = stream ? Readable.from(stream) : Readable.from([])
    Object.assign(req, { method, url: '/api/debate-votes' + (method === 'GET' ? query ?? '?debateId=' + id : query || ''),
      headers: { host: 'example.com', 'x-vercel-forwarded-for': ip,
        ...(method !== 'GET' ? { origin: 'https://example.com', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } : {}),
        ...(voter ? { cookie: voter } : {}), ...headers }, socket: { remoteAddress: '127.0.0.1' },
      ...(stream ? {} : { body: body === undefined ? input : body }) })
    const responseHeaders = {}
    const res = { statusCode: 200, setHeader(key, value) { responseHeaders[key.toLowerCase()] = value }, end(value) { this.body = value } }
    await handler(req, res)
    return { status: res.statusCode, data: JSON.parse(res.body), headers: responseHeaders }
  }
  return { store, handler, call, advance(ms) { instant += ms } }
}
const vote = (choice = 'gpt', debateId = id) => ({ debateId, choice })
const hidden = { debateId: id, hasVoted: false, choice: null, count: null, tally: null, percentages: null, counting: false }

test('initial GET issues a signed HttpOnly identity and hides every aggregate before voting', async () => {
  const { call, store } = fixture()
  const initial = await call('GET', null, { voter: '' })
  assert.equal(initial.status, 200)
  assert.deepEqual(initial.data, hidden)
  assert.match(initial.headers['set-cookie'], new RegExp('^' + DEBATE_VOTE_COOKIE_NAME + '=[a-f0-9]{64}\\.[a-f0-9]{64};'))
  assert.match(initial.headers['set-cookie'], /Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure$/u)
  assert.match(initial.headers['cache-control'], /private, no-store/u)
  assert.equal(initial.headers['cdn-cache-control'], 'no-store')
  assert.equal(initial.headers['vercel-cdn-cache-control'], 'no-store')
  assert.equal(initial.headers.vary, 'Cookie')
  assert.equal(initial.headers['access-control-allow-origin'], undefined)
  assert.equal(store.writes, 0)
  const issued = initial.headers['set-cookie'].split(';')[0]
  assert.equal((await call('POST', vote(), { voter: issued })).status, 200)
})

test('a browser has one durable choice per exact published topic, including after a new handler', async () => {
  const { call, store } = fixture()
  const saved = await call('POST', vote('claude'))
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.data, { debateId: id, hasVoted: true, choice: 'claude', count: 1, tally: null, percentages: null, counting: true })
  assert.equal((await call('POST', vote('claude'))).status, 200)
  assert.equal(store.writes, 1)
  const changed = await call('POST', vote('gemini'))
  assert.equal(changed.status, 409)
  assert.equal(changed.data.error, 'already_voted')
  assert.equal(changed.data.choice, 'claude')
  assert.deepEqual((await fixture({ store }).call()).data, saved.data)
  const previous = await call('POST', vote('gemini', otherId))
  assert.equal(previous.status, 200)
  assert.equal(previous.data.count, 1)
  assert.equal(store.rows.size, 2)
  assert.deepEqual((await call('GET', null, { voter: cookie(2) })).data, hidden)
  const privateState = JSON.stringify(store.rows.get(id).value)
  assert.doesNotMatch(privateState, /198\.51\.100\.1|0000000000000000000000000000000000000000000000000000000000000001/u)
  assert.doesNotMatch(JSON.stringify(saved.data), /ownerHash|ipHash|etag|votes|token|signature/u)
})

test('fewer than ten votes reveal only the count to voters; ten votes reveal bars only after a vote', async () => {
  const { call } = fixture()
  for (let n = 1; n <= 9; n++) {
    const result = await call('POST', vote(n <= 6 ? 'gpt' : 'claude'), { voter: cookie(n), ip: '198.51.100.' + n })
    assert.equal(result.status, 200)
    assert.equal(result.data.count, n)
    assert.equal(result.data.counting, true)
    assert.equal(result.data.tally, null)
    assert.equal(result.data.percentages, null)
  }
  const tenth = await call('POST', vote('gemini'), { voter: cookie(10), ip: '198.51.100.10' })
  assert.deepEqual(tenth.data.tally, { gpt: 6, claude: 3, gemini: 1 })
  assert.deepEqual(tenth.data.percentages, { gpt: 60, claude: 30, gemini: 10 })
  assert.equal(tenth.data.counting, false)
  assert.deepEqual((await call('GET', null, { voter: cookie(99) })).data, hidden)
  assert.deepEqual((await call()).data.tally, tenth.data.tally)
})

test('CAS preserves simultaneous votes and simultaneous duplicate submissions without lost writes', async () => {
  const { call, store } = fixture()
  const results = await Promise.all([1, 2, 3, 4].map(n => call('POST', vote(n % 2 ? 'gpt' : 'claude'), { voter: cookie(n), ip: '198.51.100.' + n })))
  assert.ok(results.every(row => row.status === 200))
  assert.equal(store.rows.get(id).value.votes.length, 4)
  assert.ok(store.conflicts > 0)
  const duplicates = await Promise.all([call('POST', vote('gemini'), { voter: cookie(5) }), call('POST', vote('gemini'), { voter: cookie(5) })])
  assert.ok(duplicates.every(row => row.status === 200))
  assert.equal(store.rows.get(id).value.votes.length, 5)
  assert.equal((await call('GET', null, { voter: cookie(5) })).data.choice, 'gemini')
})

test('a response lost after a commit is safely retryable without a second vote', async () => {
  const { call, store } = fixture()
  store.loseNextResponse = true
  assert.equal((await call('POST', vote())).status, 503)
  assert.equal((await call('POST', vote())).status, 200)
  assert.equal(store.rows.get(id).value.votes.length, 1)
  assert.equal(store.writes, 1)
})

test('only published immutable topics and participating AI are eligible', async () => {
  const { call, store } = fixture()
  assert.equal((await call('POST', vote('gpt', 'invented-topic'))).status, 404)
  assert.equal((await call('POST', vote('gpt', '../private'))).status, 400)
  assert.equal((await call('POST', { ...vote(), date: '2026-11-04' })).status, 400)
  assert.equal((await call('POST', { ...vote(), ticker: 'AMD' })).status, 400)
  assert.equal((await call('POST', vote('other-ai'))).status, 400)
  const partial = fixture({ debatesSource: () => [ { ...debate, stances: [{ ai: 'gpt' }, { ai: 'claude' }] } ] })
  assert.equal((await partial.call('POST', vote('gemini'))).data.error, 'invalid_choice')
  assert.equal((await partial.call('POST', vote('gpt'))).status, 200)
  const empty = fixture({ debatesSource: () => [{ ...debate, stances: [] }] })
  assert.equal((await empty.call()).data.error, 'voting_not_available')
  assert.equal(store.writes, 0)
})

test('changed date or symbol under an existing id cannot reuse a different topic tally', async () => {
  const { call, store } = fixture()
  await call('POST', vote())
  for (const changed of [{ ...debate, date: '2026-11-06' }, { ...debate, topic: { ticker: 'AMD' } }]) {
    const changedSource = fixture({ store, debatesSource: () => [changed] })
    assert.equal((await changedSource.call()).data.error, 'votes_unavailable')
  }
  const retired = fixture({ store, debatesSource: () => [] })
  assert.equal((await retired.call()).status, 404)
})

test('publication lookup receives only the validated topic ID so archive loading stays bounded', async () => {
  const lookups = []
  const { call } = fixture({ debatesSource: requested => { lookups.push(requested); return { debates: requested === id ? [debate] : [] } } })
  assert.equal((await call()).status, 200)
  assert.equal((await call('GET', null, { query: '?debateId=unpublished' })).status, 404)
  assert.equal((await call('GET', null, { query: '?debateId=../private' })).status, 400)
  assert.deepEqual(lookups, [id, 'unpublished'])
})

test('forged or missing identity cannot vote, and cross-site writes are rejected', async () => {
  const { call, store } = fixture()
  for (const voter of ['', DEBATE_VOTE_COOKIE_NAME + '=' + 'a'.repeat(64), cookie(1).replace(/.$/u, 'z'), cookie(1) + '; ' + cookie(2)]) {
    assert.equal((await call('POST', vote(), { voter })).data.error, 'voter_initialization_required')
  }
  for (const headers of [{ origin: undefined }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { host: 'example.com@evil.example' }]) {
    assert.equal((await call('POST', vote(), { headers })).status, 403)
  }
  const fresh = await call('GET', null, { voter: DEBATE_VOTE_COOKIE_NAME + '=tampered' })
  assert.match(fresh.headers['set-cookie'], /HttpOnly/u)
  assert.equal(store.writes, 0)
})

test('request shape and bounded JSON reject mutation through unknown fields, queries or oversized bodies', async () => {
  const { call, store } = fixture()
  assert.equal((await call('DELETE', vote())).status, 405)
  assert.equal((await call('DELETE', vote())).headers.allow, 'GET, POST')
  for (const query of ['?debateId=' + id + '&debateId=' + id, '?debateId=' + id + '&results=true', '?date=2026-11-05', '']) {
    assert.equal((await call('GET', null, { query })).status, 400)
  }
  assert.equal((await call('POST', vote(), { query: '?debateId=' + id })).status, 400)
  for (const body of [[], null, {}, { ...vote(), extra: true }, { debateId: id }, '{invalid']) assert.equal((await call('POST', null, { body })).status, 400)
  assert.equal((await call('POST', vote(), { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await call('POST', vote(), { headers: { 'content-length': '2049' } })).status, 413)
  assert.equal((await call('POST', vote(), { body: ' '.repeat(2049) })).status, 413)
  assert.equal((await call('POST', null, { stream: [' '.repeat(1024), ' '.repeat(1025)] })).status, 413)
  assert.equal(store.writes, 0)
})

test('durable per-IP bounds survive cold starts and limit freshly cleared browser identities', async () => {
  const { call, store, advance } = fixture()
  for (let n = 1; n <= 5; n++) assert.equal((await call('POST', vote(), { voter: cookie(n) })).status, 200)
  const sixth = await fixture({ store }).call('POST', vote(), { voter: cookie(6) })
  assert.equal(sixth.status, 429)
  assert.equal(sixth.headers['retry-after'], '60')
  assert.equal((await call('POST', vote(), { voter: cookie(1) })).status, 200)
  advance(61000)
  assert.equal((await call('POST', vote(), { voter: cookie(6) })).status, 200)
})

test('private storage and identity failures fail closed without secrets, invented totals or fallback votes', async () => {
  const { call, store } = fixture()
  store.unavailable = true
  const failed = await call('POST', vote())
  assert.deepEqual(failed.data, { error: 'votes_unavailable' })
  assert.equal(failed.status, 503)
  assert.equal(store.rows.size, 0)
  const noSecret = fixture({ identitySecret: undefined, secretSource: () => '' })
  assert.equal((await noSecret.call()).status, 503)
  const busy = fixture(); busy.store.alwaysConflict = true
  assert.equal((await busy.call('POST', vote())).data.error, 'votes_busy')
  assert.equal(busy.store.writes, 8)
  assert.equal(busy.store.rows.size, 0)
})

test('corrupted private state is never used to expose or inflate vote totals', async () => {
  for (const mutate of [state => state.votes.push({ ...state.votes[0] }), state => state.votes[0].choice = 'invented-ai',
    state => state.votes[0].ownerHash = 'plaintext', state => state.extra = 'private']) {
    const { call, store } = fixture()
    await call('POST', vote())
    mutate(store.rows.get(id).value)
    const failed = await call()
    assert.equal(failed.status, 503)
    assert.deepEqual(failed.data, { error: 'votes_unavailable' })
  }
})

test('private Blob store uses uncached reads and ETag-conditional writes under a hashed namespace', async () => {
  const requests = [], state = { votes: [] }
  const stream = value => new Response(JSON.stringify(value)).body
  class Precondition extends Error {}
  const sdk = {
    BlobPreconditionFailedError: Precondition,
    async get(path, options) { requests.push({ kind: 'get', path, options }); return { statusCode: 200, blob: { etag: 'first', size: 12 }, stream: stream(state) } },
    async put(path, encoded, options) { requests.push({ kind: 'put', path, encoded, options }); return { etag: 'second' } },
  }
  const store = createBlobDebateVoteStore({ sdk })
  assert.deepEqual(await store.read(id), { value: state, etag: 'first' })
  await store.write(id, state, { etag: null })
  await store.write(id, state, { etag: 'first' })
  assert.match(requests[0].path, /^debate-votes\/v1\/[a-f0-9]{64}\.json$/u)
  assert.equal(requests[0].options.access, 'private')
  assert.equal(requests[0].options.useCache, false)
  assert.equal(requests[1].options.access, 'private')
  assert.equal(requests[1].options.allowOverwrite, false)
  assert.equal(requests[1].options.addRandomSuffix, false)
  assert.equal(requests[2].options.allowOverwrite, true)
  assert.equal(requests[2].options.ifMatch, 'first')
  assert.notEqual(debateVotePath(id), debateVotePath(otherId))
  assert.throws(() => debateVotePath('../secret'))
  await assert.rejects(() => store.write(id, state), /ETag/u)
  sdk.put = async () => { throw new Precondition('private-details') }
  await assert.rejects(() => store.write(id, state, { etag: 'first' }), error => error.code === 'storage_conflict')
  sdk.put = async () => { throw new Error('generic create collision') }
  await assert.rejects(() => store.write(id, state, { etag: null }), error => error.code === 'storage_conflict')
  sdk.get = async () => null
  await assert.rejects(() => store.write(id, state, { etag: null }), /generic create collision/u)
})

test('Blob storage rejects oversized, malformed or incomplete reads without public fallbacks', async () => {
  for (const result of [{ statusCode: 403 }, { statusCode: 200, blob: { etag: 'a', size: 34 * 1024 * 1024 }, stream: new Response('{}').body },
    { statusCode: 200, blob: { etag: '', size: 2 }, stream: new Response('{}').body },
    { statusCode: 200, blob: { etag: 'a', size: 3 }, stream: new Response('bad').body }]) {
    const store = createBlobDebateVoteStore({ sdk: { async get() { return result } } })
    await assert.rejects(() => store.read(id))
  }
})
