import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { dailyCandidatePool, generateTodayPicks, publishTodayCandidate, sealTodayCandidate, stageTodayCandidate } from '../../scripts/community/today-picks.mjs'
import { requiredProviderFlags } from '../../scripts/community/ai-provider.mjs'

const NOW = Date.parse('2026-10-27T15:30:00Z')
const catalog = [{ symbol: 'NVDA', name: '엔비디아', chains: [4] }, { symbol: 'AMD', name: 'AMD', chains: [4] }, { symbol: 'INDEX', name: '시장지표', chains: [0] }]
const observedAt = '2026-10-27T14:00:00.000Z', collectedAt = '2026-10-27T15:00:00.000Z'
const source = symbol => ({ id: `ctx-${symbol}`, symbol, createdAt: collectedAt, dataAsOf: observedAt, evidence: [
  { id: `price-${symbol}`, symbol, kind: 'quote', label: '관측 자료', value: 100, unit: 'USD', observedAt, collectedAt, sourceUrl: `https://finance.yahoo.com/quote/${symbol}/`, stale: false },
] })
const bridge = fileURLToPath(new URL('../../scripts/community/ai-provider.mjs', import.meta.url))
const config = (agent = 'gpt', overrides = {}) => ({ enabled: true, dailyPicksApproved: true, termsApproved: true, isolationApproved: true,
  provider: agent, executable: process.execPath, args: [bridge, process.execPath], model: agent === 'gpt' ? 'gpt-6' : agent === 'claude' ? 'claude-sonnet-4-6' : 'gemini-3-pro', cliVersion: '2.0.0', runnerHome: tmpdir(), ...overrides })
const response = (agent, adapter, job) => ({ provider: agent, requestedModel: adapter.model, reportedModel: null, cliVersion: adapter.cliVersion,
  technical: { actualVersion: adapter.cliVersion, supportedFlags: requiredProviderFlags(agent) },
  output: { action: 'publish', symbol: job.candidates[0].symbol, message_type: 'opinion', text: '제공된 자료에서 눈여겨볼 부분이 있지만 아직 단정할 수는 없겠네. 다음 자료도 함께 살펴보자.',
    reply_to: null, previous_opinion_id: null, evidence_ids: [job.candidates[0].snapshot.evidence[0].id] } })
const peerResponse = (agent, adapter, job) => ({ provider: agent, requestedModel: adapter.model, reportedModel: null, cliVersion: adapter.cliVersion,
  technical: { actualVersion: adapter.cliVersion, supportedFlags: requiredProviderFlags(agent) },
  output: { action: 'reply', message_type: 'reply', text: '관측 자료의 범위에는 동의해. 다만 다음 공시와 사업 여건도 같이 확인해야겠네.',
    reply_to: job.parent, evidence_ids: [job.snapshot.evidence[0].id], previous_opinion_id: null, referenced_message_ids: [job.parent] } })
const allAdapters = () => Object.fromEntries(['gpt', 'claude', 'gemini'].map(agent => [agent, config(agent)]))
const messageDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const empty = () => ({ schemaVersion: 1, timezone: 'Asia/Seoul', editionDate: null, publishedAt: null, picks: [], providerStates: Object.fromEntries(['gpt', 'claude', 'gemini'].map(agent => [agent, { status: 'disabled', reason: 'provider_disabled' }])) })
async function directory(t) {
  const base = resolve(tmpdir()), root = resolve(await mkdtemp(join(base, 'today-cli-')))
  assert.ok(root.startsWith(base + sep))
  await mkdir(join(root, 'data'))
  await writeFile(join(root, 'data', 'today-picks.json'), JSON.stringify(empty()) + '\n')
  t.after(async () => { assert.ok(root.startsWith(base + sep)); await rm(root, { recursive: true, force: true }) })
  return root
}
async function simulatedCandidate(agents = ['gpt']) {
  return generateTodayPicks({ adapters: Object.fromEntries(agents.map(agent => [agent, config(agent)])), catalog, evidenceSource: source, now: () => NOW, run: async (...args) => response(...args) })
}
async function reviewedReceiptCandidate(agents = ['gpt']) {
  // Synthetic local schema records only; no real model is called or public repo data written.
  const candidate = await simulatedCandidate(agents)
  for (const receipt of Object.values(candidate.receipts)) receipt.fixture = false
  return sealTodayCandidate(candidate)
}
async function peerCandidate({ reviewed = false, run, ...options } = {}) {
  const candidate = await generateTodayPicks({ adapters: allAdapters(), catalog, evidenceSource: source, now: () => NOW,
    includeResponses: true, run: run || (async (agent, adapter, job) => job.messageType === 'reply' ? peerResponse(agent, adapter, job) : response(agent, adapter, job)), ...options })
  if (reviewed) for (const receipt of [...Object.values(candidate.receipts), ...Object.values(candidate.responseReceipts)]) receipt.fixture = false
  return sealTodayCandidate(candidate)
}

