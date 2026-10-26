import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateTokenSnapshot, tokenDailyTotals, tokenMovingAverage, visibleAuthorTotals, formatTokens, tokenTotalsCsv } from '../assets/token-core.js'
import { collectAiTokens, collectAiTokenFile, emptyTokenSnapshot, parseRankingsResponse, tokenDateWindow, RANKINGS_ENDPOINT } from '../scripts/collect-ai-tokens.mjs'

const now = new Date('2026-10-26T03:00:00Z')
const day = '2026-10-25'
const key = 'test-secret-that-must-never-be-published'
const seed = () => ({ ...emptyTokenSnapshot(), asOf: '2026-10-26', rows: [
  { date: day, model: 'Claude published model name', author: 'anthropic', totalTokens: '831000000000', rounded: true }
] })
const payload = (rows, days = 90) => ({ data: rows, meta: { ...Object.fromEntries(Object.entries(tokenDateWindow(now, days)).map(([k, v]) => [k === 'startDate' ? 'start_date' : 'end_date', v])), as_of: now.toISOString(), version: 'v1' } })
const apiRow = (model, tokens, date = day) => ({ date, model_permaslug: model, total_tokens: tokens })
const response = body => async () => ({ ok: true, status: 200, json: async () => body })
const apiSnapshot = rows => parseRankingsResponse(payload(rows), { ...tokenDateWindow(now), now })

test('completed UTC window excludes current day and respects the official history/range', () => {
  assert.deepEqual(tokenDateWindow(now, 7), { startDate: '2026-10-19', endDate: day })
  assert.deepEqual(tokenDateWindow(new Date('2025-01-02T23:59:59Z'), 90), { startDate: '2025-01-01', endDate: '2025-01-01' })
  for (const days of [0, 367, 1.5]) assert.throws(() => tokenDateWindow(now, days))
})

test('snapshot validator rejects fake completeness, invalid dates, unsafe numeric values and duplicates', () => {
  assert.equal(validateTokenSnapshot(seed(), { now }).rows.length, 1)
  for (const mutate of [
    s => { s.coverage.completePublicTotal = true },
    s => { s.rows[0].totalTokens = 9007199254740993 },
    s => { s.rows[0].totalTokens = '-1' },
    s => { s.rows[0].totalTokens = '1e12' },
    s => { s.rows[0].date = '2026-02-30' },
    s => { s.rows[0].date = '2026-10-26' },
    s => { s.rows[0].date = '2026-10-27' },
    s => { s.rows.push({ ...s.rows[0] }) }
  ]) { const data = seed(); mutate(data); assert.throws(() => validateTokenSnapshot(data, { now })) }
})

test('exact aggregate includes other; reviewed top models never become a platform total', () => {
  const data = apiSnapshot([apiRow('openai/test-a', '9007199254740993'), apiRow('anthropic/test-b', '10'), apiRow('other', '4')])
  assert.deepEqual(tokenDailyTotals(data), [{ date: day, totalTokens: '9007199254741007' }])
  assert.deepEqual(tokenDailyTotals(seed()), [])
  assert.deepEqual(visibleAuthorTotals(data), [
    { author: 'openai', totalTokens: '9007199254740993' }, { author: 'anthropic', totalTokens: '10' }
  ])
  assert.equal(formatTokens('5770000000000'), '5.77조')
  assert.equal(formatTokens(null), '—')
  assert.equal(formatTokens('-1'), '—')
})

