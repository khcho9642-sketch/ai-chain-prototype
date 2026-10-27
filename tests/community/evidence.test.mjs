import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildEvidenceSnapshot, createEvidenceSource } from '../../server/community/evidence.mjs'
import { validateOutput, makePrompt } from '../../server/community/policy.mjs'

const now = Date.parse('2026-10-27T02:00:00Z')
const market = { generatedAt: '2026-10-27T01:00:00Z', quotes: [
  { symbol: 'NVDA', status: 'ok', price: 210.96, changePercent: -0.59, volume: 10000, currency: 'USD', marketTime: Date.parse('2026-10-26T20:00:00Z') / 1000, sourceUrl: 'https://finance.yahoo.com/quote/NVDA/' },
  { symbol: 'AMD', status: 'ok', price: 999, currency: 'USD', marketTime: now / 1000, sourceUrl: 'https://finance.yahoo.com/quote/AMD/' },
] }
const snapshot = () => buildEvidenceSnapshot({ symbol: 'NVDA', market, now })
const numericOutput = row => ({ action: 'publish', message_type: 'comment', text: '2026-10-26 관측 시세는 210.96 USD다. 자료의 기준 시각부터 보고 이야기하자.', evidence_ids: [row.id], reply_to: null, previous_opinion_id: null })

test('existing structured evidence stays scoped and preserves observation versus collection time', () => {
  const result = snapshot()
  assert.equal(result.evidence.length, 3)
  assert.equal(result.evidence.some(row => row.symbol !== 'NVDA' || row.value === 999), false)
  assert.equal(result.evidence[0].observedAt, '2026-10-26T20:00:00.000Z')
  assert.equal(result.evidence[0].collectedAt, '2026-10-27T01:00:00.000Z')
  assert.equal(result.id, snapshot().id)
  assert.equal(buildEvidenceSnapshot({ symbol: 'UNKNOWN', market, now }), null)
})

test('unavailable, future, missing-unit and unsafe-source values are not supplied as verified evidence', () => {
  for (const patch of [{ status: 'error' }, { marketTime: (now + 86400000) / 1000 }, { sourceUrl: 'file:///private' }]) {
    const m = { ...market, quotes: [{ ...market.quotes[0], ...patch }] }
    assert.equal(buildEvidenceSnapshot({ symbol: 'NVDA', market: m, now }), null)
  }
  assert.equal(buildEvidenceSnapshot({ symbol: 'NVDA', market: { ...market, quotes: [{ ...market.quotes[0], currency: null, changePercent: null, volume: null }] }, now }), null)
})

