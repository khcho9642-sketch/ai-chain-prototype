import { DISPLAY_SECTORS } from './home-map-core.js'
import { MAP_COMPANIES, MAP_UNIVERSE } from './home-map-universe.js'
import { approvedCatalog } from './company-approved-catalog.js'
import { registryRows } from './company-registry-rows.js'

const selectedById = new Map(MAP_COMPANIES.map(row => [row.id, row]))
const currentCompanies = registryRows.map(company => {
  const core = selectedById.get(company.id)
  return {
    ...company,
    selection: core ? { reason: company.overview, role: core.role, order: core.sourceOrder } : null,
    analysis: null,
  }
})

export const catalog = {
  mode: approvedCatalog ? 'approved' : 'registry',
  sectors: DISPLAY_SECTORS,
  source: {
    url: MAP_UNIVERSE.sourceUrl,
    asOf: MAP_UNIVERSE.sourceAsOf,
    coreSheet: MAP_UNIVERSE.sourceSheet,
    registrySheet: '회사리스트',
    excludedId: 'C0435',
    includedId: 'SCN038',
    note: '회사리스트 586개사 중 xAI 사업만으로 편입된 SpaceX(C0435)를 제외하고 Tesla(SCN038)를 포함했습니다. 별도 사용자 요청으로 Nscale과 광통신 7개사를 추가해 전체 594개사이며, 원본 시트와 2026-11-05 저장 시세 범위는 보존합니다.',
  },
  companies: approvedCatalog?.companies || currentCompanies,
}

const tickerIndex = new Map(catalog.companies.flatMap(company =>
  company.listings.map(({ ticker }) => [ticker.toUpperCase(), company])))

export function findCompanyByTicker(ticker) {
  return tickerIndex.get(String(ticker ?? '').trim().toUpperCase())
}