test('disabled, unreviewed and wrong-purpose adapters cannot invoke any model', async () => {
  let calls = 0
  const run = async () => { calls++; assert.fail('model must stay disabled') }
  for (const adapters of [{}, { gpt: config('gpt', { enabled: false }) }, { gpt: config('gpt', { termsApproved: false }) }, { gpt: config('gpt', { isolationApproved: false }) }, { gpt: config('gpt', { dailyPicksApproved: false }) },
    { gpt: config('gpt', { executable: bridge }) }, { gpt: config('gpt', { args: [bridge, 'relative-cli.exe'] }) }, { gpt: config('gpt', { args: [bridge, process.execPath, bridge, process.execPath] }) }]) {
    const candidate = await generateTodayPicks({ adapters, catalog, evidenceSource: source, now: () => NOW, run })
    assert.equal(candidate.picks.length, 0)
    assert.equal(candidate.attempted, 0)
  }
  assert.equal(calls, 0)
})

test('known CLI failures remain diagnostic while raw exception text stays private', async () => {
  for (const [message, expected] of [['unsupported_cli_flag', 'unsupported_cli_flag'], ['cli_version_not_verified', 'cli_version_not_verified'], ['login https://private.invalid/?token=secret', 'generation_failed']]) {
    const candidate = await generateTodayPicks({ adapters: { gpt: config() }, catalog, evidenceSource: source, now: () => NOW,
      run: async () => { throw new Error(message) } })
    assert.equal(candidate.picks.length, 0)
    assert.equal(candidate.providerStates.gpt.reason, expected)
    assert.equal(JSON.stringify(candidate).includes('token=secret'), false)
  }
})

test('disabled model reasons preserve only known status codes without invoking a model', async () => {
  for (const reason of ['usage_review_required', 'terms_not_cleared', 'authentication_required', 'cli_unavailable', 'isolation_unverified', 'provider_disabled', 'login https://private.invalid/?token=secret']) {
    const candidate = await generateTodayPicks({ adapters: { claude: { enabled: false, disabledReason: reason } }, catalog, evidenceSource: source, now: NOW,
      includeResponses: true, run: async () => assert.fail('disabled model called') })
    assert.equal(candidate.attempted, 0)
    assert.equal(candidate.providerStates.claude.status, 'disabled')
    assert.equal(candidate.providerStates.claude.reason, reason.startsWith('login ') ? 'provider_disabled' : reason)
    assert.equal(JSON.stringify(candidate).includes('token=secret'), false)
    assert.deepEqual(candidate.responses, [])
  }
})

test('all agents receive the same bounded evidence pool and each can emit only one selected symbol', async () => {
  const pools = [], adapters = Object.fromEntries(['gpt', 'claude', 'gemini'].map(agent => [agent, config(agent)]))
  const candidate = await generateTodayPicks({ adapters, catalog, evidenceSource: source, now: () => NOW, run: async (agent, adapter, job) => { pools.push(JSON.stringify(job.candidates)); return response(agent, adapter, job) } })
  assert.equal(candidate.picks.length, 3)
  assert.equal(candidate.attempted, 3)
  assert.equal(new Set(pools).size, 1)
  assert.equal(candidate.editionDate, '2026-10-28')
  assert.equal(candidate.picks.every(pick => pick.symbol === 'AMD'), true)
  assert.equal(candidate.picks.every(pick => pick.provenance.reportedModel === null), true)
  assert.equal(candidate.picks.every(pick => pick.dataAsOf === observedAt), true)
  assert.equal(Object.values(candidate.receipts).every(receipt => receipt.fixture), true)
})

