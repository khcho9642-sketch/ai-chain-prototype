import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {validateIndustry,yearOnYear,seriesCsv,staleSeries,windowPoints} from '../../assets/industry-core.js'
import {parseTsmcRevenue,collectTsmc} from '../../scripts/data/collect-tsmc.mjs'
import {instruments} from '../../assets/instruments.js'
import {companyProfiles} from '../../assets/company-profiles.js'
import {sectorMetrics} from '../../assets/sector-metric-catalog.js'
import {metricDetailHTML, metricCsv} from '../../assets/sector-metric-chart.js'
const now=new Date('2026-10-26T00:00:00Z')
const series={id:'test',name:'월별 수출물량',kind:'volume-index',unit:'2020=100',frequency:'monthly',chains:[3],definition:'가격 영향을 제거한 지수',sourceId:'bok',points:[{period:'2025-09',value:100,status:'final'},{period:'2026-09',value:130.5,status:'provisional'}]}
const fixture=()=>({schemaVersion:1,sources:[{id:'bok',name:'한국은행',url:'https://ecos.bok.or.kr/',checkedAt:'2026-10-26'}],series:[structuredClone(series)]})
test('industry rejects duplicated months, missing values, future months and incorrect volume units',()=>{
  assert.ok(validateIndustry(fixture(),{now}))
  for(const mutate of [s=>s.points.push(s.points[0]),s=>s.points[0].value=null,s=>s.points[0].value=-1,s=>s.points[0].period='2026-13',s=>s.points[0].period='2026-11',s=>s.unit='kg',s=>s.sourceId='unknown']){
    const d=fixture();mutate(d.series[0]);assert.throws(()=>validateIndustry(d,{now}))
  }
})
test('YoY matches calendar months rather than neighboring rows, and missing comparison is blank',()=>{
  assert.ok(Math.abs(yearOnYear(series,series.points[1])-30.5)<1e-10)
  assert.equal(yearOnYear(series,series.points[0]),null)
  assert.equal(yearOnYear(series,{period:'2026-09',value:130.5,yoy:30.6}),30.6)
  assert.equal(staleSeries(series,now),false)
  assert.equal(staleSeries(series,new Date('2027-01-01Z')),true)
  assert.deepEqual(windowPoints({...series,points:[{period:'2024-10'},{period:'2025-01'},{period:'2026-09'}]},12).map(p=>p.period),['2026-09'])
  const csv=seriesCsv(series,fixture().sources[0]);assert.match(csv,/2020=100/);assert.match(csv,/provisional/);assert.match(csv,/https:\/\/ecos.bok.or.kr/)
})
test('TWSE revenue reads the actual reference month and monthly field, converts thousands to millions',()=>{
  const row={'公司代號':'2330','資料年月':'11509','出表日期':'1151017','營業收入-當月營收':'511857399','累計營業收入-當月累計營收':'3898726974','營業收入-去年同月增減(%)':'54.6486'}
  const p=parseTsmcRevenue([row],{now});assert.equal(p.period,'2026-09');assert.equal(p.value,511857.399);assert.equal(p.yoy,54.6486)
  assert.throws(()=>parseTsmcRevenue([{...row,'資料年月':'11511'}],{now}))
  assert.throws(()=>parseTsmcRevenue([{...row,'營業收入-當月營收':''}],{now}))
})
test('failed official update preserves last success and never replaces it with a zero',async()=>{
  const previous={...series,checkedAt:'2026-10-01'}
  const result=await collectTsmc(previous,{now,fetcher:async()=>({ok:false,status:503})})
  assert.deepEqual(result.points,previous.points);assert.equal(result.checkedAt,'2026-10-01');assert.match(result.error,/503/)
})
test('every AI peer has business source metadata and legacy market instruments remain',()=>{
  const peers=instruments.filter(i=>i.chains.some(c=>c>0));assert.ok(peers.length>=70)
  for(const p of peers){assert.ok(companyProfiles[p.symbol]?.role,p.symbol);assert.ok(companyProfiles[p.symbol]?.country,p.symbol);assert.match(companyProfiles[p.symbol]?.sourceUrl||'',/^https:\/\//,p.symbol)}
  for(const id of [1,2,3,4,5,6,7,8])assert.ok(peers.filter(p=>p.chains.includes(id)).length>=7)
  for(const p of ['EQIX','DLR','AJBU.SI','IRM'])assert.ok(peers.find(i=>i.symbol===p)?.chains.includes(6))
})
test('published industrial snapshot has distinct monthly grain and traceable official evidence',async()=>{
  const data=JSON.parse(await readFile(new URL('../../data/industry.json',import.meta.url),'utf8'))
  validateIndustry(data)
  for(const id of ['tsmc-revenue'])assert.ok(data.series.find(s=>s.id===id)?.points.length>=12)
  assert.ok(data.series.some(s=>s.kind==='volume-index'&&s.chains.includes(3)&&s.points.length>=24))
  assert.ok(data.series.some(s=>s.kind==='volume-index'&&s.chains.includes(5)&&s.points.length>=24))
  assert.ok(data.series.some(s=>s.kind==='weight'))
})

const snapshot = async name => JSON.parse(await readFile(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'))
const figure = html => html.match(/<figure\b[^>]*>([\s\S]*?)<\/figure>/u)?.[1] || ''
const dotCount = plot => (plot.match(/<circle\b/gu) || []).length

test('memory starts with the semiconductor reference and Micron business, each with its own unit, period and source', async () => {
  const [industry, ai] = await Promise.all([snapshot('industry'), snapshot('ai-statistics')])
  const [exports, micron] = sectorMetrics('memory', { industry, ai })
  const series = industry.series.find(item => item.id === 'kr-semiconductor-volume')
  const business = ai.metrics.find(item => item.id === 'micron_cloud_memory_revenue')
  assert.deepEqual([exports.id, micron.id], [series.id, business.id])
  assert.equal(exports.relation, 'reference')
  assert.equal(exports.unit, series.unit)
  assert.equal(micron.unit, business.unitLabel)
  assert.equal(micron.latest.sourceUrl, business.observations[business.latestIndex].sourceUrl)
  assert.match(exports.sourceUrl, /ecos\.bok\.or\.kr/u)

  const monthlyPlot = figure(metricDetailHTML(exports))
  const expected = windowPoints(series, 24)
  assert.equal(dotCount(monthlyPlot), expected.length)
  assert.ok(monthlyPlot.includes(expected[0].period) && monthlyPlot.includes(expected.at(-1).period))
  assert.match(metricDetailHTML(exports), /반도체 전체 기준 · 메모리 참고 지표 · 2020=100/u)

  const quarterPlot = figure(metricDetailHTML(micron))
  assert.equal(dotCount(quarterPlot), business.observations.length)
  for (const period of ['FY2025-Q4', 'FY2026-Q3', 'FY2026-Q4']) assert.ok(quarterPlot.includes(period), period)
  const actualPeriods = new Set(business.observations.map(point => point.period))
  for (const label of quarterPlot.match(/FY\d{4}-Q[1-4]/gu) || []) assert.ok(actualPeriods.has(label), label)
  assert.doesNotMatch(quarterPlot, /2020=100/u)
})

test('monthly graphs break at missing months and a single observation keeps its own dated point', () => {
  const unit = '2020=100'
  const points = [
    { label: '2024-09', ordinal: 0, value: 90 },
    { label: '2026-06', ordinal: 21, value: 12 },
    { label: '2026-08', ordinal: 23, value: 16 },
    { label: '2026-09', ordinal: 24, value: 17 },
  ]
  const metric = { name: '반도체 수출물량지수', unit, kind: 'monthly', points }
  const plot = figure(metricDetailHTML(metric))
  assert.equal(dotCount(plot), 3)
  assert.equal((plot.match(/class="sector-chart-line"/gu) || []).length, 1)
  assert.doesNotMatch(plot, /2024-09/u)
  const single = figure(metricDetailHTML({ ...metric, kind: 'observations', points: [points[2]] }))
  assert.equal(dotCount(single), 1)
  assert.match(single, /2026-08/u)
  assert.doesNotMatch(single, /class="sector-chart-line"/u)
})

test('memory shows collected KOSIS indices as references and omits empty series', async () => {
  const [industry, ai] = await Promise.all([snapshot('industry'), snapshot('ai-statistics')])
  const source = {id: 'kosis-mining-manufacturing', name: 'KOSIS', url: 'https://kosis.kr/'}
  const ids = ['kr-semiconductor-production', 'kr-semiconductor-shipments', 'kr-semiconductor-inventory']
  industry.sources = [...industry.sources.filter(item => item.id !== source.id), source]
  const indices = ids.map(id => ({ ...series, id, sourceId: source.id }))
  industry.series = [...industry.series.filter(item => !ids.includes(item.id)), ...indices]
  validateIndustry(industry)
  const metrics = sectorMetrics('memory', { industry, ai })
  assert.deepEqual(metrics.slice(0, 5).map(metric => metric.id), ['kr-semiconductor-volume', 'micron_cloud_memory_revenue', ...ids])
  for (const metric of metrics.slice(2, 5)) {
    assert.equal(metric.relation, 'reference')
    assert.equal(metric.sourceUrl, source.url)
    assert.equal(metric.latest.label, '2026-09')
  }
  indices[2].points = []
  assert.ok(!sectorMetrics('memory', { industry, ai }).some(metric => metric.id === indices[2].id))
})

test('Epoch product ranks compare available values, include zero and export the complete original sample', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ name: `GPU ${i}`, memory: i }))
  const epoch = { datasets: [{ id: 'hardware', lastSuccessAt: '2026-11-01T00:00:00Z', rows: [...rows, { name: '미공개', memory: null }] }] }
  const [metric] = sectorMetrics('memory', { epoch })
  assert.equal(metric.kind, 'comparison')
  assert.equal(metric.points.length, 10)
  const html = metricDetailHTML(metric)
  const plot = figure(html)
  assert.match(plot, /상위 8개/u)
  assert.ok(plot.indexOf('GPU 9') >= 0 && plot.indexOf('GPU 9') < plot.indexOf('GPU 8'))
  assert.doesNotMatch(plot, /GPU 0|GPU 1</u)
  assert.match(html.slice(html.indexOf('</figure>')), /GPU 0/u)
  const csv = metricCsv(metric)
  assert.equal(csv.split('\r\n').length, 11)
  assert.ok(csv.includes('"GPU 0"') && csv.includes(metric.sourceUrl))
  assert.doesNotMatch(csv, /미공개/u)
  assert.deepEqual(sectorMetrics('memory', {}), [])
})

