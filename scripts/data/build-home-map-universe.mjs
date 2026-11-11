import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { SECTORS } from '../../assets/home-map-core.js'
import { loadMarketUniverse } from './market-universe.mjs'
import { buildCompanyAdditions } from './company-additions.mjs'

const masterPath = new URL('../../research/market/company-universe.json', import.meta.url)
const selectionPath = new URL('../../research/market/home-map-selection.json', import.meta.url)
const additionsPath = new URL('../../research/market/home-map-additions.json', import.meta.url)
const issuerAdditionsPath = new URL('../../research/market/company-additions.json', import.meta.url)
const reclassificationsPath = new URL('../../research/market/sector-reclassifications.json', import.meta.url)
const outputPath = new URL('../../assets/home-map-universe.js', import.meta.url)
const countries = Object.freeze({
  한국:'KR', 미국:'US', 일본:'JP', 대만:'TW', 중국:'CN', 홍콩:'HK',
  네덜란드:'NL', 영국:'GB', 독일:'DE', 프랑스:'FR', 스위스:'CH', 아일랜드:'IE',
  싱가포르:'SG', 덴마크:'DK', 스웨덴:'SE', 스페인:'ES', 이탈리아:'IT', 핀란드:'FI',
  벨기에:'BE', 오스트리아:'AT', 이스라엘:'IL', 캐나다:'CA', 호주:'AU', 뉴질랜드:'NZ',
  인도:'IN', 인도네시아:'ID', 말레이시아:'MY', 태국:'TH', 필리핀:'PH', 베트남:'VN',
  러시아:'RU', 브라질:'BR', 남아프리카공화국:'ZA', 사우디아라비아:'SA', 카타르:'QA',
  아랍에미리트:'AE', 바레인:'BH', 튀르키예:'TR',
})

