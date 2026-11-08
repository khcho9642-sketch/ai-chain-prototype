import test from 'node:test'
import assert from 'node:assert/strict'
import { getReturn } from '../../assets/home-map-core.js'
import { buildActualMap, buildMapCatalogue } from '../../assets/home-map-data.js'

const now = Date.parse('2026-11-10T12:00:00Z')
const captured = '2026-11-06T23:00:00Z'
const capObserved = '2026-11-06T22:00:00Z'
const company = (ticker = 'AAA', extra = {}) => ({ id:ticker.toLowerCase(),ticker,name:ticker,country:'US',sector:'AI 칩',cap:9999,day:88,...extra })
const seconds = (date, hour = '14:30') => Date.parse(date + 'T' + hour + ':00Z') / 1000
function quote(symbol = 'AAA', dates = ['2026-11-05','2026-11-06'], closes = [100,110], extra = {}) {
  return {symbol,name:symbol,currency:'USD',timezone:'America/New_York',interval:'1d',range:'1y',
    price:closes.at(-1),previousClose:closes.at(-2),closeDate:dates.at(-1),priceBasis:'previous-completed-session',
    marketCap:1e12,marketCapCurrency:'USD',marketCapObservedAt:capObserved,marketCapStatus:'ok',marketCapBasis:'provider-current',
    source:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/'+symbol+'/',fetchedAt:captured,status:'ok',error:null,
    bars:dates.map((date,index)=>({time:seconds(date),close:closes[index]})),...extra}
}
const snapshot = (quotes, extra = {}) => ({schemaVersion:1,generatedAt:captured,mode:'scheduled-close',quotes,...extra})
const run = (quotes, options = {}) => buildActualMap({snapshot:snapshot(quotes),companies:[company()],now,...options})
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-8, `${value} != ${expected}`)


test('both map views receive actual capitalization and returns rather than catalog demonstration values', () => {
  const identity = company('AAA',{country:'TW',sector:'파운드리·패키징',mappingStatus:'candidate',sourceStatus:'review-draft',returns:{'1d':99,'1w':99}})
  const actual = run([quote('AAA',undefined,undefined,{identityStatus:'unverified'})],{companies:[identity]})
  const row = actual.companies[0]
  assert.equal(row.capUSD,1e12)
  assert.equal(row.cap,1000)
  assert.equal(row.capCurrency,'USD')
  assert.equal(row.capObservedAt,capObserved)
  near(row.returns['1d'],10)
  near(row.day,10)
  near(getReturn(row,'1d'),10)
  assert.equal(getReturn(row,'1w'),null)
  assert.equal(row.country,'TW')
  assert.equal(row.sector,'파운드리·패키징')
  assert.equal(row.id,'aaa')
  assert.equal(row.identityStatus,'unverified')
  assert.equal(row.mappingStatus,'candidate')
  assert.equal(row.sourceStatus,'review-draft')
  assert.deepEqual(actual.dates,['2026-11-06'])
  assert.equal(actual.coverage.catalogCount,1)
  assert.equal(actual.coverage.renderableCount,1)
  assert.equal(actual.coverage.returnableCount,1)
  assert.equal(actual.status,'ok')
  assert.equal(identity.cap,9999)
  assert.equal(identity.day,88)
})

test('every supported return key is explicit, so missing history never reaches synthetic getReturn fallback', () => {
  const value = run([quote('AAA',['2026-11-06'],[110])])
  const row = value.companies[0]
  assert.deepEqual(row.returns,{'1d':null,'1w':null,'1m':null,'1y':null})
  assert.equal(row.day,null)
  for (const period of ['1d','1w','1m','1y']) assert.equal(getReturn(row,period),null)
  assert.equal(value.coverage.missingReturn,1)
  assert.equal(value.coverage.returnableCount,0)
  assert.equal(value.coverage.returnExclusions[0].ticker,'AAA')
  assert.match(value.coverage.returnExclusions[0].reason,/직전 거래일/)
  assert.equal(value.companies.length,1)
})

