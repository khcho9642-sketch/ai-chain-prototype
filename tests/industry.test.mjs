import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {validateIndustry,yearOnYear,seriesCsv,staleSeries,windowPoints} from '../assets/industry-core.js'
import {parseTsmcRevenue,collectTsmc} from '../scripts/collect-tsmc.mjs'
import {instruments} from '../assets/instruments.js'
import {companyProfiles} from '../assets/company-profiles.js'
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
  const data=JSON.parse(await readFile(new URL('../data/industry.json',import.meta.url),'utf8'))
  validateIndustry(data)
  for(const id of ['tsmc-revenue'])assert.ok(data.series.find(s=>s.id===id)?.points.length>=12)
  assert.ok(data.series.some(s=>s.kind==='volume-index'&&s.chains.includes(3)&&s.points.length>=24))
  assert.ok(data.series.some(s=>s.kind==='volume-index'&&s.chains.includes(5)&&s.points.length>=24))
  assert.ok(data.series.some(s=>s.kind==='weight'))
})
