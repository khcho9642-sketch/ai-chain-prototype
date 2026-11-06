import assert from 'node:assert/strict'
import test from 'node:test'
import { collectKosis } from '../../scripts/data/collect-kosis.mjs'
import { validateIndustry } from '../../assets/industry-core.js'

const now = new Date('2026-11-06T00:00:00Z')
const apiKey = 'test+/=kosis'
const rows = ['T10', 'T11', 'T12'].flatMap((item, i) => ['202608', '202609'].map((period, m) => ({
  ORG_ID: '101', TBL_ID: 'DT_1F02001', C1: '00', C2: 'C261', ITM_ID: item,
  PRD_SE: 'M', PRD_DE: period, DT: String(120 + i + m), UNIT_NM: '2020=100',
})))
const read = (data, previous) => collectKosis(previous, {
  now, apiKey, fetchImpl: async () => Response.json(data),
})

test('KOSIS fetches only nationwide monthly semiconductor indices and emits public evidence', async () => {
  let called = 0
  const data = await collectKosis({}, { now, apiKey, fetchImpl: async url => {
    called++
    assert.equal(url.hostname, 'kosis.kr')
    assert.equal(url.searchParams.get('apiKey'), apiKey)
    assert.equal(url.searchParams.get('objL1'), '00')
    assert.equal(url.searchParams.get('objL2'), 'C261')
    assert.deepEqual(url.searchParams.get('itmId').split(' '), ['T10', 'T11', 'T12'])
    return Response.json(rows)
  } })
  validateIndustry({ ...data, schemaVersion: 1 }, { now })
  assert.equal(called, 1)
  assert.deepEqual(data.series.map(series => series.points.at(-1).value), [121, 122, 123])
  assert.deepEqual(data.gaps, [])
  assert.ok(!JSON.stringify(data).includes(apiKey))
})

test('KOSIS applies revisions and removes an officially missing reading without truncating older history', async () => {
  const previous = await read(rows)
  const revised = await read(rows.filter(row => row.PRD_DE === '202609').map(row => ({ ...row, DT: '140' })), previous)
  assert.deepEqual(revised.series[0].points.map(point => point.value), [120, 140])
  const withdrawn = await read(rows.map(row => row.PRD_DE === '202608' ? { ...row, DT: '-' } : row), previous)
  assert.deepEqual(withdrawn.series[0].points.map(point => point.period), ['2026-09'])
})

test('KOSIS fails closed on wrong table dimensions or API errors and preserves the earlier three series', async () => {
  const previous = await read(rows)
  for (const response of [{ err: '11', errMsg: apiKey }, rows.slice(0, 4), [...rows, rows[0]],
    rows.map(row => ({ ...row, C2: 'C26' })), rows.map(row => ({ ...row, C1: '11' }))]) {
    const next = await read(response, previous)
    assert.equal(next.gaps[0].id, 'kosis-refresh-failed')
    assert.deepEqual(next.series, previous.series)
    assert.equal(next.sources[0].checkedAt, previous.sources[0].checkedAt)
    assert.ok(!JSON.stringify(next).includes(apiKey))
  }
  const pending = await collectKosis({}, { now, apiKey: '', fetchImpl: assert.fail })
  assert.equal(pending.gaps[0].id, 'kosis-key-missing')
  assert.deepEqual(pending.series, [])
})
