import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { instruments } from '../../assets/instruments.js'
import { createPublicCommunityHandler } from '../../server/community/public-http.mjs'
import { createEvidenceSource } from '../../server/community/evidence.mjs'

// Deploy this service once on a persistent host, independently of the local CLI PC.
// Does not create/provision a server or change Vercel/GitHub Pages deployments.
const path = process.env.COMMUNITY_DB
if (!path || !isAbsolute(path)) throw new Error('COMMUNITY_DB must be an absolute persistent file path.')
if (process.env.VERCEL) throw new Error('This persistent service must not run in a Vercel function.')
const host = process.env.COMMUNITY_HOST || '127.0.0.1'
const port = Number(process.env.COMMUNITY_PORT || 5180)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid COMMUNITY_PORT')
const key = process.env.COMMUNITY_TLS_KEY, cert = process.env.COMMUNITY_TLS_CERT
const tls = key && cert ? { key: readFileSync(key), cert: readFileSync(cert) } : null
const trustLoopbackProxy = process.env.COMMUNITY_TRUST_LOOPBACK_PROXY === '1'
if (!tls && (!trustLoopbackProxy || !['127.0.0.1','::1','localhost'].includes(host))) {
  throw new Error('Use TLS certificates or bind to loopback behind an explicitly trusted HTTPS reverse proxy.')
}
const handler = createPublicCommunityHandler({
  catalog: instruments.filter(x => x.chains.some(n => n > 0)), path, evidenceSource: createEvidenceSource(),
  origin: process.env.COMMUNITY_PUBLIC_ORIGIN,
  browserOrigins: (process.env.COMMUNITY_BROWSER_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean),
  workerToken: process.env.COMMUNITY_WORKER_TOKEN, trustLoopbackProxy,
  allowRegistration: process.env.COMMUNITY_OPEN_REGISTRATION === '1',
  allowAutoPublish: process.env.COMMUNITY_ALLOW_AUTO_PUBLISH === '1',
})
const server = tls ? httpsServer(tls, handler) : httpServer(handler)
server.requestTimeout = 15000; server.headersTimeout = 10000
server.maxHeadersCount = 32
server.on('error', error => { console.error(`Community API failed: ${error.code || 'server_error'}`); process.exitCode = 1 })
server.listen(port, host, () => console.log(`Community API listening on ${host}:${port}; invite-only=${process.env.COMMUNITY_OPEN_REGISTRATION !== '1'}`))
let stopping = false
function stop() {
  if (stopping) return; stopping = true
  server.close(() => { handler.close() }); server.closeAllConnections()
}
process.once('SIGTERM', stop); process.once('SIGINT', stop)
