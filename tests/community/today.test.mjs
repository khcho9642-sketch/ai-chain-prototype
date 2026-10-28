import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { kstDate, validateTodaySnapshot, todayCards, getTodayComment } from '../../assets/today-core.js'

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
const response = (parent = pick(), agent = 'claude', overrides = {}) => {
  const base = pick(agent)
  return { ...base, id: `response-${agent}-${parent.agent}`, parentId: parent.id, symbol: parent.symbol,
    comment: '기대하는 방향은 이해하지만, 자료가 확인해 주는 범위 안에서 다음 변화를 지켜보자는 데 동의해.',
    createdAt: '2026-10-27T02:02:00Z', provenance: { ...base.provenance, runId: `response-run-${agent}-${parent.agent}`, generatedAt: '2026-10-27T02:01:00Z' }, ...overrides }
}
const threaded = (picks = [pick()], responses = [response(picks[0])]) => ({ ...edition(picks), schemaVersion: 2, responses })
const fairValue = () => ({ price: 220, currency: 'USD', asOf: '2026-10-27T01:30:00Z',
  method: '확인한 주당 이익에 가정한 이익 배수를 적용한다.', assumptions: ['배수는 검토용 가정이며 실현을 보장하지 않는다.'], evidenceIds: ['quote-nvda-close'] })
const reviewedReport = (agent = 'gpt') => {
  const base = pick(agent)
  return { ...base, id: `reviewed-report-${agent}`, kind: agent === 'claude' ? 'earnings-review' : 'stock-opinion',
    comment: '자료의 분기와 주당 단위를 구분해야 한다.', report: '자료의 분기와 주당 단위를 구분해야 한다.\n공식 출처: https://www.nvidia.com/en-us/',
    createdAt: '2026-10-27T02:08:00Z', reviewNotes: ['수동 검토한 실제 원문의 일부를 댓글로 표시한다.'],
    provenance: { ...base.provenance, runId: `reviewed-report-run-${agent}`, execution: 'owner-reviewed-one-off',
      cliName: { gpt: 'codex', claude: 'claude-code', gemini: 'antigravity' }[agent], responseSha256: 'a'.repeat(64) } }
}
const reportsEdition = (reports = [reviewedReport()]) => ({ ...threaded([pick()], []), schemaVersion: 3, reports })
const conversationComment = report => ({ id: `conversation-comment-${report.agent}`,
  text: '분기 성적표 한 장으로 연간 졸업앨범 만들지는 말자ㅋㅋ.',
  response: '분기 성적표 한 장으로 연간 졸업앨범 만들지는 말자ㅋㅋ.\r\n',
  sourceReportSha256: report.provenance.responseSha256, createdAt: '2026-10-27T02:10:00Z',
  provenance: { ...report.provenance, runId: `conversation-comment-run-${report.agent}`, generatedAt: '2026-10-27T02:08:30Z',
    reviewedAt: '2026-10-27T02:09:00Z', promptVersion: 'owner-conversation-v1', responseSha256: 'b'.repeat(64) } })
const conversationalEdition = (agent = 'gpt') => {
  const report = reviewedReport(agent)
  report.conversationComment = conversationComment(report)
  return reportsEdition([report])
}

test('committed public snapshot validates against the real catalog and preserves three author slots', async () => {
  const value = JSON.parse(await readFile(new URL('../../data/today-picks.json', import.meta.url), 'utf8'))
  assert.equal(validateTodaySnapshot(value), value)
  const cards = todayCards(value)
  assert.deepEqual(cards.map(card => card.agent), ['gpt', 'claude', 'gemini'])
})

test('empty initial snapshot contains no invented recommendations or AI responses', () => {
  const value = initial(), cards = todayCards(value, { now, catalog })
  assert.equal(cards.every(card => card.pick === null && card.state !== 'published'), true)
  assert.equal(cards.every(card => card.responses.length === 0), true)
  assert.equal(value.editionDate, null)
})

