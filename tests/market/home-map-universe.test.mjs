import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildHomeMapUniverse, renderHomeMapUniverse } from '../../scripts/data/build-home-map-universe.mjs'
import { loadMarketUniverse } from '../../scripts/data/market-universe.mjs'
import { MAP_COMPANIES, MAP_UNIVERSE, HOME_MAP_UNIVERSE } from '../../assets/home-map-universe.js'

const master = JSON.parse(await readFile(new URL('../../research/market/company-universe.json', import.meta.url), 'utf8'))
const selection = JSON.parse(await readFile(new URL('../../research/market/home-map-selection.json', import.meta.url), 'utf8'))
const universe = await loadMarketUniverse()
const approvedTickers = ['ASML.AS','AMAT','LRCX','KLAC','8035.T','042700.KS','2330.TW','INTC','0981.HK','3711.TW','AMKR',
  '005930.KS','000660.KS','MU','SNDK','285A.T','NVDA','AVGO','AMD','ARM','MRVL','CSCO','ANET','DELL','2317.TW','COHR',
  '007660.KS','GEV','ENR.DE','SU.PA','ETN','VRT','010120.KS','267260.KS','EQIX','DLR','IRM','GDS','MSFT','AMZN','ORCL',
  'BABA','CRWV','NBIS','GOOGL','META']

test('the map contains exactly the approved sheet 49, preserving source order, names, roles and provenance', async () => {
  const expected = buildHomeMapUniverse({master,universe,selection})
  assert.deepEqual(MAP_COMPANIES,expected.companies)
  assert.deepEqual(MAP_UNIVERSE,expected.metadata)
  assert.equal(HOME_MAP_UNIVERSE,MAP_COMPANIES)
  assert.equal(MAP_COMPANIES.length,49)
  assert.equal(new Set(MAP_COMPANIES.map(company=>company.id)).size,49)
  assert.equal(MAP_COMPANIES.filter(company=>company.listed).length,46)
  assert.equal(MAP_COMPANIES.filter(company=>!company.listed).length,3)
  assert.deepEqual(MAP_COMPANIES.map(company=>[company.sourceOrder,company.id,company.name,company.sourceSector,company.role]),
    selection.companies.map(company=>[company.order,company.companyId,company.name,company.sector,company.role]))
  assert.equal(MAP_UNIVERSE.sourceSheet,'핵심기업 49')
  assert.equal(MAP_UNIVERSE.sourceModifiedAt,'2026-11-06T15:21:47.237Z')
  assert.equal(MAP_UNIVERSE.sourceAsOf,'2026-11-07')
  assert.equal(MAP_UNIVERSE.sourceTimezone,'Asia/Seoul')
  assert.equal(MAP_UNIVERSE.sourceSha256,'33ba8de435afbaf08dc9fdb2f6d6ec5da8d8f7f59b4b89c31aadd1cad4cc8bf1')
  assert.equal(MAP_UNIVERSE.sourceUrl,selection.source.url)
  assert.equal(MAP_UNIVERSE.listingPolicy,'exact-approved-ticker')
  assert.equal(MAP_UNIVERSE.sourceStatus,'user-selected')
  assert.ok(MAP_COMPANIES.every(company=>/^[A-Z]{2}$/.test(company.country) && company.countryCodes.every(code=>/^[A-Z]{2}$/.test(code))))
  assert.ok(MAP_COMPANIES.every(company=>!['cap','day','returns','marketCap'].some(key=>Object.hasOwn(company,key))))
  const source=await readFile(new URL('../../assets/home-map-universe.js',import.meta.url),'utf8')
  assert.equal(source.replaceAll('\r\n','\n'),renderHomeMapUniverse(expected).replaceAll('\r\n','\n'))
  assert.ok(!source.includes('.xlsx'))
})

test('only exact approved listings are used while the full collection master remains separate', () => {
  const listed=MAP_COMPANIES.filter(company=>company.listed)
  assert.deepEqual(listed.map(company=>company.primaryTicker),approvedTickers)
  assert.ok(listed.every(company=>company.listings.length===1 && company.listings[0].primary && company.listings[0].ticker===company.primaryTicker))
  assert.ok(!listed.some(company=>['ASML','TSM','SMICY','9988.HK','9698.HK','AAPL','TSLA'].includes(company.primaryTicker)))
  assert.ok(!MAP_COMPANIES.some(company=>/^(애플|테슬라|Apple|Tesla)$/i.test(company.name)))
  assert.equal(master.companies.length,586)
  assert.equal(MAP_UNIVERSE.masterCompanyCount,586)
  assert.ok(universe.targets.length>500)
  assert.equal(MAP_UNIVERSE.mappedListedCompanyCount,46)
  assert.equal(MAP_UNIVERSE.unmappedListedCompanyCount,0)
  const hanmi=MAP_COMPANIES.find(company=>company.primaryTicker==='042700.KS')
  assert.equal(hanmi.sector,'반도체 소부장')
  assert.equal(hanmi.sectorId,'semiconductor-equipment')
  assert.equal(MAP_COMPANIES.find(company=>company.primaryTicker==='MSFT').sourceSector,'클라우드·GPU')
  assert.equal(MAP_COMPANIES.find(company=>company.primaryTicker==='MSFT').sector,'클라우드·GPU 컴퓨팅')
  assert.ok(Object.isFrozen(hanmi) && Object.isFrozen(hanmi.listings) && Object.isFrozen(hanmi.listings[0]))
})

test('OpenAI, Anthropic and DeepSeek retain their master IDs and explicit private roles without market area', () => {
  const privateCompanies=MAP_COMPANIES.filter(company=>!company.listed)
  assert.deepEqual(privateCompanies.map(company=>[company.id,company.name,company.role]),[
    ['C0351','OpenAI','GPT'],['C0037','Anthropic','Claude'],['C0128','DeepSeek','가중치 공개 AI 모델'],
  ])
  assert.ok(privateCompanies.every(company=>company.primaryTicker===null && !company.listings.length && company.unmappedReason.includes('비상장')))
})

test('generation rejects enlarged selections, ambiguous identities, reordered rows and mismatched exact listings', () => {
  const changed=fn=>{const copy=structuredClone(selection);fn(copy);return copy}
  assert.throws(()=>buildHomeMapUniverse({master,universe,selection:changed(copy=>copy.companies.push(...copy.companies.slice(0,4)))}),/49개사/)
  assert.throws(()=>buildHomeMapUniverse({master,universe,selection:changed(copy=>copy.companies[1].companyId=copy.companies[0].companyId)}),/식별/)
  assert.throws(()=>buildHomeMapUniverse({master,universe,selection:changed(copy=>copy.companies[0].sector='미확인')}),/분류/)
  assert.throws(()=>buildHomeMapUniverse({master,universe,selection:changed(copy=>copy.companies[0].order=2)}),/순서/)
  assert.throws(()=>buildHomeMapUniverse({master,universe,selection:changed(copy=>copy.companies[0].ticker='NVDA')}),/연결 불일치/)
  assert.throws(()=>buildHomeMapUniverse({master,universe,selection:changed(copy=>copy.companies[48].ticker='PRIVATE')}),/비상장/)
  assert.throws(()=>buildHomeMapUniverse({master:{...master,companies:[...master.companies,master.companies[0]]},universe,selection}),/식별 중복/)
})
