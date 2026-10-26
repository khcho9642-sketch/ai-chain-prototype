import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { CommunityStore } from './store.mjs'
import { CommunityError, ensure } from './policy.mjs'

const digest = v => createHash('sha256').update(v).digest()
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
function authorised(req, token) {
  const supplied = req.headers.authorization || ''
  return typeof supplied === 'string' && timingSafeEqual(digest(supplied), digest(`Bearer ${token}`))
}
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
async function body(req) {
  ensure((req.headers['content-type'] || '').split(';')[0] === 'application/json', 'json_required', 415)
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; ensure(size <= 16384, 'body_too_large', 413); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new CommunityError('invalid_json') }
}
export function createCommunityHandler({ catalog, path, workerToken, adminToken, store: suppliedStore } = {}) {
  ensure(typeof workerToken === 'string' && workerToken.length >= 32 && typeof adminToken === 'string' && adminToken.length >= 32 && workerToken !== adminToken, 'separate_tokens_required')
  if (path && path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const store = suppliedStore || new CommunityStore({ catalog, path: path || ':memory:' })
  const streams = new Set()
  const broadcast = message => { for (const res of streams) { if (!res.write(`event: wake\ndata: ${JSON.stringify(message)}\n\n`)) res.end() } }
  store.on('wake', broadcast)
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      // Development-only backend: never use guest sessions as production authentication.
      ensure(loopback(req.socket.remoteAddress), 'local_development_only', 403)
      const host = req.headers.host || ''
      ensure(/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host), 'invalid_host', 403)
      const origin = `http://${host}`
      if (req.headers.origin) ensure(req.headers.origin === origin, 'invalid_origin', 403)
      const url = new URL(req.url, origin), route = url.pathname.slice('/api/community'.length)
      const isWorker = route.startsWith('/worker/'), isAdmin = route.startsWith('/admin')
      if (isWorker) ensure(authorised(req, workerToken), 'worker_unauthorized', 401)
      if (isAdmin) ensure(authorised(req, adminToken), 'admin_unauthorized', 401)
      if (req.method === 'GET' && (route === '/events' || route === '/worker/events')) {
        ensure(streams.size < 64, 'too_many_streams', 429)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
        res.write('retry: 3000\nevent: wake\ndata: {}\n\n'); streams.add(res)
        const timer = setInterval(() => { if (!res.write(': keepalive\n\n')) res.end() }, 30000)
        timer.unref()
        res.on('close', () => { clearInterval(timer); streams.delete(res) }); return
      }
      if (req.method === 'GET' && route === '/status') return json(res, 200, { enabled: true, developmentOnly: true, mode: 'review_only', symbols: store.catalog.size, ...store.settings() })
      if (req.method === 'GET' && route === '/comments') return json(res, 200, store.comments(url.searchParams.get('symbol'), url.searchParams.has('before') ? Number(url.searchParams.get('before')) : Number.MAX_SAFE_INTEGER))
      if (req.method === 'GET' && route === '/admin') return json(res, 200, store.admin())
      ensure(req.method === 'POST', 'method_not_allowed', 405)
      if (!isWorker && !isAdmin) ensure(req.headers.origin === origin, 'origin_required', 403)
      const input = await body(req)
      ensure(input && typeof input === 'object' && !Array.isArray(input), 'invalid_body')
      if (route === '/comments') {
        const old = /(?:^|;\s*)ai_chain_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
        const session = store.session(old)
        res.setHeader('Set-Cookie', `ai_chain_session=${session}; Path=/api/community; HttpOnly; SameSite=Strict; Max-Age=604800`)
        return json(res, 201, store.addHuman(input, session))
      }
      if (route === '/worker/claim') return json(res, 200, store.claim(input.agents))
      if (route === '/worker/finish') { const result = store.finish(input); store.notify(); return json(res, 200, result) }
      if (route === '/worker/fail') return json(res, 200, store.fail(input))
      if (route === '/admin/settings') return json(res, 200, store.configure(input))
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
  handler.store = store
  handler.close = () => { for (const res of streams) res.end(); store.off('wake', broadcast); store.close() }
  return handler
}
