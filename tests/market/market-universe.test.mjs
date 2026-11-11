import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { instruments } from '../../assets/instruments.js'
import { normalizeListing, buildMarketUniverse, loadMarketUniverse } from '../../scripts/data/market-universe.mjs'

const master = JSON.parse(await readFile(new URL('../../research/market/company-universe.json', import.meta.url), 'utf8'))

test('collector projection preserves the 586-issuer source and appends eight approved issuers with stable IDs', async () => {
  const { targets, coverage } = await loadMarketUniverse()
  assert.equal(coverage.companyCount, 594)
  assert.equal(coverage.listedCompanyCount, 544)
  assert.equal(coverage.unlistedCompanyCount, 50)
  assert.equal(new Set(master.companies.map(company => company.id)).size, 586)
  assert.equal(coverage.mappedListedCompanyCount + coverage.unmapped.length, coverage.listedCompanyCount)
  assert.equal(coverage.mappingStatus, 'candidate')
  assert.equal(new Set(targets.map(target => target.symbol)).size, targets.length)
  assert.ok(!targets.some(target => ['C0347', 'C0483'].includes(target.companyId) && /[^A-Z0-9^=.-]/.test(target.symbol)))
  assert.equal(master.companies.reduce((count, company) => count + company.sectors.length, 0), 699)
  assert.ok(master.companies.filter(company => !company.listed).every(company => company.ticker === '' && company.exchange === ''))
  assert.ok(master.companies.every(company => Object.keys(company).every(key => ['id','name','country','listed','exchange','ticker','sector','sectors'].includes(key))))
})

test('legacy instruments stay first and keep their names, groups and memberships', async () => {
  const { targets } = await loadMarketUniverse()
  for (const [index, item] of instruments.entries()) {
    assert.equal(targets[index].symbol, item.symbol)
    assert.equal(targets[index].name, item.name)
    assert.equal(targets[index].group, item.group)
    assert.deepEqual(targets[index].chains, item.chains)
  }
  assert.ok(targets.some(target => target.companyId === 'C0046' && target.symbol === 'ANET'))
  assert.ok(targets.some(target => target.companyId === 'C0115' && target.symbol === 'CRWV'))
})

test('exchange-aware symbol formatting preserves leading zeros and avoids cross-market collisions', () => {
  assert.equal(normalizeListing('005930','KRX KOSPI').symbol, '005930.KS')
  assert.equal(normalizeListing('002230','SZSE').symbol, '002230.SZ')
  assert.equal(normalizeListing('688256','SSE STAR').symbol, '688256.SS')
  assert.equal(normalizeListing('2330','TWSE').symbol, '2330.TW')
  assert.equal(normalizeListing('6488','TPEx').symbol, '6488.TWO')
  assert.equal(normalizeListing('285A','TSE').symbol, '285A.T')
  assert.equal(normalizeListing('00763','HKEX').symbol, '0763.HK')
  assert.equal(normalizeListing('0700','HKEX').symbol, '0700.HK')
  assert.equal(normalizeListing('BIP.UN','TSX').symbol, 'BIP-UN.TO')
  assert.equal(normalizeListing('T','MOEX').symbol, undefined)
  assert.equal(normalizeListing('T','TSX').symbol, 'T.TO')
  assert.equal(normalizeListing('T','NYSE').symbol, 'T')
  assert.equal(normalizeListing('DU','DFM').symbol, 'DU.AE')
  assert.equal(normalizeListing('TEL','PSE').symbol, undefined)
  assert.equal(normalizeListing('ETISALAT','ADX').symbol, undefined)
  assert.equal(normalizeListing('035510','KRX').symbol, undefined)
  assert.equal(normalizeListing('007660','KRX',['007660.KS']).symbol, '007660.KS')
  assert.equal(normalizeListing('007660','KRX',['007660.KS','007660.KQ']).symbol, undefined)
})

test('ADR and alternate share classes keep one primary market-cap listing per issuer', async () => {
  const { targets, coverage } = await loadMarketUniverse()
  const tsmc = targets.filter(target => target.companyId === 'C0483')
  assert.deepEqual(tsmc.map(target => target.symbol).sort(), ['2330.TW','TSM'])
  assert.deepEqual(tsmc.filter(target => target.primaryForCompany).map(target => target.symbol), ['2330.TW'])
  const primary = targets.filter(target => target.primaryForCompany && /^C\d{4}$/.test(target.companyId))
  assert.equal(new Set(primary.map(target => target.companyId)).size, coverage.mappedListedCompanyCount)
  assert.equal(primary.length, coverage.mappedListedCompanyCount)
  assert.ok(coverage.unmapped.some(company => company.companyId === 'C0484' && company.ticker === 'T'))
  assert.equal(targets.find(target => target.companyId === 'C0284').symbol, '032640.KS')
  assert.ok(targets.find(target => target.companyId === 'C0284').mappingSourceUrl.startsWith('https://kind.krx.co.kr/'))
  assert.equal(coverage.unmapped.length, 12)
  assert.equal(coverage.alternateOnlyCompanyCount, 1)
  assert.equal(targets.find(target => target.symbol === 'PHI').companyId, 'C0361')
  assert.equal(targets.find(target => target.symbol === 'PHI').primaryForCompany, false)
  assert.ok(coverage.unmapped.some(company => company.companyId === 'C0361' && company.alternateSymbols.includes('PHI')))
  assert.ok(!targets.some(target => ['TEL.PS','GLO.PS','ETISALAT.AD','DU.DU'].includes(target.symbol)))
})

test('the universe rejects duplicate issuer IDs and shared symbols instead of silently merging companies', () => {
  assert.throws(() => buildMarketUniverse({ master: { ...master, companies: [master.companies[0],master.companies[0]] } }), /식별/)
  const company = { id:'C0001',name:'First',country:'미국',listed:true,exchange:'NASDAQ',ticker:'SAME',sector:'SEG1',sectors:['SEG1'] }
  assert.throws(() => buildMarketUniverse({master:{schemaVersion:1,companies:[company,{...company,id:'C0002'}]},legacyItems:[],catalogCompanies:[]}), /충돌/)
})
