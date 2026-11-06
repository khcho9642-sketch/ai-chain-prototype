import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hashDebatePacket, publishDebateDay } from '../../scripts/community/debate.mjs'
import { buildDebatePublication } from '../../scripts/deployment/debate-publication.mjs'
import { createSiteServer } from '../../scripts/serve.mjs'

const digest = text => createHash('sha256').update(text).digest('hex')
function reviewedDay() {
  const date = '2026-11-05', topic = { ticker: 'SNDK', name: '샌디스크', sectorId: 'memory', changePct: -2.5, title: '샌디스크 -2.5%, 이 흐름 멈출까?' }
  const closePrice = { value: 100, currency: 'USD', date, sourceUrl: 'https://finance.yahoo.com/quote/SNDK/', observedAt: '2026-11-05T21:00:00Z' }
  const sources = [{ label: '확정 종가', url: closePrice.sourceUrl }], packet = { date, topic, closePrice, sources }, packetSha256 = hashDebatePacket(packet)
  const rawResponse = JSON.stringify({ ticker: 'SNDK', date, stance: '수익성의 조건을 따져보자', stanceLevel: 'neutral', reason: '과거 숫자와 미래 가정은 구분해야 해', analysis: '같은 종가를 놓고 확인한 수익력이 이어지는지 따져보자는 쪽이야. 한 번의 실적이 높았다는 것과 이후에도 그 수준이 유지된다는 얘기는 다르지. 가격 변화의 원인은 이 자료만으로 단정할 수 없어. 아직 근거 없는 가격 범위는 채우지 않고 다음 자료를 기다리는 게 맞아.', basis: '같은 종가와 자료로 비교하며, 범위를 정당화할 추가 자료가 없어 비워뒀어.', scenario: null, pointEstimate: null })
  const stance = { ai: 'gpt', ...JSON.parse(rawResponse), scenario: null, pointEstimate: null, writtenAt: '2026-11-06T08:00:00Z', priceAtWriting: 100, closeDate: date, sources, rawResponse, provenance: { provider: 'gpt', requestedModel: 'gpt-pinned', reportedModel: null, cliName: 'codex', cliVersion: '1.0.0', generatedAt: '2026-11-06T08:00:00Z', reviewedAt: '2026-11-06T08:01:00Z', runId: 'reviewed-publication-run', promptVersion: 'same-topic-debate-v1', responseSha256: digest(rawResponse), packetSha256, execution: 'owner-reviewed-one-off' } }
  return { schemaVersion: 1, id: 'debate-2026-11-05-SNDK', date, publishedAt: '2026-11-06T08:02:00Z', topic, headline: '같은 숫자와 다른 조건을 나눠보자', issue: null, ripple: [], stances: [stance], thread: [], closePrice, packet, packetSha256, summary: null }
}
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'debate-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { source: join(root, 'source'), output: join(root, 'dist') }
}
test('legacy sources without a debate manifest create no new public directory', async t => {
  const { source, output } = await workspace(t)
  await mkdir(join(source, 'data'), { recursive: true }); await mkdir(output, { recursive: true })
  await buildDebatePublication(source, output)
  await assert.rejects(readdir(join(output, 'data', 'debate')), { code: 'ENOENT' })
})
test('build copies only reviewed manifest-listed days and excludes private generation artifacts', async t => {
  const { source, output } = await workspace(t)
  await publishDebateDay({ day: reviewedDay(), root: source, now: Date.parse('2026-11-06T09:00:00Z') })
  await mkdir(join(source, '.local'), { recursive: true })
  await writeFile(join(source, '.local', 'provider-response.json'), '{"private":"credentials never public"}')
  await writeFile(join(source, 'data', 'debate', '2026-11-04.json'), '{"unreviewed":true}')
  await writeFile(join(source, 'data', 'debate', 'private.json'), '{"private":true}')
  await buildDebatePublication(source, output)
  assert.deepEqual((await readdir(join(output, 'data', 'debate'))).sort(), ['2026-11-05.json', 'index.json'])
  assert.equal(JSON.parse(await readFile(join(output, 'data', 'debate', '2026-11-05.json'), 'utf8')).id, reviewedDay().id)
  await assert.rejects(readFile(join(output, '.local', 'provider-response.json')), { code: 'ENOENT' })
})
test('tampered raw hashes stop publication before any public day copy', async t => {
  const { source, output } = await workspace(t), day = reviewedDay()
  await publishDebateDay({ day, root: source, now: Date.parse('2026-11-06T09:00:00Z') })
  day.stances[0].rawResponse += ' '
  await writeFile(join(source, 'data', 'debate', day.date + '.json'), JSON.stringify(day))
  await assert.rejects(buildDebatePublication(source, output), /debate_response_hash_mismatch/u)
  await assert.rejects(readdir(join(output, 'data', 'debate')), { code: 'ENOENT' })
})
test('static serving accepts a listed day with query and rejects private names and invalid paths', async t => {
  const { source, output } = await workspace(t)
  await publishDebateDay({ day: reviewedDay(), root: source, now: Date.parse('2026-11-06T09:00:00Z') })
  await buildDebatePublication(source, output)
  await writeFile(join(output, 'data', 'debate', 'private.json'), '{"private":true}')
  const server = createSiteServer({ root: output })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const response = await fetch(origin + '/data/debate/2026-11-05.json?date=2026-11-05')
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^application\/json/u)
  assert.equal((await response.json()).date, '2026-11-05')
  assert.equal((await fetch(origin + '/data/debate/index.json')).status, 200)
  for (const path of ['/data/debate/private.json', '/data/debate/2026-99-99.json', '/data/debate/2026-11-04.json', '/.local/provider-response.json', '/data/debate/2026-11-05.json/extra']) assert.equal((await fetch(origin + path)).status, 404, path)
  assert.equal((await fetch(origin + '/data/debate/2026-11-05.json', { method: 'POST' })).status, 405)
})
