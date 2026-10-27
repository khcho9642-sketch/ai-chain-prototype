import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { kstDate, validateTodaySnapshot, todayCards } from '../../assets/today-core.js'

const now = Date.parse('2026-10-27T03:00:00Z')
const catalog = [{ symbol: 'NVDA', name: '엔비디아', chains: [4] }, { symbol: '005930.KS', name: '삼성전자', chains: [2, 3] }, { symbol: 'BTC-USD', name: '비트코인', chains: [0] }]
const initial = () => ({ schemaVersion: 1, timezone: 'Asia/Seoul', editionDate: null, publishedAt: null, picks: [], providerStates: {
  gpt: { status: 'disabled', reason: 'verification_pending' }, claude: { status: 'disabled', reason: 'usage_review_required' }, gemini: { status: 'disabled', reason: 'cli_unavailable' },
} })
// Production-shaped validation inputs only. Never publish these test records.
const pick = (agent = 'gpt', overrides = {}) => ({ id: `opinion-${agent}-20261027`, agent, symbol: 'NVDA',
  comment: '새 자료에서 기대하는 이유는 이해되는데, 확인한 범위와 자료의 기준 시각을 먼저 구분해서 보자.',
  createdAt: '2026-10-27T02:00:00Z', dataAsOf: '2026-10-26T20:00:00Z', evidence: [{ id: 'quote-nvda-close', symbol: 'NVDA', label: '전일 관측 시세', sourceUrl: 'https://finance.yahoo.com/quote/NVDA/', observedAt: '2026-10-26T20:00:00Z', collectedAt: '2026-10-27T01:00:00Z' }],
  provenance: { provider: agent, requestedModel: agent + '-pinned', reportedModel: null, cliVersion: 'cli-1.0.0', generatedAt: '2026-10-27T01:30:00Z', promptVersion: 'today-v1', runId: `run-${agent}-20261027`, execution: 'official-cli', reviewedAt: '2026-10-27T02:05:00Z' }, ...overrides })
const edition = picks => ({ ...initial(), editionDate: '2026-10-27', publishedAt: '2026-10-27T02:10:00Z', picks })
const validate = value => validateTodaySnapshot(value, { now, catalog })
const clone = value => structuredClone(value)

test('empty public initial snapshot contains no invented recommendations or AI responses', async () => {
  const value = JSON.parse(await readFile(new URL('../../data/today-picks.json', import.meta.url), 'utf8'))
  assert.equal(validate(value), value)
  const cards = todayCards(value, { now, catalog })
  assert.deepEqual(cards.map(card => card.agent), ['gpt', 'claude', 'gemini'])
  assert.equal(cards.every(card => card.pick === null && card.state === 'unavailable'), true)
  assert.equal(value.editionDate, null)
})

test('KST edition changes at local midnight rather than UTC midnight', () => {
  assert.equal(kstDate(Date.parse('2026-10-26T14:59:59Z')), '2026-10-26')
  assert.equal(kstDate(Date.parse('2026-10-26T15:00:00Z')), '2026-10-27')
  assert.throws(() => kstDate(NaN), /invalid_today_clock/)
  const premature = edition([]); premature.publishedAt = '2026-10-26T15:01:00Z'
  assert.throws(() => validateTodaySnapshot(premature, { catalog, now: Date.parse('2026-10-26T14:59:00Z') }), /invalid_today_publication_time/)
})

test('zero and partial editions keep three slots without borrowing another model response', () => {
  const empty = edition([]); assert.equal(validate(empty), empty)
  const value = edition([pick()]), cards = todayCards(value, { now, catalog })
  assert.equal(cards[0].state, 'published')
  assert.equal(cards[0].pick.agent, 'gpt')
  assert.equal(cards[1].pick, null)
  assert.equal(cards[2].pick, null)
})

test('three providers may independently select the same catalog company', () => {
  const value = edition(['gpt', 'claude', 'gemini'].map(agent => pick(agent)))
  assert.equal(validate(value).picks.length, 3)
  assert.equal(todayCards(value, { now, catalog }).every(card => card.state === 'published' && card.pick.symbol === 'NVDA'), true)
})

test('past editions preserve actual dates and do not become today picks after refresh', () => {
  const value = edition([pick()]), later = Date.parse('2026-10-28T01:00:00Z')
  const cards = todayCards(value, { now: later, catalog })
  assert.equal(cards[0].state, 'previous-edition')
  assert.equal(cards[0].editionDate, '2026-10-27')
  assert.equal(cards[0].pick.createdAt, value.picks[0].createdAt)
  assert.equal(cards[0].publishedAt, value.publishedAt)
})

