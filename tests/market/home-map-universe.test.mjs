import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildHomeMapUniverse, renderHomeMapUniverse } from '../../scripts/data/build-home-map-universe.mjs'
import { buildCompanyAdditions } from '../../scripts/data/company-additions.mjs'
import { loadMarketUniverse } from '../../scripts/data/market-universe.mjs'
import { MAP_COMPANIES, MAP_UNIVERSE, HOME_MAP_UNIVERSE } from '../../assets/home-map-universe.js'

const master = JSON.parse(await readFile(new URL('../../research/market/company-universe.json', import.meta.url), 'utf8'))
const selection = JSON.parse(await readFile(new URL('../../research/market/home-map-selection.json', import.meta.url), 'utf8'))
const additions = JSON.parse(await readFile(new URL('../../research/market/home-map-additions.json', import.meta.url), 'utf8'))
const issuerAdditions = JSON.parse(await readFile(new URL('../../research/market/company-additions.json', import.meta.url), 'utf8'))
const reclassifications = JSON.parse(await readFile(new URL('../../research/market/sector-reclassifications.json', import.meta.url), 'utf8'))
const universe = await loadMarketUniverse()
const approvedTickers = ['ASML.AS','AMAT','LRCX','KLAC','8035.T','042700.KS','2330.TW','INTC','0981.HK','3711.TW','AMKR',
  '005930.KS','000660.KS','MU','SNDK','285A.T','NVDA','AVGO','AMD','ARM','MRVL','CSCO','ANET','DELL','2317.TW','COHR',
  '007660.KS','GEV','ENR.DE','SU.PA','ETN','VRT','010120.KS','267260.KS','EQIX','DLR','IRM','GDS','MSFT','AMZN','ORCL',
  'BABA','CRWV','NBIS','GOOGL','META','QCOM','688825.SS']
approvedTickers.push('GLW','300308.SZ','LITE','300502.SZ','5803.T','CIEN')

test('the map preserves the original 49 and adds the nine user-requested core issuers', async () => {
  const expected = buildHomeMapUniverse({master,universe,selection,additions,issuerAdditions,reclassifications})
  assert.deepEqual(MAP_COMPANIES,expected.companies)
  assert.deepEqual(MAP_UNIVERSE,expected.metadata)
  assert.equal(HOME_MAP_UNIVERSE,MAP_COMPANIES)
  assert.equal(MAP_COMPANIES.length,58)
  assert.equal(new Set(MAP_COMPANIES.map(company=>company.id)).size,58)
  assert.equal(MAP_COMPANIES.filter(company=>company.listed).length,54)
  assert.equal(MAP_COMPANIES.filter(company=>!company.listed).length,4)
  assert.deepEqual(MAP_COMPANIES.slice(0,49).map(company=>[company.sourceOrder,company.id,company.name,company.sourceSector,company.role]),
    selection.companies.map(company=>[company.order,company.companyId,company.name,company.companyId==='C0110'?'광통신':company.sector,company.role]))
  assert.equal(MAP_UNIVERSE.baseCompanyCount,49)
  assert.equal(MAP_UNIVERSE.userAdditions.length,9)
  assert.deepEqual(MAP_UNIVERSE.userAdditions.slice(0,3),[{companyId:'C0371',ticker:'QCOM',requestedOn:'2026-11-08'},{companyId:'C0119',ticker:'688825.SS',requestedOn:'2026-11-08'},{companyId:'C0587',ticker:null,requestedOn:'2026-11-08'}])
  assert.ok(MAP_UNIVERSE.userAdditions.slice(3).every(row=>row.requestedOn==='2026-11-11'))
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
  assert.equal(MAP_UNIVERSE.masterCompanyCount,594)
  assert.equal(MAP_UNIVERSE.baseMasterCompanyCount,586)
  assert.ok(universe.targets.length>500)
  assert.equal(MAP_UNIVERSE.mappedListedCompanyCount,54)
  assert.equal(MAP_UNIVERSE.unmappedListedCompanyCount,0)
  const hanmi=MAP_COMPANIES.find(company=>company.primaryTicker==='042700.KS')
  assert.equal(hanmi.sector,'반도체 소부장')
  assert.equal(hanmi.sectorId,'semiconductor-equipment')
  assert.equal(MAP_COMPANIES.find(company=>company.primaryTicker==='MSFT').sourceSector,'클라우드·GPU')
  assert.equal(MAP_COMPANIES.find(company=>company.primaryTicker==='MSFT').sector,'클라우드·GPU 컴퓨팅')
  assert.ok(Object.isFrozen(hanmi) && Object.isFrozen(hanmi.listings) && Object.isFrozen(hanmi.listings[0]))
})