test('seven-day mean needs seven consecutive dates, retains exact rational sum and never fills missing days with zero', () => {
  const totals = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-${String(18 + i).padStart(2, '0')}`, totalTokens: String((i + 1) * 10) }))
  const result = tokenMovingAverage(totals, 7)
  assert.ok(result.slice(0, 6).every(p => p.value === null))
  assert.equal(result[6].value, 40)
  assert.equal(result[6].sumTokens, '280')
  assert.equal(result[7].value, 50)
  const gap = tokenMovingAverage(totals.filter(p => p.date !== '2026-10-20'), 7)
  assert.ok(gap.every(p => p.value === null))
  assert.throws(() => tokenMovingAverage([...totals, totals[0]], 7))
})

test('missing key makes no request and preserves reviewed data instead of inventing live zeros', async () => {
  const previous = seed()
  const result = await collectAiTokens(previous, { now, apiKey: '', fetcher: () => { throw new Error('must not call') } })
  assert.equal(result.collection.status, 'missing-key')
  assert.deepEqual(result.rows, previous.rows)
  assert.equal(result.collection.lastSuccessAt, null)
  assert.equal(previous.collection.status, 'not-connected')
})

test('auth/rate/network failures preserve the last success and do not disclose the secret or response body', async () => {
  const previous = { ...apiSnapshot([apiRow('openai/test', '100')]), collection: { method: 'api', status: 'ok', lastAttemptAt: '2026-10-25T03:00:00Z', lastSuccessAt: '2026-10-25T03:00:00Z', message: 'ok' } }
  for (const fetcher of [
    async () => ({ ok: false, status: 401, json: async () => ({ error: key }) }),
    async () => ({ ok: false, status: 429, json: async () => ({ error: key }) }),
    async () => { throw new Error(`Network error: Authorization Bearer ${key}`) },
    async () => ({ ok: true, status: 200, json: async () => { throw new Error(key) } })
  ]) {
    const result = await collectAiTokens(previous, { now, apiKey: key, fetcher })
    assert.equal(result.collection.status, 'error')
    assert.equal(result.collection.lastSuccessAt, previous.collection.lastSuccessAt)
    assert.deepEqual(result.rows, previous.rows)
    assert.ok(!JSON.stringify(result).includes(key))
  }
})

test('successful API call uses bearer server-side, rejects redirects and replaces rounded seed', async () => {
  let called = 0
  const result = await collectAiTokens(seed(), { now, apiKey: key, days: 7, fetcher: async (url, options) => {
    called++
    assert.ok(url.startsWith(RANKINGS_ENDPOINT + '?'))
    assert.equal(new URL(url).searchParams.get('start_date'), '2026-10-19')
    assert.equal(new URL(url).searchParams.get('end_date'), day)
    assert.ok(!url.includes(key))
    assert.equal(options.headers.Authorization, 'Bearer ' + key)
    assert.equal(options.redirect, 'error')
    return { ok: true, json: async () => payload([apiRow('anthropic/actual-id', '1'), apiRow('other', '2')], 7) }
  } })
  assert.equal(called, 1)
  assert.equal(result.collection.status, 'ok')
  assert.equal(result.collection.lastSuccessAt, now.toISOString())
  assert.equal(result.rows.length, 2)
  assert.ok(result.rows.every(r => !r.rounded))
  assert.ok(!result.rows.some(r => r.model === seed().rows[0].model))
  assert.ok(!JSON.stringify(result).includes(key))
  assert.match(result.source.attribution, /CC BY 4\.0/)
})

test('restatement replaces a complete date group so fallen models are not double-counted with other', async () => {
  const previous = apiSnapshot([apiRow('openai/fallen-model', '30'), apiRow('openai/old-history', '10', '2026-08-01')])
  const result = await collectAiTokens(previous, { now, apiKey: key, days: 7,
    fetcher: response(payload([apiRow('anthropic/new-model', '20'), apiRow('other', '30')], 7)) })
  assert.equal(result.collection.status, 'ok')
  assert.deepEqual(tokenDailyTotals(result), [{ date: '2026-08-01', totalTokens: '10' }, { date: day, totalTokens: '50' }])
  assert.ok(!result.rows.some(r => r.model.includes('fallen')))
})

test('sparse response keeps previously collected dates without treating absent days as zero', async () => {
  const previous = apiSnapshot([apiRow('openai/older-day', '10', '2026-10-24'), apiRow('openai/restated', '100')])
  const result = await collectAiTokens(previous, { now, apiKey: key, fetcher: response(payload([apiRow('other', '200')])) })
  assert.deepEqual(tokenDailyTotals(result), [{ date: '2026-10-24', totalTokens: '10' }, { date: day, totalTokens: '200' }])
  assert.deepEqual(result.meta.retainedDates, ['2026-10-24'])
  assert.equal(result.meta.retainedSnapshotAsOf, previous.asOf)
  assert.equal(result.collection.status, 'ok')
})

test('untrusted response dates, duplicate rows, numeric tokens and malformed metadata cannot replace prior data', async () => {
  for (const body of [
    payload([apiRow('openai/test', '1', '2026-10-26')]),
    payload([apiRow('openai/test', '1', '2026-10-27')]),
    payload([apiRow('openai/test', '1'), apiRow('openai/test', '2')]),
    payload([apiRow('openai/test', 9007199254740993)]),
    payload([apiRow('openai/test', '-1')]),
    { ...payload([apiRow('openai/test', '1')]), meta: { as_of: key } },
    payload([]),
    payload(Array.from({ length: 51 }, (_, i) => apiRow(`openai/m${i}`, '1')))
  ]) {
    const previous = seed(), result = await collectAiTokens(previous, { now, apiKey: key, fetcher: response(body) })
    assert.equal(result.collection.status, 'error')
    assert.deepEqual(result.rows, previous.rows)
    assert.ok(!JSON.stringify(result).includes(key))
  }
})

test('only a successful fetch today skips work; force and failed attempts can retry', async () => {
  const body = payload([apiRow('openai/test', '100')])
  const ok = await collectAiTokens(seed(), { now, apiKey: key, fetcher: response(body) })
  let calls = 0
  const fetcher = async () => { calls++; return { ok: true, json: async () => body } }
  assert.equal(await collectAiTokens(ok, { now, apiKey: key, fetcher }), ok)
  assert.equal(calls, 0)
  await collectAiTokens(ok, { now, apiKey: key, fetcher, force: true })
  assert.equal(calls, 1)
  const forcedFailure = await collectAiTokens(ok, { now, apiKey: key, force: true, fetcher: async () => { throw new Error(key) } })
  assert.equal(forcedFailure.collection.status, 'error')
  assert.equal(await collectAiTokens(forcedFailure, { now, apiKey: key, fetcher }), forcedFailure)
  assert.equal(calls, 1)
  const failed = { ...ok, collection: { ...ok.collection, status: 'error', lastSuccessAt: '2026-10-25T03:00:00Z' } }
  await collectAiTokens(failed, { now, apiKey: key, fetcher })
  assert.equal(calls, 2)
})

test('CSV records individual model rows, preserves exact integers and neutralizes spreadsheet formulas', () => {
  const data = seed(); data.rows[0].model = '=HYPERLINK("https://example.invalid")'
  const csv = tokenTotalsCsv(data)
  assert.match(csv, /831000000000/)
  assert.match(csv, /"'=HYPERLINK/)
  assert.match(csv, /reviewed-top-model-snapshot/)
  assert.match(csv, /https:\/\/openrouter\.ai\/rankings/)
})

test('file collector writes missing-key state atomically and refuses to overwrite malformed previous data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-token-test-')), output = join(directory, 'tokens.json')
  try {
    await writeFile(output, JSON.stringify(seed()))
    await collectAiTokenFile(output, { now, apiKey: '' })
    assert.equal(JSON.parse(await readFile(output, 'utf8')).collection.status, 'missing-key')
    await writeFile(output, '{broken-json')
    await assert.rejects(collectAiTokenFile(output, { now, apiKey: '' }))
    assert.equal(await readFile(output, 'utf8'), '{broken-json')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
