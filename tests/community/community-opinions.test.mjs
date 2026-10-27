import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { CommunityStore } from '../../server/community/store.mjs'
import { createPublicCommunityHandler } from '../../server/community/public-http.mjs'

const catalog = [{ symbol: 'NVDA', name: '엔비디아' }, { symbol: '005930.KS', name: '삼성전자' }]
const start = Date.parse('2026-10-27T01:00:00Z')
const snapshot = symbol => ({ id: 'source-' + symbol, symbol, createdAt: new Date(start).toISOString(), dataAsOf: '2026-10-26T20:00:00.000Z', evidence: [{ id: 'price-' + symbol, symbol, kind: 'price', label: '종가', value: 100, unit: 'USD', observedAt: '2026-10-26T20:00:00.000Z', collectedAt: '2026-10-27T00:00:00.000Z', sourceUrl: 'https://example.com/fixture' }] })
const opinion = job => ({ action: 'publish', message_type: 'opinion', text: `${job.agent}의 관점에서는 기대와 불확실성이 함께 보여서, 확인한 자료만으로 단정하기보다 다음 변화를 지켜볼 만하다고 생각한다.`, reply_to: null, evidence_ids: ['price-' + job.symbol], previous_opinion_id: job.previousOpinionId })
const payload = (job, output = opinion(job)) => ({ jobId: job.id, leaseToken: job.lease, provider: job.agent, requestedModel: 'fixture-only', reportedModel: null, cliVersion: 'fixture-v4', generatedAt: '1999-01-01T00:00:00Z', output })
function setup(t, options = {}) {
  let time = start
  const store = new CommunityStore({ catalog, now: () => time, evidenceSource: snapshot, ...options })
  t.after(() => store.close())
  return { store, advance(ms = 1) { time += ms }, enable(...agents) { for (const agent of agents) store.configure({ agent, enabled: true }) } }
}
const batch = (store, agents = ['gpt'], symbols = ['NVDA']) => store.requestOpinions({ symbols, agents, requestId: randomUUID() })
const human = (store, extra = {}, actor = randomUUID()) => store.addHuman({ symbol: 'NVDA', body: '확인한 내용을 함께 이야기해 보자', allowAi: true, requestId: randomUUID(), ...extra }, actor)
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-chain-opinions-'))
  t.after(async () => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep)); await rm(dir, { recursive: true, force: true }) })
  return dir
}

test('opinion batches are idempotent, freeze one shared snapshot, and hide new peers from initial contexts', t => {
  const source = snapshot('NVDA'), { store, enable } = setup(t, { evidenceSource: () => source })
  source.evidence[0].privateConfig = 'must-not-reach-model-or-browser'
  enable('gpt', 'claude', 'gemini')
  const input = { symbols: ['NVDA'], agents: ['gpt', 'claude', 'gemini'], requestId: randomUUID() }
  const requested = store.requestOpinions(input)
  assert.deepEqual(store.requestOpinions(input), requested)
  assert.throws(() => store.requestOpinions({ ...input, agents: ['gpt'] }), /idempotency_conflict/)
  source.evidence[0].value = 999
  const first = store.claim(['gpt', 'claude', 'gemini']).job
  assert.equal(first.snapshot.evidence[0].value, 100)
  assert.equal(first.snapshot.evidence[0].privateConfig, undefined)
  store.finish(payload(first)); const published = store.approve(first.id)
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM community_jobs WHERE message_type!='opinion'").get().n, 0)
  const second = store.claim(['gpt', 'claude', 'gemini']).job
  assert.deepEqual(second.snapshot, first.snapshot)
  assert.ok(!second.context.some(row => row.id === published.id))
  store.finish(payload(second)); store.approve(second.id)
  const third = store.claim(['gpt', 'claude', 'gemini']).job
  store.finish(payload(third)); store.approve(third.id)
  const followup = store.claim(['gpt', 'claude', 'gemini']).job
  assert.equal(followup.messageType, 'reply')
  assert.equal(followup.interactionId, first.interactionId)
  assert.equal(followup.context.filter(row => row.messageType === 'opinion').length, 3)
})