test('business context preserves an official source and review date without crossing stocks or inventing dates', () => {
  const value = edition([pick()])
  value.picks[0].businessProfile = { symbol: 'NVDA', role: 'GPU·AI 컴퓨팅', sourceUrl: 'https://www.nvidia.com/en-us/', reviewedAt: '2026-10-26' }
  assert.equal(validate(value), value)
  for (const changes of [{symbol:'AMD'}, {sourceUrl:'http://www.nvidia.com/'}, {reviewedAt:'2026-10-28'}, {unapproved:'extra'}]) {
    const bad = clone(value); Object.assign(bad.picks[0].businessProfile, changes)
    assert.throws(() => validate(bad),/invalid_today_business_source/)
  }
})

test('reviewed initial picks may preserve an explicit fair-value estimate without changing old records', () => {
  const older = edition([pick()])
  assert.equal(validate(older), older)
  assert.equal(Object.hasOwn(older.picks[0], 'fairValue'), false)
  for (const value of [edition([pick('gpt', { fairValue: fairValue() })]), threaded([pick('gpt', { fairValue: fairValue() })], [])]) {
    assert.equal(validate(value), value)
    assert.equal(todayCards(value, { now, catalog })[0].pick.fairValue.price, 220)
    assert.deepEqual(value.picks[0].fairValue.evidenceIds, ['quote-nvda-close'])
  }
})

test('fair-value estimates reject invalid prices, currencies, missing fields and unapproved additions', () => {
  for (const changes of [{ price: 0 }, { price: -1 }, { price: NaN }, { price: Infinity }, { price: '220' },
    { currency: 'usd' }, { currency: 'US' }, { currency: 'USD/share' }, { method: '' }, { method: '가'.repeat(1001) }, { confidence: 100 }]) {
    const value = edition([pick('gpt', { fairValue: { ...fairValue(), ...changes } })])
    assert.throws(() => validate(value), /invalid_today_fair_value/)
  }
  for (const estimate of [null, undefined, {}, { ...fairValue(), assumptions: undefined }]) {
    assert.throws(() => validate(edition([pick('gpt', { fairValue: estimate })])), /invalid_today_fair_value/)
  }
})

test('fair-value assumptions and cited evidence must be bounded, nonempty and distinct', () => {
  for (const changes of [{ assumptions: [] }, { assumptions: [''] }, { assumptions: ['공통 가정', '공통 가정'] },
    { assumptions: [' 가정'] }, { assumptions: ['가'.repeat(401)] }, { assumptions: Array.from({ length: 13 }, (_, i) => `가정 ${i}`) },
    { evidenceIds: [] }, { evidenceIds: ['unknown-financial-source'] }, { evidenceIds: ['quote-nvda-close', 'quote-nvda-close'] }, { evidenceIds: [null] }]) {
    assert.throws(() => validate(edition([pick('gpt', { fairValue: { ...fairValue(), ...changes } })])), /invalid_today_fair_value/)
  }
  const foreign = edition([pick('gpt', { fairValue: fairValue() })]); foreign.picks[0].evidence[0].symbol = '005930.KS'
  assert.throws(() => validate(foreign), /invalid_today_evidence/)
})

test('fair-value as-of dates cannot follow actual generation or precede their cited observations', () => {
  for (const asOf of ['2026-02-30T01:00:00Z', '2026-10-27', '2026-10-27T01:30:01Z', '2026-10-26T19:59:59Z']) {
    assert.throws(() => validate(edition([pick('gpt', { fairValue: { ...fairValue(), asOf } })])), /invalid_today_fair_value/)
  }
  const value = edition([pick('gpt', { fairValue: { ...fairValue(), asOf: '2026-10-26T20:00:00Z' } })])
  assert.equal(validate(value), value)
})