test('a model may skip and a mismatched provider or unsupported CLI cannot impersonate it', async () => {
  const candidate = await generateTodayPicks({ adapters: { gpt: config(), claude: config('claude'), gemini: config('gemini') }, catalog, evidenceSource: source, now: () => NOW,
    run: async (agent, adapter, job) => agent === 'gpt' ? { ...response(agent, adapter, job), output: { action: 'skip', reason: '자료만으로 선정하기 어렵다.' } } : agent === 'claude' ? { ...response(agent, adapter, job), provider: 'gpt' } : { ...response(agent, adapter, job), technical: null } })
  assert.equal(candidate.attempted, 3)
  assert.equal(candidate.picks.length, 0)
  assert.equal(candidate.providerStates.gpt.reason, 'model_skipped')
  assert.equal(candidate.providerStates.claude.reason, 'provenance_mismatch')
  assert.equal(candidate.providerStates.gemini.reason, 'cli_not_verified')
})

test('stale or missing evidence prevents generation and bounded coverage is explicit', async () => {
  let calls = 0
  const candidate = await generateTodayPicks({ adapters: { gpt: config() }, catalog, evidenceSource: symbol => ({ ...source(symbol), evidence: source(symbol).evidence.map(item => ({ ...item, stale: true })) }), now: () => NOW, run: async () => { calls++ } })
  assert.equal(calls, 0)
  assert.equal(candidate.providerStates.gpt.reason, 'insufficient_fresh_evidence')
  const pool = dailyCandidatePool({ catalog, evidenceSource: source, now: NOW, maxBytes: 10 })
  assert.equal(pool.candidates.length, 0)
  assert.equal(pool.eligibleCount, 2)
  assert.equal(pool.omittedForSize, 2)
})

test('responses are opt-in and bounded to one other verified agent per parent and responding agent', async () => {
  const defaultCandidate = await generateTodayPicks({ adapters: allAdapters(), catalog, evidenceSource: source, now: NOW, run: async (...args) => response(...args) })
  assert.equal(defaultCandidate.attempted, 3)
  assert.deepEqual(defaultCandidate.responses, [])
  const calls = []
  const candidate = await peerCandidate({ run: async (agent, adapter, job) => {
    calls.push({ agent, job: JSON.parse(JSON.stringify(job)) })
    if (job.messageType === 'reply') return peerResponse(agent, adapter, job)
    const selected = job.candidates.find(row => row.symbol === (agent === 'claude' ? 'NVDA' : 'AMD'))
    return { ...response(agent, adapter, job), output: { ...response(agent, adapter, job).output, symbol: selected.symbol, evidence_ids: [selected.snapshot.evidence[0].id] } }
  } })
  assert.equal(candidate.schemaVersion, 2)
  assert.equal(candidate.attempted, 6)
  assert.equal(candidate.responses.length, 3)
  assert.equal(new Set(candidate.responses.map(row => row.parentId)).size, 3)
  assert.equal(new Set(candidate.responses.map(row => row.agent)).size, 3)
  const replyCalls = calls.filter(row => row.job.messageType === 'reply')
  assert.equal(replyCalls.length, 3)
  for (const { agent, job } of replyCalls) {
    const parent = candidate.picks.find(pick => pick.id === job.parent)
    assert.notEqual(parent.agent, agent)
    assert.equal(job.symbol, parent.symbol)
    assert.equal(job.snapshot.symbol, parent.symbol)
    assert.equal(job.snapshot.evidence.every(row => row.symbol === parent.symbol), true)
    assert.deepEqual(job.context.map(row => row.id), [parent.id])
    assert.equal(job.context[0].text, parent.comment)
    assert.equal(candidate.responses.some(row => row.id === job.parent), false)
    const published = candidate.responses.find(row => row.parentId === parent.id)
    assert.equal(published.symbol, parent.symbol)
    assert.equal(candidate.responseReceipts[published.id].fixture, true)
  }
})

