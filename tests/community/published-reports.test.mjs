import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { instruments } from '../../assets/instruments.js'
import { validateTodaySnapshot, getTodayComment, getTodayPriceComparison } from '../../assets/today-core.js'

const snapshot = JSON.parse(await readFile(new URL('../../data/today-picks.json', import.meta.url), 'utf8'))
const source = await readFile(new URL('../../assets/community.js', import.meta.url), 'utf8')
const allReports = [...snapshot.reports, ...(snapshot.reportHistory || [])]
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

test('active and historical native reports retain exact hashes while current recommendations are distinct', () => {
  validateTodaySnapshot(snapshot)
  assert.equal(snapshot.reports.length, 2)
  assert.equal(snapshot.selectionPolicy, 'distinct-symbols-v1')
  for (const report of allReports) {
    assert.equal(createHash('sha256').update(report.report, 'utf8').digest('hex'), report.provenance.responseSha256)
    assert.ok(report.report.includes(report.comment))
    assert.ok(report.reviewNotes.length)
  }
  for (const [agent, digest] of Object.entries(digests)) {
    const original = allReports.find(report => report.agent === agent && report.provenance.responseSha256 === digest)
    assert.ok(original, `${agent} original report remains published or archived`)
    assert.equal(createHash('sha256').update(original.report, 'utf8').digest('hex'), digest)
  }
  const selections = snapshot.reports.filter(report => report.kind === 'stock-opinion')
  assert.equal(selections.length, 2)
  assert.equal(new Set(selections.map(report => report.symbol)).size, selections.length)
  const gpt = selections.find(report => report.agent === 'gpt')
  assert.equal(gpt.provenance.responseSha256, '39d4b075a10cbc73756c2d6f94309a13d846f2b2e3063cbfe27be04c2f514d53')
  assert.equal(Object.hasOwn(gpt, 'fairValue'), false)
  const gemini = selections.find(report => report.agent === 'gemini')
  assert.notEqual(gemini.symbol, 'NVDA')
  assert.equal(gemini.provenance.responseSha256, '9fe66c84bf2ff9aaf396fc04302dc61fd30e52ce292bf520c4843d5ff52f3ed7')
  assert.equal(gemini.symbol, 'AVGO')
  assert.equal(gemini.fairValue.price, 375.2)
  assert.equal(gemini.provenance.cliName, 'gemini-web')
  assert.equal(gemini.provenance.cliVersion, null)
  assert.equal(gemini.provenance.requestedModel, 'Gemini 3.1 Pro (웹)')
  assert.equal(gemini.provenance.reportedModel, null)
  assert.equal(gemini.reviewNotes.length, 3)
  assert.equal(snapshot.reportHistory.some(report => report.agent === 'gemini' && report.symbol === 'NVDA' && report.provenance.responseSha256 === digests.gemini), true)
  assert.equal(snapshot.reports.some(report => report.agent === 'claude'), false)
  const claude = snapshot.reportHistory.find(report => report.agent === 'claude')
  assert.equal(claude.kind, 'earnings-review')
  assert.equal(Object.hasOwn(claude, 'fairValue'), false)
  assert.equal(claude.provenance.cliName, 'claude-code')
})

test('the replacement preserves all earlier report fields, comments, dates and original legacy picks', () => {
  const recordHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const gpt = snapshot.reports.find(report => report.agent === 'gpt')
  assert.equal(recordHash(gpt), 'fa532a4b1d3178be64d96753e5cb90d9f8df4afba40dbc5cad5f4e593a7991ed')
  const preserved = new Map([
    ['report-3083de50-d655-417b-8af9-ec9158bb0b5a', '6b1fcf5c93de4b3ac0b69eac35a837f52bffeca13d06c644e8b89f8064123866'],
    ['report-051ba683-4799-4120-a484-9f6e0b5f2467', '16863266bdbd6d6705fc1bdb04db03806eedfe8871a671a0e1f213fe0217faae'],
    ['report-04f0a3e0-a5e1-40e2-a08a-3e7810b75f85', '59e84c44615785fafa58d4ccab4646edb7d46df6a4b9c230b5fb2d8cdb1feb5a'],
    ['report-977575bc-3c17-400a-8c4d-af76f0e2d0eb', 'a6e7051963d83d6efbd8c743169f456ee022f174e3274afd28a7f502b402adfc'],
  ])
  assert.equal(snapshot.reportHistory.length, preserved.size)
  for (const [id, digest] of preserved) {
    const report = snapshot.reportHistory.find(item => item.id === id)
    assert.ok(report, `${id} remains in publication history`)
    assert.equal(recordHash(report), digest)
  }
  const priorGemini = snapshot.reportHistory.find(report => report.symbol === 'VRT')
  assert.equal(priorGemini.fairValue.price, 234)
  assert.equal(priorGemini.provenance.cliName, 'antigravity')
  assert.deepEqual(priorGemini.comparisonSources.map(item => item.symbol).sort(), ['AMD', 'AVGO'])
  assert.equal(recordHash(snapshot.picks), 'b06f9ecef634510154a099b13d256d7324705c362080e74d457f531474a8ee36')
})

