import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { generateDebate } from '../../scripts/community/debate-generation.mjs'
import { hashDebatePacket, verifyDebateHashes } from '../../scripts/community/debate.mjs'
import { validateDebateDay } from '../../assets/debate-core.js'

const digest = value => createHash('sha256').update(value).digest('hex')
const packet = { date: '2026-11-05', topic: { ticker: 'SNDK', name: '샌디스크', sectorId: 'memory', changePct: -2.5, title: '샌디스크 -2.5%, 이 흐름 멈출까?' }, closePrice: { value: 100, currency: 'USD', date: '2026-11-05', sourceUrl: 'https://finance.yahoo.com/quote/SNDK/', observedAt: '2026-11-05T21:00:00Z' }, ripple: [], fundamentals: { gaapGrossMarginPercent: 85, guidanceLowPercent: 84.4, guidanceHighPercent: 85.4 }, sources: [{ label: '공통 자료', url: 'https://finance.yahoo.com/quote/SNDK/' }] }
const now = Date.parse('2026-11-06T12:00:00Z')
function adapter({ badFirstAnalysis = false, alwaysBadPeers = false, onlyOne = false, wrongReceipt = false } = {}) {
  const calls = [], counts = new Map()
  const invoke = async (agent, prompt, stage) => {
    calls.push({ agent, prompt, stage }); const key = agent + ':' + stage, attempt = (counts.get(key) || 0) + 1; counts.set(key, attempt)
    assert.ok(prompt.includes(JSON.stringify(packet)), 'every real stage receives the identical packet')
    if (agent === 'claude' || onlyOne && agent === 'gemini') throw Object.assign(new Error('subscription expired'), { code: 'authentication_required' })
    let value
    if (stage === 'analysis') value = { ticker: 'SNDK', date: packet.date, stance: badFirstAnalysis && agent === 'gpt' && attempt === 1 ? '이 종목 추천' : '수익성의 지속 조건부터 보자', stanceLevel: agent === 'gpt' ? 'bullish' : 'neutral', reason: '이번 수익성과 다음 전망을 구분해야 해', analysis: '입력된 자료로 같은 종가와 수익성 조건을 보고 있어. 높은 수익성이 확인된 한 분기가 계속 이어지는지는 아직 다른 문제지. 실적의 숫자와 회사의 전망을 같은 확정 사실로 뭉뚱그릴 수는 없어. 다음 자료에서 그 가정이 유지되는지 보는 게 내 분석의 출발점이야.', basis: '분기 실적과 다음 전망은 구분하고, 가격 범위를 정할 추가 근거가 없어 빈칸으로 두었어.', scenario: null, pointEstimate: null }
    if (stage === 'peer') value = { ticker: 'SNDK', date: packet.date, comments: [{ to: agent === 'gpt' ? 'gemini' : 'gpt', text: alwaysBadPeers ? '이 주식은 무조건 오른다' : agent === 'gemini' ? '지피티야, 85%는 이번 분기 실적이고 다음 분기 전망은 84.4~85.4%야. 같은 숫자가 확정됐다고 읽으면 시점이 섞이잖아.' : '제미나이야, 전망이랑 실적을 분리하자는 쪽은 나도 같아. 좋은 수익성이 한 번 나왔다고 다음 분기 계약서까지 쓴 건 아니지.' }] }
    if (stage === 'reply') {
      const block = prompt.split('\n\n네게 달린 실제 댓글:\n')[1].split('\n\n공통 자료:\n')[0], peers = JSON.parse(block)
      value = { ticker: 'SNDK', date: packet.date, replies: peers.map(row => ({ replyToId: row.id, text: agent === 'gpt' ? '제미나이야, 숫자 구분은 네 말이 맞아. 85%는 나온 실적이고 다음 전망과는 따로 봐야지. 확정처럼 읽히게 말했다면 그 부분은 인정하고 조건을 다시 붙일게.' : '지피티야, 맞아. 전망은 이미 찍힌 성적표가 아니니까 그걸 구분해야 해. 숫자 앞에서 캐릭터 고집은 잠깐 내려놓는 게 맞지.' })) }
    }
    if (stage === 'summary') value = { issue: '높았던 수익성이 다음에도 이어질 수 있나?', stances: ['gpt', 'gemini'].map(ai => ({ ai, stance: '확정 실적과 다음 조건을 나눠보자', stanceLevel: 'neutral', reason: '실제 토론에서 전망과 실적의 차이를 인정했어' })) }
    const rawResponse = JSON.stringify(value), generatedAt = { analysis: '2026-11-06T09:00:00Z', peer: '2026-11-06T09:30:00Z', reply: '2026-11-06T10:00:00Z', summary: '2026-11-06T11:00:00Z' }[stage]
    return { rawResponse, provenance: { provider: agent, requestedModel: agent + '-pinned', reportedModel: null, cliName: agent === 'gpt' ? 'codex' : 'gemini-cli', cliVersion: '1.0.0', generatedAt, runId: key + '-' + attempt, responseSha256: wrongReceipt ? '0'.repeat(64) : digest(rawResponse), packetSha256: hashDebatePacket(packet) } }
  }
  return { calls, invoke }
}
test('coordinator keeps two actual participants after an auth failure and replies to each real comment ID', async () => {
  const model = adapter(), result = await generateDebate({ packet, invoke: model.invoke, now })
  assert.equal(result.publication, 'review_required'); assert.deepEqual(result.day.stances.map(row => row.ai), ['gpt', 'gemini'])
  assert.equal(model.calls.filter(row => row.agent === 'claude').length, 1)
  assert.deepEqual(result.failures, [{ agent: 'claude', stage: 'analysis', code: 'authentication_required' }])
  const peers = result.day.thread.filter(row => row.kind === 'peer'), replies = result.day.thread.filter(row => row.kind === 'reply')
  assert.equal(peers.length, 2); assert.equal(replies.length, 2)
  assert.deepEqual(replies.map(row => row.replyToId).sort(), peers.map(row => row.id).sort())
  assert.ok(replies.find(row => row.ai === 'gpt').text.includes('네 말이 맞아'))
  assert.equal(result.day.stances.find(row => row.ai === 'gpt').stanceLevel, 'neutral')
  assert.throws(() => validateDebateDay(result.day, { now }), /invalid_debate_provenance/u, 'unreviewed execution is never silently promoted to publication')
  for (const row of [...result.day.stances, ...result.day.thread, result.day.summary]) { row.provenance.execution = 'owner-reviewed-one-off'; row.provenance.reviewedAt = '2026-11-06T11:30:00Z' }
  validateDebateDay(result.day, { now }); verifyDebateHashes(result.day)
})
test('a forbidden generated block gets one rewrite and a twice-rejected peer batch stays private', async () => {
  const model = adapter({ badFirstAnalysis: true, alwaysBadPeers: true }), result = await generateDebate({ packet, invoke: model.invoke, now })
  assert.equal(model.calls.filter(row => row.agent === 'gpt' && row.stage === 'analysis').length, 2)
  assert.ok(model.calls.some(row => row.prompt.includes('이번이 마지막 재작성 기회')))
  assert.equal(model.calls.filter(row => row.agent === 'gpt' && row.stage === 'peer').length, 2)
  assert.equal(result.day.thread.length, 0)
  assert.ok(result.attempts.some(row => row.rawResponse.includes('무조건 오른다')))
  assert.ok(!JSON.stringify(result.day).includes('무조건 오른다'))
})
test('fewer than two verified participants produces no substitute debate or publication', async () => {
  const model = adapter({ onlyOne: true }), result = await generateDebate({ packet, invoke: model.invoke, now })
  assert.equal(result.day, null); assert.equal(result.publication, 'insufficient_participants')
  assert.ok(model.calls.every(row => row.stage === 'analysis'))
})
test('a raw response with a mismatched genuine-receipt hash cannot enter a candidate', async () => {
  const model = adapter({ wrongReceipt: true }), result = await generateDebate({ packet, invoke: model.invoke, now })
  assert.equal(result.day, null); assert.ok(result.failures.some(row => row.code === 'unverified_provider_receipt'))
})
