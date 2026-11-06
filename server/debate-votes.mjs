import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export const DEBATE_VOTE_COOKIE_NAME = 'ai_chain_debate_voter'
const AGENTS = ['gpt', 'claude', 'gemini']
const DIGEST = /^[a-f0-9]{64}$/u
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u
const MAX_VOTES = 100000
const MAX_BODY = 2048
const MINUTE = 60000
const DAY = 24 * 60 * MINUTE
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export class DebateVoteError extends Error {
  constructor(code, status = 400, result) { super(code); this.code = code; this.status = status; this.result = result }
}
const ensure = (condition, code, status = 400) => { if (!condition) throw new DebateVoteError(code, status) }
export const debateVoteStorageConflict = () => new DebateVoteError('storage_conflict', 409)
const keyedHash = (secret, purpose, value) => createHmac('sha256', secret).update(purpose + ':' + value).digest('hex')
const exactFields = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))

function trustedOrigin(req, production) {
  const host = req.headers.host
  ensure(typeof host === 'string' && /^[a-z0-9.[\]:-]+$/iu.test(host), 'invalid_origin', 403)
  try {
    const origin = new URL((production || req.socket?.encrypted ? 'https://' : 'http://') + host)
    ensure(origin.host === host.toLowerCase() && !origin.username && !origin.password, 'invalid_origin', 403)
    return origin.origin
  } catch { throw new DebateVoteError('invalid_origin', 403) }
}
function sameOrigin(req, expected, required) {
  if (required || req.headers.origin !== undefined) ensure(req.headers.origin === expected, 'invalid_origin', 403)
  if (required && req.headers['sec-fetch-site']) ensure(req.headers['sec-fetch-site'] === 'same-origin', 'invalid_origin', 403)
}
function identity(req, res, { secret, production, required }) {
  const matching = String(req.headers.cookie || '').split(';').map(row => row.trim()).filter(row => row.startsWith(DEBATE_VOTE_COOKIE_NAME + '='))
  const supplied = matching.length === 1 ? matching[0].slice(DEBATE_VOTE_COOKIE_NAME.length + 1) : ''
  const [token, signature, extra] = supplied.split('.')
  const valid = !extra && DIGEST.test(token || '') && DIGEST.test(signature || '') &&
    timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(keyedHash(secret, 'debate-cookie', token), 'hex'))
  if (valid) return keyedHash(secret, 'debate-owner', token)
  ensure(!required, 'voter_initialization_required', 409)
  const fresh = randomBytes(32).toString('hex')
  res.setHeader('Set-Cookie', DEBATE_VOTE_COOKIE_NAME + '=' + fresh + '.' + keyedHash(secret, 'debate-cookie', fresh) +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (production ? '; Secure' : ''))
  return keyedHash(secret, 'debate-owner', fresh)
}
function clientIp(req, trustProxy) {
  const forwarded = trustProxy ? req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] : null
  const candidate = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : ''
  const value = isIP(candidate) ? candidate : req.socket?.remoteAddress
  return isIP(value || '') ? value : 'unknown'
}
async function readJson(req) {
  ensure(String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json', 'json_required', 415)
  if (req.headers['content-length'] !== undefined) ensure(/^\d+$/u.test(String(req.headers['content-length'])) && Number(req.headers['content-length']) <= MAX_BODY, 'body_too_large', 413)
  let raw
  if (req.body !== undefined) {
    try { raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body)) }
    catch { throw new DebateVoteError('invalid_body') }
  } else {
    let size = 0; const chunks = []
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk); size += bytes.length
      ensure(size <= MAX_BODY, 'body_too_large', 413); chunks.push(bytes)
    }
    raw = Buffer.concat(chunks)
  }
  ensure(raw.length <= MAX_BODY, 'body_too_large', 413)
  try { return JSON.parse(raw.toString('utf8')) } catch { throw new DebateVoteError('invalid_json') }
}
function emptyState(debate) { return { version: 1, debateId: debate.id, date: debate.date, ticker: debate.topic.ticker, votes: [] } }
function validateState(value, debate) {
  ensure(exactFields(value, ['version', 'debateId', 'date', 'ticker', 'votes']) && value.version === 1 && value.debateId === debate.id &&
    value.date === debate.date && value.ticker === debate.topic.ticker && Array.isArray(value.votes) && value.votes.length <= MAX_VOTES, 'votes_unavailable', 503)
  const owners = new Set()
  for (const row of value.votes) {
    ensure(exactFields(row, ['ownerHash', 'choice', 'ipHash', 'at']) && DIGEST.test(row.ownerHash) && DIGEST.test(row.ipHash) &&
      AGENTS.includes(row.choice) && Number.isSafeInteger(row.at) && row.at > 0 && !owners.has(row.ownerHash), 'votes_unavailable', 503)
    owners.add(row.ownerHash)
  }
  return value
}
function publicState(value, debateId, ownerHash) {
  const own = value.votes.find(row => row.ownerHash === ownerHash)
  const count = own ? value.votes.length : null
  const visible = own && count >= 10
  const tally = visible ? Object.fromEntries(AGENTS.map(ai => [ai, value.votes.filter(row => row.choice === ai).length])) : null
  const percentages = visible ? Object.fromEntries(AGENTS.map(ai => [ai, Math.round(tally[ai] * 1000 / count) / 10])) : null
  return { debateId, hasVoted: !!own, choice: own?.choice || null, count, tally, percentages, counting: !!own && !visible }
}
function send(res, status, value) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value))
}

