import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichHomeMarket } from '../../scripts/data/enrich-home-market.mjs'
const now = () => Date.parse('2026-11-06T10:00:00Z')
const stamp = '2026-11-06T09:00:00Z'
const point = (date, value = 100) => ({date,value,currency:'USD',basis:'provider-dated',source:'Yahoo Finance',observedAt:stamp})
const companies = [{ticker:'NVDA'}]
const snapshot = {schemaVersion:1,generatedAt:stamp,quotes:[{symbol:'NVDA',price:10,closeDate:'2026-11-05',fetchedAt:stamp}]}
const fx = async symbol => ({symbol,currency:({'KRW=X':'KRW','JPY=X':'JPY','TWD=X':'TWD'})[symbol],priceBasis:'previous-completed-session',interval:'1d',timezone:'UTC',source:'Yahoo Finance',fetchedAt:stamp,bars:[{time:Date.parse('2026-11-04T00:00:00Z')/1000,close:1000}]})

test('home enrichment preserves actual price timestamps and collects separately dated caps and FX', async () => {
  const data = await enrichHomeMarket(snapshot,{now,companies,fxService:fx,capService:async symbol=>({symbol,status:'ok',fetchedAt:stamp,observations:[point('2026-11-04')],conflictingDates:[]})})
  assert.equal(data.quotes[0].price,10)
  assert.equal(data.quotes[0].fetchedAt,stamp)
  assert.equal(data.quotes[0].marketCapHistory[0].date,'2026-11-04')
  assert.deepEqual(data.fxHistory.KRW.observations,[{date:'2026-11-04',unitsPerUSD:1000}])
  assert.equal(data.homeCoverage.historicalCapCompanies,1)
  assert.deepEqual(snapshot.quotes[0].marketCapHistory,undefined)
})

test('provider failures retain historical observations and their original capture time', async () => {
  const previous = {quotes:[{symbol:'NVDA',marketCapHistory:[point('2026-11-04')],capHistoryFetchedAt:'2026-11-01T00:00:00Z'}],fxHistory:{KRW:{observations:[{date:'2026-11-04',unitsPerUSD:1400}],fetchedAt:'2026-11-01T00:00:00Z'}}}
  const fail = async () => { throw new Error('offline') }
  const data = await enrichHomeMarket(snapshot,{now,companies,previous,capService:fail,fxService:fail})
  assert.equal(data.quotes[0].capHistoryStatus,'stale')
  assert.equal(data.quotes[0].capHistoryFetchedAt,'2026-11-01T00:00:00Z')
  assert.equal(data.fxHistory.KRW.status,'stale')
  assert.equal(data.fxHistory.KRW.fetchedAt,'2026-11-01T00:00:00Z')
  assert.equal(data.fxHistory.JPY.status,'unavailable')
  assert.deepEqual(data.fxHistory.JPY.observations,[])
})

test('newly conflicting cap dates are removed, valid dates merge and wrong FX currencies are excluded', async () => {
  const previous = {quotes:[{symbol:'NVDA',marketCapHistory:[point('2026-10-31'),point('2026-11-01')]}]}
  const data = await enrichHomeMarket(snapshot,{now,companies,previous,
    capService:async symbol=>({symbol,status:'ok',fetchedAt:stamp,observations:[point('2026-11-04')],conflictingDates:['2026-10-31']}),
    fxService:async symbol=>({...await fx(symbol),currency:'USD'})})
  assert.deepEqual(data.quotes[0].marketCapHistory.map(p=>p.date),['2026-11-01','2026-11-04'])
  assert.equal(data.fxHistory.KRW.status,'unavailable')
})
