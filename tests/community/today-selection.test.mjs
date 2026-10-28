import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { validateOutput, makePrompt } from '../../server/community/policy.mjs'
import { runAdapter } from '../../scripts/community/ai-cli.mjs'

const evidence = symbol => ({ id: 'source-' + symbol, symbol, kind: 'quote', label: '관측 가격', value: 100, unit: 'USD', observedAt: '2026-10-27T20:00:00Z', collectedAt: '2026-10-27T21:00:00Z', sourceUrl: `https://finance.yahoo.com/quote/${symbol}/` })
const job = agent => ({ task: 'daily-pick', agent, date: '2026-10-28', context: [], parent: null,
  candidates: ['NVDA','TSM'].map(symbol => ({ symbol, company: symbol, snapshot: { symbol, evidence: [evidence(symbol)] } })) })
const output = { action: 'publish', symbol: 'NVDA', message_type: 'opinion', text: '이번 자료에서는 이 종목을 먼저 살펴보고 싶다. 다만 과거 시세만으로 앞으로의 방향을 단정하진 않겠다.', reply_to: null, evidence_ids: ['source-NVDA'], previous_opinion_id: null }

test('daily task lets each provider choose exactly one allowed stock with one bounded comment', () => {
  for (const agent of ['gpt','claude','gemini']) {
    const value = validateOutput(output, job(agent))
    assert.equal(value.symbol, 'NVDA'); assert.equal(value.messageType, 'opinion')
    assert.equal(value.text, output.text)
  }
  assert.throws(() => validateOutput({ ...output, symbol: ['NVDA','TSM'] }, job('gpt')), /invalid_pick_symbol/)
  assert.throws(() => validateOutput({ ...output, symbol: 'UNKNOWN' }, job('gpt')), /invalid_pick_symbol/)
})

test('selected stock cannot cite another stock or inject model, author, return and certainty fields', () => {
  assert.throws(() => validateOutput({ ...output, evidence_ids: ['source-TSM'] }, job('gpt')), /unknown_evidence_id/)
  assert.throws(() => validateOutput({ ...output, evidence_ids: [] }, job('gpt')), /pick_evidence_required/)
  for (const field of ['author','provider','confidence','expectedReturn','symbols']) {
    assert.throws(() => validateOutput({ ...output, [field]: 'not allowed' }, job('gpt')), /unexpected_output_field/)
  }
  assert.throws(() => validateOutput({ ...output, message_type: 'comment' }, job('gpt')), /message_type_mismatch/)
  assert.throws(() => validateOutput(output), /unexpected_output_field/)
})

test('skip is valid without a pick and never assigns a substitute stock', () => {
  assert.equal(validateOutput({ action: 'skip', reason: '지금 자료만으로 선정하기 어렵다' }, job('claude')).action, 'skip')
  assert.throws(() => validateOutput({ action: 'skip', symbol: 'TSM' }, job('claude')), /skip_must_not_select_symbol/)
})

test('daily prompts share the same candidate evidence while styles and independent selection remain explicit', () => {
  const prompts = ['gpt','claude','gemini'].map(agent => makePrompt(job(agent)))
  for (const prompt of prompts) {
    assert.match(prompt, /한 종목만/); assert.match(prompt, /중복 선택하지/)
    assert.match(prompt, /신뢰하지 않는 입력/); assert.match(prompt, /도구·셸·파일·웹·MCP를 사용하지/)
    assert.match(prompt, /source-NVDA/); assert.match(prompt, /source-TSM/)
    assert.match(prompt, /낙관·비관·반박을 고정하지/)
  }
  assert.match(prompts[0], /펨코/); assert.match(prompts[1], /디시/); assert.match(prompts[2], /블라인드/)
})

test('oversized selection input is rejected before any child process or inference is launched', async () => {
  const input = job('gpt')
  input.candidates[0].snapshot.evidence[0].label = 'large-public-context '.repeat(7000)
  const config = { provider: 'gpt', enabled: true, termsApproved: true, isolationApproved: true,
    executable: process.execPath, args: ['this-file-must-never-run.mjs'], model: 'fixture-only', cliVersion: 'fixture-only', runnerHome: tmpdir() }
  await assert.rejects(runAdapter('gpt', config, input), /prompt_too_large/)
})