// The curated sheet controls membership, order, names, sectors and the exact
// selected listing. The broader 586-company master remains a collection source.
export function buildHomeMapUniverse({ master, universe, selection, additions, issuerAdditions, reclassifications } = {}) {
  if (master?.schemaVersion !== 1 || !Array.isArray(master.companies) || !Array.isArray(universe?.targets)) throw new Error('지도 기업 원장 형식 오류')
  if (selection?.schemaVersion !== 1 || !Array.isArray(selection.companies) || selection.companies.length !== 49
    || selection.companyCount !== 49 || selection.listedCompanyCount !== 46 || selection.unlistedCompanyCount !== 3
    || selection.source?.sheet !== '핵심기업 49' || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(selection.source.url || '')
    || !/^[a-f0-9]{64}$/.test(selection.source.sha256 || '') || !Number.isFinite(Date.parse(selection.source.modifiedAt))) throw new Error('지도 49개사 선정표·출처 오류')
  const additionalCompanies = additions?.companies ?? []
  if (additions && (additions.schemaVersion !== 1 || !Array.isArray(additions.companies)
    || additions.source?.type !== 'user-request' || !additions.source.note?.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(additions.source.requestedOn || '')
    || !Number.isFinite(Date.parse(additions.source.requestedOn)))) throw new Error('지도 사용자 추가 선정표·출처 오류')
  // Keep the original sheet and its hash intact; later user requests are explicit additions.
  const selectedCompanies = [...selection.companies, ...additionalCompanies.map((company, index) =>
    ({...company, order: selection.companies.length + index + 1}))]
  const sectors = new Map(SECTORS.map(sector => [sector.name, sector]))
  sectors.set('클라우드·GPU',sectors.get('클라우드·GPU 컴퓨팅'))
  const sectorNames = new Map(SECTORS.map(sector => [sector.id, sector.name]))
  const reclassified = new Map((reclassifications?.changes || []).map(change => [change.companyId, sectorNames.get(change.sectorId)]))
  const extra = buildCompanyAdditions({master, additions:issuerAdditions})
  const masterCompanies = new Map([...master.companies,...extra.issuers].map(company=>[company.id,company]))
  if (masterCompanies.size !== master.companies.length + extra.issuers.length) throw new Error('지도 기업 식별 중복')
  const ids = new Set(), symbols = new Set()
  const companies = selectedCompanies.map((selected,index) => {
    const company=masterCompanies.get(selected.companyId),sector=sectors.get(reclassified.get(selected.companyId) || selected.sector)
    const countryCodes=String(company?.country).split('·').map(name=>countries[name.trim()])
    if (!company || !/^C\d{4}$/.test(selected.companyId) || ids.has(selected.companyId) || !selected.name || !sector
      || selected.order !== index+1 || typeof selected.listed !== 'boolean' || !selected.role
      || countryCodes.some(code=>!code)) throw new Error('지도 선정 기업 식별·분류·순서 오류')
    ids.add(selected.companyId)
    const listings=[]
    if (selected.listed) {
      if (!/^[A-Z0-9.-]{1,24}$/.test(selected.ticker || '') || symbols.has(selected.ticker)) throw new Error('지도 선정 상장 종목 중복·형식 오류')
      const targets=universe.targets.filter(target=>target.companyId===company.id && target.symbol===selected.ticker)
      if (targets.length !== 1) throw new Error('지도 선정 티커와 기업 연결 불일치: '+selected.ticker)
      symbols.add(selected.ticker)
      listings.push({ticker:selected.ticker,primary:true,currency:targets[0].currency || null,exchange:targets[0].exchange || null})
    } else if (selected.ticker !== null) throw new Error('지도 비상장 선정 기업의 티커 오류')
    const row={id:company.id,name:selected.name,country:countryCodes[0],countryName:company.country,countryCodes,
      sector:sector.name,sectorId:sector.id,sourceOrder:selected.order,sourceSector:reclassified.get(selected.companyId) || selected.sector,
      selectionChange:selected.change,role:selected.role,listed:selected.listed,primaryTicker:selected.ticker,listings}
    if (!selected.listed) row.unmappedReason='비상장: 공개 시총·종가 없음'
    return row
  })
  const listedCompanyCount = companies.filter(company => company.listed).length
  if (listedCompanyCount !== selection.listedCompanyCount + additionalCompanies.filter(company => company.listed).length) throw new Error('지도 선정 상장·비상장 기업 수 오류')
  return { companies, metadata: {
    schemaVersion: 1, source: 'approved-home-map-selection',
    sourceAsOf:new Date(Date.parse(selection.source.modifiedAt)+9*3600000).toISOString().slice(0,10),sourceTimezone:'Asia/Seoul',
    sourceUrl:selection.source.url,sourceSheet:selection.source.sheet,sourceModifiedAt:selection.source.modifiedAt,sourceSha256:selection.source.sha256,
    baseCompanyCount: selection.companyCount,
    userAdditions: additionalCompanies.map(company => ({companyId: company.companyId, ticker: company.ticker, requestedOn: company.requestedOn || additions.source.requestedOn})),
    sourceStatus: 'user-selected', mappingStatus: 'candidate',listingPolicy:'exact-approved-ticker',masterCompanyCount:masterCompanies.size,baseMasterCompanyCount:master.companies.length,
    companyCount: companies.length, listedCompanyCount, unlistedCompanyCount: companies.length - listedCompanyCount,
    mappedListedCompanyCount: companies.filter(company => company.listed && company.primaryTicker).length,
    alternateOnlyCompanyCount: companies.filter(company => company.listed && !company.primaryTicker && company.listings.length).length,
    unmappedListedCompanyCount: companies.filter(company => company.listed && !company.primaryTicker).length,
  } }
}

export function renderHomeMapUniverse({ companies, metadata }) {
  return '// Generated by scripts/data/build-home-map-universe.mjs; public identity fields only.\n'
    + 'export const MAP_UNIVERSE = Object.freeze(' + JSON.stringify(metadata) + ')\n'
    + 'export const MAP_COMPANIES = Object.freeze([\n'
    + companies.map(company => '  ' + JSON.stringify(company)).join(',\n')
    + '\n].map(company => Object.freeze({...company, countryCodes: Object.freeze(company.countryCodes), listings: Object.freeze(company.listings.map(Object.freeze))})))\n'
    + 'export const HOME_MAP_UNIVERSE = MAP_COMPANIES\n'
}

export async function writeHomeMapUniverse({ destination = outputPath } = {}) {
  const [master, universe, selection, additions, issuerAdditions, reclassifications] = await Promise.all([readFile(masterPath, 'utf8').then(JSON.parse), loadMarketUniverse(),readFile(selectionPath,'utf8').then(JSON.parse),readFile(additionsPath,'utf8').then(JSON.parse),readFile(issuerAdditionsPath,'utf8').then(JSON.parse),readFile(reclassificationsPath,'utf8').then(JSON.parse)])
  const value = buildHomeMapUniverse({ master, universe, selection, additions, issuerAdditions, reclassifications })
  const path = destination instanceof URL ? fileURLToPath(destination) : resolve(destination)
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, renderHomeMapUniverse(value))
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
  return value.metadata
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeHomeMapUniverse().then(metadata => console.log('지도 기업 원장 생성: ' + metadata.companyCount + '개사'))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