test('opinions and normal comments share IDs while chatter cannot replace latest opinion', t => {
  const { store, enable } = setup(t); enable('gpt')
  batch(store); const job = store.claim(['gpt']).job
  const request = payload(job), receipt = store.finish(request), published = store.approve(job.id)
  const data = store.comments('NVDA')
  assert.equal(data.opinions.gpt.latest.id, published.id)
  assert.equal(data.comments.find(row => row.id === published.id).messageType, 'opinion')
  assert.equal(published.metadata.reportedModel, null)
  assert.equal(published.metadata.requestedModel, 'fixture-only')
  assert.equal(published.metadata.provider, 'gpt')
  assert.equal(published.metadata.generatedAt, new Date(start).toISOString())
  assert.equal(published.metadata.contextSnapshotId, job.snapshot.id)
  assert.equal(published.metadata.evidence.length, 1)
  assert.equal(published.metadata.evidence[0].sourceUrl, 'https://example.com/fixture')
  assert.deepEqual(store.finish(request), receipt)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM community_comments WHERE job_id=?').get(job.id).n, 1)
  human(store, { parent: published.id })
  const reply = store.claim(['gpt']).job
  store.finish(payload(reply, { action: 'publish', message_type: 'reply', text: '그 관점도 같이 지켜볼 만하지', reply_to: reply.parent }))
  store.approve(reply.id)
  assert.equal(store.comments('NVDA').opinions.gpt.latest.id, published.id)
  store.hide(published.id)
  assert.equal(store.comments('NVDA').opinions.gpt.latest, null)
  assert.equal(store.comments('NVDA').opinions.gpt.history.length, 0)
})

test('missing data and disabled agents produce real blocked states without model work', t => {
  const { store, enable } = setup(t, { evidenceSource: () => null }); enable('gpt')
  const request = batch(store, ['gpt', 'claude'])
  assert.equal(request.states.find(row => row.agent === 'gpt').reason, 'insufficient_evidence')
  assert.equal(request.states.find(row => row.agent === 'claude').reason, 'agent_disabled')
  assert.equal(store.claim(['gpt', 'claude']).job, null)
  assert.equal(store.admin().usage.agents.length, 0)
})

test('source, parent and own past opinion survive the recent-context limit; disallowed text never enters it', t => {
  const { store, enable, advance } = setup(t); enable('gpt')
  batch(store); let job = store.claim(['gpt']).job; store.finish(payload(job)); const past = store.approve(job.id)
  const source = human(store, { parent: past.id })
  const privateRow = human(store, { allowAi: false, body: '인간 전용 비공개가 아닌 공개 대화' })
  for (let i = 0; i < 25; i++) { advance(); human(store) }
  job = store.claim(['gpt']).job
  assert.equal(job.source, source.id); assert.equal(job.parent, source.id)
  assert.ok(job.context.some(row => row.id === source.id))
  assert.ok(job.context.some(row => row.id === past.id))
  assert.ok(!job.context.some(row => row.id === privateRow.id))
  assert.equal(job.previousOpinionId, past.id)
})

test('new opinion version cancels in-flight older versions and late stop/hide cannot publish', t => {
  const { store, enable } = setup(t); enable('gpt')
  batch(store); const older = store.claim(['gpt']).job
  batch(store)
  assert.throws(() => store.finish(payload(older)), /stale_lease/)
  const latest = store.claim(['gpt']).job
  store.finish(payload(latest)); store.configure({ paused: true }); store.configure({ paused: false })
  assert.throws(() => store.approve(latest.id), /not_awaiting_approval/)
  human(store); const reply = store.claim(['gpt']).job
  store.hide(reply.source)
  assert.throws(() => store.finish(payload(reply, { action: 'skip', reason: '원문 없음' })), /stale_lease/)
})

test('initial opinions are separate from four followups and per-agent followup caps', t => {
  const { store, enable } = setup(t); enable('gpt', 'claude', 'gemini')
  batch(store, ['gpt', 'claude', 'gemini'])
  for (let i = 0; i < 3; i++) { const job = store.claim(['gpt', 'claude', 'gemini']).job; store.finish(payload(job)); store.approve(job.id) }
  let count = 0, previous = null
  for (;;) {
    const job = store.claim(['gpt', 'claude', 'gemini']).job
    if (!job) break
    assert.notEqual(job.agent, previous); previous = job.agent
    store.finish(payload(job, { action: 'publish', message_type: 'reply', text: ['그 관점도 생각할 거리가 있네', '조금 더 자료를 보고 이야기하자', '다른 해석도 가능하다고 생각해', '이 정도면 여기서 지켜보자'][count], reply_to: job.parent }))
    store.approve(job.id); count++
    assert.ok(count <= 4)
  }
  assert.equal(count, 4)
  assert.equal(store.comments('NVDA').comments.filter(row => row.messageType === 'opinion').length, 3)
  for (const row of store.db.prepare("SELECT agent,COUNT(*) AS n FROM community_jobs WHERE message_type!='opinion' GROUP BY agent").all()) assert.ok(row.n <= 2)
})

