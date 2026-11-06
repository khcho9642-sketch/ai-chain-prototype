import { COMPANIES, SECTORS } from './home-map-core.js'

// A reproducible homepage observation basket, not a claim that research has
// already been published. Retain the map's existing sector order and first five
// listed names per sector. The wider company master remains a separate universe.
export const focusCompanies = Object.freeze(SECTORS.flatMap((sector, order) =>
  COMPANIES.filter(company => company.sector === sector.name).slice(0, 5).map(company =>
    Object.freeze({
      id: company.id, ticker: company.ticker, name: company.name, country: company.country,
      sector: sector.name, sectorId: sector.id, sectorOrder: order + 1,
      // A US-listed ADR follows the US session, regardless of issuer domicile.
      market: /\.(KS|KQ)$/.test(company.ticker) ? 'KR'
        : /^[A-Z][A-Z0-9-]*$/.test(company.ticker) ? 'US' : 'ETC',
    }))))

if (focusCompanies.length !== SECTORS.length * 5
  || new Set(focusCompanies.map(company => company.ticker)).size !== focusCompanies.length) {
  throw new Error('홈 핵심 종목은 섹터별 고유 5개씩 필요합니다.')
}
