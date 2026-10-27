import test from 'node:test'
import assert from 'node:assert/strict'
import { opinionEntry, communityStateLabel, communityReasonLabel, messageProvenance, communityEvidenceUrl } from '../../assets/community-ui-core.js'

const opinion = (id, seq, extra = {}) => ({ id, seq, kind: 'ai', messageType: 'opinion', text: '공개 의견', ...extra })

test('opinion cards retain shared message IDs while history excludes hidden, duplicate and non-opinion messages', () => {
  const latest = opinion('current', 4)
  const entry = opinionEntry({ latest, history: [latest, opinion('old', 2), opinion('old', 2), opinion('hidden', 3, { hidden: true }), opinion('chat', 5, { messageType: 'comment' })] })
  assert.equal(entry.latest, latest)
  assert.deepEqual(entry.history.map(item => item.id), ['old'])
})

test('a hidden latest opinion never becomes a card or exposes its text through history', () => {
  const hidden = opinion('hidden', 4, { hidden: true, text: 'HIDDEN_BODY_MUST_NOT_RENDER' })
  const entry = opinionEntry({ latest: hidden, history: [hidden, opinion('old', 2)] })
  assert.equal(entry.latest, null)
  assert.deepEqual(entry.history.map(item => item.id), ['old'])
  assert.ok(!JSON.stringify(entry).includes('HIDDEN_BODY_MUST_NOT_RENDER'))
  assert.equal(opinionEntry(null).latest, null)
})

test('server job state and reasons are labeled without inventing a running job for missing state', () => {
  assert.equal(communityStateLabel({ status: 'running' }), '생성 중')
  assert.equal(communityStateLabel({ status: 'disabled' }), '현재 참여 중지')
  assert.equal(communityStateLabel(null), '의견 확인 전')
  assert.equal(communityReasonLabel('insufficient_evidence'), '확인된 자료가 부족하여 생성하지 않았습니다.')
})

test('legacy requested-model metadata does not become verified reported-model provenance', () => {
  const result = messageProvenance({ agent: 'gpt', metadata: { model: 'requested-only', cli_version: 'fixture-v1' } })
  assert.equal(result.requestedModel, 'requested-only')
  assert.equal(result.reportedModel, null)
  assert.equal(result.provider, 'gpt')
  assert.equal(result.dataAsOf, null)
})

test('opinion provenance preserves separate publication, generation and evidence metadata', () => {
  const metadata = { provider: 'claude', requestedModel: 'requested', reportedModel: 'reported', cliVersion: 'fixture-v4', generatedAt: '2026-10-27T01:00:00Z', dataAsOf: '2026-10-26T20:00:00Z', contextSnapshotId: 'snapshot-a', evidenceIds: ['evidence-a'], evidence: [], previousOpinionId: 'old', promptVersion: 'v4' }
  assert.deepEqual(messageProvenance({ createdAt: '2026-10-27T02:00:00Z', metadata }), metadata)
})

test('evidence links permit credential-free HTTPS source URLs only', () => {
  assert.equal(communityEvidenceUrl('https://example.com/source?id=one'), 'https://example.com/source?id=one')
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'https://user:secret@example.com', 'not-a-url']) assert.equal(communityEvidenceUrl(value), null)
})
