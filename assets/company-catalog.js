import { SECTORS } from './home-map-core.js'
import { dartCompanies } from './company-disclosure-sources.js'
import { companyProfiles } from './company-profiles.js'
import { approvedCatalog } from './company-approved-catalog.js'
import { previewRecords } from './company-preview-records.js'

const dartSymbols = new Set(dartCompanies.map(row => row.symbol))

function previewCompany(row) {
  const listings = row.listings.map(([ticker, exchange, currency]) => ({ ticker, exchange, currency }))
  const primary = listings[0]?.ticker
  const profile = companyProfiles[primary]
  return {
    id: row.id,
    name: row.name,
    englishName: row.englishName,
    aliases: row.aliases || [],
    country: row.country,
    sectorId: row.sectorId,
    secondarySectorIds: row.secondarySectorIds || [],
    product: row.product,
    overview: row.overview || (profile?.exposure ? row.product + ' · ' + profile.exposure : row.product),
    listed: listings.length > 0,
    listings,
    sources: row.urls.map(url => ({
      label: url === profile?.sourceUrl ? profile.sourceLabel : new URL(url).hostname.replace(/^www\./, ''),
      url,
    })),
    financialId: row.financialId || null,
    dartSymbol: dartSymbols.has(primary) ? primary : null,
    discussionTicker: row.discussionTicker || null,
    selection: row.financialId ? { reason: row.reason, order: Number(row.financialId.slice(3)) } : null,
    analysis: null,
  }
}

export const catalog = {
  mode: approvedCatalog ? 'approved' : 'preview',
  sectors: SECTORS,
  companies: approvedCatalog?.companies || previewRecords.map(previewCompany),
}

const tickerIndex = new Map(catalog.companies.flatMap(company =>
  company.listings.map(({ ticker }) => [ticker.toUpperCase(), company])))

export function findCompanyByTicker(ticker) {
  return tickerIndex.get(String(ticker ?? '').trim().toUpperCase())
}