test('replies cannot attach a separate valuation or reuse the initial-pick extension', () => {
  assert.throws(() => validate(threaded([pick()], [response(pick(), 'claude', { fairValue: fairValue() })])), /invalid_today_response/)
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

test('v1 remains compatible while v2 requires an explicit bounded response collection', () => {
  const old = edition([pick()]); assert.equal(validate(old), old)
  assert.deepEqual(todayCards(old, { now, catalog })[0].responses, [])
  const empty = { ...initial(), schemaVersion: 2, responses: [] }
  assert.equal(validate(empty), empty)
  assert.equal(todayCards(empty, { now, catalog }).every(card => card.responses.length === 0), true)
  assert.throws(() => validate({ ...old, responses: [] }), /invalid_today_snapshot/)
  const missing = threaded(); delete missing.responses
  assert.throws(() => validate(missing), /invalid_today_snapshot/)
  const tooMany = threaded(); tooMany.responses = Array(4).fill(response())
  assert.throws(() => validate(tooMany), /invalid_today_snapshot/)
})

test('three independently authored replies attach to their real parent comments and archive together', () => {
  const picks = ['gpt', 'claude', 'gemini'].map(agent => pick(agent))
  const responses = [response(picks[0], 'claude'), response(picks[1], 'gemini'), response(picks[2], 'gpt')]
  const value = threaded(picks, responses)
  assert.equal(validate(value), value)
  const cards = todayCards(value, { now, catalog })
  assert.deepEqual(cards.map(card => card.responses[0].parentId), picks.map(pick => pick.id))
  assert.deepEqual(cards.map(card => card.responses[0].agent), ['claude', 'gemini', 'gpt'])
  const older = todayCards(value, { now: now + 86400000, catalog })
  assert.equal(older.every(card => card.state === 'previous-edition' && card.responses.length === 1), true)
})

test('replies require an initial parent from another agent in the same stock', () => {
  for (const patch of [{ parentId: 'missing' }, { parentId: response().id }, { symbol: '005930.KS', evidence: [{ ...pick().evidence[0], symbol: '005930.KS' }] }]) {
    assert.throws(() => validate(threaded([pick()], [response(pick(), 'claude', patch)])), /invalid_today_response_parent/)
  }
  assert.throws(() => validate(threaded([pick()], [response(pick(), 'gpt')])), /invalid_today_response_parent/)
})

test('only one reply per parent and one reply per agent may enter an edition', () => {
  const picks = [pick(), pick('claude')]
  assert.throws(() => validate(threaded(picks, [response(picks[0], 'claude'), response(picks[0], 'gemini')])), /invalid_today_response_limit/)
  assert.throws(() => validate(threaded(picks, [response(picks[0], 'gemini'), response(picks[1], 'gemini')])), /invalid_today_response_limit/)
})

test('reply IDs and execution IDs cannot collide with any pick or another reply', () => {
  const parent = pick(), other = response(parent)
  assert.throws(() => validate(threaded([parent], [{ ...other, id: parent.id }])), /invalid_today_response/)
  other.provenance.runId = parent.provenance.runId
  assert.throws(() => validate(threaded([parent], [other])), /invalid_today_provenance/)
  const picks = [pick(), pick('claude')], replies = [response(picks[0], 'claude'), response(picks[1], 'gemini')]
  replies[1].id = replies[0].id
  assert.throws(() => validate(threaded(picks, replies)), /invalid_today_response/)
})

test('reply source and actual generation provenance use the same fail-closed checks as initial comments', () => {
  for (const patch of [{ provider: 'gpt' }, { requestedModel: 'fixture-only' }, { reportedModel: 'substituted' }, { reviewedAt: null }]) {
    const value = threaded(); Object.assign(value.responses[0].provenance, patch)
    assert.throws(() => validate(value), /invalid_today_provenance/)
  }
  const foreign = threaded(); foreign.responses[0].evidence[0].symbol = '005930.KS'
  assert.throws(() => validate(foreign), /invalid_today_evidence/)
  const unsafe = threaded(); unsafe.responses[0].evidence[0].sourceUrl = 'https://example.com/response'
  assert.throws(() => validate(unsafe), /invalid_today_evidence/)
  assert.throws(() => validate(threaded([pick()], [response(pick(), 'claude', { evidence: [] })])), /invalid_today_response/)
})

test('a reply is generated after its parent and cannot be backdated, future-dated or relabeled with new data', () => {
  const early = threaded(); early.responses[0].provenance.generatedAt = '2026-10-27T01:59:00Z'
  assert.throws(() => validate(early), /invalid_today_response_parent/)
  const previous = threaded(); previous.responses[0].provenance.generatedAt = '2026-10-26T02:01:00Z'
  assert.throws(() => validate(previous), /invalid_today_chronology/)
  const late = threaded(); late.responses[0].createdAt = '2026-10-27T02:11:00Z'
  assert.throws(() => validate(late), /invalid_today_chronology/)
  const relabeled = threaded(); relabeled.responses[0].dataAsOf = relabeled.responses[0].createdAt
  assert.throws(() => validate(relabeled), /invalid_today_data_as_of/)
})

test('reply bodies allow agreement or disagreement without fake reactions or nested reply fields', () => {
  for (const comment of ['동의해.', '같은 자료라도 결론은 다를 수 있지. 이 근거만으로는 낙관하기 어렵다고 봐.']) assert.equal(validate(threaded([pick()], [response(pick(), 'claude', { comment })])).responses.length, 1)
  for (const patch of [{ comment: '가' }, { comment: '가'.repeat(301) }, { comment: '<b>가짜 HTML 댓글</b>' }, { likes: 10 }, { parent: pick().id }, { responses: [] }]) {
    assert.throws(() => validate(threaded([pick()], [response(pick(), 'claude', patch)])), /invalid_today_response/)
  }
})

test('v3 displays independently reviewed reports while retaining the original publication and worker states', () => {
  const reports = ['gpt', 'claude', 'gemini'].map(agent => reviewedReport(agent)), value = reportsEdition(reports)
  const original = clone(value.picks[0]), providerStates = clone(value.providerStates)
  assert.equal(validate(value), value)
  const cards = todayCards(value, { now, catalog })
  assert.deepEqual(cards.map(card => card.report.agent), ['gpt', 'claude', 'gemini'])
  assert.equal(cards.every(card => card.state === 'published' && card.reason === 'reviewed_one_off_publication'), true)
  assert.deepEqual(cards[0].pick, original)
  assert.deepEqual(value.providerStates, providerStates)
  assert.equal(cards[2].report.provenance.cliName, 'antigravity')
  assert.equal(cards[2].report.provenance.reportedModel, null)
})

test('v3 requires an explicit bounded report array and does not silently relax v2', () => {
  const missing = reportsEdition(); delete missing.reports
  assert.throws(() => validate(missing), /invalid_today_snapshot/)
  assert.throws(() => validate(reportsEdition(Array(4).fill(reviewedReport()))), /invalid_today_snapshot/)
  const older = threaded(); older.reports = []
  assert.throws(() => validate(older), /invalid_today_snapshot/)
  assert.equal(validate(reportsEdition([])).reports.length, 0)
  const empty = { ...initial(), schemaVersion: 3, responses: [], reports: [] }
  assert.equal(validate(empty), empty)
  empty.reports.push(reviewedReport())
  assert.throws(() => validate(empty), /invalid_today_edition/)
})

test('Claude factual reviews cannot masquerade as a selected stock or contain an attributed fair value', () => {
  const value = reportsEdition([reviewedReport('claude')])
  assert.equal(validate(value).reports[0].kind, 'earnings-review')
  for (const patch of [{ kind: 'stock-opinion' }, { kind: 'recommendation' }, { fairValue: fairValue() }, { selected: true }]) {
    const bad = clone(value); Object.assign(bad.reports[0], patch)
    assert.throws(() => validate(bad), /invalid_today_report/)
  }
  const gpt = reportsEdition(); gpt.reports[0].fairValue = fairValue()
  assert.equal(validate(gpt).reports[0].fairValue.price, 220)
  gpt.reports[0].fairValue.evidenceIds = ['another-stock-evidence']
  assert.throws(() => validate(gpt), /invalid_today_fair_value/)
})

test('a displayed report comment is an exact excerpt with explicit editorial notes and bounded plaintext', () => {
  const value = reportsEdition()
  assert.equal(validate(value).reports[0].report.includes(value.reports[0].comment), true)
  value.reports[0].report += '\r\n'
  assert.equal(validate(value).reports[0].report.endsWith('\r\n'), true)
  for (const patch of [{ comment: '원문에 없는 다른 모델의 대필 문장' }, { report: '<script>alert(1)</script>' },
    { report: '가'.repeat(16001) }, { reviewNotes: [] }, { reviewNotes: ['수정', '수정'] }, { reviewNotes: ['<b>수정</b>'] },
    { likes: 100 }, { parentId: pick().id }]) {
    const bad = clone(value); Object.assign(bad.reports[0], patch)
    assert.throws(() => validate(bad), /invalid_today_report/)
  }
})

test('one-off reports require the actual CLI family and complete source metadata without enabling old pick execution', () => {
  for (const patch of [{ cliName: 'gemini' }, { execution: 'official-cli' }, { responseSha256: 'A'.repeat(64) },
    { responseSha256: 'abc' }, { reportedModel: 'some-other-model' }, { provider: 'claude' }]) {
    const value = reportsEdition(); Object.assign(value.reports[0].provenance, patch)
    assert.throws(() => validate(value), /invalid_today_provenance/)
  }
  const missing = reportsEdition(); delete missing.reports[0].provenance.responseSha256
  assert.throws(() => validate(missing), /invalid_today_report/)
  const old = edition([pick()]); old.picks[0].provenance.execution = 'owner-reviewed-one-off'
  assert.throws(() => validate(old), /invalid_today_provenance/)
})

test('reports publish at the actual new date while preserving earlier generation and original pick dates', () => {
  const value = reportsEdition(), nextDay = Date.parse('2026-10-28T03:00:00Z')
  value.editionDate = '2026-10-28'; value.publishedAt = '2026-10-28T02:10:00Z'
  value.reports[0].createdAt = '2026-10-28T02:08:00Z'
  value.reports[0].provenance.reviewedAt = '2026-10-28T02:05:00Z'
  assert.equal(validateTodaySnapshot(value, { now: nextDay, catalog }), value)
  const cards = todayCards(value, { now: nextDay, catalog })
  assert.equal(cards[0].state, 'published')
  assert.equal(cards[0].report.provenance.generatedAt, '2026-10-27T01:30:00Z')
  assert.equal(cards[0].pick.createdAt, '2026-10-27T02:00:00Z')
  assert.equal(todayCards(value, { now: nextDay + 86400000, catalog })[0].state, 'previous-edition')
  for (const patch of [{ reviewedAt: '2026-10-28T02:09:00Z' }, { reviewedAt: '2026-10-27T02:05:00Z' },
    { generatedAt: '2026-10-28T02:06:00Z' }]) {
    const bad = clone(value); Object.assign(bad.reports[0].provenance, patch)
    assert.throws(() => validateTodaySnapshot(bad, { now: nextDay, catalog }), /invalid_today_chronology/)
  }
})

test('post-generation independent source review remains dated separately from model valuation inputs', () => {
  const value = reportsEdition(), report = value.reports[0]
  report.evidence.push({ id: 'official-earnings-review', symbol: 'NVDA', label: '공식 실적의 사후 검토',
    sourceUrl: 'https://investor.nvidia.com/', observedAt: '2026-10-27T02:03:00Z', collectedAt: '2026-10-27T02:04:00Z' })
  report.dataAsOf = '2026-10-27T02:03:00Z'; report.fairValue = fairValue()
  assert.equal(validate(value), value)
  report.fairValue.evidenceIds.push('official-earnings-review')
  assert.throws(() => validate(value), /invalid_today_fair_value/)
  report.fairValue.evidenceIds.pop(); report.evidence[1].collectedAt = '2026-10-27T02:20:00Z'
  assert.throws(() => validate(value), /invalid_today_evidence/)
})

test('reports cannot duplicate an agent, original message or actual inference run', () => {
  assert.throws(() => validate(reportsEdition([reviewedReport(), { ...reviewedReport(), id: 'another-report', provenance: { ...reviewedReport().provenance, runId: 'another-report-run' } }])), /invalid_today_report_limit/)
  const messageCollision = reportsEdition(); messageCollision.reports[0].id = pick().id
  assert.throws(() => validate(messageCollision), /invalid_today_report/)
  const runCollision = reportsEdition(); runCollision.reports[0].provenance.runId = pick().provenance.runId
  assert.throws(() => validate(runCollision), /invalid_today_provenance/)
})

test('a fresh native conversation comment preserves the original report, excerpt and actual source metadata', () => {
  const value = conversationalEdition(), source = reviewedReport(), report = value.reports[0]
  assert.equal(validate(value), value)
  assert.equal(report.report, source.report)
  assert.equal(report.comment, source.comment)
  assert.deepEqual(report.provenance, source.provenance)
  assert.equal(report.createdAt, source.createdAt)
  assert.equal(getTodayComment(report), report.conversationComment)
  assert.equal(getTodayComment(report).response.endsWith('\r\n'), true)
  assert.deepEqual(getTodayComment(source), { id: source.id, text: source.comment, createdAt: source.createdAt, provenance: source.provenance })
  assert.deepEqual(getTodayComment(pick()), { id: pick().id, text: pick().comment, createdAt: pick().createdAt, provenance: pick().provenance })
})

test('conversation comments bind their exact native response to the correct original report', () => {
  for (const patch of [{ sourceReportSha256: 'c'.repeat(64) }, { response: '이 댓글은 다른 원문이다.' },
    { response: '<script>alert(1)</script>' }, { response: '가'.repeat(16001) }, { text: '가' },
    { text: '가'.repeat(301) }, { text: '보러 가 https://www.nvidia.com/' }, { text: '수익 보장' },
    { text: ' 분기 성적표 한 장으로 연간 졸업앨범 만들지는 말자ㅋㅋ.' }, { symbol: 'AMD' }, { fairValue: fairValue() }]) {
    const value = conversationalEdition(); Object.assign(value.reports[0].conversationComment, patch)
    assert.throws(() => validate(value), /invalid_today_(?:conversation_comment|report)/)
  }
  const missing = conversationalEdition(); delete missing.reports[0].conversationComment.response
  assert.throws(() => validate(missing), /invalid_today_conversation_comment/)
  const old = edition([pick()]); old.picks[0].conversationComment = conversationComment(reviewedReport())
  assert.throws(() => validate(old), /invalid_today_pick/)
})

test('fresh comments require their own matching provider, CLI and complete execution provenance', () => {
  for (const patch of [{ provider: 'claude' }, { cliName: 'antigravity' }, { execution: 'official-cli' },
    { reportedModel: 'other-model' }, { responseSha256: 'ABC' }, { requestedModel: 'fixture-only' },
    { runId: reviewedReport().provenance.runId }]) {
    const value = conversationalEdition(); Object.assign(value.reports[0].conversationComment.provenance, patch)
    assert.throws(() => validate(value), /invalid_today_provenance/)
  }
  const missing = conversationalEdition(); delete missing.reports[0].conversationComment.provenance.responseSha256
  assert.throws(() => validate(missing), /invalid_today_conversation_comment/)
  const idCollision = conversationalEdition(); idCollision.reports[0].conversationComment.id = pick().id
  assert.throws(() => validate(idCollision), /invalid_today_conversation_comment/)
  const nextReportCollision = conversationalEdition()
  const claude = reviewedReport('claude')
  nextReportCollision.reports[0].conversationComment.provenance.runId = claude.provenance.runId
  nextReportCollision.reports.push(claude)
  assert.throws(() => validate(nextReportCollision), /invalid_today_provenance/)
})

test('fresh conversation chronology cannot backdate source generation or future-date publication', () => {
  const early = conversationalEdition(); early.reports[0].conversationComment.provenance.generatedAt = '2026-10-27T01:29:59Z'
  assert.throws(() => validate(early), /invalid_today_conversation_comment/)
  for (const patch of [{ generatedAt: '2026-10-27T02:09:30Z' }, { reviewedAt: '2026-10-27T02:11:00Z' },
    { reviewedAt: '2026-10-26T02:09:00Z' }]) {
    const value = conversationalEdition(); Object.assign(value.reports[0].conversationComment.provenance, patch)
    assert.throws(() => validate(value), /invalid_today_chronology/)
  }
  const late = conversationalEdition(); late.reports[0].conversationComment.createdAt = '2026-10-27T02:10:01Z'
  assert.throws(() => validate(late), /invalid_today_chronology/)
})

test('factual Claude comments retain the existing review scope and cannot add a new attributed valuation', () => {
  const value = conversationalEdition('claude')
  assert.equal(validate(value).reports[0].kind, 'earnings-review')
  assert.equal(getTodayComment(value.reports[0]).provenance.cliName, 'claude-code')
  for (const patch of [{ kind: 'stock-opinion' }, { selected: true }, { fairValue: fairValue() }]) {
    const bad = clone(value); Object.assign(bad.reports[0].conversationComment, patch)
    assert.throws(() => validate(bad), /invalid_today_conversation_comment/)
  }
})
