import { Readable } from 'node:stream'
import { handleAuthRequest } from './google-auth.mjs'
import { createMemberDatabase } from './sqlite.mjs'

// Only the loopback development server uses this adapter; Pages uses Web Requests.
export function createLocalMemberHandler({ path, clientId, origin }) {
  const url = new URL(origin)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('local_auth_origin_required')
  const db = createMemberDatabase(path)
  const env = { MEMBER_DB: db, GOOGLE_CLIENT_ID: clientId, AUTH_ORIGIN: url.origin, AUTH_ALLOW_LOCAL_HTTP: '1' }
  const handler = async (req, res) => {
    try {
      // Host is checked separately so an attacker cannot supply our canonical URL.
      if (req.headers.host !== url.host) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        return res.end(JSON.stringify({ error: 'invalid_origin' }))
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (name === 'cf-connecting-ip' || name === 'transfer-encoding') continue
        if (Array.isArray(value)) for (const item of value) headers.append(name, item)
        else if (value !== undefined) headers.set(name, value)
      }
      headers.set('cf-connecting-ip', req.socket.remoteAddress || 'local')
      const init = { method: req.method, headers }
      if (!['GET', 'HEAD'].includes(req.method)) { init.body = Readable.toWeb(req); init.duplex = 'half' }
      const response = await handleAuthRequest(new Request(new URL(req.url, url.origin), init), env)
      res.statusCode = response.status
      for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value)
      const cookies = response.headers.getSetCookie()
      if (cookies.length) res.setHeader('Set-Cookie', cookies)
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: 'auth_unavailable' }))
    }
  }
  handler.close = () => db.close()
  return handler
}
