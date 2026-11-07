import { readFile } from 'node:fs/promises'
import { instruments } from '../../assets/instruments.js'
import { previewRecords } from '../../assets/company-preview-records.js'
import { SECTORS } from '../../assets/home-map-core.js'

const defaultMaster = new URL('../../research/market/company-universe.json', import.meta.url)
const defaultResolutions = new URL('../../research/market/listing-resolutions.json', import.meta.url)
const sectorIds = Object.fromEntries(SECTORS.map((sector, index) => ['SEG' + (index + 1), sector.id]))
// Preserve the historical ADR/share-class mappings independently of which issuers
// are currently featured in the company directory.
const listingSupplements = previewRecords.map(({ id, name, sectorId, country, listings }) => ({
  id, name, sectorId, country, listed: listings.length > 0,
  listings: listings.map(([ticker, exchange, currency]) => ({ ticker, exchange, currency })),
}))

// These are symbol-format mappings, not a claim that a listing is still traded
// or that the provider has returned it. Collection validates those separately.
const exchanges = new Map([
  ['NASDAQ', ['', 'USD']], ['NYSE', ['', 'USD']],
  ['KRX KOSPI', ['.KS', 'KRW']], ['KRX KOSDAQ', ['.KQ', 'KRW']], ['KOSDAQ', ['.KQ', 'KRW']],
  ['TWSE', ['.TW', 'TWD']], ['TPEx', ['.TWO', 'TWD']],
  ['TSE', ['.T', 'JPY']], ['Tokyo Stock Exchange', ['.T', 'JPY']],
  ['TSE Prime', ['.T', 'JPY']], ['TSE Standard', ['.T', 'JPY']],
  ['SSE', ['.SS', 'CNY']], ['SSE STAR', ['.SS', 'CNY']], ['Shanghai Stock Exchange', ['.SS', 'CNY']],
  ['SZSE', ['.SZ', 'CNY']], ['SZSE ChiNext', ['.SZ', 'CNY']], ['Shenzhen Stock Exchange', ['.SZ', 'CNY']],
  ['HKEX', ['.HK', 'HKD']], ['Euronext Amsterdam', ['.AS', 'EUR']],
  ['Euronext Paris', ['.PA', 'EUR']], ['Euronext Milan', ['.MI', 'EUR']],
  ['Euronext Growth Milan', ['.MI', 'EUR']], ['Xetra', ['.DE', 'EUR']], ['XETRA', ['.DE', 'EUR']],
  ['SIX', ['.SW', 'CHF']], ['SIX Swiss Exchange', ['.SW', 'CHF']],
  ['Nasdaq Helsinki', ['.HE', 'EUR']], ['Nasdaq Copenhagen', ['.CO', 'DKK']],
  ['Nasdaq Stockholm', ['.ST', 'SEK']], ['BME', ['.MC', 'EUR']], ['BME Growth', ['.MC', 'EUR']],
  ['LSE', ['.L', 'GBP']], ['LSE AIM', ['.L', 'GBP']],
  ['NSE', ['.NS', 'INR']], ['BSE', ['.BO', 'INR']], ['Bursa Malaysia', ['.KL', 'MYR']],
  ['SET', ['.BK', 'THB']], ['ASX', ['.AX', 'AUD']], ['NZX', ['.NZ', 'NZD']],
  ['SGX', ['.SI', 'SGD']], ['IDX', ['.JK', 'IDR']], ['TSX', ['.TO', 'CAD']], ['TSXV', ['.V', 'CAD']],
  ['B3', ['.SA', 'BRL']], ['JSE', ['.JO', 'ZAR']], ['TASE', ['.TA', 'ILS']],
  ['Saudi Exchange', ['.SR', 'SAR']], ['QSE', ['.QA', 'QAR']],
  ['Borsa Istanbul', ['.IS', 'TRY']],
  // Verified against Yahoo's DU.AE quote and successful daily-chart response.
  // PSE/ADX article tags are not proof of an available chart endpoint.
  ['DFM', ['.AE', 'AED']],
])

