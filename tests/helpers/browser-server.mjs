// Isolated browser test fixture. Never deploy or use with production data/credentials.
import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { instruments } from '../../assets/instruments.js'
import { createPublicCommunityHandler } from '../../server/community/public-http.mjs'
import { createSiteServer } from '../../scripts/serve.mjs'
import { build } from '../../scripts/build.mjs'
if (process.env.COMMUNITY_BROWSER_FIXTURE !== '1') throw new Error('Test fixture is disabled')
const tls = { key: readFileSync(process.env.SMOKE_TLS_KEY), cert: readFileSync(process.env.SMOKE_TLS_CERT) }
const site = createServer(tls), backend = createServer(tls)
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve))
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
const siteOrigin = `https://localhost:${site.address().port}`, apiOrigin = `https://localhost:${backend.address().port}`
const handler = createPublicCommunityHandler({ catalog: instruments.filter(x => x.chains.some(n => n > 0)), origin: apiOrigin, browserOrigins: [siteOrigin], workerToken: 'test-only-not-a-real-worker-token-'.repeat(2) })
backend.on('request', handler)
const member = await handler.auth.create({ name: 'browser_member', password: 'fixture-only-password-123' }, { bootstrap: true })
await handler.auth.create({ name: 'browser_operator', password: 'fixture-only-password-456' }, { bootstrap: true, role: 'admin' })
handler.store.configure({ agent: 'gpt', enabled: true })
handler.store.addHuman({ symbol: 'NVDA', body: '브라우저 검증용 원문입니다.', allowAi: true, requestId: randomUUID() }, `member:${member.id}`)
const job = handler.store.claim(['gpt']).job
handler.store.finish({ id: job.id, lease: job.lease, output: { action: 'reply', text: '화면 검증용 AI 댓글입니다.' }, model: 'fixture-not-real-ai', cliVersion: 'fixture-only' })
handler.store.approve(job.id)
const root = await build(undefined, { communityOrigin: apiOrigin })
const staticServer = createSiteServer({ root })
site.on('request', staticServer.listeners('request')[0])
console.log(JSON.stringify({ siteOrigin, apiOrigin }))
let stopped = false
function stop() {
  if (stopped) return; stopped = true
  site.close(); backend.close(); site.closeAllConnections(); backend.closeAllConnections()
  handler.close()
}
process.once('SIGTERM', stop); process.once('SIGINT', stop)
