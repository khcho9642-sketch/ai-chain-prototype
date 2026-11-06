import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichHomeMarket } from '../../scripts/data/enrich-home-market.mjs'
const now = () => Date.parse('2026-11-06T10:00:00Z')
const stamp = '2026-11-06T09:00:00Z'
const point = (date, value = 100) => ({date,value,currency:'USD',basis:'provider-dated',source:'Yahoo Finance',observedAt:stamp})
const companies = [{ticker:'NVDA'}]
const snapshot = {schemaVersion:1,generatedAt:stamp,quotes:[{symbol:'NVDA',price:10,closeDate:'2026-11-05',fetchedAt:stamp}]}
const pairs = {KRW:'KRW=X',JPY:'JPY=X',TWD:'TWD=X',EUR:'EUR=X',CHF:'USDCHF=X',HKD:'HKD=X',SGD:'SGD=X',CNY:'CNY=X',
  AED:'AED=X',AUD:'AUD=X',BRL:'BRL=X',CAD:'CAD=X',IDR:'IDR=X',INR:'INR=X',MYR:'MYR=X',NZD:'NZD=X',
  QAR:'QAR=X',SAR:'SAR=X',SEK:'SEK=X',THB:'THB=X',TRY:'TRY=X',DKK:'DKK=X',GBP:'GBP=X'}
const fx = async symbol => ({symbol,currency:Object.keys(pairs).find(currency=>pairs[currency]===symbol),priceBasis:'previous-completed-session',closeDate:'2026-11-04',interval:'1d',timezone:'UTC',source:'Yahoo Finance',fetchedAt:stamp,bars:[{time:Date.parse('2026-11-04T00:00:00Z')/1000,close:1000}]})

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

test('full-universe FX covers all observed cap currencies and GBP/DKK with explicit USD direction and provider dates', async () => {
  const rates = { KRW:1400, JPY:150, TWD:32, EUR:.92, CHF:.88, HKD:7.8, SGD:1.3, CNY:7.2,
    AED:3.67,AUD:1.5,BRL:5.6,CAD:1.4,IDR:16000,INR:84,MYR:4.3,NZD:1.7,QAR:3.64,SAR:3.75,SEK:10.5,THB:34,TRY:35,DKK:6.9,GBP:.78 }
  const requested = []
  const data = await enrichHomeMarket(snapshot, { now, companies: [], fxService: async symbol => {
    requested.push(symbol)
    const quote = await fx(symbol)
    quote.bars[0].close = rates[quote.currency]
    // A valid-looking current-day observation beyond the declared completed
    // session cannot leak into a dollar-cap conversion.
    quote.bars.push({time:Date.parse('2026-11-06T00:00:00Z')/1000,close:999})
    return quote
  } })
  assert.deepEqual(requested.sort(), Object.values(pairs).sort())
  for (const [currency, rate] of Object.entries(rates)) {
    const value = data.fxHistory[currency]
    assert.equal(value.currency, currency)
    assert.equal(value.baseCurrency, 'USD')
    assert.equal(value.quoteConvention, 'currency-per-USD')
    assert.equal(value.symbol, pairs[currency])
    assert.equal(value.fetchedAt, stamp)
    assert.deepEqual(value.observations, [{date:'2026-11-04',unitsPerUSD:rate}])
  }
  assert.ok(!requested.includes('EURUSD=X'))
  assert.equal(data.homeCoverage.fxCurrencies.length, 23)
})

test('added-currency FX failures preserve matching prior values but reject an inverse or mismatched record', async () => {
  const previous = {fxHistory:{
    EUR:{symbol:'EUR=X',currency:'EUR',baseCurrency:'USD',observations:[{date:'2026-11-03',unitsPerUSD:.9}],fetchedAt:'2026-11-03T23:00:00Z'},
    CHF:{symbol:'CHFUSD=X',currency:'CHF',baseCurrency:'CHF',observations:[{date:'2026-11-03',unitsPerUSD:1.1}],fetchedAt:'2026-11-03T23:00:00Z'},
    BRL:{symbol:'BRL=X',currency:'BRL',baseCurrency:'USD',quoteConvention:'currency-per-USD',observations:[{date:'2026-11-03',unitsPerUSD:5.6}],fetchedAt:'2026-11-03T23:00:00Z'},
    CAD:{symbol:'CAD=X',currency:'CAD',baseCurrency:'USD',quoteConvention:'USD-per-currency',observations:[{date:'2026-11-03',unitsPerUSD:.7}],fetchedAt:'2026-11-03T23:00:00Z'},
  }}
  const fail = async () => {throw new Error('offline')}
  const data = await enrichHomeMarket(snapshot,{now,companies:[],previous,fxService:fail})
  assert.equal(data.fxHistory.EUR.status,'stale')
  assert.equal(data.fxHistory.EUR.fetchedAt,'2026-11-03T23:00:00Z')
  assert.deepEqual(data.fxHistory.EUR.observations,previous.fxHistory.EUR.observations)
  assert.equal(data.fxHistory.CHF.status,'unavailable')
  assert.deepEqual(data.fxHistory.CHF.observations,[])
  assert.equal(data.fxHistory.CHF.fetchedAt,null)
  assert.equal(data.fxHistory.BRL.status,'stale')
  assert.equal(data.fxHistory.BRL.fetchedAt,previous.fxHistory.BRL.fetchedAt)
  assert.deepEqual(data.fxHistory.BRL.observations,previous.fxHistory.BRL.observations)
  assert.equal(data.fxHistory.CAD.status,'unavailable')
  assert.deepEqual(data.fxHistory.CAD.observations,[])
})
