import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { instruments } from '../../assets/instruments.js'
import { validateTodaySnapshot, getTodayComment } from '../../assets/today-core.js'

const snapshot = JSON.parse(await readFile(new URL('../../data/today-picks.json', import.meta.url), 'utf8'))
const source = await readFile(new URL('../../assets/community.js', import.meta.url), 'utf8')
const digests = {
  gpt: '877b8fc3c09a9f5dd522b0cd4a7d35ca5bff5ebf30fd4591f5dcfdc43eba040d',
  gemini: '90f768add01d36ab29c75979233be4ac17171b8dc902c1a918abe34f19cb7449',
  claude: '6ac72def4b6908f4f8fd70fc589e35824b5a58625848142cd9b7b8223141d928',
}

function moduleHarness(fetch) {
  const context = vm.createContext({
    instruments, validateTodaySnapshot, getTodayComment, fetch, AbortController, DOMException, URL, console,
    location: { origin: 'https://ai-chain-prototype.vercel.app', hash: '' },
    document: { getElementById: () => null }, window: { addEventListener() {} },
    communityApiOrigin: '', resolveCommunityOrigin: (_, origin) => origin,
  })
  vm.runInContext(source.replace(/^import .+$/gmu, '').replace(/^export /gmu, '') + '\nglobalThis.reportsApi = { publishedReportsForSymbol, readPublishedReports };', context)
  return context.reportsApi
}

test('three published native reports retain exact response hashes, excerpts and factual-only Claude scope', () => {
  validateTodaySnapshot(snapshot)
  assert.equal(snapshot.reports.length, 3)
  for (const report of snapshot.reports) {
    assert.equal(createHash('sha256').update(report.report, 'utf8').digest('hex'), digests[report.agent])
    assert.equal(report.provenance.responseSha256, digests[report.agent])
    assert.ok(report.report.includes(report.comment))
    assert.ok(report.reviewNotes.length)
  }
  const claude = snapshot.reports.find(report => report.agent === 'claude')
  assert.equal(claude.kind, 'earnings-review')
  assert.equal(Object.hasOwn(claude, 'fairValue'), false)
  assert.equal(claude.provenance.cliName, 'claude-code')
  assert.equal(snapshot.reports.find(report => report.agent === 'gemini').provenance.cliName, 'antigravity')
})

test('three conversational comments preserve separate native responses and bind to their original reports', () => {
  const ids = new Set(), runs = new Set()
  for (const report of snapshot.reports) {
    const comment = report.conversationComment
    assert.ok(comment, `${report.agent} has a separately generated comment`)
    assert.equal(getTodayComment(report), comment)
    assert.equal(comment.sourceReportSha256, digests[report.agent])
    assert.equal(createHash('sha256').update(comment.response, 'utf8').digest('hex'), comment.provenance.responseSha256)
    assert.ok(comment.response.includes(comment.text))
    assert.notEqual(comment.text, report.comment)
    assert.notEqual(comment.provenance.responseSha256, report.provenance.responseSha256)
    assert.equal(comment.provenance.provider, report.agent)
    assert.equal(comment.provenance.cliName, report.provenance.cliName)
    assert.notEqual(comment.provenance.runId, report.provenance.runId)
    assert.ok(!ids.has(comment.id)); ids.add(comment.id)
    assert.ok(!runs.has(comment.provenance.runId)); runs.add(comment.provenance.runId)
    assert.ok(Date.parse(comment.provenance.generatedAt) >= Date.parse(report.provenance.generatedAt))
    assert.equal(Object.hasOwn(comment, 'fairValue'), false)
  }
})

test('read-only published comments respect human-only tabs and never mix other stock contexts', () => {
  const { publishedReportsForSymbol } = moduleHarness(() => { throw new Error('unexpected_network') })
  assert.equal(publishedReportsForSymbol(snapshot, 'NVDA', 'mixed').length, 3)
  assert.equal(publishedReportsForSymbol(snapshot, 'NVDA', 'ai').length, 3)
  assert.equal(publishedReportsForSymbol(snapshot, 'NVDA', 'human').length, 0)
  assert.equal(publishedReportsForSymbol(snapshot, 'AMD', 'mixed').length, 0)
  assert.equal(publishedReportsForSymbol(snapshot, 'VRT', 'mixed').length, 0)
  const malformed = structuredClone(snapshot); malformed.reports[0].provenance.responseSha256 = 'invented'
  assert.throws(() => publishedReportsForSymbol(malformed, 'NVDA'), /invalid_today_provenance/u)
})

test('views share one snapshot read independently of community backend connectivity', async () => {
  let calls = 0
  const { readPublishedReports } = moduleHarness(async (url, options) => {
    calls++
    assert.equal(url, './data/today-picks.json')
    assert.equal(options.method, undefined)
    return { ok: true, json: async () => structuredClone(snapshot) }
  })
  const first = new AbortController(), second = new AbortController()
  const values = await Promise.all([readPublishedReports(first.signal), readPublishedReports(second.signal)])
  assert.equal(calls, 1)
  assert.equal(values[0], values[1])
  assert.equal((await readPublishedReports(new AbortController().signal)).reports.length, 3)
  assert.equal(calls, 1)
})

test('disposing the last pending view aborts its read and a new view can load without stale context', async () => {
  let calls = 0, aborted = 0
  const { readPublishedReports } = moduleHarness((_, options) => {
    calls++
    if (calls > 1) return Promise.resolve({ ok: true, json: async () => structuredClone(snapshot) })
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      aborted++; reject(new DOMException('Disposed', 'AbortError'))
    }, { once: true }))
  })
  const first = new AbortController(), pending = readPublishedReports(first.signal)
  first.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(aborted, 1)
  assert.equal((await readPublishedReports(new AbortController().signal)).reports.length, 3)
  assert.equal(calls, 2)
})

test('an already disposed view never starts a snapshot request', async () => {
  let calls = 0
  const { readPublishedReports } = moduleHarness(() => { calls++; throw new Error('unexpected_network') })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readPublishedReports(controller.signal), error => error.name === 'AbortError')
  assert.equal(calls, 0)
})

test('a failed snapshot read can recover on route re-entry without a full page reload', async () => {
  let calls = 0
  const { readPublishedReports } = moduleHarness(async () => {
    calls++
    if (calls === 1) throw new Error('temporary_network_failure')
    return { ok: true, json: async () => structuredClone(snapshot) }
  })
  await assert.rejects(readPublishedReports(new AbortController().signal), /temporary_network_failure/u)
  const recovered = await readPublishedReports(new AbortController().signal)
  assert.equal(recovered.reports.length, 3)
  assert.equal(calls, 2)
  assert.equal(await readPublishedReports(new AbortController().signal), recovered)
  assert.equal(calls, 2)
})
