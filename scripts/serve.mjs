import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { middleware } from '../server/market.mjs'
import { build, projectRoot } from './build.mjs'

export function createSiteServer({ root = join(projectRoot, 'dist'), chartService } = {}) {
  return createServer(async (req, res) => {
    const pathname = URL.canParse(req.url, 'http://localhost') ? new URL(req.url, 'http://localhost').pathname : ''
    if (pathname === '/api/snapshot') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405
        res.setHeader('Allow', 'GET, HEAD')
        return res.end(JSON.stringify({ error: 'GET 또는 HEAD 요청만 지원합니다.' }))
      }
      try {
        const content = await readFile(join(root, 'data', 'market.json'))
        res.statusCode = 200
        return res.end(req.method === 'HEAD' ? undefined : content)
      } catch {
        res.statusCode = 503
        return res.end(JSON.stringify({ error: '시세 스냅샷을 불러올 수 없습니다.' }))
      }
    }
    await middleware(req, res, async () => {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end('GET 또는 HEAD 요청만 지원합니다.')
      }
      try {
        const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
        const relative = path === '/' ? 'index.html' : path.slice(1)
        // Explicit public-file allowlist keeps source, design notes and Git files private.
        if (relative !== 'index.html' && relative !== 'data/market.json' && !/^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(relative)) {
          res.statusCode = 404; return res.end('페이지를 찾을 수 없습니다.')
        }
        const content = await readFile(join(root, relative))
        const type = relative.endsWith('.html') ? 'text/html' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/json'
        res.setHeader('Content-Type', `${type}; charset=utf-8`)
        res.setHeader('Cache-Control', 'no-cache')
        res.statusCode = 200
        res.end(req.method === 'HEAD' ? undefined : content)
      } catch (error) {
        res.statusCode = error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : 500
        res.end(res.statusCode === 400 ? '잘못된 요청입니다.' : '페이지를 불러올 수 없습니다.')
      }
    }, chartService)
  })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5175)
  const host = process.env.HOST || '127.0.0.1'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT가 올바르지 않습니다.')
  const root = await build()
  const server = createSiteServer({ root })
  server.on('error', error => { console.error(error.message); process.exitCode = 1 })
  server.listen(port, host, () => console.log(`AI CHAIN: http://${host}:${port} (실제 시세 API 포함)`))
}