test('user+symbol and symbol attempt limits persist independently of model daily limits', t => {
  const { store, enable } = setup(t); enable('gpt')
  store.configure({ userSymbolDailyAttempts: 1, symbolDailyAttempts: 2 })
  human(store, {}, 'member-one'); let job = store.claim(['gpt']).job; store.finish(payload(job, { action: 'skip', reason: '충분한 이야기' }))
  human(store, {}, 'member-one'); assert.equal(store.claim(['gpt']).job, null)
  assert.ok(store.admin().jobs.some(row => row.reason === 'user_symbol_daily_limit'))
  human(store, {}, 'member-two'); job = store.claim(['gpt']).job; store.fail({ id: job.id, lease: job.lease, code: 'cli_failed' })
  human(store, {}, 'member-three'); assert.equal(store.claim(['gpt']).job, null)
  const admin = store.admin()
  assert.ok(admin.jobs.some(row => row.reason === 'symbol_daily_limit'))
  assert.equal(admin.usage.agents.find(row => row.agent === 'gpt').attempts, 2)
  assert.equal(admin.metrics.generationFailureRate, 0.5)
  assert.equal(admin.metrics.generationAttempts.unknown, 0)
  assert.equal(admin.metrics.generationAttempts.running, 0)
  assert.equal(admin.metrics.reportReasons, null)
})

test('evidence requiring human review never auto-publishes and actual model mismatches are rejected', t => {
  const { store, enable } = setup(t); enable('gpt'); store.configure({ mode: 'auto' })
  batch(store); const job = store.claim(['gpt']).job
  assert.throws(() => store.finish({ ...payload(job), provider: 'claude' }), /provider_mismatch/)
  assert.throws(() => store.finish({ ...payload(job), reportedModel: 'different-model' }), /reported_model_mismatch/)
  const output = { ...opinion(job), text: '2026-10-26 관측 종가 100 USD를 기준으로 보면 기대와 불확실성이 함께 있어 더 살펴볼 필요가 있다.' }
  assert.equal(store.finish(payload(job, output)).state, 'awaiting_approval')
  assert.equal(store.comments('NVDA').comments.length, 0)
  store.approve(job.id)
  assert.equal(store.comments('NVDA').opinions.gpt.latest.messageType, 'opinion')
})

test('queued human reply bursts cannot publish past interaction limits or revive cancelled work', t => {
  const { store, enable } = setup(t); enable('gpt', 'claude', 'gemini')
  const root = human(store)
  for (let i = 0; i < 5; i++) human(store, { parent: root.id })
  let count = 0
  for (;;) {
    const job = store.claim(['gpt', 'claude', 'gemini']).job
    if (!job) break
    store.finish(payload(job, { action: 'publish', text: ['그 관점은 생각할 거리가 있네', '조금 더 자료를 보고 이야기하자', '다른 해석도 가능하다고 생각해', '이 정도면 여기서 지켜보자'][count] }))
    store.approve(job.id); count++
    assert.ok(count <= 4)
  }
  assert.equal(count, 4)
  assert.ok(store.admin().jobs.some(job => ['followup_limit', 'agent_interaction_limit'].includes(job.reason)))
})

test('hiding a frozen context message invalidates initial drafts before publication', t => {
  const { store, enable } = setup(t)
  const prior = human(store)
  enable('gpt'); batch(store)
  const job = store.claim(['gpt']).job
  assert.ok(job.context.some(row => row.id === prior.id))
  store.finish(payload(job)); store.hide(prior.id)
  assert.throws(() => store.approve(job.id), /not_awaiting_approval/)
  assert.equal(store.comments('NVDA').opinions.gpt.latest, null)
})

test('attempt limits and stable finish receipts survive a process restart', async t => {
  const dir = await directory(t), path = join(dir, 'persistent.sqlite')
  let store = new CommunityStore({ catalog, path, now: () => start, evidenceSource: snapshot })
  store.configure({ agent: 'gpt', enabled: true, userSymbolDailyAttempts: 1 })
  human(store, {}, 'same-member')
  const job = store.claim(['gpt']).job, sent = payload(job, { action: 'skip', reason: '추가 답변 불필요' })
  const receipt = store.finish(sent); store.close()
  store = new CommunityStore({ catalog, path, now: () => start, evidenceSource: snapshot })
  try {
    assert.deepEqual(store.finish(sent), receipt)
    human(store, {}, 'same-member')
    assert.equal(store.claim(['gpt']).job, null)
    assert.equal(store.admin().usage.agents[0].attempts, 1)
    assert.ok(store.admin().jobs.some(row => row.reason === 'user_symbol_daily_limit'))
  } finally { store.close() }
})