test('a peer may agree or skip and the attempt never fans out to substitute or recursive replies', async () => {
  const calls = []
  const candidate = await peerCandidate({ run: async (agent, adapter, job) => {
    calls.push({ agent, parent: job.parent })
    if (job.messageType !== 'reply') return response(agent, adapter, job)
    return agent === 'claude' ? { ...peerResponse(agent, adapter, job), output: { action: 'skip', reason: '추가할 의견 없음' } } : peerResponse(agent, adapter, job)
  } })
  assert.equal(candidate.attempted, 6)
  assert.equal(candidate.responses.length, 2)
  const parent = candidate.picks.find(row => row.agent === 'gpt')
  assert.deepEqual(candidate.responseStates[parent.id], { agent: 'claude', status: 'unavailable', reason: 'model_skipped' })
  assert.equal(calls.filter(row => row.parent === parent.id).length, 1)
  assert.equal(candidate.responses.every(row => row.comment.startsWith('관측 자료의 범위에는 동의해.')), true)
})

test('disabled or technically unverified peers cannot respond under another model name', async () => {
  const calls = []
  const candidate = await peerCandidate({ adapters: { gpt: config(), claude: { enabled: false, disabledReason: 'terms_not_cleared' }, gemini: config('gemini') },
    run: async (agent, adapter, job) => { calls.push(agent); return agent === 'gemini' ? { ...response(agent, adapter, job), technical: null } : response(agent, adapter, job) } })
  assert.deepEqual(calls, ['gpt', 'gemini'])
  assert.equal(candidate.responses.length, 0)
  assert.equal(candidate.picks.length, 1)
  assert.equal(candidate.providerStates.claude.reason, 'terms_not_cleared')
  assert.equal(candidate.responseStates[candidate.picks[0].id].reason, 'insufficient_verified_peers')
})

test('peer output rejects foreign parents, cross-stock evidence and missing actual evidence', async () => {
  const invalid = [
    { reply_to: 'another-parent' }, { evidence_ids: ['price-another-stock'] }, { symbol: 'ANOTHER' }, { evidence_ids: [] },
  ]
  for (const change of invalid) {
    const candidate = await peerCandidate({ run: async (agent, adapter, job) => job.messageType === 'reply'
      ? { ...peerResponse(agent, adapter, job), output: { ...peerResponse(agent, adapter, job).output, ...change } }
      : response(agent, adapter, job) })
    assert.equal(candidate.attempted, 6)
    assert.equal(candidate.responses.length, 0)
    assert.equal(Object.values(candidate.responseStates).every(state => state.status === 'blocked'), true)
  }
})

test('a KST edition change discards a late peer result and prevents remaining calls', async () => {
  let at = NOW
  const candidate = await peerCandidate({ now: () => at, run: async (agent, adapter, job) => {
    if (job.messageType === 'reply') { at += 86400000; return peerResponse(agent, adapter, job) }
    return response(agent, adapter, job)
  } })
  assert.equal(candidate.attempted, 4)
  assert.equal(candidate.responses.length, 0)
  assert.equal(Object.values(candidate.responseStates).every(state => state.reason === 'edition_changed_during_generation'), true)
})

test('manual approval, same-day generation and non-fixture execution receipts are mandatory', async t => {
  const root = await directory(t), candidate = await simulatedCandidate(), path = await stageTodayCandidate(candidate, { root })
  await assert.rejects(publishTodayCandidate(path, { root, catalog, now: NOW }), /manual_approval_required/)
  await assert.rejects(publishTodayCandidate(path, { root, catalog, now: NOW, approve: true }), /unverified_execution_receipt/)
  const reviewed = await stageTodayCandidate(await reviewedReceiptCandidate(), { root })
  await assert.rejects(publishTodayCandidate(reviewed, { root, catalog, now: NOW + 86400000, approve: true }), /candidate_not_current_edition/)
  assert.equal(JSON.parse(await readFile(join(root, 'data', 'today-picks.json'), 'utf8')).picks.length, 0)
})