test('Private companies retain stable IDs and explicit roles without market area', () => {
  const privateCompanies=MAP_COMPANIES.filter(company=>!company.listed)
  assert.deepEqual(privateCompanies.map(company=>[company.id,company.name,company.role]),[
    ['C0351','OpenAI','GPT'],['C0037','Anthropic','Claude'],['C0128','DeepSeek','가중치 공개 AI 모델'],
    ['C0587','Nscale','AI 학습·추론용 GPU 클라우드'],
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

test('Qualcomm additions preserve the base roster and reject duplicate issuers, wrong listings and unapproved provenance', () => {
  const q=MAP_COMPANIES.find(company=>company.primaryTicker==='QCOM')
  assert.equal(q.id,'C0371')
  assert.equal(q.sectorId,'ai-chips')
  assert.equal(q.sourceOrder,50)
  assert.equal(q.selectionChange,'사용자 추가')
  assert.equal(MAP_COMPANIES.filter(company=>company.sectorId==='ai-chips').length,6)
  assert.equal(buildHomeMapUniverse({master,universe,selection}).companies.length,49)
  for (const mutate of [
    copy=>copy.companies.push({...copy.companies[0]}),
    copy=>copy.companies[0].companyId='C0347',
    copy=>copy.companies[0].ticker='NVDA',
    copy=>copy.source.type='inferred',
    copy=>copy.source.requestedOn='',
  ]) {
    const copy=structuredClone(additions); mutate(copy)
    assert.throws(()=>buildHomeMapUniverse({master,universe,selection,additions:copy,issuerAdditions}))
  }
})

test('CXMT joins memory once using its existing issuer ID and exact Shanghai listing', () => {
  const rows=MAP_COMPANIES.filter(company=>company.id==='C0119')
  assert.equal(rows.length,1)
  const c=rows[0]
  assert.equal(c.name,'CXMT')
  assert.equal(c.sectorId,'memory')
  assert.equal(c.sourceOrder,51)
  assert.equal(c.primaryTicker,'688825.SS')
  assert.equal(c.listed,true)
  assert.equal(c.listings[0].currency,'CNY')
  assert.equal(MAP_COMPANIES.filter(company=>company.sectorId==='memory').length,6)
})

test('Nscale is a separate approved private issuer without extending quote collection targets', () => {
  const original=structuredClone(master)
  const extra=buildCompanyAdditions({master,additions:issuerAdditions})
  assert.deepEqual(master,original)
  assert.equal(extra.issuers.length,8)
  assert.equal(extra.registryRows.length,8)
  const c=MAP_COMPANIES.find(company=>company.id==='C0587')
  assert.equal(c.name,'Nscale')
  assert.equal(c.sourceOrder,52)
  assert.equal(c.country,'GB')
  assert.equal(c.sectorId,'cloud-gpu')
  assert.equal(c.listed,false)
  assert.equal(c.primaryTicker,null)
  assert.deepEqual(c.listings,[])
  assert.equal(MAP_COMPANIES.filter(company=>company.sectorId==='cloud-gpu').length,7)
  assert.ok(!universe.targets.some(target=>target.companyId===c.id || target.symbol==='NSCL'))
  assert.deepEqual(extra.registryRows[0].listingCodes,[])
  assert.equal(extra.registryRows[0].financialId,null)
  assert.ok(!Object.keys(extra.registryRows[0]).some(key=>/price|cap|revenue/i.test(key)))
  assert.ok(!master.companies.some(company=>company.id===c.id))
})

test('separate issuer additions reject collisions, fake listings, unsafe links and numeric market fields', () => {
  for (const mutate of [
    copy=>copy.companies[0].id='C0371',
    copy=>copy.companies.push(structuredClone(copy.companies[0])),
    copy=>copy.companies[0].ticker='NSCL',
    copy=>copy.companies[0].listed=true,
    copy=>copy.companies[0].sources[0].url='javascript:alert(1)',
    copy=>copy.companies[0].sources[0].url='https://user:secret@example.com/',
    copy=>copy.companies[0].marketCap=123,
    copy=>copy.source.type='inferred',
  ]) {
    const copy=structuredClone(issuerAdditions); mutate(copy)
    assert.throws(()=>buildCompanyAdditions({master,additions:copy}))
  }
})