/** Durable votes are tied to an immutable published day and its actual AI participants. */
export function createDebateVotesHandler({ store, debatesSource, secretSource = () => process.env.BLOB_READ_WRITE_TOKEN,
  identitySecret, now = Date.now, production = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production',
  trustProxy = process.env.VERCEL === '1', attempts = 8 } = {}) {
  ensure(store && typeof store.read === 'function' && typeof store.write === 'function' && typeof debatesSource === 'function' &&
    Number.isInteger(attempts) && attempts >= 1 && attempts <= 16, 'invalid_votes_configuration', 500)
  function resolveDebate(id) {
    ensure(typeof id === 'string' && ID.test(id), 'invalid_debate')
    const source = debatesSource(id)
    ensure(source && typeof source.then !== 'function', 'votes_unavailable', 503)
    const rows = Array.isArray(source) ? source : source.debates
    ensure(Array.isArray(rows), 'votes_unavailable', 503)
    const found = rows.find(row => row.id === id)
    ensure(found, 'debate_not_found', 404)
    ensure(DATE.test(found.date) && found.topic && typeof found.topic.ticker === 'string' && found.topic.ticker.length > 0 &&
      Array.isArray(found.stances), 'votes_unavailable', 503)
    const participants = found.stances.map(row => row.ai)
    ensure(participants.length > 0 && participants.length <= 3 && new Set(participants).size === participants.length && participants.every(ai => AGENTS.includes(ai)), 'voting_not_available', 409)
    return { ...found, participants }
  }
  async function read(debate) {
    const current = await store.read(debate.id)
    if (current === null) return { value: emptyState(debate), etag: null }
    ensure(object(current) && typeof current.etag === 'string' && current.etag.length > 0, 'votes_unavailable', 503)
    return { value: validateState(structuredClone(current.value), debate), etag: current.etag }
  }
  async function mutate(debate, operation) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const current = await read(debate), result = operation(current.value)
      if (!result.changed) return result.value
      try { await store.write(debate.id, current.value, { etag: current.etag }); return result.value }
      catch (error) { if (error?.code !== 'storage_conflict') throw error }
    }
    throw new DebateVoteError('votes_busy', 503)
  }
  return async function debateVotes(req, res) {
    for (const [key, value] of Object.entries({ 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' })) res.setHeader(key, value)
    try {
      const method = req.method?.toUpperCase()
      ensure(method === 'GET' || method === 'POST', 'method_not_allowed', 405)
      const origin = trustedOrigin(req, production)
      sameOrigin(req, origin, method === 'POST')
      const url = new URL(req.url, origin)
      let input
      if (method === 'GET') {
        ensure([...url.searchParams.keys()].every(key => key === 'debateId') && url.searchParams.getAll('debateId').length === 1, 'invalid_query')
        input = { debateId: url.searchParams.get('debateId') }
      } else {
        ensure(url.search === '', 'invalid_query')
        input = await readJson(req)
        ensure(exactFields(input, ['debateId', 'choice']), 'invalid_body')
      }
      const debate = resolveDebate(input.debateId)
      const secret = identitySecret ?? secretSource()
      ensure(typeof secret === 'string' && secret.length >= 16, 'votes_unavailable', 503)
      const ownerHash = identity(req, res, { secret, production, required: method === 'POST' })
      if (method === 'GET') return send(res, 200, publicState((await read(debate)).value, debate.id, ownerHash))
      ensure(debate.participants.includes(input.choice), 'invalid_choice')
      const at = now()
      ensure(Number.isSafeInteger(at) && at > 0, 'votes_unavailable', 503)
      const ipHash = keyedHash(secret, 'debate-ip', debate.id + ':' + clientIp(req, trustProxy))
      const result = await mutate(debate, state => {
        const previous = state.votes.find(row => row.ownerHash === ownerHash)
        if (previous) {
          if (previous.choice !== input.choice) throw new DebateVoteError('already_voted', 409, publicState(state, debate.id, ownerHash))
          return { changed: false, value: publicState(state, debate.id, ownerHash) }
        }
        const recent = state.votes.filter(row => row.ipHash === ipHash)
        // Durable bounds also apply after cold starts and to freshly cleared cookies.
        ensure(recent.filter(row => row.at > at - MINUTE).length < 5 && recent.filter(row => row.at > at - DAY).length < 20, 'rate_limited', 429)
        ensure(state.votes.length < MAX_VOTES, 'vote_capacity_reached', 409)
        state.votes.push({ ownerHash, choice: input.choice, ipHash, at })
        return { changed: true, value: publicState(state, debate.id, ownerHash) }
      })
      return send(res, 200, result)
    } catch (error) {
      const known = error instanceof DebateVoteError && error.code !== 'storage_conflict'
      const status = known ? error.status : 503
      if (status === 405) res.setHeader('Allow', 'GET, POST')
      if (status === 429) res.setHeader('Retry-After', '60')
      return send(res, status, { error: known ? error.code : 'votes_unavailable', ...(known && error.result ? error.result : {}) })
    }
  }
}
