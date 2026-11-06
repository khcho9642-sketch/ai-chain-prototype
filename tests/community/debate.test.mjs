import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalDebatePacket, debateCharacterHistory, debateStanceChanges, debateTextAllowed, debateWritingDatesDiffer, selectDebateTopic, validateDebateDay, validateDebateIndex } from '../../assets/debate-core.js'
import { hashDebatePacket, loadPublishedDebates, publishDebateDay, verifyDebateHashes } from '../../scripts/community/debate.mjs'
import { analysisPrompt, peerPrompt, replyPrompt, summaryPrompt } from '../../server/community/debate-prompts.mjs'

const now = Date.parse('2026-11-06T12:00:00Z'), digest = text => createHash('sha256').update(text).digest('hex')
const names = { gpt: 'codex', claude: 'claude-code', gemini: 'gemini-cli' }
const topic = { ticker: 'SNDK', name: '샌디스크', sectorId: 'memory', changePct: -3, title: '샌디스크 -3.0%, 이 흐름 멈출까?' }
const close = { value: 100, currency: 'USD', date: '2026-11-05', sourceUrl: 'https://finance.yahoo.com/quote/SNDK/', observedAt: '2026-11-05T21:00:00Z' }
const source = { label: '공식 가격 자료', url: close.sourceUrl }
const analysis = '오늘 입력 가격은 같은 날 확정 종가야. 수익성이 높았다는 과거 사실과 앞으로도 유지된다는 가정은 서로 다르지. 하나의 분기를 계속 반복하는 셈법에는 조건이 붙고, 시장 분위기만으로 원인을 단정할 수는 없어. 다음 자료에서 그 수익력의 지속성이 확인되는지 보자는 쪽이야.'
const basis = '같은 기준 종가와 자료로 비교하고, 확인한 수치와 가정은 구분해. 근거가 없는 가격 범위는 비워뒀어.'
function day() {
  const packet = { date: close.date, topic, closePrice: close, sources: [source] }, packetSha256 = hashDebatePacket(packet)
  const result = { schemaVersion: 1, id: 'debate-2026-11-05-SNDK', date: close.date, publishedAt: '2026-11-06T11:00:00Z', headline: '같은 가격, 수익력 지속성에 다른 질문', topic: structuredClone(topic), issue: null, ripple: [], packet, packetSha256, summary: null, closePrice: structuredClone(close), thread: [], stances: [] }
  for (const ai of ['gpt', 'claude', 'gemini']) {
    const rawResponse = JSON.stringify({ ticker: topic.ticker, date: close.date, stance: '수익성 지속 조건부터 보자', stanceLevel: 'neutral', reason: '확인한 실적과 다음 전망은 같은 사실이 아니야', analysis, basis, scenario: null, pointEstimate: null })
    result.stances.push({ ai, ...JSON.parse(rawResponse), writtenAt: '2026-11-06T09:00:00Z', priceAtWriting: close.value, closeDate: close.date, sources: [source], rawResponse, provenance: provenance(ai, rawResponse, packetSha256, 'analysis-' + ai, '2026-11-06T09:00:00Z') })
  }
  return result
}
function provenance(ai, rawResponse, packetSha256, runId, generatedAt) {
  return { provider: ai, requestedModel: ai + '-pinned', reportedModel: null, cliName: names[ai], cliVersion: '1.0.0', generatedAt, reviewedAt: '2026-11-06T10:59:00Z', runId, promptVersion: 'same-topic-analysis-v1', responseSha256: digest(rawResponse), packetSha256, execution: 'owner-reviewed-one-off' }
}
function threaded() {
  const value = day()
  const text = '클로드야, 그 지적은 맞아. 높은 이익 한 번이 다음 분기까지 보증해주는 건 아니니 가정을 분리해서 보자.'
  const peerRaw = JSON.stringify({ ticker: topic.ticker, date: close.date, comments: [{ to: 'claude', text }] })
  value.thread.push({ id: 'peer-gpt-claude', ai: 'gpt', to: 'claude', kind: 'peer', replyToId: null, text, writtenAt: '2026-11-06T09:30:00Z', priceAtWriting: close.value, closeDate: close.date, rawResponse: peerRaw, provenance: provenance('gpt', peerRaw, value.packetSha256, 'peer-run-gpt', '2026-11-06T09:30:00Z') })
  const reply = '지피티야, 그 구분은 인정해. 이익 수치가 좋다는 것과 그 수준이 계속된다는 얘기는 따로 따져야 하는 거지.'
  const replyRaw = JSON.stringify({ ticker: topic.ticker, date: close.date, replies: [{ replyToId: 'peer-gpt-claude', text: reply }] })
  value.thread.push({ id: 'reply-claude-gpt', ai: 'claude', to: 'gpt', kind: 'reply', replyToId: 'peer-gpt-claude', text: reply, writtenAt: '2026-11-06T10:00:00Z', priceAtWriting: close.value, closeDate: close.date, rawResponse: replyRaw, provenance: provenance('claude', replyRaw, value.packetSha256, 'reply-run-claude', '2026-11-06T10:00:00Z') })
  return value
}

