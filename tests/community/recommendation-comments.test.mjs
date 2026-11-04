import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { createRecommendationCommentsHandler, recommendationStorageConflict, RECOMMENDATION_COOKIE_NAME } from '../../server/recommendation-comments.mjs'
import { createBlobRecommendationCommentStore, recommendationCommentPath } from '../../server/recommendation-comment-blob.mjs'

const report = 'report-current-gpt', history = 'report-previous-gpt', legacy = 'pick-legacy', earnings = 'report-earnings'
const snapshot = { reports: [{ id: report, symbol: 'NVDA' }, { id: earnings, symbol: 'NVDA', kind: 'earnings-review' }],
  reportHistory: [{ id: history, symbol: 'NVDA' }], picks: [{ id: legacy, symbol: 'NVDA' }] }
const owner = letter => RECOMMENDATION_COOKIE_NAME + '=' + letter.repeat(64)
const publicKeys = ['body', 'createdAt', 'id', 'isOwn', 'name']

class FakeCAS {
  rows = new Map()
  reads = 0
  writes = 0
  conflicts = 0
  unavailable = false
  alwaysConflict = false
  failAfterCommit = false
  async read(id) {
    this.reads++
    if (this.unavailable) throw new Error('private-token-must-never-leak')
    const row = this.rows.get(id)
    return row ? structuredClone(row) : null
  }
  async write(id, value, { etag }) {
    this.writes++
    await setImmediate()
    if (this.unavailable) throw new Error('private-token-must-never-leak')
    const current = this.rows.get(id)
    if (this.alwaysConflict || (current?.etag || null) !== etag) {
      this.conflicts++; throw recommendationStorageConflict()
    }
    this.rows.set(id, { value: structuredClone(value), etag: randomUUID() })
    if (this.failAfterCommit) { this.failAfterCommit = false; throw new Error('lost-response') }
    return { etag: this.rows.get(id).etag }
  }
}
function fixture(options = {}) {
  const store = options.store || new FakeCAS()
  let instant = Date.parse('2026-11-05T02:00:00Z')
  const handler = createRecommendationCommentsHandler({ store, reportsSource: () => snapshot, now: () => instant,
    production: true, trustProxy: true, ...options })
  async function call(method = 'GET', input, { cookie = owner('a'), query = '', headers = {}, body, stream } = {}) {
    const request = stream ? Readable.from(stream) : Readable.from([])
    Object.assign(request, {
      method, url: '/api/recommendation-comments' + (method === 'GET' ? query || '?reportId=' + report : ''),
      headers: { host: 'example.com', ...(method !== 'GET' ? { origin: 'https://example.com', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : {}),
        ...(cookie ? { cookie } : {}), 'x-forwarded-for': '198.51.100.1', ...headers },
      socket: { remoteAddress: '127.0.0.1' },
      ...(stream ? {} : { body: body === undefined ? input : body }),
    })
    const responseHeaders = {}
    const response = { statusCode: 200, setHeader(key, value) { responseHeaders[key.toLowerCase()] = value }, end(value) { this.body = value } }
    await handler(request, response)
    return { status: response.statusCode, data: JSON.parse(response.body), headers: responseHeaders }
  }
  return { store, handler, call, advance(ms) { instant += ms } }
}
const input = (extra = {}) => ({ reportId: report, name: '손님', body: '추천의 근거를 함께 확인해요.', requestId: randomUUID(), ...extra })

test('initial reading issues an HttpOnly secure capability and never caches personalized responses', async () => {
  const { call, store } = fixture()
  const result = await call('GET', null, { cookie: '' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.data, { reportId: report, comments: [], count: 0, nextCursor: null })
  assert.match(result.headers['set-cookie'], new RegExp('^' + RECOMMENDATION_COOKIE_NAME + '=[a-f0-9]{64};'))
  assert.match(result.headers['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=31536000; Secure$/)
  assert.match(result.headers['cache-control'], /private, no-store/)
  assert.equal(result.headers['cdn-cache-control'], 'no-store')
  assert.equal(result.headers['vercel-cdn-cache-control'], 'no-store')
  assert.equal(result.headers.vary, 'Cookie')
  assert.equal(result.headers['access-control-allow-origin'], undefined)
  assert.equal(store.writes, 0)
})

test('guest comments persist with server identities and reveal only public fields', async () => {
  const { call, store } = fixture()
  const saved = await call('POST', input({ name: '  손님  ', body: '  검토해 봅시다.  ' }))
  assert.equal(saved.status, 201)
  assert.equal(saved.data.comment.isOwn, true)
  assert.equal(saved.data.comment.name, '손님')
  assert.equal(saved.data.comment.body, '검토해 봅시다.')
  assert.deepEqual(Object.keys(saved.data.comment).sort(), publicKeys)
  const own = await call(), stranger = await call('GET', null, { cookie: owner('b') })
  assert.equal(own.data.comments[0].isOwn, true)
  assert.equal(stranger.data.comments[0].isOwn, false)
  assert.equal(own.headers['set-cookie'], undefined)
  const output = JSON.stringify(stranger.data), privateState = JSON.stringify(store.rows.get(report).value)
  assert.doesNotMatch(output, /ownerHash|ipHash|requests|seq|etag/)
  assert.doesNotMatch(privateState, /198\.51\.100\.1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/)
  assert.equal(store.rows.get(report).value.comments[0].ownerHash.length, 64)
})

test('anchors are resolved only from trusted active reports, history, legacy picks and earnings reports', async () => {
  const { call, store } = fixture()
  for (const id of [report, history, legacy, earnings]) {
    assert.equal((await call('POST', input({ reportId: id, symbol: 'NVDA' }))).status, 201)
    assert.equal((await call('GET', null, { query: '?reportId=' + id })).data.count, 1)
  }
  assert.equal((await call('GET', null, { query: '?reportId=report-invented' })).status, 404)
  assert.equal((await call('POST', input({ reportId: report, symbol: 'AMD' }))).data.error, 'report_symbol_mismatch')
  assert.equal((await call('GET', null, { query: '?reportId=' + report + '&symbol=AMD' })).status, 400)
  assert.equal((await call('POST', input({ reportId: '../private-file' }))).status, 400)
  assert.equal(store.rows.size, 4)
})

test('latest fifty comments and cursors stay isolated to the exact report', async () => {
  const { call, advance } = fixture()
  for (let i = 0; i < 55; i++) {
    advance(61000)
    const result = await call('POST', input({ body: 'comment-' + String(i).padStart(2, '0') }))
    assert.equal(result.status, 201)
  }
  const latest = await call()
  assert.equal(latest.data.count, 55)
  assert.equal(latest.data.comments.length, 50)
  assert.equal(latest.data.comments[0].body, 'comment-05')
  assert.equal(latest.data.comments.at(-1).body, 'comment-54')
  const older = await call('GET', null, { query: '?reportId=' + report + '&before=' + latest.data.nextCursor })
  assert.equal(older.data.comments.length, 5)
  assert.equal(older.data.comments[0].body, 'comment-00')
  assert.equal(older.data.count, 55)
  assert.equal(older.data.nextCursor, null)
  assert.equal((await call('GET', null, { query: '?reportId=' + history + '&before=' + latest.data.nextCursor })).data.error, 'invalid_cursor')
  assert.equal((await call('GET', null, { query: '?reportId=' + history })).data.count, 0)
  assert.equal((await call('GET', null, { query: '?reportId=' + report + '&before=bogus' })).status, 400)
  assert.equal((await call('GET', null, { query: '?reportId=' + report + '&reportId=' + history })).status, 400)
})

test('CAS protects simultaneous creation, concurrent additions and deletion without lost writes', async () => {
  const { call, store } = fixture()
  const first = await Promise.all([call('POST', input({ body: '첫 댓글' })), call('POST', input({ body: '다른 댓글' }))])
  assert.ok(first.every(row => row.status === 201))
  assert.equal((await call()).data.count, 2)
  assert.ok(store.conflicts >= 1)
  const remove = first[0].data.comment.id
  const raced = await Promise.all([call('DELETE', { reportId: report, commentId: remove }), call('POST', input({ body: '동시에 추가' }))])
  assert.deepEqual(raced.map(row => row.status), [200, 201])
  const final = await call()
  assert.equal(final.data.count, 2)
  assert.ok(!final.data.comments.some(row => row.id === remove))
  assert.ok(final.data.comments.some(row => row.body === '동시에 추가'))
})

test('simultaneous duplicate requests and retries after a new handler remain idempotent', async () => {
  const { call, store } = fixture()
  const payload = input()
  const duplicate = await Promise.all([call('POST', payload), call('POST', payload)])
  assert.ok(duplicate.every(row => row.status === 201))
  assert.equal(duplicate[0].data.comment.id, duplicate[1].data.comment.id)
  assert.equal(store.rows.get(report).value.comments.length, 1)
  assert.equal(store.rows.get(report).value.rates.length, 1)
  const restarted = fixture({ store })
  assert.equal((await restarted.call('POST', payload)).data.comment.id, duplicate[0].data.comment.id)
  assert.equal((await call('POST', { ...payload, body: '변경된 내용' })).data.error, 'idempotency_conflict')
  assert.equal((await call('POST', { ...payload, name: '변경 이름' })).status, 409)
})

test('an ambiguous committed write can be retried without creating another comment', async () => {
  const { call, store } = fixture()
  const payload = input()
  store.failAfterCommit = true
  assert.equal((await call('POST', payload)).status, 503)
  const retry = await call('POST', payload)
  assert.equal(retry.status, 201)
  assert.equal(retry.data.count, 1)
  assert.equal(store.rows.get(report).value.comments.length, 1)
})

test('only the owning capability can delete, and removed text is not retained or recreated by retry', async () => {
  const { call, store } = fixture()
  const payload = input({ name: '삭제될 이름', body: '삭제될 원문' })
  const saved = await call('POST', payload)
  const deletion = { reportId: report, commentId: saved.data.comment.id }
  assert.equal((await call('DELETE', deletion, { cookie: owner('b') })).status, 403)
  assert.equal((await call('DELETE', { ...deletion, reportId: history })).status, 404)
  assert.deepEqual((await call('DELETE', deletion)).data, { deleted: true, count: 0 })
  assert.equal((await call('DELETE', deletion)).status, 200)
  assert.equal((await call('POST', payload)).data.error, 'comment_deleted')
  assert.doesNotMatch(JSON.stringify(store.rows.get(report).value), /삭제될 원문|삭제될 이름/)
  assert.equal((await call()).data.count, 0)
})

test('rate limits survive new handlers, cover both owner and IP, and prune old transient records', async () => {
  const { call, store, advance } = fixture()
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', input(), { headers: { 'x-forwarded-for': '198.51.100.' + (i + 1) } })).status, 201)
  assert.equal((await call('POST', input(), { headers: { 'x-forwarded-for': '203.0.113.20' } })).status, 429)
  const restarted = fixture({ store })
  assert.equal((await restarted.call('POST', input())).status, 429)
  advance(61000)
  assert.equal((await call('POST', input())).status, 201)
  assert.equal(store.rows.get(report).value.rates.length, 1)
  const other = fixture()
  for (const token of ['a', 'b', 'c', 'd', 'e']) assert.equal((await other.call('POST', input(), { cookie: owner(token) })).status, 201)
  assert.equal((await other.call('POST', input(), { cookie: owner('f') })).status, 429)
  assert.equal((await other.call('POST', input({ reportId: history }), { cookie: owner('f') })).status, 201)
})

test('strict fields, text bounds and malformed JSON reject malicious input before storage', async () => {
  const { call, store } = fixture()
  for (const bad of [
    { body: '' }, { body: ' '.repeat(5) }, { body: '가'.repeat(1001) }, { name: '😀'.repeat(25) }, { name: '' },
    { requestId: 'short' }, { body: 'control\u0000' }, { ownerHash: 'f'.repeat(64) }, { kind: 'ai' }, { parent: 'report-other' },
  ]) assert.equal((await call('POST', input(bad))).status, 400)
  assert.equal((await call('POST', input({ body: '가'.repeat(1000), name: '😀'.repeat(24) }))).status, 201)
  assert.equal((await call('POST', null, { body: '{broken' })).data.error, 'invalid_json')
  assert.equal((await call('POST', null, { body: [] })).status, 400)
  assert.equal((await call('POST', input(), { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await call('POST', input(), { headers: { 'content-length': '8193' } })).status, 413)
  assert.equal((await call('POST', null, { stream: ['x'.repeat(4096), 'y'.repeat(4097)] })).status, 413)
  assert.equal(store.rows.get(report).value.comments.length, 1)
})

test('JSON mutations require exact same-origin requests and never enable CORS', async () => {
  const { call, store } = fixture()
  for (const headers of [{ origin: undefined }, { origin: 'null' }, { origin: 'https://evil.example' },
    { origin: 'https://example.com.evil.example' }, { 'sec-fetch-site': 'cross-site' }, { host: 'example.com/evil' }]) {
    const result = await call('POST', input(), { headers })
    assert.equal(result.status, 403)
    assert.equal(result.headers['access-control-allow-origin'], undefined)
  }
  assert.equal((await call('GET', null, { headers: { origin: 'https://evil.example' } })).status, 403)
  const unsupported = await call('OPTIONS')
  assert.equal(unsupported.status, 405)
  assert.equal(unsupported.headers.allow, 'GET, POST, DELETE')
  assert.equal(store.writes, 0)
})

test('storage failures, malformed stored state and exhausted CAS retries fail honestly', async () => {
  const { call, store } = fixture()
  store.unavailable = true
  const unavailable = await call()
  assert.deepEqual(unavailable.data, { error: 'comments_unavailable' })
  assert.equal(unavailable.status, 503)
  assert.doesNotMatch(JSON.stringify(unavailable), /private-token/)
  store.unavailable = false
  store.rows.set(report, { value: { version: 1, reportId: history }, etag: 'broken' })
  assert.equal((await call()).status, 503)
  store.rows.clear(); store.alwaysConflict = true
  const bounded = fixture({ store, attempts: 3 })
  assert.deepEqual((await bounded.call('POST', input())).data, { error: 'comments_busy' })
  assert.equal(store.writes, 3)
  assert.equal(store.rows.size, 0)
})

test('a full thread returns an explicit capacity error without dropping existing comments', async () => {
  const { call, store } = fixture()
  await call('POST', input())
  const row = store.rows.get(report), template = row.value.comments[0]
  row.value.comments = Array.from({ length: 5000 }, (_, index) => ({ ...template, id: randomUUID(), seq: index + 1 }))
  row.value.nextSeq = 5001
  const result = await call('POST', input())
  assert.equal(result.status, 409)
  assert.equal(result.data.error, 'thread_capacity_reached')
  assert.equal(store.rows.get(report).value.comments.length, 5000)
})

function blobResult(value, etag = '"etag"') {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  return { statusCode: 200, blob: { etag, size: encoded.length }, stream: new ReadableStream({ start(controller) { controller.enqueue(encoded); controller.close() } }) }
}
test('Blob adapter uses private uncached reads, deterministic paths, create-only writes and conditional ETags', async () => {
  const calls = []
  class Precondition extends Error {}
  const sdk = {
    BlobPreconditionFailedError: Precondition,
    async get(path, options) { calls.push({ method: 'get', path, options }); return blobResult({ reportId: report }) },
    async put(path, body, options) { calls.push({ method: 'put', path, body, options }); return { etag: '"next"' } },
  }
  const store = createBlobRecommendationCommentStore({ sdk })
  assert.deepEqual(await store.read(report), { value: { reportId: report }, etag: '"etag"' })
  await store.write(report, { value: 1 }, { etag: null })
  await store.write(report, { value: 2 }, { etag: '"etag"' })
  assert.match(calls[0].path, /^recommendation-comments\/v1\/[a-f0-9]{64}\.json$/)
  assert.equal(calls[0].options.access, 'private')
  assert.equal(calls[0].options.useCache, false)
  assert.equal(calls[1].options.allowOverwrite, false)
  assert.equal(calls[1].options.ifMatch, undefined)
  assert.equal(calls[2].options.allowOverwrite, true)
  assert.equal(calls[2].options.ifMatch, '"etag"')
  assert.equal(calls[2].options.access, 'private')
  assert.equal(calls[2].options.addRandomSuffix, false)
  assert.notEqual(recommendationCommentPath(report), recommendationCommentPath(history))
  await assert.rejects(store.write(report, {}, {}), /ETag/)
  sdk.put = async () => { throw new Precondition('changed') }
  await assert.rejects(store.write(report, {}, { etag: '"etag"' }), error => error.code === 'storage_conflict')
  sdk.put = async () => { throw new Error('already exists') }
  await assert.rejects(store.write(report, {}, { etag: null }), error => error.code === 'storage_conflict')
  sdk.get = async () => null
  assert.equal(await store.read(report), null)
  await assert.rejects(store.write(report, {}, { etag: null }), /already exists/)
})

test('Blob adapter rejects invalid metadata or oversized private state instead of treating it as empty', async () => {
  const sdk = { async get() { return { ...blobResult({}), blob: { size: 33 * 1024 * 1024, etag: '"etag"' } } }, async put() { throw new Error('unused') } }
  const store = createBlobRecommendationCommentStore({ sdk })
  await assert.rejects(store.read(report), /Invalid comment storage response/)
  sdk.get = async () => ({ ...blobResult({}), blob: { size: 2, etag: '' } })
  await assert.rejects(store.read(report), /Invalid comment storage response/)
})

test('deleting an old comment keeps a fresh retry marker after original post requests expire', async () => {
  const { call, store, advance } = fixture()
  const saved = await call('POST', input({ body: '오래된 삭제 원문' }))
  const deletion = { reportId: report, commentId: saved.data.comment.id }
  advance(25 * 60 * 60000)
  await call('POST', input({ body: '시간 경과 후 새 댓글' }))
  assert.ok(!store.rows.get(report).value.requests.some(row => row.commentId === deletion.commentId))
  assert.equal((await call('DELETE', deletion)).status, 200)
  assert.equal((await call('DELETE', deletion)).status, 200)
  assert.doesNotMatch(JSON.stringify(store.rows.get(report).value), /오래된 삭제 원문/)
  assert.equal((await call()).data.count, 1)
})