test('publication backs up the previous bytes and atomically writes only reviewed public fields', async t => {
  const root = await directory(t), previous = await readFile(join(root, 'data', 'today-picks.json'))
  const candidate = await stageTodayCandidate(await reviewedReceiptCandidate(), { root })
  const result = await publishTodayCandidate(candidate, { root, catalog, now: NOW, approve: true })
  assert.deepEqual(await readFile(result.backupPath), previous)
  const published = JSON.parse(await readFile(result.path, 'utf8'))
  assert.equal(published.picks.length, 1)
  assert.equal(published.picks[0].provenance.reviewedAt, new Date(NOW).toISOString())
  assert.equal(published.picks[0].provenance.reportedModel, null)
  assert.deepEqual(published.picks[0].businessProfile, JSON.parse(await readFile(candidate, 'utf8')).picks[0].businessProfile)
  assert.equal(Object.hasOwn(published, 'receipts'), false)
  assert.equal(Object.hasOwn(published, 'checksum'), false)
  assert.equal(Object.hasOwn(published, 'candidateCount'), false)
  assert.equal((await readdir(join(root, 'data'))).some(name => name.endsWith('.tmp')), false)
})

test('peer publication requires non-fixture receipts and emits only reviewed public v2 fields', async t => {
  const root = await directory(t), candidate = await peerCandidate()
  // A real-looking initial receipt must never hide simulated peer responses.
  for (const receipt of Object.values(candidate.receipts)) receipt.fixture = false
  const blocked = await stageTodayCandidate(sealTodayCandidate(candidate), { root })
  await assert.rejects(publishTodayCandidate(blocked, { root, catalog, now: NOW, approve: true }), /unverified_execution_receipt/)
  const reviewed = await stageTodayCandidate(await peerCandidate({ reviewed: true }), { root })
  const result = await publishTodayCandidate(reviewed, { root, catalog, now: NOW, approve: true })
  assert.equal(result.snapshot.schemaVersion, 2)
  assert.equal(result.snapshot.responses.length, 3)
  assert.equal(result.snapshot.responses.every(row => row.provenance.reviewedAt === new Date(NOW).toISOString()), true)
  for (const field of ['responseReceipts', 'responseStates', 'receipts', 'checksum']) assert.equal(Object.hasOwn(result.snapshot, field), false)
})

test('response-only append upgrades v1, preserves first review times and rejects same-day replacement', async t => {
  const root = await directory(t), full = await peerCandidate({ reviewed: true })
  const initial = sealTodayCandidate({ ...full, responses: [], responseReceipts: {}, responseStates: {} })
  const first = await publishTodayCandidate(await stageTodayCandidate(initial, { root }), { root, catalog, now: NOW, approve: true })
  const v1 = { ...first.snapshot, schemaVersion: 1 }; delete v1.responses
  await writeFile(first.path, JSON.stringify(v1) + '\n')
  const v1Bytes = await readFile(first.path)
  const replyOnly = sealTodayCandidate({ ...full, picks: [], receipts: {} })
  const staged = await stageTodayCandidate(replyOnly, { root })
  const added = await publishTodayCandidate(staged, { root, catalog, now: NOW + 30000, approve: true })
  assert.deepEqual(await readFile(added.backupPath), v1Bytes)
  assert.equal(added.snapshot.schemaVersion, 2)
  assert.deepEqual(added.snapshot.picks, first.snapshot.picks)
  assert.equal(added.snapshot.responses.length, 3)
  const repeated = await publishTodayCandidate(staged, { root, catalog, now: NOW + 60000, approve: true })
  assert.deepEqual(repeated.snapshot.responses, added.snapshot.responses)
  const replacement = JSON.parse(JSON.stringify(replyOnly)), oldId = replacement.responses[0].id
  replacement.responses[0].id = 'replacement-response'
  replacement.responses[0].provenance.runId = 'replacement-run'
  replacement.responses[0].comment = '다시 생성한 응답으로 같은 날 이미 발행한 답글을 교체하려는 문장이다.'
  replacement.responseReceipts['replacement-response'] = { ...replacement.responseReceipts[oldId], runId: 'replacement-run', outputDigest: messageDigest(replacement.responses[0]) }
  delete replacement.responseReceipts[oldId]
  const before = await readFile(first.path)
  await assert.rejects(publishTodayCandidate(await stageTodayCandidate(sealTodayCandidate(replacement), { root }), { root, catalog, now: NOW + 90000, approve: true }), /daily_response_already_published/)
  assert.deepEqual(await readFile(first.path), before)
})