test('week, month and year compare actual prior closes at calendar baselines, never generated percentages', () => {
  const dates=['2025-11-06','2026-10-06','2026-10-30','2026-11-05','2026-11-06']
  const row=run([quote('AAA',dates,[50,80,100,110,120])]).companies[0]
  near(row.returns['1d'],(120/110-1)*100)
  near(row.returns['1w'],20)
  near(row.returns['1m'],50)
  near(row.returns['1y'],140)
  assert.equal(row.returnDates['1m'].startDate,'2026-10-06')
  assert.equal(row.previousCloseDate,'2026-11-05')
})

test('a missing exchange session does not become a two-session one-day move', () => {
  const a=quote('AAA',['2026-11-04','2026-11-06'],[100,120])
  const b=quote('BBB',['2026-11-04','2026-11-05','2026-11-06'],[100,110,121])
  const data=run([a,b],{companies:[company('AAA'),company('BBB')]})
  assert.equal(data.companies[0].returns['1d'],null)
  assert.equal(data.companies[0].previousClose,null)
  assert.equal(data.companies[0].previousCloseDate,'2026-11-05')
  near(data.companies[1].returns['1d'],10)
})

test('period baselines require the expected observed exchange date, and no distant or later price is substituted', () => {
  const a=quote('AAA',['2026-10-28','2026-11-05','2026-11-06'],[90,100,110])
  const b=quote('BBB',['2026-10-28','2026-10-30','2026-11-05','2026-11-06'],[90,100,110,121])
  const data=run([a,b],{companies:[company('AAA'),company('BBB')],period:'1w'})
  assert.equal(data.companies[0].returns['1w'],null)
  near(data.companies[1].returns['1w'],21)
  assert.equal(data.coverage.missingReturn,1)
  assert.equal(run([quote('AAA',['2026-10-01','2026-11-06'],[100,110])],{period:'1w'}).companies[0].returns['1w'],null)
})

test('foreign capitalization uses the latest earlier observed fixing, not a future or later-fetched same-day rate', () => {
  const capTime='2026-11-06T12:00:00Z'
  const q=quote('AAA',undefined,undefined,{marketCap:1e12,marketCapCurrency:'KRW',marketCapObservedAt:capTime})
  const fxHistory={KRW:{currency:'KRW',timezone:'UTC',fetchedAt:'2026-11-06T13:00:00Z',source:'Yahoo Finance',observations:[
    {date:'2026-11-05',unitsPerUSD:1000},{date:'2026-11-06',unitsPerUSD:2000},{date:'2026-11-07',unitsPerUSD:1},
  ]}}
  const row=run([q],{snapshot:snapshot([q],{fxHistory})}).companies[0]
  assert.equal(row.capUSD,1e9)
  assert.equal(row.cap,1)
  assert.equal(row.fxDate,'2026-11-05')
  assert.equal(row.fxFetchedAt,'2026-11-06T13:00:00Z')
})

test('a same-day fixing is usable when its feed or own observation timestamp proves it was already available', () => {
  const q=quote('AAA',undefined,undefined,{marketCap:1e12,marketCapCurrency:'JPY',marketCapObservedAt:'2026-11-06T12:00:00Z'})
  const entry={currency:'JPY',timezone:'UTC',fetchedAt:'2026-11-06T11:00:00Z',observations:[{date:'2026-11-06',unitsPerUSD:100}]}
  const first=run([q],{snapshot:snapshot([q],{fxHistory:{JPY:entry}})}).companies[0]
  assert.equal(first.capUSD,1e10)
  assert.equal(first.fxDate,'2026-11-06')
  entry.fetchedAt='2026-11-06T13:00:00Z'
  entry.observations[0].observedAt='2026-11-06T10:00:00Z'
  assert.equal(run([q],{snapshot:snapshot([q],{fxHistory:{JPY:entry}})}).companies[0].fxDate,'2026-11-06')
})

