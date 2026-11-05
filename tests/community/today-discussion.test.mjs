import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { validateTodayDiscussion, todayDiscussionForReport } from '../../assets/today-discussion-core.js'
import { createTodayDiscussionResponse, verifyTodayDiscussionHashes, publishTodayDiscussion } from '../../scripts/community/today-discussion.mjs'

const todayBytes = await readFile(new URL('../../data/today-picks.json', import.meta.url), 'utf8')
const today = JSON.parse(todayBytes)
const now = Date.parse('2026-11-05T03:00:00Z')
const generatedAt = '2026-11-05T01:00:00Z', reviewedAt = '2026-11-05T01:01:00Z', createdAt = '2026-11-05T01:02:00Z', publishedAt = '2026-11-05T01:03:00Z'
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex')
const clone = value => structuredClone(value)
const agents = ['gpt', 'claude', 'gemini']
const names = { gpt: 'codex', claude: 'claude-code', gemini: 'gemini' }
function response(parent = today.reports[0], agent = 'claude') {
  const text = '가정은 이해되지만 원래 보고서의 기간과 단위를 먼저 확인해야겠어.'
  return createTodayDiscussionResponse({ parent, agent, text, rawResponse: text + '\r\n', createdAt,
    id: 'peer-' + parent.id + '-' + agent,
    provenance: { provider: agent, requestedModel: agent + '-pinned', reportedModel: null, cliName: names[agent], cliVersion: '1.0.0',
      generatedAt, promptVersion: 'owner-cross-opinion-v1', runId: 'peer-run-' + parent.id + '-' + agent,
      execution: 'owner-reviewed-one-off', reviewedAt } })
}
function six() {
  return { schemaVersion: 1, publishedAt, responses: today.reports.flatMap(parent => agents.filter(agent => agent !== parent.agent).map(agent => response(parent, agent))), states: [] }
}
const validate = value => validateTodayDiscussion(value, { today, now })

test('three original recommendations accept all six peer opinions without retiming or modifying source reports', () => {
  const original = JSON.stringify(today), value = six()
  assert.equal(validate(value), value)
  assert.equal(verifyTodayDiscussionHashes(value, { today }), value)
  assert.equal(value.responses.length, 6)
  for (const parent of today.reports) {
    const result = todayDiscussionForReport(value, parent)
    assert.deepEqual(result.responses.map(row => row.agent).sort(), agents.filter(agent => agent !== parent.agent).sort())
    assert.equal(result.states.length, 0)
    assert.ok(result.responses.every(row => row.symbol === parent.symbol && row.parentReportSha256 === parent.provenance.responseSha256))
  }
  assert.equal(JSON.stringify(today), original)
})

test('one authentic batch can share raw bytes and provenance while retaining distinct parent anchors', () => {
  const value = six(), rows = value.responses.filter(row => row.agent === 'gpt')
  const rawResponse = JSON.stringify({ responses: rows.map((row, index) => ({ parentId: row.parentId, text: '각 추천의 근거를 따로 읽고 기간 가정을 확인하자. ' + index })) }) + '\n'
  rows.forEach((row, index) => {
    row.text = '각 추천의 근거를 따로 읽고 기간 가정을 확인하자. ' + index
    row.rawResponse = rawResponse
    row.provenance.runId = 'peer-shared-gpt-run'
    row.provenance.responseSha256 = digest(rawResponse)
  })
  validate(value); verifyTodayDiscussionHashes(value, { today })
  rows[1].rawResponse += '\n'
  rows[1].provenance.responseSha256 = digest(rows[1].rawResponse)
  assert.throws(() => validate(value), /invalid_today_discussion_provenance/)
})

test('self replies, invented reports, wrong symbols and changed report hashes cannot attach peer text', () => {
  for (const patch of [
    { agent: today.reports[0].agent }, { parentId: 'report-does-not-exist' }, { symbol: 'AMD' }, { parentReportSha256: '0'.repeat(64) },
  ]) {
    const value = six(); Object.assign(value.responses[0], patch)
    assert.throws(() => validate(value), /invalid_today_discussion_parent/)
  }
  const value = six(), parent = clone(today.reports[0])
  parent.provenance.responseSha256 = 'f'.repeat(64)
  assert.deepEqual(todayDiscussionForReport(value, parent), { responses: [], states: [] })
  parent.id = 'replacement-with-same-symbol'
  assert.deepEqual(todayDiscussionForReport(value, parent), { responses: [], states: [] })
})