export function normalizeListing(ticker, exchange, knownSymbols = []) {
  ticker = String(ticker ?? '').trim().toUpperCase()
  exchange = String(exchange ?? '').trim()
  if (!ticker || !exchange) return { reason: '거래소·종목코드 누락' }
  if (exchange === 'KRX') {
    // A numeric code alone cannot distinguish KOSPI from KOSDAQ. Reuse only
    // an already connected exact symbol; otherwise retain it as unresolved.
    const matches = [...new Set(knownSymbols)].filter(symbol => symbol === ticker + '.KS' || symbol === ticker + '.KQ')
    return matches.length === 1
      ? { symbol: matches[0], currency: 'KRW', mapping: 'existing-symbol' }
      : { reason: 'KRX 시장구분 미확인: KOSPI·KOSDAQ 대조 필요' }
  }
  const mapping = exchanges.get(exchange)
  if (!mapping) return { reason: '현재 공급처의 거래소 연결 미확인' }
  const [suffix, currency] = mapping
  if (exchange === 'HKEX') {
    if (!/^\d{1,5}$/.test(ticker)) return { reason: '홍콩 종목코드 형식 확인 필요' }
    ticker = String(Number(ticker)).padStart(4, '0')
  }
  if (/^(?:KRX KOSPI|KRX KOSDAQ|KOSDAQ|SSE|SSE STAR|Shanghai Stock Exchange|SZSE|SZSE ChiNext|Shenzhen Stock Exchange)$/.test(exchange)
    && !/^\d{6}$/.test(ticker)) return { reason: '6자리 종목코드 확인 필요' }
  // Yahoo uses hyphens for share classes and units (e.g. BIP.UN -> BIP-UN.TO).
  const symbol = ticker.replaceAll('.', '-') + suffix
  if (!/^[A-Z0-9^=.-]{1,24}$/.test(symbol)) return { reason: '공급처 종목코드 형식 확인 필요' }
  return { symbol, currency, mapping: 'exchange-format' }
}

function primaryListing(company, knownSymbols) {
  const exchange = company.exchange.split(/\s*\/\s*/)[0]
  const ticker = company.ticker.split(/\s*\/\s*/)[0]
  return { exchange, ticker, ...normalizeListing(ticker, exchange, knownSymbols) }
}