test('missing, conflicting, stale-by-more-than-seven-days and wrong-currency FX never become a zero or raw-currency cap', () => {
  const q=quote('AAA',undefined,undefined,{marketCapCurrency:'TWD'})
  const invalid=[undefined,{TWD:{currency:'TWD',observations:[]}},{TWD:{currency:'KRW',observations:[{date:'2026-11-05',unitsPerUSD:30}]}},
    {TWD:{observations:[{date:'2026-10-29',unitsPerUSD:30}]}},
    {TWD:{observations:[{date:'2026-11-05',unitsPerUSD:30},{date:'2026-11-05',unitsPerUSD:31}]}}]
  for(const fxHistory of invalid){
    const data=run([q],{snapshot:snapshot([q],{fxHistory})})
    assert.equal(data.companies.length,0)
    assert.equal(data.coverage.missingFx,1)
    assert.match(data.coverage.exclusions[0].reason,/환율/)
  }
})

test('seven-day holiday FX gap is allowed with its real date while an older fixing is excluded', () => {
  const q=quote('AAA',undefined,undefined,{marketCapCurrency:'EUR'})
  const data=run([q],{snapshot:snapshot([q],{fxHistory:{EUR:{observations:[{date:'2026-10-30',unitsPerUSD:.8}]}}})})
  assert.equal(data.companies[0].fxDate,'2026-10-30')
  assert.equal(data.companies[0].capUSD,1.25e12)
})

test('explicit contradictory FX direction metadata is rejected while legacy units-per-USD points remain usable', () => {
  const q=quote('AAA',undefined,undefined,{marketCapCurrency:'EUR'})
  const entry={currency:'EUR',observations:[{date:'2026-11-05',unitsPerUSD:.8}]}
  for(const contradiction of [{baseCurrency:'EUR'},{quoteConvention:'USD-per-currency'}]){
    const data=run([q],{snapshot:snapshot([q],{fxHistory:{EUR:{...entry,...contradiction}}})})
    assert.equal(data.companies.length,0)
    assert.equal(data.coverage.missingFx,1)
  }
  const data=run([q],{snapshot:snapshot([q],{fxHistory:{EUR:entry}})})
  assert.equal(data.companies[0].capUSD,1.25e12)
})

test('missing cap, explicit currency and observation timestamp are separate from synthetic catalog fields', () => {
  for(const change of [{marketCap:null},{marketCap:0},{marketCap:-1},{marketCap:Infinity},{marketCapCurrency:null},{marketCapCurrency:'GBp'},{marketCapCurrency:'GBX'},
    {marketCapObservedAt:null},{marketCapStatus:'unavailable'},{marketCapObservedAt:'2026-11-10T12:06:00Z'}]){
    const data=run([quote('AAA',undefined,undefined,change)])
    assert.equal(data.companies.length,0)
    assert.equal(data.coverage.missingCap,1)
  }
  const q=quote('AAA',undefined,undefined,{marketCapObservedAt:null,marketCapFetchedAt:capObserved})
  assert.equal(run([q]).companies[0].capObservedAt,capObserved)
})

test('legacy capture-day and future daily candles are excluded even when their file is read later', () => {
  const q=quote('AAA',['2026-11-04','2026-11-05','2026-11-06'],[100,110,999],{priceBasis:undefined,fetchedAt:'2026-11-06T18:00:00Z'})
  const value=run([q]).companies[0]
  assert.equal(value.closeDate,'2026-11-05')
  assert.equal(value.price,110)
  near(value.returns['1d'],10)
  const completed=quote('AAA',['2026-11-05','2026-11-06','2026-11-09'],[100,110,999],{closeDate:'2026-11-06'})
  assert.equal(run([completed]).companies[0].closeDate,'2026-11-06')
})

test('non-finite and non-positive daily prices never turn into observed returns', () => {
  const q=quote('AAA',['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'],[100,null,Infinity,0,110])
  const b=quote('BBB',['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'],[100,101,102,103,110])
  const data=run([q,b],{companies:[company('AAA'),company('BBB')]})
  assert.equal(data.companies[0].returns['1d'],null)
  assert.equal(data.companies[0].price,110)
  assert.ok(!Number.isNaN(data.companies[0].cap))
})

