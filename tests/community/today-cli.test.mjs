import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
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
  assert.equal(Object.hasOwn(published, 'receipts'), false)
  assert.equal(Object.hasOwn(published, 'checksum'), false)
  assert.equal(Object.hasOwn(published, 'candidateCount'), false)
  assert.equal((await readdir(join(root, 'data'))).some(name => name.endsWith('.tmp')), false)
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
