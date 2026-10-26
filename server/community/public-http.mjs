import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { isIP } from 'node:net'
import { CommunityStore } from './store.mjs'
import { CommunityAuth } from './auth.mjs'
import { CommunityError, ensure } from './policy.mjs'

const digest = value => createHash('sha256').update(value).digest()
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
function canonicalOrigin(value) {
  const url = new URL(value)
  ensure(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'https_origin_required')
  return url.origin
}
function bearer(req) {
  const value = req.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : ''
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value))
}
async function readJson(req) {
  ensure((req.headers['content-type'] || '').split(';')[0].trim() === 'application/json', 'json_required', 415)
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; ensure(size <= 16384, 'body_too_large', 413); chunks.push(chunk) }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new CommunityError('invalid_json') }
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'invalid_body')
  return value
}

/** A single long-running Node service, not a Vercel/serverless function.
 * Keep the SQLite file on a persistent local volume; use one API process.
 * Browser members and the operator's CLI worker have different credentials.
 */
export function createPublicCommunityHandler({ catalog, path, origin, browserOrigins = [], workerToken,
  trustLoopbackProxy = false, allowRegistration = false, allowAutoPublish = false, store: suppliedStore } = {}) {
  const publicOrigin = canonicalOrigin(origin), publicHost = new URL(publicOrigin).host
  const allowed = new Set([publicOrigin, ...browserOrigins.map(canonicalOrigin)])
  ensure(typeof workerToken === 'string' && workerToken.length >= 32, 'worker_token_required')
  if (path && path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const store = suppliedStore || new CommunityStore({ catalog, path: path || ':memory:' })
  const auth = new CommunityAuth(store, { allowRegistration })
  // An old DB must not keep auto-publish enabled when the process disallows it.
  if (!allowAutoPublish && store.settings().mode === 'auto') store.configure({ mode: 'review_only' })
  const streams = new Map()
  const broadcast = message => {
    for (const [res] of streams) if (!res.write(`event: wake\ndata: ${JSON.stringify({ symbol: message.symbol || null })}\n\n`)) res.end()
  }
  store.on('wake', broadcast)
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Vary', 'Origin')
    try {
      const proxy = trustLoopbackProxy && loopback(req.socket.remoteAddress)
      ensure(req.headers.host === publicHost, 'invalid_host', 403)
      ensure(req.socket.encrypted === true || (proxy && req.headers['x-forwarded-proto'] === 'https'), 'https_required', 403)
      if (req.headers.origin) {
        ensure(allowed.has(req.headers.origin), 'invalid_origin', 403)
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
      }
      if (req.method === 'OPTIONS') {
        ensure(allowed.has(req.headers.origin), 'invalid_origin', 403)
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Worker-Id')
        res.setHeader('Access-Control-Max-Age', '600'); res.writeHead(204); return res.end()
      }
      const url = new URL(req.url, publicOrigin)
      ensure(url.pathname.startsWith('/api/community/'), 'not_found', 404)
      const route = url.pathname.slice('/api/community'.length), token = bearer(req)
      const worker = route.startsWith('/worker/'), admin = route === '/admin' || route.startsWith('/admin/')
      // Only a configured loopback reverse proxy can supply client addresses.
      const forwarded = proxy ? String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim() : ''
      const address = isIP(forwarded) ? forwarded : req.socket.remoteAddress
      const ipKey = digest(`${workerToken}:${address}`).toString('hex')
      auth.limit(`request:${ipKey}`, worker ? 3000 : 300)
      if (worker) ensure(timingSafeEqual(digest(token), digest(workerToken)), 'worker_unauthorized', 401)
      let user
      if (admin) { user = auth.user(token); ensure(user.role === 'admin', 'admin_required', 403) }
      const workerId = String(req.headers['x-worker-id'] || 'primary')
      if (worker) store.touchWorker(workerId)
      if (req.method === 'GET' && (route === '/events' || route === '/worker/events')) {
        ensure(streams.size < 128 && [...streams.values()].filter(x => x.ipKey === ipKey).length < 6, 'too_many_streams', 429)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
        res.write('retry: 3000\nevent: wake\ndata: {}\n\n')
        streams.set(res, { ipKey, worker })
        const timer = setInterval(() => {
          if (worker) store.touchWorker(workerId)
          if (!res.write(': keepalive\n\n')) res.end()
        }, 30000)
        timer.unref()
        res.on('close', () => { clearInterval(timer); streams.delete(res) })
        return
      }
      if (req.method === 'GET' && route === '/status') return json(res, 200, {
        enabled: true, developmentOnly: false, auth: 'member', registration: allowRegistration ? 'open' : 'invite',
        symbols: store.catalog.size, ...store.settings(), autoPublishAllowed: allowAutoPublish,
      })
      if (req.method === 'GET' && route === '/auth/me') return json(res, 200, { user: auth.user(token) })
      if (req.method === 'GET' && route === '/comments') return json(res, 200, store.comments(url.searchParams.get('symbol'), url.searchParams.has('before') ? Number(url.searchParams.get('before')) : Number.MAX_SAFE_INTEGER))
      if (req.method === 'GET' && route === '/admin') return json(res, 200, { ...store.admin(), autoPublishAllowed: allowAutoPublish })
      ensure(req.method === 'POST', 'method_not_allowed', 405)
      const input = await readJson(req)
      if (route === '/auth/register') {
        auth.limit(`register:${ipKey}`, 3, 3600000)
        const member = await auth.create({ name: input.name, password: input.password, invite: input.invite })
        return json(res, 201, { user: member })
      }
      if (route === '/auth/login') {
        auth.limit(`login:${ipKey}`, 8)
        auth.limit(`account:${digest(String(input.name || '').toLowerCase()).toString('hex')}`, 8)
        return json(res, 200, await auth.login(input))
      }
      if (route === '/auth/logout') { auth.logout(token); return json(res, 200, { loggedOut: true }) }
      if (route === '/comments') {
        user = auth.user(token)
        // Stable member identity provides idempotence across login/session changes.
        return json(res, 201, store.addHuman(input, `member:${user.id}`))
      }
      if (route === '/worker/claim') return json(res, 200, store.claim(input.agents))
      if (route === '/worker/finish') { const result = store.finish(input); store.notify(); return json(res, 200, result) }
      if (route === '/worker/fail') return json(res, 200, store.fail(input))
      if (route === '/admin/settings') {
        if (input.mode === 'auto') ensure(allowAutoPublish, 'auto_publish_not_enabled_on_server', 403)
        return json(res, 200, store.configure(input))
      }
      if (route === '/admin/invite') return json(res, 201, auth.invite())
      if (route === '/admin/request') return json(res, 200, store.request(input.symbol))
      if (route === '/admin/approve') return json(res, 200, store.approve(input.id))
      if (route === '/admin/reject') return json(res, 200, store.reject(input.id))
      if (route === '/admin/hide') return json(res, 200, store.hide(input.id))
      return json(res, 404, { error: 'not_found' })
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof CommunityError ? error.status : 500, { error: error instanceof CommunityError ? error.code : 'internal_error' })
      else res.end()
    }
  }
  handler.store = store; handler.auth = auth
  handler.close = () => { for (const [res] of streams) res.end(); store.off('wake', broadcast); store.close() }
  return handler
}
