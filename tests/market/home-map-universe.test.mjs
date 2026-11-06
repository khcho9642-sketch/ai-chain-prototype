import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildHomeMapUniverse, renderHomeMapUniverse } from '../../scripts/data/build-home-map-universe.mjs'
import { loadMarketUniverse } from '../../scripts/data/market-universe.mjs'
import { MAP_COMPANIES, MAP_UNIVERSE, HOME_MAP_UNIVERSE } from '../../assets/home-map-universe.js'

const master = JSON.parse(await readFile(new URL('../../research/market/company-universe.json', import.meta.url), 'utf8'))

test('the public map catalogue retains all 586 issuers and private/unresolved coverage without synthetic observations', async () => {
  const expected = buildHomeMapUniverse({ master, universe: await loadMarketUniverse() })
  assert.deepEqual(MAP_COMPANIES, expected.companies)
  assert.deepEqual(MAP_UNIVERSE, expected.metadata)
  assert.equal(HOME_MAP_UNIVERSE, MAP_COMPANIES)
  assert.equal(MAP_COMPANIES.length, 586)
  assert.equal(new Set(MAP_COMPANIES.map(company => company.id)).size, 586)
  assert.equal(MAP_COMPANIES.filter(company => company.listed).length, 537)
  assert.equal(MAP_COMPANIES.filter(company => !company.listed).length, 49)
  assert.equal(MAP_COMPANIES.filter(company => !company.primaryTicker && company.listed).length, 12)
  assert.ok(MAP_COMPANIES.filter(company => !company.listed).every(company => !company.listings.length && company.unmappedReason.includes('비상장')))
  assert.ok(MAP_COMPANIES.every(company => /^[A-Z]{2}$/.test(company.country) && company.countryCodes.every(code => /^[A-Z]{2}$/.test(code))))
  assert.ok(MAP_COMPANIES.every(company => !['cap', 'day', 'returns', 'marketCap', 'sourceUrl'].some(key => Object.hasOwn(company, key))))
  const source = await readFile(new URL('../../assets/home-map-universe.js', import.meta.url), 'utf8')
  assert.equal(source, renderHomeMapUniverse(expected))
  assert.ok(!source.includes('.xlsx') && !source.includes('drive.google.com'))
})

test('primary and alternate listings remain under one issuer and preserve alternate-only unresolved companies', () => {
  const tsmc = MAP_COMPANIES.find(company => company.id === 'C0483')
  assert.equal(tsmc.primaryTicker, '2330.TW')
  assert.deepEqual(tsmc.listings.map(listing => listing.ticker), ['2330.TW', 'TSM'])
  assert.equal(tsmc.listings.filter(listing => listing.primary).length, 1)
  const pldt = MAP_COMPANIES.find(company => company.id === 'C0361')
  assert.equal(pldt.primaryTicker, null)
  assert.deepEqual(pldt.listings.map(listing => listing.ticker), ['PHI'])
  assert.ok(pldt.unmappedReason)
  const symbols = MAP_COMPANIES.flatMap(company => company.listings.map(listing => listing.ticker))
  assert.equal(symbols.length, new Set(symbols).size)
  assert.ok(Object.isFrozen(tsmc) && Object.isFrozen(tsmc.listings) && Object.isFrozen(tsmc.listings[0]))
})

test('map generation fails on ambiguous identities and multiple primary listings', () => {
  const company = master.companies[0]
  assert.throws(() => buildHomeMapUniverse({ master: {...master, companies:[company, company]}, universe:{targets:[]} }), /식별/)
  assert.throws(() => buildHomeMapUniverse({ master: {...master, companies:[{...company,country:'미확인'}]}, universe:{targets:[]} }), /분류/)
  const targets = ['FIRST','SECOND'].map(symbol => ({companyId:company.id,symbol,primaryForCompany:true}))
  assert.throws(() => buildHomeMapUniverse({ master: {...master, companies:[company]}, universe:{targets} }), /대표 상장/)
})