test('stale actual values retain original dates and timestamps instead of becoming newly fetched observations', () => {
  const q=quote('AAA',undefined,undefined,{status:'stale',marketCapStatus:'stale',error:'provider unavailable'})
  const raw=JSON.stringify(q)
  const value=run([q])
  assert.equal(value.companies[0].status,'stale')
  assert.equal(value.companies[0].capStatus,'stale')
  assert.equal(value.companies[0].closeDate,'2026-11-06')
  assert.equal(value.companies[0].fetchedAt,captured)
  assert.equal(value.companies[0].capObservedAt,capObserved)
  assert.equal(value.coverage.staleCount,1)
  assert.equal(value.status,'partial')
  assert.equal(JSON.stringify(q),raw)
})

test('default catalog is retained for coverage while empty snapshots cannot display demonstration tiles', () => {
  const empty=buildActualMap({snapshot:null,now})
  assert.equal(empty.coverage.catalogCount,52)
  assert.equal(empty.coverage.companyCount,52)
  assert.equal(empty.coverage.listedCompanyCount,48)
  assert.equal(empty.coverage.unlistedCompanyCount,4)
  assert.equal(empty.coverage.unmappedPrimaryCompanyCount,0)
  assert.equal(empty.coverage.unmappedCompanyCount,0)
  assert.equal(empty.coverage.renderableCount,0)
  assert.equal(empty.companies.length,0)
  assert.equal(empty.coverage.exclusions.length,52)
  assert.equal(empty.coverage.exclusions.filter(item=>item.kind==='unlisted').length,4)
  assert.equal(empty.status,'unavailable')
  assert.throws(()=>buildActualMap({period:'made-up',now}),/수익률 기간/)
})

test('the approved 52-company map retains source order with normalized country and selected primary sector metadata', () => {
  const catalogue=buildMapCatalogue()
  assert.equal(catalogue.length,52)
  assert.equal(new Set(catalogue.map(company=>company.id)).size,52)
  assert.equal(catalogue.filter(company=>company.listed).length,48)
  assert.equal(catalogue.filter(company=>!company.listed).length,4)
  assert.deepEqual(catalogue.map(company=>company.sourceOrder),Array.from({length:52},(_,index)=>index+1))
  assert.ok(catalogue.every(company=>company.countryCodes.includes(company.country) && company.countryName && company.sector))
  assert.ok(catalogue.every(company=>company.mappingStatus==='candidate' && company.sourceStatus==='user-selected'))
  assert.ok(catalogue.every(company=>!Object.hasOwn(company,'cap') && !Object.hasOwn(company,'day') && !Object.hasOwn(company,'returns')))
  const tsmc=catalogue.find(company=>company.primaryTicker==='2330.TW')
  assert.deepEqual(tsmc.candidateTickers,['2330.TW'])
  const preliminary=buildMapCatalogue(snapshot([quote('TSM')])).find(company=>company.id===tsmc.id)
  assert.equal(preliminary.ticker,'2330.TW')
  assert.equal(preliminary.primaryTicker,tsmc.primaryTicker)
  assert.equal(buildMapCatalogue({quotes:{invalid:true}}).length,52)
  assert.ok(!catalogue.some(company=>['AAPL','TSLA'].includes(company.primaryTicker)))
})

