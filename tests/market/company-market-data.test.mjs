import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildCompanyMarket,commonSession } from '../../scripts/data/company-market-table.mjs'
import { readCompanySeries } from '../../scripts/data/company-market-series.mjs'
import { getCompanyMarket,validateCompanyMarket } from '../../assets/company-market-data.js'
import { companyMarketFixture } from '../helpers/company-market-fixture.mjs'
import { catalog } from '../../assets/company-catalog.js'

const day='2026-11-05',url='https://finance.yahoo.com/quote/EXAMPLE/'
const pt=(date,value,currency='EUR')=>({date,value,currency})
function model(){
  const bars=[['2025-11-03',40],['2025-12-31',50],['2026-10-05',80],['2026-11-04',100],[day,120]]
    .map(([date,close])=>({time:Date.parse(date)/1000,close,high:close+5}))
  const quotes=[{symbol:'EXAMPLE',companyId:'C0001',primaryForCompany:true,exchange:'Paris',currency:'EUR',timezone:'UTC',
    priceBasis:'previous-completed-session',closeDate:day,fetchedAt:day+'T19:00:00Z',sourceUrl:url,bars}]
  const quarter=['2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30'].map((date,i)=>pt(date,100+i*10))
  const info={ticker:'EXAMPLE',caps:[{...pt(day,400),sourceUrl:url}],quarterlyTotalRevenue:quarter,
    trailingNetIncomeCommonStockholders:[pt('2026-06-30',-10)]}
  return {market:{generatedAt:day+'T19:00:00Z',quotes,fxHistory:{EUR:{currency:'EUR',baseCurrency:'USD',
    quoteConvention:'currency-per-USD',observations:[{date:day,unitsPerUSD:.8}],sourceUrl:url}}},
    companies:[{id:'C0001',listed:true},{id:'C0002',listed:false},{id:'C0003',listed:true}],
    seriesById:new Map([['C0001',info]]),valuations:[{companyId:'C0002',date:'2025-09-01',value:40,currency:'EUR',url,kind:'round'}]}
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8, a+' != '+b)

test('comparison uses one completed session and one FX date; private values are separate',()=>{
  const table=validateCompanyMarket(buildCompanyMarket(model()))
  assert.equal(table.asOf,day)
  const row=getCompanyMarket(table,'C0001')
  near(row.change1d,20);near(row.change1mo,50);near(row.changeYtd,140);near(row.fromHigh52w,-4)
  assert.equal(row.marketCapUsd,500);assert.equal(row.revenueTtmUsd,625)
  assert.equal(row.loss,true);assert.equal(row.pe,null);assert.equal(row.revenueGrowthPeriod,'quarter');near(row.revenueGrowth,40)
  assert.equal(table.rows.C0002.valuationUsd,50);assert.equal(table.rows.C0002.marketCapUsd,null)
  assert.equal(table.rows.C0003.price,null);assert.equal(getCompanyMarket(table,'unknown'),null)
})

test('an old cap, a different FX date, and a missing quarterly period cannot substitute for the requested observation',()=>{
  const data=model()
  data.market.fxHistory.EUR.observations[0].date='2026-11-04'
  const series=data.seriesById.get('C0001')
  series.caps[0].date='2026-11-04'
  series.quarterlyTotalRevenue.splice(2,1)
  const row=buildCompanyMarket(data).rows.C0001
  assert.equal(row.price,120);assert.equal(row.marketCapUsd,null);assert.equal(row.revenueTtmUsd,null)
  assert.equal(row.loss,true)
  assert.equal(commonSession([[{date:day},{date:'2026-11-06'}],[{date:day}]]),day)
})

test('wrong-symbol fundamentals or a false disclosure date cannot be accepted',()=>{
  const mismatched={timeseries:{result:[{meta:{symbol:['WRONG'],type:['quarterlyTotalRevenue']},quarterlyTotalRevenue:[]}]}}
  assert.throws(()=>readCompanySeries(mismatched,'EXAMPLE','2024-01-01',day,day+'T20:00:00Z'),/종목/)
  const fixture=companyMarketFixture()
  fixture.rows.C0001.asOf='2026-01-04'
  assert.throws(()=>validateCompanyMarket(fixture),/종가 기준일/)
})

test('bundled public snapshot contains no duplicate issuer or pseudo-market securities',async()=>{
  const table=validateCompanyMarket(JSON.parse(await readFile(new URL('../../data/company-market.json',import.meta.url))))
  // Preserve the archived 586-company snapshot; later additions receive no synthetic observations.
  assert.equal(Object.keys(table.rows).length,586)
  assert.deepEqual(Object.keys(table.rows).sort(),catalog.companies.filter(c=>!/^C05(?:8[7-9]|9[0-4])$/.test(c.id)).map(c=>c.id).sort())
  assert.equal(catalog.companies.find(c=>c.id==='C0587').listed,false)
  assert.equal(getCompanyMarket(table,'C0587'),null)
  assert.ok(!Object.values(table.rows).some(row=>row.ticker==='NSCL'))
  assert.equal(table.rows.SCN038.ticker,'TSLA')
  assert.equal(table.rows.SCN038.listed,true)
  assert.ok(table.rows.SCN038.price > 0)
  assert.equal(table.rows.C0435,undefined)
  const rows=Object.values(table.rows)
  assert.ok(!rows.some(r=>['GC=F','CL=F','BTC-USD'].includes(r.ticker)))
  assert.ok(rows.some(r=>r.price!==null&&r.revenueTtmUsd!==null&&r.marketCapUsd!==null))
  assert.ok(rows.some(r=>!r.listed&&r.valuationSourceUrl&&r.valuationDate))
})

test('paused company collector performs no network requests and preserves the saved snapshot',async()=>{
  const {collectCompanyMarket}=await import('../../scripts/data/collect-company-market.mjs')
  const before=await readFile(new URL('../../data/company-market.json',import.meta.url),'utf8')
  const original=globalThis.fetch
  let calls=0
  globalThis.fetch=async()=>{calls++;throw Error('network must stay disabled')}
  try{
    const result=await collectCompanyMarket({restore:true,collectionEnabled:false,logger:{log(){}}})
    assert.equal(result.paused,true);assert.equal(calls,0)
    assert.equal(await readFile(new URL('../../data/company-market.json',import.meta.url),'utf8'),before)
  }finally{globalThis.fetch=original}
})