export function buildMarketUniverse({ master, legacyItems = instruments, catalogCompanies = listingSupplements, listingResolutions = [], alternateListings = [] } = {}) {
  if (!master || master.schemaVersion !== 1 || !Array.isArray(master.companies)) throw new Error('기업 수집 원장 형식 오류')
  const ids = new Set()
  for (const company of master.companies) {
    if (!/^C\d{4}$/.test(company.id) || ids.has(company.id) || typeof company.listed !== 'boolean'
      || !company.name || typeof company.ticker !== 'string' || typeof company.exchange !== 'string'
      || !sectorIds[company.sector]) throw new Error('기업 수집 원장 회사 식별·분류 오류')
    ids.add(company.id)
  }
  const knownSymbols = [...legacyItems.map(item => item.symbol), ...catalogCompanies.flatMap(company => company.listings.map(listing => listing.ticker))]
  const targets = new Map(legacyItems.map(item => [item.symbol, { ...item, chains: [...(item.chains || [])], companyId: null, primaryForCompany: false }]))
  if (targets.size !== legacyItems.length) throw new Error('기존 수집 종목코드 중복')
  const unmapped = [], primarySymbols = new Map(), byId = new Map(master.companies.map(company => [company.id, company]))
  const resolutions = new Map(listingResolutions.map(row => [row.companyId, row]))
  if (resolutions.size !== listingResolutions.length) throw new Error('거래소 확인 근거 중복')

  function add(symbol, company, listing, primaryForCompany, source = 'company-master') {
    const previous = targets.get(symbol)
    if (previous?.companyId && previous.companyId !== company.id) throw new Error('서로 다른 회사의 수집 종목코드 충돌: ' + symbol)
    const legacy = previous || {}
    targets.set(symbol, {
      name: company.name, chains: [], group: /\.(KS|KQ)$/.test(symbol) ? '국내' : '해외',
      ...legacy, symbol, companyId: company.id,
      sectorId: sectorIds[company.sector] || company.sectorId,
      country: company.country,
      exchange: listing.exchange, currency: listing.currency,
      sourceTicker: listing.ticker, mappingStatus: 'candidate', universeSource: source,
      ...(listing.mappingSourceUrl ? { mappingSourceUrl: listing.mappingSourceUrl } : {}),
      primaryForCompany: Boolean(legacy.primaryForCompany || primaryForCompany),
    })
  }

  for (const company of master.companies) {
    if (!company.listed) continue
    let listing = primaryListing(company, knownSymbols)
    const resolution = resolutions.get(company.id)
    if (!listing.symbol && resolution) {
      if (resolution.sourceExchange !== company.exchange || resolution.sourceTicker !== company.ticker
        || !/^https:\/\/kind\.krx\.co\.kr\//.test(resolution.sourceUrl)) throw new Error('거래소 확인 근거와 원장 불일치')
      listing = { exchange: resolution.exchange, ticker: company.ticker,
        ...normalizeListing(company.ticker, resolution.exchange, knownSymbols), mappingSourceUrl: resolution.sourceUrl }
    }
    if (!listing.symbol) {
      unmapped.push({ companyId: company.id, name: company.name, exchange: company.exchange, ticker: company.ticker, reason: listing.reason })
      continue
    }
    primarySymbols.set(company.id, listing.symbol)
    add(listing.symbol, company, listing, true)
  }

  for (const alternate of alternateListings) {
    const company = byId.get(alternate.companyId)
    if (!company?.listed || company.exchange !== alternate.sourceExchange || company.ticker !== alternate.sourceTicker
      || !/^https:\/\/(?:[a-z]+\.)?finance\.yahoo\.com\/quote\//.test(alternate.sourceUrl)) throw new Error('대체 상장 근거와 원장 불일치')
    const rawExchanges = company.exchange.split(/\s*\/\s*/), rawTickers = company.ticker.split(/\s*\/\s*/)
    const sourceIndex = rawExchanges.indexOf(alternate.exchange)
    if (sourceIndex < 0 || rawTickers[sourceIndex] !== alternate.ticker) throw new Error('원장에 없는 대체 상장 종목')
    const listing = { exchange: alternate.exchange, ticker: alternate.ticker,
      ...normalizeListing(alternate.ticker, alternate.exchange, knownSymbols), mappingSourceUrl: alternate.sourceUrl }
    if (!listing.symbol) throw new Error('대체 상장 종목코드 확인 필요')
    add(listing.symbol, company, listing, false, 'company-master-alternate')
    const unresolved = unmapped.find(row => row.companyId === company.id)
    if (unresolved) unresolved.alternateSymbols = [...(unresolved.alternateSymbols || []), listing.symbol]
  }

  // Existing company pages retain their alternate ADRs/share classes. Their
  // presence does not add an issuer to the master or a second primary cap.
  for (const publicCompany of catalogCompanies) {
    if (!publicCompany.listed) continue
    const company = byId.get(publicCompany.id) || publicCompany
    for (const [index, listing] of publicCompany.listings.entries()) {
      const symbol = listing.ticker.toUpperCase()
      if (!/^[A-Z0-9^=.-]{1,24}$/.test(symbol)) throw new Error('공개 카탈로그 종목코드 형식 오류')
      add(symbol, company, listing, primarySymbols.get(company.id) === symbol || (!byId.has(company.id) && index === 0), 'public-company-catalog')
    }
  }

  const listedCompanies = master.companies.filter(company => company.listed).length
  return {
    targets: [...targets.values()],
    coverage: {
      source: master.source, sourceUrl: master.sourceUrl, sourceAsOf: master.asOf,
      sourceStatus: master.sourceStatus || 'review-draft',
      companyCount: master.companies.length, listedCompanyCount: listedCompanies,
      unlistedCompanyCount: master.companies.length - listedCompanies,
      mappedListedCompanyCount: primarySymbols.size,
      alternateOnlyCompanyCount: unmapped.filter(row => row.alternateSymbols?.length).length,
      targetCount: targets.size, legacyTargetCount: legacyItems.length,
      addedSymbolCount: targets.size - legacyItems.length,
      mappingStatus: 'candidate', unmapped,
    },
  }
}

export async function loadMarketUniverse({ masterPath = defaultMaster, resolutionsPath = defaultResolutions, ...options } = {}) {
  const [master, resolutions] = await Promise.all([
    readFile(masterPath, 'utf8').then(JSON.parse), readFile(resolutionsPath, 'utf8').then(JSON.parse),
  ])
  return buildMarketUniverse({ master, listingResolutions: resolutions.entries, alternateListings: resolutions.alternates || [], ...options })
}
