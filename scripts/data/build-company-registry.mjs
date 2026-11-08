import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { MAP_COMPANIES, MAP_UNIVERSE } from '../../assets/home-map-universe.js'
import { previewRecords } from '../../assets/company-preview-records.js'
import { companyProfiles } from '../../assets/company-profiles.js'
import { instruments } from '../../assets/instruments.js'
import { dartCompanies } from '../../assets/company-disclosure-sources.js'
import { SECTORS } from '../../assets/home-map-core.js'
import { loadMarketUniverse } from './market-universe.mjs'
import { buildCompanyAdditions } from './company-additions.mjs'

// Reads a UTF-8 CSV export of the 원장's 회사리스트 sheet, including multiline cells.
// Only identity, business descriptions, ticker mappings and public reference links
// are copied to the browser. Editorial notes and the private workbook stay local.
function readBusinessSheet(text) {
  const records = []
  let row = [], field = '', quoted = false
  const csv = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n') + '\n'
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field); field = ''
      if (c === '\n') { records.push(row); row = [] }
    } else field += c
  }
  if (quoted) throw new Error('열린 따옴표가 있는 CSV입니다.')
  const header = records.find(r => r.includes('회사ID') && r.includes('주요사업·모델'))
  const columns = ['회사ID','회사명','국가·지역','상장구분','종목코드','주SEG(초안)','주요사업·모델','SEG별 편입 근거','출처 URL','보충 출처 URL','별칭·검색어']
  if (!header || !columns.every(c => header.includes(c))) throw new Error('회사리스트 CSV 머리글이 잘못되었습니다.')
  const byId = new Map()
  for (const cells of records) {
    const id = cells[header.indexOf('회사ID')]
    if (!/^C\d{4}$/.test(id)) continue
    if (byId.has(id)) throw new Error('중복 회사 ID: ' + id)
    byId.set(id, Object.fromEntries(columns.map(c => [c, (cells[header.indexOf(c)] || '').trim()])))
  }
  return byId
}

const sectorIdForCode = new Map(SECTORS.map((s, i) => ['SEG' + (i + 1), s.id]))
const ownChipIds = new Set(['C0041','SCN038','C0024','C0309','C0026','C0305'])
const coreById = new Map(MAP_COMPANIES.map(c => [c.id, c]))
const reviewedById = new Map(previewRecords.map(c => [c.id, c]))
const legacyInstruments = new Map(instruments.map(c => [c.symbol, c]))
const dartSymbols = new Set(dartCompanies.map(c => c.symbol))
const excludedId = 'C0435'

const roleOverrides = {
  C0543: ['HBM·DRAM·NAND 메모리, 반도체 파운드리', '가속기·서버 제조사에 HBM과 DRAM을 공급합니다. 저장장치용 NAND와 위탁 생산하는 시스템 반도체도 취급합니다.'],
  C0024: ['Gemini·Gemma 모델, Google Cloud GPU·TPU 컴퓨팅', 'Gemini 모델을 소비자 서비스와 기업용 API에 제공하며 Google Cloud에서 모델 개발·실행을 위한 GPU·TPU를 공급합니다.'],
  C0427: ['특화 공정·로직 반도체 파운드리', '반도체 설계 기업이 맡긴 회로를 웨이퍼에 제조해 공급합니다.'],
  C0212: ['AI 서버·랙 위탁생산', '클라우드와 전자기기 고객사가 설계한 AI 서버와 랙을 조립·제조합니다.'],
  C0416: ['가스터빈·송배전망 장비', '전력 생산자와 송전망 운영사에 발전용 가스터빈, 변압기와 계통 설비를 공급합니다.'],
}

function cleanURLs(values) {
  const urls = new Set()
  for (const raw of values.filter(Boolean).flatMap(s => s.split(/\s+/))) {
    if (!URL.canParse(raw)) continue
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.password || url.username) continue
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || key.startsWith('_hs') || key === '_bhlid') url.searchParams.delete(key)
    }
    urls.add(url.href)
  }
  return [...urls]
}