test('Nscale stays in the seven-company cloud roster without a quote or price tile even if a proposed-symbol quote exists', () => {
  const catalogue=buildMapCatalogue(snapshot([quote('NSCL')]))
  const cloud=catalogue.filter(company=>company.sectorId==='cloud-gpu')
  assert.equal(cloud.length,7)
  assert.equal(cloud.filter(company=>company.listed).length,6)
  const nscale=catalogue.find(company=>company.id==='C0587')
  assert.equal(catalogue.filter(company=>company.id==='C0587').length,1)
  assert.equal(nscale.sourceOrder,52)
  assert.equal(nscale.country,'GB')
  assert.equal(nscale.listed,false)
  assert.equal(nscale.primaryTicker,null)
  assert.equal(nscale.ticker,null)
  assert.deepEqual(nscale.listings,[])
  assert.deepEqual(nscale.candidateTickers,[])
  for(const key of ['cap','capUSD','price','day','returns'])assert.equal(Object.hasOwn(nscale,key),false)
  const actual=buildActualMap({snapshot:snapshot([quote('NSCL')]),companies:[nscale],now})
  assert.equal(actual.companies.length,0)
  assert.equal(actual.coverage.unlistedCompanyCount,1)
  assert.equal(actual.coverage.exclusions[0].id,'C0587')
  assert.equal(actual.coverage.exclusions[0].kind,'unlisted')
  assert.equal(actual.coverage.exclusions[0].reason,'비상장 기업')
})

test('primary and alternate listings produce a single issuer cap, preferring the usable primary', () => {
  const issuer=company('AAA',{id:'C9999',listed:true,primaryTicker:'AAA',countryName:'한국·미국',countryCodes:['KR','US'],
    listings:[{ticker:'AAA',primary:true},{ticker:'BBB',primary:false}]})
  const primary=quote('AAA',undefined,undefined,{marketCap:1e12}),alternate=quote('BBB',undefined,undefined,{marketCap:2e12})
  const data=run([alternate,primary],{companies:[issuer]})
  assert.equal(data.companies.length,1)
  assert.equal(data.companies[0].ticker,'AAA')
  assert.equal(data.companies[0].capUSD,1e12)
  assert.equal(data.companies[0].alternateListing,false)
  assert.deepEqual(data.companies[0].countryCodes,['KR','US'])
  assert.equal(data.coverage.companyCount,1)
  assert.equal(data.coverage.renderableCount,1)
})

test('alternate listing fallback validates the entire same-listing cap, price and FX combination', () => {
  const issuer=company('AAA',{listed:true,primaryTicker:'AAA',listings:[{ticker:'AAA',primary:true},{ticker:'BBB',primary:false}]})
  for(const missing of [{marketCap:null},{bars:[]},{marketCapCurrency:'KRW'}]){
    const primary=quote('AAA',undefined,undefined,missing),alternate=quote('BBB',undefined,undefined,{marketCap:2e12})
    const data=run([primary,alternate],{companies:[issuer]})
    assert.equal(data.companies.length,1)
    assert.equal(data.companies[0].ticker,'BBB')
    assert.equal(data.companies[0].primaryTicker,'AAA')
    assert.equal(data.companies[0].capUSD,2e12)
    assert.equal(data.companies[0].alternateListing,true)
  }
  const split=run([quote('AAA',undefined,undefined,{marketCap:null}),quote('BBB',undefined,undefined,{bars:[]})],{companies:[issuer]})
  assert.equal(split.companies.length,0)
  assert.match(split.coverage.exclusions[0].reason,/동일 상장/)
})

test('private and unresolved issuers stay visible in coverage with explicit exclusion reasons', () => {
  const companies=[company('AAA',{id:'private',listed:false,listings:[],primaryTicker:null}),
    company('UNMAPPED',{id:'unmapped',ticker:null,listed:true,listings:[],primaryTicker:null,unmappedReason:'거래소 연결 미확인'}),
    company('BBB',{id:'missing',listed:true})]
  const data=run([],{companies})
  assert.equal(data.coverage.companyCount,3)
  assert.equal(data.coverage.listedCompanyCount,2)
  assert.equal(data.coverage.unlistedCompanyCount,1)
  assert.equal(data.coverage.unmappedCompanyCount,1)
  assert.equal(data.coverage.missingCap,1)
  assert.equal(data.coverage.missingPrice,1)
  assert.equal(data.coverage.exclusions.find(item=>item.id==='private').reason,'비상장 기업')
  assert.equal(data.coverage.exclusions.find(item=>item.id==='unmapped').reason,'거래소 연결 미확인')
  assert.equal(data.companies.length,0)
})