test('company RSS contributes titles only and never another company or invented report contents', () => {
  const disclosures = { companies: [{ symbol: 'NVDA', status: 'ok', lastSuccessAt: '2026-10-27', items: [
    { title: '사업보고서 제출', publishedAt: '2026-10-26', sourceUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=123' },
  ] }] }
  const result = buildEvidenceSnapshot({ symbol: 'NVDA', disclosures, now })
  assert.equal(result.evidence[0].titleOnly, true)
  assert.equal(result.evidence[0].value, null)
  assert.throws(() => validateOutput({ action: 'publish', text: '공시 본문을 분석했는데 실적은 확실히 좋아졌다.', evidence_ids: [result.evidence[0].id] }, { symbol: 'NVDA', snapshot: result }), /title_only_claim/)
})

test('referenced numeric values require matching value, unit and actual observation date', () => {
  const result = snapshot(), output = numericOutput(result.evidence[0])
  const ctx = { symbol: 'NVDA', snapshot: result, messageType: 'comment' }
  const valid = validateOutput(output, ctx)
  assert.equal(valid.requiresReview, true)
  assert.equal(valid.evidenceIds[0], result.evidence[0].id)
  assert.throws(() => validateOutput({ ...output, text: output.text.replace('210.96', '999') }, ctx), /unsupported_numeric_claim/)
  assert.throws(() => validateOutput({ ...output, text: output.text.replace('USD', '원') }, ctx), /missing_evidence_unit/)
  assert.throws(() => validateOutput({ ...output, text: output.text.replace('2026-10-26', '2026-10-27') }, ctx), /unsupported_evidence_date/)
  assert.throws(() => validateOutput({ ...output, evidence_ids: ['made-up-id'] }, ctx), /unknown_evidence_id/)
  assert.throws(() => validateOutput({ ...output, evidence_ids: [] }, ctx), /needs_verified_evidence/)
})

test('historical quotes remain historical and evidence IDs do not permit wrong stock contexts', () => {
  const result = buildEvidenceSnapshot({ symbol: 'NVDA', market, now: now + 3 * 86400000 })
  assert.equal(result.evidence[0].stale, true)
  const output = numericOutput(result.evidence[0])
  assert.throws(() => validateOutput({ ...output, text: `${output.text} 지금 가격이다.` }, { symbol: 'NVDA', snapshot: result }), /stale_current_claim/)
  assert.throws(() => validateOutput(output, { symbol: 'AMD', snapshot: result }), /unknown_evidence_id/)
})

test('mixing quoted value and the unit of another evidence row is rejected', () => {
  const result = snapshot()
  const output = { ...numericOutput(result.evidence[0]), text: '2026-10-26 관측 거래량은 210.96 주다. 자료를 먼저 확인하자.', evidence_ids: [result.evidence[0].id, result.evidence[2].id] }
  assert.throws(() => validateOutput(output, { symbol: 'NVDA', snapshot: result }), /missing_evidence_unit/)
})

test('adding quote evidence cannot turn a disclosure title into permission to invent financial results', () => {
  const result = snapshot()
  const title = { id: 'title', symbol: 'NVDA', kind: 'disclosure_title', label: '사업보고서', titleOnly: true, observedAt: '2026-10-26T00:00:00Z' }
  result.evidence.push(title)
  assert.throws(() => validateOutput({ action: 'publish', text: '공시 본문을 분석했는데 실적은 확실히 좋아졌다.', evidence_ids: [title.id, result.evidence[0].id] }, { symbol: 'NVDA', snapshot: result }), /title_only_claim/)
})

test('opinion, reply and actual past-message references are constrained by the claimed task', () => {
  const opinion = { action: 'publish', message_type: 'opinion', text: '기대하는 이유는 이해되는데, 이번 자료만으로 좋아졌다고 단정하기는 아직 어렵다.', reply_to: null, evidence_ids: [], previous_opinion_id: 'old' }
  assert.equal(validateOutput(opinion, { messageType: 'opinion', previousOpinionId: 'old' }).messageType, 'opinion')
  assert.throws(() => validateOutput({ ...opinion, text: 'ㅋㅋㅋ' }, { messageType: 'opinion', previousOpinionId: 'old' }), /message_too_short/)
  assert.throws(() => validateOutput({ ...opinion, previous_opinion_id: 'invented' }, { messageType: 'opinion', previousOpinionId: 'old' }), /invalid_previous_opinion/)
  assert.throws(() => validateOutput({ action: 'publish', text: '그 말은 좀 더 봐야지', reply_to: 'other' }, { parent: 'real', allowedReplyIds: ['real'] }), /invalid_reply_target/)
  assert.throws(() => validateOutput({ action: 'publish', text: '그때도 비슷한 말을 했지', referenced_message_ids: ['imaginary'] }, { context: [{ id: 'real' }] }), /unknown_message_reference/)
  assert.throws(() => validateOutput({ action: 'publish', text: '2026-10-20에 발표했다고 들었어' }), /unsupported_evidence_date/)
  assert.throws(() => validateOutput({ action: 'publish', text: '연락은 fake@example.com으로 해' }), /private_information/)
})

test('read-only evidence source rereads changed source files and does not invent data after failure', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-evidence-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'data'))
  const path = join(dir, 'data', 'market.json')
  await writeFile(path, JSON.stringify(market))
  const source = createEvidenceSource({ root: dir, now: () => now })
  assert.equal(source('NVDA').evidence[0].value, 210.96)
  await writeFile(path, '{invalid')
  assert.equal(source('NVDA'), null)
})

test('thirty editorial scenarios are prepared, with real-model review explicitly pending', async () => {
  const data = JSON.parse(await readFile(new URL('../fixtures/community-style-scenarios.json', import.meta.url), 'utf8'))
  assert.equal(data.scenarios.length >= 30, true)
  assert.equal(new Set(data.scenarios.map(row => row.id)).size, data.scenarios.length)
  for (const category of ['rise', 'fall', 'flat', 'conflicting', 'unsupported', 'joke', 'question', 'revision', 'human-only']) assert.ok(data.scenarios.some(row => row.category === category))
  assert.equal(data.realModelReviewed, false)
  const prompt = makePrompt({ agent: 'gpt', symbol: 'NVDA', messageType: 'opinion', context: [], snapshot: snapshot(), source: 'actual-source' })
  assert.match(prompt, /source_comment_id/)
  assert.match(prompt, /community|opinion/)
  assert.match(prompt, /사실 자료가 아니다/)
})