test('same-topic day preserves genuine raw bindings, one price/date and partial participation', () => {
  const value = threaded(); assert.equal(validateDebateDay(value, { now }), value); assert.equal(verifyDebateHashes(value), value)
  value.stances = value.stances.slice(0, 2); validateDebateDay(value, { now })
  assert.equal(canonicalDebatePacket({ b: { z: 1, a: 2 }, a: 3 }), canonicalDebatePacket({ a: 3, b: { a: 2, z: 1 } }))
})
test('new same-topic content rejects another close, date, source and rewritten raw text', () => {
  for (const mutate of [value => { value.stances[0].priceAtWriting = 101 }, value => { value.stances[0].closeDate = '2026-11-04' }, value => { value.stances[0].analysis += ' 바꿨다.' }, value => { value.stances[0].sources[0] = { label: '외부', url: 'https://example.com/' } }, value => { value.stances[0].provenance.provider = 'claude' }, value => { value.packet.closePrice = { ...value.closePrice, value: 99 } }]) {
    const value = structuredClone(day()); mutate(value); assert.throws(() => validateDebateDay(value, { now }), /invalid_debate_/u)
  }
  const value = day(); value.packet.extra = 'unreviewed'; assert.throws(() => verifyDebateHashes(value), /debate_packet_hash_mismatch/u)
})
test('peer replies are independently bound to one real comment by target, author and chronology', () => {
  for (const mutate of [value => { value.thread[1].replyToId = 'missing-peer' }, value => { value.thread[1].to = 'gemini' }, value => { value.thread[1].provenance.generatedAt = '2026-11-06T09:00:00Z' }, value => { value.thread.push({ ...value.thread[1], id: 'duplicate-reply' }) }, value => { value.thread[0].to = 'gemini' }, value => { value.thread[1].rawResponse = JSON.stringify({ replies: [{ replyToId: 'other-peer', text: value.thread[1].text }] }) }]) {
    const value = threaded(); mutate(value); assert.throws(() => validateDebateDay(value, { now }), /invalid_debate_/u)
  }
})
test('summary binds each attributed stance to that actual author and hides failed issues', () => {
  const value = day(), issue = '높았던 수익성이 다음에도 유지될 수 있나?'
  const summaries = value.stances.map(row => ({ ai: row.ai, stance: row.stance, stanceLevel: row.stanceLevel, reason: row.reason }))
  const rawResponse = JSON.stringify({ issue, stances: summaries })
  value.summary = { rawResponse, provenance: provenance('gpt', rawResponse, value.packetSha256, 'summary-run', '2026-11-06T10:30:00Z') }; value.issue = issue
  validateDebateDay(value, { now }); verifyDebateHashes(value)
  value.stances[0].stance = '원문에 없던 입장'
  assert.throws(() => validateDebateDay(value, { now }), /invalid_debate_summary_binding/u)
  value.issue = '수익성은 계속 갈까'; assert.throws(() => validateDebateDay(value, { now }), /invalid_debate_issue/u)
})
test('public language filter rejects calls to trade and unsupported certainty while allowing useful prose', () => {
  for (const text of ['이 종목 추천', '지금 사라', '당장 팔라', '매수 의견', '매도 판단', '목표가를 정함', '무조건 오른다', '계속 내린다', '수익 보장']) assert.equal(debateTextAllowed(text), false, text)
  assert.equal(debateTextAllowed('분기 실적이 높았다는 사실과 그 다음 가정은 구분하자.'), true)
  const value = day(); value.stances[0].scenario = { low: 200, high: 100, currency: 'USD' }; assert.throws(() => validateDebateDay(value, { now }), /invalid_debate_scenario/u)
  const altered = day(); altered.stances[0].pointEstimate = 200; assert.throws(() => validateDebateDay(altered, { now }), /invalid_debate_scenario_binding/u)
  altered.stances[0].pointEstimate = null; altered.stances[0].scenario = { low: 90, high: 110, currency: 'USD' }; assert.throws(() => validateDebateDay(altered, { now }), /invalid_debate_scenario_binding/u)
})
test('manifest validates latest-first order and never accepts traversal dates', () => {
  assert.deepEqual(validateDebateIndex({ schemaVersion: 1, publishedAt: null, latestDate: null, days: [] }).days, [])
  const value = day(), entry = { id: value.id, date: value.date, topic: value.topic, issue: value.issue }
  const index = { schemaVersion: 1, publishedAt: value.publishedAt, latestDate: value.date, days: [entry] }
  assert.equal(validateDebateIndex(index), index)
  assert.throws(() => validateDebateIndex({ ...index, days: [{ ...entry, date: '../today-picks' }] }), /invalid_debate_index/u)
  assert.throws(() => validateDebateIndex({ ...index, days: [entry, entry] }), /invalid_debate_index/u)
})
test('immutable publication preserves past sessions and loader publishes only manifest-listed files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'debate-publish-')); t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual((await loadPublishedDebates(root)).days, [])
  const value = day(); const first = await publishDebateDay({ day: value, root, now }); assert.equal(first.unchanged, false)
  const before = await readFile(first.path, 'utf8'); assert.equal((await publishDebateDay({ day: value, root, now })).unchanged, true)
  const other = structuredClone(value); other.headline = '오늘 설명을 바꾼 새 문구'
  await assert.rejects(publishDebateDay({ day: other, root, now }), /debate_published_day_immutable/u)
  assert.equal(await readFile(first.path, 'utf8'), before)
  const published = await loadPublishedDebates(root, { now }); assert.equal(published.days.length, 1); assert.equal(published.index.latestDate, value.date)
})
test('concurrent publication never replaces the winning day or loses a successfully published index entry', async t => {
  const root = await mkdtemp(join(tmpdir(), 'debate-concurrent-')); t.after(() => rm(root, { recursive: true, force: true }))
  const first = day(), competing = structuredClone(first); competing.headline = '같은 날 다른 원고는 덮어쓸 수 없어'
  const results = await Promise.allSettled([publishDebateDay({ day: first, root, now }), publishDebateDay({ day: competing, root, now })])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.ok(results.filter(row => row.status === 'rejected').every(row => /debate_publication_busy|debate_published_day_immutable/u.test(row.reason.message)))
  const publication = await loadPublishedDebates(root, { now }); assert.equal(publication.days.length, 1)
  assert.ok([first.headline, competing.headline].includes(publication.days[0].headline))
  const winner = publication.days[0], sameAgain = await publishDebateDay({ day: winner, root, now }); assert.equal(sameAgain.unchanged, true)
})
test('concurrent different-session publication either serializes both or fails busy without losing a completed day', async t => {
  const root = await mkdtemp(join(tmpdir(), 'debate-concurrent-days-')); t.after(() => rm(root, { recursive: true, force: true }))
  const first = day(), next = structuredClone(first); next.date = '2026-11-04'; next.id = 'debate-2026-11-04-SNDK'; next.closePrice.date = next.date; next.packet.date = next.date; next.packet.closePrice = { ...next.closePrice }; next.packetSha256 = hashDebatePacket(next.packet)
  for (const row of next.stances) { row.closeDate = next.date; const raw = JSON.parse(row.rawResponse); raw.date = next.date; row.rawResponse = JSON.stringify(raw); row.provenance.packetSha256 = next.packetSha256; row.provenance.responseSha256 = digest(row.rawResponse) }
  const results = await Promise.allSettled([publishDebateDay({ day: first, root, now }), publishDebateDay({ day: next, root, now })])
  assert.ok(results.some(row => row.status === 'fulfilled'))
  assert.ok(results.filter(row => row.status === 'rejected').every(row => row.reason.message === 'debate_publication_busy'))
  const publication = await loadPublishedDebates(root, { now }); assert.equal(publication.days.length, results.filter(row => row.status === 'fulfilled').length)
  for (const [index, result] of results.entries()) if (result.status === 'fulfilled') assert.ok(publication.days.some(row => row.date === [first, next][index].date))
})
test('character changes compare only the preceding same ticker and three weekdays trigger a date warning', () => {
  const first = day(), next = structuredClone(first); next.date = '2026-11-06'; first.stances[0].stanceLevel = 'bullish'; first.stances[1].stanceLevel = 'bearish'; next.stances[2].stanceLevel = 'bullish'
  assert.deepEqual(debateStanceChanges(next, first).map(row => row.ai), ['gpt', 'claude', 'gemini'])
  assert.deepEqual(debateCharacterHistory([next, first]), { gpt: 1, claude: 1, gemini: 1 })
  next.topic = { ...next.topic, ticker: 'MU' }; assert.deepEqual(debateStanceChanges(next, first), [])
  next.stances[0].writtenAt = '2026-11-02T04:00:00Z'; next.stances[1].writtenAt = '2026-11-05T04:00:00Z'; assert.equal(debateWritingDatesDiffer(next), true)
})

