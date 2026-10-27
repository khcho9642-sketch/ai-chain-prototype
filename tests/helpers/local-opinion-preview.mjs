// Disposable in-memory UI preview. Never reads a user DB, logs into a provider or calls AI.
import { instruments } from '../../assets/instruments.js'
import { createCommunityHandler } from '../../server/community/http.mjs'
import { createSiteServer } from '../../scripts/serve.mjs'
import { build } from '../../scripts/build.mjs'

if (process.env.COMMUNITY_BROWSER_FIXTURE !== '1') throw new Error('Test fixture is disabled')
const adminToken = 'fixture-local-admin-token-not-a-real-secret'
const community = createCommunityHandler({ catalog: instruments.filter(row => row.chains.some(n => n > 0)),
  adminToken, workerToken: 'fixture-local-worker-token-not-a-real-secret',
  evidenceSource: symbol => ({ symbol, dataAsOf: '2026-10-26T20:00:00Z', evidence: [{
    id: `fixture-${symbol}`, symbol, kind: 'quote', label: '검증용 가상 자료', value: 1, unit: 'USD',
    observedAt: '2026-10-26T20:00:00Z', collectedAt: '2026-10-27T00:00:00Z', sourceUrl: 'https://example.com/fixture',
  }] }) })
const store = community.store
store.configure({ maxFollowups: 0 })
for (const agent of ['gpt', 'claude', 'gemini']) store.configure({ agent, enabled: true })
for (const [round, phrase] of [['initial', '처음 판단을 남기는'], ['updated', '새 자료를 보고 생각을 바꾸는']]) {
  store.requestOpinions({ symbols: ['NVDA'], agents: ['gpt', 'claude', 'gemini'], requestId: `preview-${round}-opinion-request` })
  for (let index = 0; index < 3; index++) {
    const { job } = store.claim(['gpt', 'claude', 'gemini'])
    if (!job) throw new Error('Preview opinion job was not created')
    store.finish({ jobId: job.id, leaseToken: job.lease, provider: job.agent, requestedModel: 'fixture-not-real-ai', reportedModel: null, cliVersion: 'fixture-only',
      output: { action: 'publish', message_type: 'opinion', text: `화면 검증용 가상 의견입니다. ${phrase} 흐름과 실제 자료의 기준 시각을 구분해 보여줍니다.`,
        reply_to: null, evidence_ids: [job.snapshot.evidence[0].id], previous_opinion_id: job.previousOpinionId } })
    store.approve(job.id)
  }
}
store.addHuman({ symbol: 'NVDA', body: '인간 탭에서는 AI가 참여하지 않는지 확인하는 검증용 댓글입니다.', allowAi: false, requestId: 'preview-human-comment-request' }, 'fixture-member')
const server = createSiteServer({ root: await build(), community })
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ siteOrigin: `http://127.0.0.1:${server.address().port}`, mode: 'fixture-only-in-memory' })))
function stop() { server.close(); server.closeAllConnections(); community.close() }
process.once('SIGTERM', stop); process.once('SIGINT', stop)