test('each parent and peer pair, response id and authentic run identity stay unique', () => {
  const repeated = six(); repeated.responses.push(clone(repeated.responses[0]))
  assert.throws(() => validate(repeated), /invalid_today_discussion_response/)
  const pair = six(), duplicate = clone(pair.responses[0]); duplicate.id = 'second-id-same-peer'; duplicate.provenance.runId = 'another-peer-run'; pair.responses.push(duplicate)
  assert.throws(() => validate(pair), /invalid_today_discussion_parent/)
  const collision = six(); collision.responses[1].provenance.runId = collision.responses[0].provenance.runId
  assert.throws(() => validate(collision), /invalid_today_discussion_provenance/)
})

test('text must be unchanged raw output or an exact parsed JSON text field', () => {
  const value = six(), row = value.responses[0]
  row.text = '첫째 줄의 가정을 읽고\n다음 줄의 한계를 확인하자.'
  row.rawResponse = '```json\n' + JSON.stringify({ text: row.text }) + '\n```\r\n'
  row.provenance.responseSha256 = digest(row.rawResponse)
  validate(value); verifyTodayDiscussionHashes(value, { today })
  for (const text of ['AI 대신 작성한 다른 문장이다.', '<script>bad</script>', 'https://untrusted.example/route', '무조건 매수', '가'.repeat(301), '']) {
    const invalid = six(); invalid.responses[0].text = text
    assert.throws(() => validate(invalid), /invalid_today_discussion_response/)
  }
})

test('provider attribution, actual web unknown-model metadata and model fallback rules are enforced', () => {
  const valid = six(), row = valid.responses.find(item => item.agent === 'gemini')
  row.provenance.cliName = 'gemini-web'; row.provenance.cliVersion = null
  row.provenance.requestedModel = 'Gemini 웹 기본 모드'; row.provenance.reportedModel = null
  validate(valid)
  for (const patch of [
    { provider: 'gpt' }, { cliName: 'codex' }, { reportedModel: 'another-model' }, { cliVersion: '1.0.0' },
    { execution: 'simulated' }, { runId: 'mock-run' }, { requestedModel: 'fixture-model' },
  ]) {
    const invalid = clone(valid), target = invalid.responses.find(item => item.agent === 'gemini'); Object.assign(target.provenance, patch)
    assert.throws(() => validate(invalid), /invalid_today_discussion_provenance/)
  }
})

test('a native CLI default may truthfully report its selected model while pinned requests still reject fallback', () => {
  const value = six(), row = value.responses.find(item => item.agent === 'claude')
  row.provenance.requestedModel = 'native-default'
  row.provenance.reportedModel = 'claude-native-current'
  validate(value)
  row.provenance.requestedModel = 'claude-pinned'
  assert.throws(() => validate(value), /invalid_today_discussion_provenance/)
  row.provenance.requestedModel = 'native-default'
  row.provenance.cliName = 'claude-web'; row.provenance.cliVersion = null
  assert.throws(() => validate(value), /invalid_today_discussion_provenance/)
})

test('fresh peer opinions can discuss older reports but cannot precede the parent or bypass review chronology', () => {
  validate(six())
  for (const mutation of [
    row => { row.provenance.generatedAt = '2026-10-01T00:00:00Z' },
    row => { row.provenance.reviewedAt = '2026-11-05T00:59:00Z' },
    row => { row.createdAt = '2026-11-05T01:00:30Z' },
    row => { row.createdAt = '2026-11-05T01:04:00Z' },
  ]) {
    const invalid = six(); mutation(invalid.responses[0])
    assert.throws(() => validate(invalid), /invalid_today_discussion_chronology/)
  }
  const future = six(); future.publishedAt = '2026-11-06T00:00:00Z'
  assert.throws(() => validate(future), /invalid_today_discussion_snapshot/)
  assert.throws(() => validateTodayDiscussion(six(), { today, now: NaN }), /invalid_today_discussion_clock/)
})