test('topic selection uses exact homepage top trigger, curated override and the 45-company fallback', () => {
  const seconds = date => Date.parse(date + 'T14:30:00Z') / 1000
  const quote = (symbol, prices) => ({ symbol, currency: 'USD', timezone: 'America/New_York', status: 'ok', sourceUrl: 'https://finance.yahoo.com/quote/' + symbol + '/', fetchedAt: '2026-11-06T08:00:00Z', closeDate: '2026-11-05', priceBasis: 'previous-completed-session', price: prices[1], bars: prices.map((close, index) => ({ time: seconds('2026-11-0' + (index + 4)), close })) })
  const marketSnapshot = { generatedAt: '2026-11-06T08:00:00Z', quotes: [quote('SNDK', [100, 103]), quote('NVDA', [100, 101]), quote('SPY', [100, 160])] }
  assert.equal(selectDebateTopic({ marketSnapshot, now }).topic.ticker, 'SNDK')
  assert.equal(selectDebateTopic({ marketSnapshot, curated: { date: '2026-11-05', ticker: 'NVDA', issue: '수익력이 이어질 수 있나?' }, now }).selectionMethod, 'curated')
  marketSnapshot.quotes[0].price = 100.5; marketSnapshot.quotes[0].bars[1].close = 100.5
  const fallback = selectDebateTopic({ marketSnapshot, now }); assert.equal(fallback.topic.ticker, 'NVDA'); assert.equal(fallback.selectionMethod, 'largest-absolute-close-change')
})
test('three model prompts share one packet while preserving numeric corrections and individual reply IDs', () => {
  const value = day(), analyses = value.stances
  for (const agent of ['gpt', 'claude', 'gemini']) {
    assert.ok(analysisPrompt({ agent, packet: value.packet }).endsWith(JSON.stringify(value.packet)))
    assert.match(analysisPrompt({ agent, packet: value.packet }), /입장을 바꾼다/u)
    assert.match(peerPrompt({ agent, packet: value.packet, analyses }), /억지로 반대하지/u)
    const peerComments = analyses.filter(row => row.ai !== agent).map(row => ({ id: 'peer-' + row.ai, ai: row.ai, to: agent, text: '실제 수치를 다시 보자.' }))
    const prompt = replyPrompt({ agent, packet: value.packet, analysis: analyses.find(row => row.ai === agent), peerComments })
    assert.match(prompt, /각 댓글마다 별도 답글/u); assert.ok(prompt.includes(peerComments[0].id)); assert.ok(prompt.includes(peerComments[1].id))
    assert.throws(() => replyPrompt({ agent, packet: value.packet, analysis: analyses.find(row => row.ai === agent), peerComments: [{ ...peerComments[0], to: 'different' }] }), /invalid_debate_reply_context/u)
  }
  assert.match(summaryPrompt({ packet: value.packet, analyses, thread: [] }), /원문에 없는 주장/u)
})
