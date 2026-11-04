import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'

export const RECOMMENDATION_COOKIE_NAME = 'ai_chain_comment_owner'
const MAX_BODY_BYTES = 8192
const PAGE_SIZE = 50
const MAX_COMMENTS = 5000
const MAX_REQUESTS = 20000
const MAX_RATES = 10000
const MINUTE = 60000
const RETRY_TTL = 24 * 60 * MINUTE
const hash = value => createHash('sha256').update(value).digest('hex')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const digestPattern = /^[a-f0-9]{64}$/
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export class RecommendationCommentError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}
const ensure = (condition, code, status = 400) => { if (!condition) throw new RecommendationCommentError(code, status) }
export const recommendationStorageConflict = () => new RecommendationCommentError('storage_conflict', 409)

function clean(value, max, code) {
  ensure(typeof value === 'string', code)
  const result = value.trim().normalize('NFC')
  ensure([...result].length >= 1 && [...result].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result), code)
  return result
}
function emptyThread(reportId) {
  return { version: 1, reportId, nextSeq: 1, comments: [], requests: [], rates: [] }
}
function validateThread(value, reportId) {
  const invalid = () => { throw new RecommendationCommentError('comments_unavailable', 503) }
  if (!object(value) || value.version !== 1 || value.reportId !== reportId || !Number.isSafeInteger(value.nextSeq) || value.nextSeq < 1 ||
    !Array.isArray(value.comments) || value.comments.length > MAX_COMMENTS || !Array.isArray(value.requests) || value.requests.length > MAX_REQUESTS ||
    !Array.isArray(value.rates) || value.rates.length > MAX_RATES) invalid()
  const ids = new Set(), sequences = new Set()
  for (const row of value.comments) {
    if (!object(row) || !uuidPattern.test(row.id) || ids.has(row.id) || !Number.isSafeInteger(row.seq) || row.seq < 1 || row.seq >= value.nextSeq ||
      sequences.has(row.seq) || !digestPattern.test(row.ownerHash) || typeof row.name !== 'string' || typeof row.body !== 'string' ||
      typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) invalid()
    try { if (clean(row.name, 24, 'invalid_name') !== row.name || clean(row.body, 1000, 'invalid_body') !== row.body) invalid() } catch { invalid() }
    ids.add(row.id); sequences.add(row.seq)
  }
  for (const row of value.requests) {
    if (!object(row) || !digestPattern.test(row.key) || !digestPattern.test(row.digest) || !digestPattern.test(row.ownerHash) ||
      !uuidPattern.test(row.commentId) || !Number.isSafeInteger(row.at)) invalid()
  }
  for (const row of value.rates) {
    if (!object(row) || !digestPattern.test(row.ownerHash) || !digestPattern.test(row.ipHash) || !Number.isSafeInteger(row.at)) invalid()
  }
  return value
}
function publicComment(row, ownerHash) {
  return { id: row.id, name: row.name, body: row.body, createdAt: row.createdAt, isOwn: row.ownerHash === ownerHash }
}
function cursor(reportId, seq) {
  return Buffer.from(JSON.stringify({ reportId, seq })).toString('base64url')
}
function cursorSequence(value, reportId) {
  if (value === null) return Number.MAX_SAFE_INTEGER
  ensure(typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value), 'invalid_cursor')
  let decoded
  try { decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { throw new RecommendationCommentError('invalid_cursor') }
  ensure(object(decoded) && decoded.reportId === reportId && Number.isSafeInteger(decoded.seq) && decoded.seq > 0 &&
    cursor(reportId, decoded.seq) === value, 'invalid_cursor')
  return decoded.seq
}
function page(value, reportId, before, ownerHash) {
  const rows = value.comments.filter(row => row.seq < before).sort((a, b) => a.seq - b.seq)
  const selected = rows.slice(-PAGE_SIZE)
  return { reportId, comments: selected.map(row => publicComment(row, ownerHash)), count: value.comments.length,
    nextCursor: rows.length > PAGE_SIZE ? cursor(reportId, selected[0].seq) : null }
}
function requestOrigin(req, production) {
  const host = req.headers.host
  ensure(typeof host === 'string' && /^[a-z0-9.[\]:-]+$/i.test(host), 'invalid_host', 403)
  try {
    const url = new URL((production || req.socket?.encrypted ? 'https://' : 'http://') + host)
    ensure(!url.username && !url.password && url.host === host.toLowerCase(), 'invalid_host', 403)
    return url.origin
  } catch { throw new RecommendationCommentError('invalid_host', 403) }
}
function sameOrigin(req, expected, required) {
  const origin = req.headers.origin
  if (required || origin !== undefined) ensure(typeof origin === 'string' && origin === expected, 'invalid_origin', 403)
  if (required && req.headers['sec-fetch-site']) ensure(req.headers['sec-fetch-site'] === 'same-origin', 'invalid_origin', 403)
}
function ownerIdentity(req, res, production) {
  const matching = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(RECOMMENDATION_COOKIE_NAME + '='))
  const supplied = matching.length === 1 ? matching[0].slice(RECOMMENDATION_COOKIE_NAME.length + 1) : ''
  const token = digestPattern.test(supplied) ? supplied : randomBytes(32).toString('hex')
  if (token !== supplied) {
    res.setHeader('Set-Cookie', RECOMMENDATION_COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (production ? '; Secure' : ''))
  }
  return hash('owner:' + token)
}
function clientIp(req, trustProxy) {
  const forwarded = trustProxy ? req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] : null
  const candidate = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : ''
  const address = isIP(candidate) ? candidate : req.socket?.remoteAddress
  return isIP(address || '') ? address : 'unknown'
}
function fields(input, allowed) {
  ensure(object(input) && Object.keys(input).every(key => allowed.includes(key)), 'invalid_body')
}
async function readJson(req) {
  ensure(String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json', 'json_required', 415)
  const declared = req.headers['content-length']
  if (declared !== undefined) ensure(/^\d+$/.test(String(declared)) && Number(declared) <= MAX_BODY_BYTES, 'body_too_large', 413)
  let raw
  if (req.body !== undefined) {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) raw = Buffer.from(req.body)
    else {
      try { raw = Buffer.from(JSON.stringify(req.body)) } catch { throw new RecommendationCommentError('invalid_body') }
    }
  } else {
    const chunks = []; let size = 0
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk); size += bytes.length
      ensure(size <= MAX_BODY_BYTES, 'body_too_large', 413); chunks.push(bytes)
    }
    raw = Buffer.concat(chunks)
  }
  ensure(raw.length <= MAX_BODY_BYTES, 'body_too_large', 413)
  let input
  try { input = JSON.parse(raw.toString('utf8')) } catch { throw new RecommendationCommentError('invalid_json') }
  ensure(object(input), 'invalid_body')
  return input
}
function send(res, status, value) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value))
}

