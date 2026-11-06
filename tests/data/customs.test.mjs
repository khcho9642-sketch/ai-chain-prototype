import assert from 'node:assert/strict'
import test from 'node:test'
import { collectCustoms, parseCustomsXml } from '../../scripts/data/collect-customs.mjs'
import { validateIndustry } from '../../assets/industry-core.js'

const now = new Date('2026-11-06T00:00:00Z')
const fixture = (rows, resultCode = '00') => `<?xml version="1.0"?><response><header><resultCode>${resultCode}</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body><items>${rows.join('')}</items></body></response>`
const row = (code, year, usd = '100', kg = '5') => `<item><hsCode>${code}</hsCode><year>${year}</year><expDlr>${usd}</expDlr><expWgt>${kg}</expWgt></item>`
const fetchImpl = async url => {
  assert.equal(url.hostname, 'apis.data.go.kr')
  assert.equal(url.searchParams.get('serviceKey'), 'secret+/=')
  const first = url.searchParams.get('strtYymm'), last = url.searchParams.get('endYymm')
  const rows = [row('-', '총계', '999999', '999999')]
  for (let year = +first.slice(0, 4), month = +first.slice(4); `${year}${String(month).padStart(2, '0')}` <= last;) {
    rows.push(row(url.searchParams.get('hsSgn'), `${year}.${String(month).padStart(2, '0')}`))
    if (++month === 13) { year++; month = 1 }
  }
  return new Response(fixture(rows))
}

test('Customs excludes totals, rejects duplicate periods, missing rows and different HS identities', () => {
  const month = row('854232', '2026.09', '1,234', '12.5')
  assert.deepEqual(parseCustomsXml(fixture([month, row('-', '총계')]), '854232', '2026-09', '2026-09').get('2026-09'), { period: '2026-09', usd: 1234, kg: 12.5 })
  for (const xml of [fixture([month, month]), fixture([month.replace('854232', '854231')]), fixture([month.replace('1,234', '-')]), fixture([month], '30'), fixture([]), '<!DOCTYPE a>' + fixture([month]), fixture([month]).replace('</item>', '')]) assert.throws(() => parseCustomsXml(xml, '854232', '2026-09', '2026-09'))
  assert.throws(() => parseCustomsXml(fixture([month]), '854232', '2026-08', '2026-09'))
})

test('Customs collects 36 months in annual windows, sums exactly seven transformer codes and retains units', async () => {
  let requests = 0
  const data = await collectCustoms({}, { now, serviceKey: 'secret%2B%2F%3D', fetchImpl: async url => { requests++; return fetchImpl(url) } })
  assert.equal(requests, 24)
  assert.deepEqual(data.gaps, [])
  validateIndustry({ ...data, schemaVersion: 1 }, { now })
  assert.equal(data.series.length, 4)
  for (const series of data.series) {
    assert.equal(series.points.length, 36)
    assert.equal(series.points[0].period, '2023-10')
    assert.equal(series.points.at(-1).period, '2026-09')
    assert.ok(!JSON.stringify(series).includes('secret'))
  }
  assert.equal(data.series.find(series => series.id === 'kr-transformer-export-usd').points[0].value, 700)
  assert.equal(data.series.find(series => series.id === 'kr-transformer-export-weight').points[0].value, 35)
})

test('Customs preserves paired group history and timestamps on partial failure without publishing credentials', async () => {
  const data = await collectCustoms({}, { now, serviceKey: 'secret+/=', fetchImpl })
  const next = await collectCustoms(data, { now: new Date('2026-11-07T00:00:00Z'), serviceKey: 'secret+/=', fetchImpl: async url => {
    if (url.searchParams.get('hsSgn') === '850422') throw Error(String(url))
    return fetchImpl(url)
  } })
  assert.equal(next.gaps[0].id, 'customs-itemtrade-refresh-failed')
  assert.deepEqual(next.series.filter(series => series.id.includes('transformer')), data.series.filter(series => series.id.includes('transformer')))
  assert.ok(!JSON.stringify(next).includes('secret'))
  const missing = await collectCustoms(data, { now, serviceKey: '', fetchImpl: assert.fail })
  assert.deepEqual(missing.series, data.series)
  assert.equal(missing.sources[0].checkedAt, data.sources[0].checkedAt)
  assert.equal(missing.gaps[0].id, 'customs-itemtrade-key-missing')
})