test('customs memory and transformer exports use direct USD and kg series with the selected chart unit and source', async () => {
  const [industry, ai] = await Promise.all([snapshot('industry'), snapshot('ai-statistics')])
  const source = { id: 'customs-itemtrade', name: '관세청 품목별 수출입실적', url: 'https://www.data.go.kr/data/15101609/openapi.do' }
  const goods = ['memory', 'transformer'].flatMap(group => [
    { ...series, id: `kr-${group}-export-usd`, name: `${group} 수출액`, kind: 'value', unit: 'USD', sourceId: source.id },
    { ...series, id: `kr-${group}-export-weight`, name: `${group} 수출 순중량`, kind: 'weight', unit: 'kg', sourceId: source.id },
  ])
  const ids = new Set(goods.map(item => item.id))
  industry.sources = [...industry.sources.filter(item => item.id !== source.id), source]
  industry.series = [...industry.series.filter(item => !ids.has(item.id)), ...goods]
  validateIndustry(industry)
  for (const [sector, group] of [['memory', 'memory'], ['power-cooling', 'transformer']]) {
    const metrics = sectorMetrics(sector, { industry, ai })
    const dollars = metrics.find(metric => metric.id === `kr-${group}-export-usd`)
    const weight = metrics.find(metric => metric.id === `kr-${group}-export-weight`)
    assert.deepEqual([dollars.unit, weight.unit], ['USD', 'kg'])
    for (const metric of [dollars, weight]) {
      assert.equal(metric.relation, 'direct')
      assert.equal(metric.sourceUrl, source.url)
      assert.equal(metric.latest.label, '2026-09')
      assert.match(metricDetailHTML(metric), new RegExp(metric.unit, 'u'))
      assert.doesNotMatch(metricDetailHTML(metric), /2020=100/u)
      assert.ok(metricCsv(metric).includes(`"${metric.unit}"`))
    }
    assert.ok(!metrics.some(metric => metric.id.startsWith(`kr-${group === 'memory' ? 'transformer' : 'memory'}-export-`)))
  }
  goods[1].points = []
  assert.ok(!sectorMetrics('memory', { industry, ai }).some(metric => metric.id === goods[1].id))
})