/**
 * Per-report guest comments backed by an injected persistent compare-and-swap store.
 * Never falls back to memory or browser-only data when storage is unavailable.
 */
export function createRecommendationCommentsHandler({ store, reportsSource, now = Date.now,
  production = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production',
  trustProxy = process.env.VERCEL === '1', attempts = 8 } = {}) {
  ensure(store && typeof store.read === 'function' && typeof store.write === 'function' && typeof reportsSource === 'function', 'invalid_comments_configuration', 500)
  ensure(Number.isInteger(attempts) && attempts >= 1 && attempts <= 16, 'invalid_comments_configuration', 500)
  async function read(reportId) {
    const current = await store.read(reportId)
    if (current === null) return { value: emptyThread(reportId), etag: null }
    ensure(object(current) && typeof current.etag === 'string' && current.etag.length > 0, 'comments_unavailable', 503)
    return { value: validateThread(structuredClone(current.value), reportId), etag: current.etag }
  }
  async function mutate(reportId, operation) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const current = await read(reportId)
      const result = operation(current.value)
      if (!result.changed) return result.value
      try {
        await store.write(reportId, current.value, { etag: current.etag })
        return result.value
      } catch (error) {
        if (error?.code !== 'storage_conflict') throw error
      }
    }
    throw new RecommendationCommentError('comments_busy', 503)
  }
  function resolveReport(reportId, symbol) {
    ensure(typeof reportId === 'string' && idPattern.test(reportId), 'invalid_report')
    const snapshot = reportsSource()
    ensure(snapshot && typeof snapshot.then !== 'function', 'comments_unavailable', 503)
    const report = [...(snapshot.reports || []), ...(snapshot.reportHistory || []), ...(snapshot.picks || [])].find(row => row.id === reportId)
    ensure(report, 'report_not_found', 404)
    if (symbol !== undefined && symbol !== null) ensure(typeof symbol === 'string' && symbol === report.symbol, 'report_symbol_mismatch')
    return report
  }
  return async function recommendationComments(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    res.setHeader('CDN-Cache-Control', 'no-store')
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
    res.setHeader('Vary', 'Cookie')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const method = req.method?.toUpperCase()
      ensure(['GET', 'POST', 'DELETE'].includes(method), 'method_not_allowed', 405)
      const origin = requestOrigin(req, production)
      sameOrigin(req, origin, method !== 'GET')
      const url = new URL(req.url, origin)
      let input
      if (method === 'GET') {
        ensure([...url.searchParams.keys()].every(key => ['reportId', 'before', 'symbol'].includes(key)) &&
          ['reportId', 'before', 'symbol'].every(key => url.searchParams.getAll(key).length <= 1), 'invalid_query')
        input = { reportId: url.searchParams.get('reportId'), symbol: url.searchParams.get('symbol') }
      } else {
        input = await readJson(req)
        fields(input, method === 'POST' ? ['reportId', 'symbol', 'name', 'body', 'requestId'] : ['reportId', 'symbol', 'commentId'])
      }
      const reportId = resolveReport(input.reportId, input.symbol).id
      const ownerHash = ownerIdentity(req, res, production)
      if (method === 'GET') {
        const before = cursorSequence(url.searchParams.get('before'), reportId)
        return send(res, 200, page((await read(reportId)).value, reportId, before, ownerHash))
      }
      const at = now()
      ensure(Number.isSafeInteger(at) && at > 0, 'comments_unavailable', 503)
      if (method === 'POST') {
        const name = clean(input.name, 24, 'invalid_name'), body = clean(input.body, 1000, 'invalid_body')
        ensure(typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(input.requestId), 'invalid_request_id')
        const key = hash(ownerHash + ':' + input.requestId), digest = hash(JSON.stringify({ reportId, name, body }))
        const ipHash = hash('ip:' + reportId + ':' + clientIp(req, trustProxy))
        const result = await mutate(reportId, thread => {
          thread.requests = thread.requests.filter(row => row.at > at - RETRY_TTL)
          const previous = thread.requests.find(row => row.key === key)
          if (previous) {
            ensure(previous.digest === digest, 'idempotency_conflict', 409)
            const existing = thread.comments.find(row => row.id === previous.commentId)
            ensure(existing, 'comment_deleted', 409)
            return { changed: false, value: { comment: publicComment(existing, ownerHash), count: thread.comments.length } }
          }
          thread.rates = thread.rates.filter(row => row.at > at - MINUTE)
          ensure(thread.rates.filter(row => row.ownerHash === ownerHash).length < 5 &&
            thread.rates.filter(row => row.ipHash === ipHash).length < 5, 'rate_limited', 429)
          ensure(thread.comments.length < MAX_COMMENTS && thread.requests.length < MAX_REQUESTS && thread.rates.length < MAX_RATES &&
            thread.nextSeq < Number.MAX_SAFE_INTEGER, 'thread_capacity_reached', 409)
          const comment = { id: randomUUID(), seq: thread.nextSeq++, ownerHash, name, body, createdAt: new Date(at).toISOString() }
          thread.comments.push(comment)
          thread.requests.push({ key, digest, ownerHash, commentId: comment.id, at })
          thread.rates.push({ ownerHash, ipHash, at })
          return { changed: true, value: { comment: publicComment(comment, ownerHash), count: thread.comments.length } }
        })
        return send(res, 201, result)
      }
      ensure(typeof input.commentId === 'string' && uuidPattern.test(input.commentId), 'invalid_comment_id')
      const result = await mutate(reportId, thread => {
        const found = thread.comments.find(row => row.id === input.commentId)
        if (!found) {
          ensure(thread.requests.some(row => row.commentId === input.commentId && row.ownerHash === ownerHash && row.at > at - RETRY_TTL), 'comment_not_found', 404)
          return { changed: false, value: { deleted: true, count: thread.comments.length } }
        }
        ensure(found.ownerHash === ownerHash, 'not_comment_owner', 403)
        // A recent deletion remains retryable even if the original post is old.
        // The marker retains only hashes and IDs, never the deleted name or text.
        thread.requests = thread.requests.filter(row => row.at > at - RETRY_TTL || row.commentId === found.id)
        const marker = thread.requests.find(row => row.commentId === found.id && row.ownerHash === ownerHash)
        if (marker) marker.at = at
        else {
          ensure(thread.requests.length < MAX_REQUESTS, 'thread_capacity_reached', 409)
          thread.requests.push({ key: hash('deleted:' + ownerHash + ':' + found.id), digest: hash('deleted'), ownerHash, commentId: found.id, at })
        }
        thread.comments = thread.comments.filter(row => row.id !== found.id)
        thread.rates = thread.rates.filter(row => row.at > at - MINUTE)
        return { changed: true, value: { deleted: true, count: thread.comments.length } }
      })
      return send(res, 200, result)
    } catch (error) {
      const known = error instanceof RecommendationCommentError && error.code !== 'storage_conflict'
      const status = known ? error.status : 503
      if (status === 405) res.setHeader('Allow', 'GET, POST, DELETE')
      if (status === 429) res.setHeader('Retry-After', '60')
      return send(res, status, { error: known ? error.code : 'comments_unavailable' })
    }
  }
}