test('the genuine Gemini web estimate exceeds its unchanged input quote with selected-stock-only canonical evidence', () => {
  const gemini = snapshot.reports.find(report => report.agent === 'gemini')
  const original = JSON.parse(gemini.report)
  assert.equal(original.symbol, 'AVGO')
  assert.equal(original.observedQuote.price, 351.81)
  assert.equal(original.observedQuote.currency, 'USD')
  assert.equal(original.observedQuote.marketTime, '2026-10-28T20:00:01.000Z')
  assert.equal(original.coverage, 'AMD·AVGO두후보비교이며NVDA·VRT제외')
  assert.deepEqual(gemini.fairValue, original.fairValue)
  assert.equal(Number((2.68 * 4 * 35).toFixed(2)), gemini.fairValue.price)
  assert.deepEqual(gemini.fairValue.evidenceIds, ['avgo-latest-earnings', 'avgo-quote'])
  assert.ok(gemini.evidence.every(item => item.symbol === 'AVGO'))
  assert.ok(gemini.evidence.every(item => item.sourceUrl.startsWith('https://') && !item.sourceUrl.includes('](')))
  assert.ok(original.sourceUrls.every(item => item.startsWith('[https://')))
  assert.ok(gemini.reviewNotes.some(note => note.includes('136.65억') && note.includes('20.19억') && note.includes('20.06억')))
  const quote = { symbol: 'AVGO', ...original.observedQuote, marketTime: Date.parse(original.observedQuote.marketTime) / 1000, status: 'ok' }
  const before = structuredClone(gemini)
  const comparison = getTodayPriceComparison(gemini, quote)
  assert.equal(comparison.status, 'above')
  assert.equal(comparison.eligible, true)
  assert.equal(comparison.differencePercent.toFixed(2), '6.65')
  assert.equal(getTodayPriceComparison(gemini, { ...quote, price: 400 }).eligible, false)
  assert.deepEqual(gemini, before)
})

test('three conversational comments preserve separate native responses and bind to their original reports', () => {
  const ids = new Set(), runs = new Set()
  const separatelyGenerated = allReports.filter(report => report.conversationComment)
  assert.equal(separatelyGenerated.length, 3)
  for (const report of separatelyGenerated) {
    const comment = report.conversationComment
    assert.ok(comment, `${report.agent} has a separately generated comment`)
    assert.equal(getTodayComment(report), comment)
    assert.equal(comment.sourceReportSha256, report.provenance.responseSha256)
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
  assert.equal(publishedReportsForSymbol(snapshot, 'NVDA', 'mixed').length, 4)
  assert.equal(publishedReportsForSymbol(snapshot, 'NVDA', 'ai').length, 4)
  assert.equal(publishedReportsForSymbol(snapshot, 'NVDA', 'human').length, 0)
  const gemini = snapshot.reports.find(report => report.agent === 'gemini')
  assert.deepEqual(Array.from(publishedReportsForSymbol(snapshot, gemini.symbol, 'mixed'), report => report.id), [gemini.id])
  assert.equal(publishedReportsForSymbol(snapshot, gemini.symbol, 'human').length, 0)
  const archivedVrt = snapshot.reportHistory.find(report => report.symbol === 'VRT')
  assert.deepEqual(Array.from(publishedReportsForSymbol(snapshot, 'VRT', 'ai'), report => report.id), [archivedVrt.id])
  assert.equal(publishedReportsForSymbol(snapshot, 'VRT', 'human').length, 0)
  assert.equal(publishedReportsForSymbol(snapshot, 'AVGO', 'ai').some(report => report.symbol === 'VRT'), false)
  assert.equal(publishedReportsForSymbol(snapshot, 'VRT', 'ai').some(report => report.symbol === 'AVGO'), false)
  for (const symbol of instruments.filter(item => item.chains.some(chain => chain > 0)).map(item => item.symbol)) {
    assert.ok(publishedReportsForSymbol(snapshot, symbol).every(report => report.symbol === symbol))
  }
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
  assert.equal((await readPublishedReports(new AbortController().signal)).reports.length, 2)
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
  assert.equal((await readPublishedReports(new AbortController().signal)).reports.length, 2)
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
  assert.equal(recovered.reports.length, 2)
  assert.equal(calls, 2)
  assert.equal(await readPublishedReports(new AbortController().signal), recovered)
  assert.equal(calls, 2)
})