test('catalog eligibility is dynamic and unknown tickers or non-company instruments are rejected', () => {
  for (const symbol of ['NOT-A-STOCK', 'BTC-USD']) assert.throws(() => validate(edition([pick('gpt', { symbol })])), /invalid_today_pick/)
  const added = { symbol: 'NEW', name: '추가 기업', chains: [7] }, value = edition([pick('gpt', { symbol: 'NEW', evidence: [{ ...pick().evidence[0], symbol: 'NEW' }] })])
  assert.equal(validateTodaySnapshot(value, { now, catalog: [...catalog, added] }), value)
})

test('duplicate provider, message, or execution IDs are rejected while stock duplication is allowed', () => {
  assert.throws(() => validate(edition([pick(), pick()])), /invalid_today_pick/)
  assert.throws(() => validate(edition([pick(), pick('claude', { id: pick().id })])), /invalid_today_pick/)
  const second = pick('claude'); second.provenance.runId = pick().provenance.runId
  assert.throws(() => validate(edition([pick(), second])), /invalid_today_provenance/)
})

test('an unreported model stays null and a substituted provider or reported model is rejected', () => {
  const value = edition([pick()]); assert.equal(validate(value).picks[0].provenance.reportedModel, null)
  for (const patch of [{ provider: 'claude' }, { reportedModel: 'another-model' }, { execution: 'manual' }]) {
    const next = clone(value); Object.assign(next.picks[0].provenance, patch)
    assert.throws(() => validate(next), /invalid_today_provenance/)
  }
})

test('public picks reject fixture identities, unsafe sources and unreviewed output', () => {
  for (const field of ['requestedModel', 'cliVersion', 'runId']) {
    const value = edition([pick()]); value.picks[0].provenance[field] = 'fixture-not-real-ai'
    assert.throws(() => validate(value), /invalid_today_provenance/)
  }
  for (const sourceUrl of ['https://example.com/source', 'https://u:secret@finance.yahoo.com/', 'javascript:alert(1)', 'http://finance.yahoo.com/', 'https://127.0.0.1/private']) {
    const value = edition([pick()]); value.picks[0].evidence[0].sourceUrl = sourceUrl
    assert.throws(() => validate(value), /invalid_today_evidence/)
  }
  const unreviewed = edition([pick()]); unreviewed.picks[0].provenance.reviewedAt = null
  assert.throws(() => validate(unreviewed), /invalid_today_provenance/)
})

test('old observation and new collection dates remain separate and cannot be relabeled as fresh data', () => {
  const value = edition([pick()]); value.picks[0].evidence[0].observedAt = '2026-10-23T20:00:00Z'; value.picks[0].dataAsOf = '2026-10-23T20:00:00Z'
  assert.equal(validate(value).picks[0].dataAsOf, '2026-10-23T20:00:00Z')
  value.picks[0].dataAsOf = '2026-10-27T01:00:00Z'
  assert.throws(() => validate(value), /invalid_today_data_as_of/)
})

test('future, backdated, out-of-order and cross-stock records fail validation', () => {
  for (const patch of [{ createdAt: '2026-10-28T00:00:00Z' }, { createdAt: '2026-10-26T02:00:00Z' }, { createdAt: '2026-10-27T01:00:00Z' }]) assert.throws(() => validate(edition([pick('gpt', patch)])), /invalid_today_chronology/)
  const other = edition([pick()]); other.picks[0].evidence[0].symbol = '005930.KS'
  assert.throws(() => validate(other), /invalid_today_evidence/)
  const future = edition([pick()]); future.publishedAt = '2026-10-27T05:00:00Z'
  assert.throws(() => validate(future), /invalid_today_publication_time/)
})

test('unapproved fields, fake social counts, HTML and malformed dates do not enter the public snapshot', () => {
  for (const patch of [{ likes: 500 }, { confidence: 100 }, { trade: 'buy' }]) assert.throws(() => validate({ ...edition([pick()]), ...patch }), /invalid_today_snapshot/)
  for (const comment of ['<script>alert("x")</script>', '짧은 글', '가'.repeat(161)]) assert.throws(() => validate(edition([pick('gpt', { comment })])), /invalid_today_pick/)
  const date = edition([]); date.editionDate = '2026-02-30'
  assert.throws(() => validate(date), /invalid_today_snapshot/)
})