test('an expired partial opinion batch cannot create fresh followups on reconnect', t => {
  const { store, enable, advance } = setup(t); enable('gpt', 'claude')
  batch(store, ['gpt', 'claude'])
  const first = store.claim(['gpt']).job; store.finish(payload(first)); store.approve(first.id)
  advance(86400001)
  assert.equal(store.claim(['gpt', 'claude']).job, null)
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM community_jobs WHERE message_type!='opinion'").get().n, 0)
})

test('duplicate auto-publish rejection returns a stable receipt and records measured rejection', t => {
  const { store, enable } = setup(t); enable('gpt')
  batch(store); let job = store.claim(['gpt']).job; store.finish(payload(job)); store.approve(job.id)
  store.configure({ mode: 'auto' }); batch(store); job = store.claim(['gpt']).job
  const sent = payload(job), result = store.finish(sent)
  assert.equal(result.state, 'awaiting_approval'); assert.equal(result.reason, 'duplicate_comment')
  assert.deepEqual(store.finish(sent), result)
  assert.equal(store.admin().metrics.duplicateRejections, 1)
})

test('migration creates a consistent pre-change backup and preserves legacy messages; restart disables auto', async t => {
  const dir = await directory(t), path = join(dir, 'legacy.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`PRAGMA journal_mode=WAL; CREATE TABLE community_comments (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,symbol TEXT NOT NULL,parent TEXT,kind TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,allow_ai INTEGER NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,interaction TEXT NOT NULL,depth INTEGER NOT NULL,job_id TEXT UNIQUE); INSERT INTO community_comments(id,symbol,kind,author,body,allow_ai,created,interaction,depth) VALUES('legacy','NVDA','human','prior','보존할 원문',1,1,'prior-event',0);`)
  // Keep WAL open during backup to verify committed WAL contents are included.
  let store = new CommunityStore({ catalog, path, evidenceSource: snapshot })
  assert.ok(store.migrationBackup)
  const backup = new DatabaseSync(store.migrationBackup, { readOnly: true })
  assert.equal(backup.prepare('SELECT body FROM community_comments').get().body, '보존할 원문'); backup.close(); legacy.close()
  assert.equal(store.comments('NVDA').comments[0].text, '보존할 원문')
  store.configure({ mode: 'auto', agent: 'gpt', enabled: true }); batch(store)
  store.close(); store = new CommunityStore({ catalog, path, evidenceSource: snapshot })
  try { assert.equal(store.settings().mode, 'review_only'); assert.equal(store.migrationBackup, null); assert.ok(store.claim(['gpt']).job) } finally { store.close() }
})

test('HTTP opinion request is admin-only, supports injected evidence, and page reads never enqueue', async t => {
  const origin = 'https://api.example.test', workerToken = 'fixture-worker-token-'.repeat(3)
  const handler = createPublicCommunityHandler({ catalog, origin, workerToken, evidenceSource: snapshot })
  t.after(() => handler.close())
  handler.store.configure({ agent: 'gpt', enabled: true })
  await handler.auth.create({ name: 'opinion_operator', password: 'fixture-password-only' }, { bootstrap: true, role: 'admin' })
  const token = (await handler.auth.login({ name: 'opinion_operator', password: 'fixture-password-only' })).token
  async function call(route, input, bearer) {
    const req = Readable.from(input ? [Buffer.from(JSON.stringify(input))] : [])
    Object.assign(req, { url: '/api/community' + route, method: input ? 'POST' : 'GET', socket: { encrypted: true, remoteAddress: '127.0.0.1' }, headers: { host: 'api.example.test', ...(input ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) } })
    const res = { headers: {}, setHeader(key,value) { this.headers[key] = value }, writeHead(status,headers) { this.status = status; Object.assign(this.headers, headers) }, end(value) { this.body = value ? JSON.parse(value) : null } }
    await handler(req,res); return res
  }
  const input = { symbols: ['NVDA'], agents: ['gpt'], requestId: randomUUID() }
  assert.equal((await call('/admin/opinions', input)).status, 401)
  const result = await call('/admin/opinions', input, token)
  assert.equal(result.status, 200); assert.equal(result.body.jobIds.length, 1)
  assert.deepEqual((await call('/admin/opinions', input, token)).body, result.body)
  const before = handler.store.db.prepare('SELECT COUNT(*) AS n FROM community_jobs').get().n
  const read = await call('/comments?symbol=NVDA')
  assert.ok(read.body.opinions.gpt)
  assert.equal(handler.store.db.prepare('SELECT COUNT(*) AS n FROM community_jobs').get().n, before)
})
