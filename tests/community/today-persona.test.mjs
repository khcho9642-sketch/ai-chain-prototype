import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { validateTodayPersonas, getPersonaForReport } from '../../assets/today-persona-core.js'
import { createPersonaRewrite, verifyTodayPersonaHashes, publishTodayPersonas } from '../../scripts/community/today-persona.mjs'

const todayBytes = await readFile(new URL('../../data/today-picks.json', import.meta.url), 'utf8')
const today = JSON.parse(todayBytes), now = Date.parse('2026-11-05T12:00:00Z')
const names = { gpt: 'codex', claude: 'claude-code', gemini: 'gemini' }
const headline = '가정부터 하나씩 까보는 내 분석 노트'
const comment = '숫자가 커 보여도 기간을 섞으면 판단이 흔들려. 원래 보고서의 가정부터 확인하고 다음 실적에서 수익력이 유지되는지 보자. 분위기만 보고 결론부터 달리면 안 돼.'
const paragraph = '사업의 역할은 원래 보고서에 적힌 근거부터 확인하자. 시장이 기대하는 성장과 실제로 확인한 실적을 섞지 않는 게 핵심이야. 이익이 유지된다는 가정과 평가 배수는 서로 다른 문제라서 따로 읽어야 해. '
const analysis = Array.from({ length: 3 }, () => paragraph.repeat(2).trim()).join('\n\n')
function rewrite(parent = today.reports[0]) {
  return createPersonaRewrite({ parent, headline, comment, analysis, rawResponse: JSON.stringify({ headline, comment, analysis }) + '\r\n',
    createdAt: '2026-11-05T08:02:00Z', id: 'persona-' + parent.id,
    provenance: { provider: parent.agent, requestedModel: parent.agent + '-pinned', reportedModel: null, cliName: names[parent.agent], cliVersion: '1.0.0',
      generatedAt: '2026-11-05T08:00:00Z', promptVersion: 'owner-persona-rewrite-v1', runId: 'persona-run-' + parent.id,
      execution: 'owner-reviewed-one-off', reviewedAt: '2026-11-05T08:01:00Z' } })
}
const snapshot = () => ({ schemaVersion: 1, publishedAt: '2026-11-05T08:03:00Z', rewrites: today.reports.map(rewrite) })
const validate = value => validateTodayPersonas(value, { today, now })
const clone = value => structuredClone(value)

test('same-author expressions retain their original report identity, raw bytes and sources', () => {
  const original = JSON.stringify(today), value = snapshot()
  assert.equal(validate(value), value)
  assert.equal(verifyTodayPersonaHashes(value, { today }), value)
  for (const parent of today.reports) assert.equal(getPersonaForReport(value, parent).agent, parent.agent)
  assert.equal(JSON.stringify(today), original)
  const replaced = clone(today.reports[0]); replaced.provenance.responseSha256 = 'f'.repeat(64)
  assert.equal(getPersonaForReport(value, replaced), null)
  replaced.provenance.responseSha256 = today.reports[0].provenance.responseSha256; replaced.id = 'replacement-report'
  assert.equal(getPersonaForReport(value, replaced), null)
})

test('unknown fields, wrong authors, duplicated parents and changed source hashes are rejected', () => {
  for (const patch of [{ fairValue: { price: 999 } }, { agent: 'claude' }, { parentReportSha256: '0'.repeat(64) }, { symbol: 'AMD' }]) {
    const value = snapshot(); Object.assign(value.rewrites[0], patch)
    assert.throws(() => validate(value), /invalid_today_persona/)
  }
  const duplicate = snapshot(); duplicate.rewrites.push({ ...clone(duplicate.rewrites[0]), id: 'second-persona-id' })
  assert.throws(() => validate(duplicate), /invalid_today_persona_parent/)
})

test('display strings must be exact fields from one original JSON object and use informal speech', () => {
  const changed = snapshot(); changed.rewrites[0].comment += ' 다른 문장.'
  assert.throws(() => validate(changed), /invalid_today_persona_rewrite/)
  for (const text of ['이 가정은 다시 확인해야 합니다.', '이 가정은 위험할 수 있어요.', '이것이 제 생각이에요.']) {
    const value = snapshot(), row = value.rewrites[0]
    row.comment = comment + ' ' + text
    row.rawResponse = JSON.stringify({ headline, comment: row.comment, analysis })
    assert.throws(() => validate(value), /invalid_today_persona_rewrite/)
  }
  const split = snapshot(), row = split.rewrites[0]
  row.rawResponse = JSON.stringify([{ headline, comment }, { analysis }])
  assert.throws(() => validate(split), /invalid_today_persona_rewrite/)
  const fenced = snapshot(); fenced.rewrites[0] = rewrite()
  fenced.rewrites[0].rawResponse = '```json\n' + JSON.stringify({ headline, comment, analysis }) + '\n```\r\n'
  validate(fenced)
})

test('authorship, model provenance, review chronology and independently checked hashes cannot drift', () => {
  const value = snapshot(), original = clone(value)
  value.rewrites[0].provenance.reportedModel = 'different-model'
  assert.throws(() => validate(value), /invalid_today_persona_provenance/)
  const earlier = clone(original); earlier.rewrites[0].provenance.generatedAt = '2026-10-01T00:00:00Z'
  assert.throws(() => validate(earlier), /invalid_today_persona_chronology/)
  const bytes = clone(original); bytes.rewrites[0].rawResponse += '\n'
  validate(bytes)
  assert.throws(() => verifyTodayPersonaHashes(bytes, { today }), /today_persona_response_hash_mismatch/)
  const parent = clone(today); parent.reports[0].report += '\n'
  assert.throws(() => verifyTodayPersonaHashes(original, { today: parent }), /today_persona_parent_hash_mismatch/)
})

test('publication writes only the expression snapshot and preserves the last valid publication on failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ai-chain-persona-'))
  t.after(async () => {
    const destination = resolve(root), within = relative(resolve(tmpdir()), destination)
    assert.ok(within && !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    await rm(destination, { recursive: true, force: true })
  })
  await mkdir(join(root, 'data')); await writeFile(join(root, 'data', 'today-picks.json'), todayBytes)
  const value = snapshot(), result = await publishTodayPersonas({ snapshot: value, root, now })
  assert.equal(result.rewrites, 3)
  assert.equal(await readFile(join(root, 'data', 'today-picks.json'), 'utf8'), todayBytes)
  const before = await readFile(result.output, 'utf8')
  const invalid = clone(value); invalid.rewrites[0].rawResponse += '\n'
  await assert.rejects(publishTodayPersonas({ snapshot: invalid, root, now }), /today_persona_response_hash_mismatch/)
  assert.equal(await readFile(result.output, 'utf8'), before)
})
test('explicit denials of guaranteed returns remain valid while positive guarantees are rejected', () => {
  for (const ending of ['이건 수익 보장이 아님.', '이 계산은 수익을 보장하지 않아.']) {
    const value = snapshot(), row = value.rewrites[0]
    row.comment = comment + ' ' + ending
    row.rawResponse = JSON.stringify({ headline, comment: row.comment, analysis })
    validate(value)
  }
  for (const ending of ['이 종목은 수익 보장.', '이 종목은 수익을 보장해.']) {
    const value = snapshot(), row = value.rewrites[0]
    row.comment = comment + ' ' + ending
    row.rawResponse = JSON.stringify({ headline, comment: row.comment, analysis })
    assert.throws(() => validate(value), /invalid_today_persona_rewrite/)
  }
})