function registryCompany(issuer, sheet, targets) {
  const old = reviewedById.get(issuer.id)
  const selected = coreById.get(issuer.id)
  const sectorId = selected?.sectorId || (issuer.id === 'C0041' ? 'ai-equipment' : sectorIdForCode.get(issuer.sector) || old?.sectorId)
  const tags = ownChipIds.has(issuer.id) ? ['자체 설계 칩'] : []
  const secondary = new Set(issuer.sectors.map(s => sectorIdForCode.get(s)))
  // Self-use silicon is a tag, not an additional merchant chip supplier.
  if (tags.length) secondary.delete('ai-chips')
  secondary.delete(sectorId)
  const listings = targets.map(t => ({ticker:t.symbol, exchange:t.exchange, currency:t.currency}))
  const primary = selected?.primaryTicker || targets.find(t => t.primaryForCompany)?.symbol
  listings.sort((a,b) => Number(b.ticker === primary) - Number(a.ticker === primary))
  if (selected?.listed && listings[0]?.ticker !== selected.primaryTicker) throw new Error('핵심 티커 불일치: ' + issuer.id)
  const legacy = listings.map(l => legacyInstruments.get(l.ticker)).find(Boolean)
  const profile = listings.map(l => companyProfiles[l.ticker]).find(Boolean)
  const name = selected?.name || old?.name || legacy?.name || issuer.name
  const englishAlias = sheet?.['별칭·검색어'].split(/;\s*/).find(alias => /^[A-Za-z][\x20-\x7E]*$/.test(alias))
  const english = old?.englishName || (/^[\x20-\x7E]+$/.test(issuer.name) ? issuer.name : englishAlias || '')
  const section = (sheet?.['SEG별 편입 근거'] || '').split('\n').find(s => s.startsWith(issuer.sector + ':'))
  const sourceProduct = (section?.slice(section.indexOf(':') + 1) || sheet?.['주요사업·모델'] || '').trim().replaceAll(' | ', ' · ').replaceAll('; ', '·')
  const product = roleOverrides[issuer.id]?.[0] || old?.product || selected?.role || profile?.role || sourceProduct
  const overview = roleOverrides[issuer.id]?.[1] || old?.overview || profile?.role || sourceProduct
  const aliases = [...new Set([issuer.name, legacy?.name, ...(old?.aliases || []), ...(sheet?.['별칭·검색어'] || '').split(/;\s*/)]
    .map(x => x?.trim()).filter(s => s && s !== name && s !== english))]
  const urls = cleanURLs([...(old?.urls || []), profile?.sourceUrl, sheet?.['출처 URL'], sheet?.['보충 출처 URL']])
  const discussion = listings.find(l => legacyInstruments.get(l.ticker)?.chains.some(n => n > 0))
  if (!sectorId || !product || !overview) throw new Error('기본정보 누락: ' + issuer.id)
  return {
    id:issuer.id, name, englishName:english, aliases, country:issuer.country, sectorId, secondarySectorIds:[...secondary], tags,
    product, overview, listed:issuer.listed, listings, listingCodes:issuer.ticker ? issuer.ticker.split(/\s*\/\s*/) : [],
    sourceStatus:urls.length ? 'linked' : 'pending',
    sources:urls.map(url => ({label:url === profile?.sourceUrl ? profile.sourceLabel : new URL(url).hostname.replace(/^www\./,''), url})),
    financialId:old?.financialId || null, dartSymbol:listings.find(l=>dartSymbols.has(l.ticker))?.ticker || null,
    discussionTicker:discussion?.ticker || null,
  }
}

export async function buildCompanyRegistry(csvText) {
  const [master, market, issuerAdditions] = await Promise.all([
    readFile(new URL('../../research/market/company-universe.json', import.meta.url), 'utf8').then(JSON.parse),
    loadMarketUniverse(),
    readFile(new URL('../../research/market/company-additions.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const sheet = readBusinessSheet(csvText)
  if (master.companies.length !== 586 || sheet.size !== 586 || MAP_UNIVERSE.companyCount !== MAP_COMPANIES.length || coreById.size !== MAP_COMPANIES.length) throw new Error('대상 원장 건수 불일치')
  const byIssuer = Map.groupBy(market.targets.filter(q => q.companyId), q => q.companyId)
  const rows = []
  for (const issuer of master.companies) {
    const business = sheet.get(issuer.id)
    if (!business || business['회사명'] !== issuer.name || business['국가·지역'] !== issuer.country ||
      (business['상장구분'] === '상장') !== issuer.listed || business['주SEG(초안)'] !== issuer.sector ||
      business['종목코드'] !== issuer.ticker) throw new Error('원장 대조 실패: ' + issuer.id)
    if (issuer.id === excludedId) {
      if (issuer.name !== 'SpaceX' || !/xAI.*Grok/i.test(business['주요사업·모델'])) throw new Error('제외 근거 재검토 필요')
      continue
    }
    rows.push(registryCompany(issuer, business, byIssuer.get(issuer.id) || []))
  }
  if (rows.some(r => r.listingCodes.includes('TSLA')) || rows.length !== 585) throw new Error('Tesla 편입 전 원장 확인 필요')
  const tesla = reviewedById.get('SCN038')
  rows.push(registryCompany({id:tesla.id,name:tesla.name,country:tesla.country,listed:true,ticker:'TSLA',sectors:[]}, null, byIssuer.get(tesla.id) || []))
  rows.push(...buildCompanyAdditions({master, additions:issuerAdditions}).registryRows)
  if (rows.filter(c=>coreById.has(c.id)).length !== MAP_COMPANIES.length) throw new Error('핵심 ' + MAP_COMPANIES.length + '개사 원장 대조 실패')
  return rows.sort((a,b) => a.id.localeCompare(b.id))
}

async function main() {
  if (process.argv.length !== 3) throw new Error('사용법: node scripts/data/build-company-registry.mjs <회사리스트.csv>')
  const rows = await buildCompanyRegistry(await readFile(process.argv[2], 'utf8'))
  const generated = '// Generated from the original company worksheet, verified listing map and separately approved user additions.\nexport const registryRows = [\n' +
    rows.map(row => '  ' + JSON.stringify(row)).join(',\n') + '\n]\n'
  await writeFile(new URL('../../assets/company-registry-rows.js', import.meta.url), generated)
  console.log('신기업정보 원장: ' + rows.length + '개사')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1 })
}