test('blocked or pending peers remain explicit states instead of fabricated opinions', () => {
  const value = six(), removed = value.responses.shift()
  value.states.push({ parentId: removed.parentId, parentReportSha256: removed.parentReportSha256, agent: removed.agent, symbol: removed.symbol,
    status: 'blocked', reason: 'authentication_required', checkedAt: createdAt })
  validate(value)
  assert.equal(todayDiscussionForReport(value, today.reports[0]).responses.length, 1)
  assert.equal(todayDiscussionForReport(value, today.reports[0]).states[0].reason, 'authentication_required')
  const duplicate = clone(value); duplicate.responses.push(removed)
  assert.throws(() => validate(duplicate), /invalid_today_discussion_parent/)
  const unsafe = clone(value); unsafe.states[0].reason = 'secret token from exception'
  assert.throws(() => validate(unsafe), /invalid_today_discussion_state/)
  const empty = { schemaVersion: 1, publishedAt: null, responses: [], states: [] }
  validate(empty)
  empty.states.push(value.states[0])
  assert.throws(() => validate(empty), /invalid_today_discussion_snapshot/)
})

test('Node publication independently verifies unchanged raw bytes and original report hashes', () => {
  const value = six()
  assert.ok(value.responses[0].rawResponse.endsWith('\r\n'))
  assert.equal(value.responses[0].provenance.responseSha256, digest(value.responses[0].rawResponse))
  const changed = clone(value); changed.responses[0].rawResponse += '\n'
  validate(changed)
  assert.throws(() => verifyTodayDiscussionHashes(changed, { today }), /today_discussion_response_hash_mismatch/)
  const parentChanged = clone(today); parentChanged.reports[0].report += '\n'
  assert.throws(() => verifyTodayDiscussionHashes(value, { today: parentChanged }), /today_discussion_parent_hash_mismatch/)
})

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-chain-peer-opinions-'))
  t.after(async () => {
    const destination = resolve(root), within = relative(resolve(tmpdir()), destination)
    assert.ok(within && !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    await rm(destination, { recursive: true, force: true })
  })
  await mkdir(join(root, 'data'))
  await writeFile(join(root, 'data', 'today-picks.json'), todayBytes)
  return root
}

test('publishing writes only the separate snapshot atomically and a rejected update preserves the last publication', async t => {
  const root = await temporaryRoot(t), value = six()
  const result = await publishTodayDiscussion({ snapshot: value, root, now })
  assert.equal(result.responses, 6)
  assert.equal(result.output, join(root, 'data', 'today-discussion.json'))
  assert.equal(await readFile(join(root, 'data', 'today-picks.json'), 'utf8'), todayBytes)
  assert.deepEqual(JSON.parse(await readFile(result.output, 'utf8')), value)
  const originalOutput = await readFile(result.output, 'utf8')
  const invalid = clone(value); invalid.responses[0].rawResponse += '\n'
  await assert.rejects(publishTodayDiscussion({ snapshot: invalid, root, now }), /today_discussion_response_hash_mismatch/)
  assert.equal(await readFile(result.output, 'utf8'), originalOutput)
  assert.deepEqual((await readdir(join(root, 'data'))).sort(), ['today-discussion.json', 'today-picks.json'])
})

test('unrecognized fields cannot add price targets, market facts or an alternate source into a peer record', () => {
  const extra = six(); extra.responses[0].fairValue = { price: 999, currency: 'USD' }
  assert.throws(() => validate(extra), /invalid_today_discussion_response/)
  const wrongRoot = six(); wrongRoot.marketData = {}
  assert.throws(() => validate(wrongRoot), /invalid_today_discussion_snapshot/)
})


test('published peer snapshot retains raw hashes and covers both peers for every current report', async () => {
  const value = JSON.parse(await readFile(new URL('../../data/today-discussion.json', import.meta.url), 'utf8'))
  validateTodayDiscussion(value, { today })
  verifyTodayDiscussionHashes(value, { today })
  for (const parent of today.reports) {
    const peers = todayDiscussionForReport(value, parent)
    assert.equal(peers.responses.length + peers.states.length, 2)
    assert.deepEqual([...peers.responses, ...peers.states].map(row => row.agent).sort(), agents.filter(agent => agent !== parent.agent).sort())
  }
})