test('publication rejects a verified-looking response with a foreign or recursive parent', async t => {
  const root = await directory(t), candidate = await peerCandidate({ reviewed: true })
  candidate.responses[0].parentId = candidate.responses[1].id
  candidate.responseReceipts[candidate.responses[0].id].outputDigest = messageDigest(candidate.responses[0])
  const before = await readFile(join(root, 'data', 'today-picks.json'))
  const path = await stageTodayCandidate(sealTodayCandidate(candidate), { root })
  await assert.rejects(publishTodayCandidate(path, { root, catalog, now: NOW, approve: true }), /invalid_today_response_parent/)
  assert.deepEqual(await readFile(join(root, 'data', 'today-picks.json')), before)
})

test('same-day picks cannot be replaced; an independently reviewed different agent may be appended', async t => {
  const root = await directory(t), first = await stageTodayCandidate(await reviewedReceiptCandidate(), { root })
  const published = await publishTodayCandidate(first, { root, catalog, now: NOW, approve: true })
  const repeated = await publishTodayCandidate(first, { root, catalog, now: NOW + 30000, approve: true })
  assert.deepEqual(repeated.snapshot.picks[0], published.snapshot.picks[0])
  const replacement = await stageTodayCandidate(await reviewedReceiptCandidate(), { root })
  await assert.rejects(publishTodayCandidate(replacement, { root, catalog, now: NOW + 60000, approve: true }), /daily_pick_already_published/)
  const addition = await stageTodayCandidate(await reviewedReceiptCandidate(['claude']), { root })
  const result = await publishTodayCandidate(addition, { root, catalog, now: NOW + 60000, approve: true })
  assert.deepEqual(result.agents.sort(), ['claude', 'gpt'])
  assert.deepEqual(result.snapshot.picks.find(pick => pick.agent === 'gpt'), published.snapshot.picks[0])
})

test('duplicate agents and edited private candidate bytes are rejected before public writes', async t => {
  const root = await directory(t), candidate = await reviewedReceiptCandidate()
  candidate.picks.push(candidate.picks[0])
  const duplicate = await stageTodayCandidate(sealTodayCandidate(candidate), { root })
  await assert.rejects(publishTodayCandidate(duplicate, { root, catalog, now: NOW, approve: true }), /duplicate_daily_agent/)
  const path = await stageTodayCandidate(await reviewedReceiptCandidate(), { root })
  const changed = JSON.parse(await readFile(path, 'utf8')); changed.picks[0].comment = '승인 전 원문이 바뀌었지만 새 모델 실행 결과인 것처럼 게시하려는 수정본이다.'
  await writeFile(path, JSON.stringify(changed))
  await assert.rejects(publishTodayCandidate(path, { root, catalog, now: NOW, approve: true }), /invalid_candidate_checksum/)
})

test('candidate staging rejects an edition that could become a filesystem path', async t => {
  const root = await directory(t), candidate = await simulatedCandidate()
  candidate.editionDate = '../outside'
  await assert.rejects(stageTodayCandidate(sealTodayCandidate(candidate), { root }), /invalid_candidate_edition/)
  assert.deepEqual(await readdir(root), ['data'])
})

test('private candidate paths cannot escape through an outside path or junction', async t => {
  const root = await directory(t), outside = join(root, 'outside'); await mkdir(outside)
  await writeFile(join(outside, 'today-picks-external.json'), '{}')
  await mkdir(join(root, '.local')); await symlink(outside, join(root, '.local', 'tmp'), 'junction')
  await assert.rejects(publishTodayCandidate(join(outside, 'today-picks-external.json'), { root, catalog, now: NOW, approve: true }), /unsafe_today_path/)
  assert.equal(JSON.parse(await readFile(join(root, 'data', 'today-picks.json'), 'utf8')).picks.length, 0)
})
