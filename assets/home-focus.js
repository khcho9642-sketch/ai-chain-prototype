import { SECTORS } from './home-map-core.js'
import { MAP_COMPANIES } from './home-map-universe.js'

// Cards, ripple and historical-cap enrichment use the approved selection's
// listed issuers, exact selected listing and primary sector. Private companies
// remain in the map roster without becoming fabricated price-return peers.
export const focusCompanies = Object.freeze(MAP_COMPANIES.filter(company => company.listed).map(company => {
  const order = SECTORS.findIndex(sector => sector.id === company.sectorId)
  const ticker = company.primaryTicker
  if (order < 0 || !/^[A-Z0-9.-]{1,24}$/.test(ticker || '')) throw new Error('홈 핵심 종목의 승인 티커·섹터를 확인해야 합니다.')
  return Object.freeze({
    id: company.id, ticker, name: company.name, country: company.country,
    sector: SECTORS[order].name, sectorId: company.sectorId, sectorOrder: order + 1,
    // A US-listed ADR follows the US session, regardless of issuer domicile.
    market: /\.(KS|KQ)$/.test(ticker) ? 'KR'
      : /^[A-Z][A-Z0-9-]*$/.test(ticker) ? 'US' : 'ETC',
  })
}))

if (!focusCompanies.length || new Set(focusCompanies.map(company => company.id)).size !== focusCompanies.length
  || new Set(focusCompanies.map(company => company.ticker)).size !== focusCompanies.length) {
  throw new Error('홈 핵심 종목의 고유 회사·티커를 확인해야 합니다.')
}
