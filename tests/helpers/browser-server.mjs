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
const handler = createPublicCommunityHandler({ catalog: instruments.filter(x => x.chains.some(n => n > 0)), origin: apiOrigin, browserOrigins: [siteOrigin], workerToken: 'test-only-not-a-real-worker-token-'.repeat(2),
  evidenceSource: symbol => {
    const observedAt = new Date(Date.now() - 60000).toISOString()
    return { symbol, dataAsOf: observedAt, evidence: [
      { id: 'fixture-price-' + symbol, symbol, kind: 'price', label: '브라우저 검증 전용 가격', value: 100, unit: 'USD', observedAt, collectedAt: observedAt, sourceUrl: 'https://example.com/browser-fixture' },
      { id: 'fixture-title-' + symbol, symbol, kind: 'disclosure-title', label: '브라우저 검증 전용 공시 제목', value: '테스트용 공시 제목', unit: '제목', observedAt, collectedAt: observedAt, sourceUrl: 'https://example.com/browser-fixture', titleOnly: true, stale: true },
    ] }
  },
})
backend.on('request', handler)
const member = await handler.auth.create({ name: 'browser_member', password: 'fixture-only-password-123' }, { bootstrap: true })
await handler.auth.create({ name: 'browser_operator', password: 'fixture-only-password-456' }, { bootstrap: true, role: 'admin' })
handler.store.configure({ agent: 'gpt', enabled: true })
handler.store.addHuman({ symbol: 'NVDA', body: '브라우저 검증용 원문입니다.', allowAi: true, requestId: randomUUID() }, `member:${member.id}`)
const job = handler.store.claim(['gpt']).job
handler.store.finish({ id: job.id, lease: job.lease, output: { action: 'reply', text: '화면 검증용 AI 댓글입니다.' }, model: 'fixture-not-real-ai', cliVersion: 'fixture-only' })
handler.store.approve(job.id)
// These schema-valid opinions are deterministic fixtures, never actual model output.
const agentNames = { gpt: 'GPT', claude: 'Claude', gemini: 'Gemini' }
for (const agent of Object.keys(agentNames)) handler.store.configure({ agent, enabled: true })
function publishOpinions(version) {
  handler.store.requestOpinions({ symbols: ['NVDA'], agents: Object.keys(agentNames), requestId: randomUUID() })
  const messages = {}
  for (const agent of Object.keys(agentNames)) {
    const pending = handler.store.claim([agent]).job
    if (!pending || pending.messageType !== 'opinion') throw new Error('Expected an opinion fixture job')
    handler.store.finish({ id: pending.id, lease: pending.lease, provider: agent, requestedModel: 'fixture-not-real-ai', reportedModel: null, cliVersion: 'fixture-only',
      output: { action: 'publish', message_type: 'opinion', text: `${agentNames[agent]}의 ${version} 브라우저 검증 의견입니다. 실제 모델이 작성한 내용이 아니며, 자료의 기준을 먼저 확인하자는 테스트용 문장입니다.`, reply_to: pending.parent || null, evidence_ids: pending.snapshot.evidence.map(item => item.id), previous_opinion_id: pending.previousOpinionId || null } })
    messages[agent] = handler.store.approve(pending.id)
  }
  // End fixture follow-ups so later UI requests test their own queued jobs.
  handler.store.configure({ paused: true }); handler.store.configure({ paused: false })
  return messages
}
const previousOpinions = publishOpinions('이전'), latestOpinions = publishOpinions('최신')
handler.store.requestOpinions({ symbols: ['NVDA'], agents: ['claude'], requestId: randomUUID() })
const failed = handler.store.claim(['claude']).job
handler.store.fail({ id: failed.id, lease: failed.lease, code: 'fixture_cli_unavailable', retryable: false })
handler.store.configure({ agent: 'gemini', enabled: false })
const root = await build(undefined, { communityOrigin: apiOrigin })
const staticServer = createSiteServer({ root })
site.on('request', staticServer.listeners('request')[0])
console.log(JSON.stringify({ siteOrigin, apiOrigin, fixture: { previousOpinions, latestOpinions } }))
let stopped = false
function stop() {
  if (stopped) return; stopped = true
  site.close(); backend.close(); site.closeAllConnections(); backend.closeAllConnections()
  handler.close()
}
process.once('SIGTERM', stop); process.once('SIGINT', stop)
