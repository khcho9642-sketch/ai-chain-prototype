import { SECTORS } from '../../assets/home-map-core.js'

const sectorIds = new Map(SECTORS.map((sector, index) => ['SEG' + (index + 1), sector.id]))
const allowed = new Set(['id','name','englishName','aliases','country','listed','ticker','exchange','symbol','currency','sector','product','overview','sources'])

// Separate, explicitly approved issuers. Listed additions extend only the
// candidate universe; the collection policy remains independently paused.
export function buildCompanyAdditions({ master, additions } = {}) {
  if (!Array.isArray(master?.companies)) throw new Error('추가 기업 원장 형식 오류')
  const ids = new Set(master.companies.map(company => company.id))
  if (ids.size !== master.companies.length) throw new Error('지도 기업 식별 중복')
  if (!additions) return {issuers: [], registryRows: []}
  if (additions.schemaVersion !== 1 || !Array.isArray(additions.companies)
    || additions.source?.type !== 'user-request' || !additions.source.note?.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(additions.source.requestedOn || '')
    || !Number.isFinite(Date.parse(additions.source.requestedOn))) throw new Error('추가 기업 출처 오류')
  const names = new Set(master.companies.map(company => company.name.toLowerCase()))
  const issuers = [], registryRows = []
  for (const company of additions.companies) {
    if (!company || Object.keys(company).some(key => !allowed.has(key))
      || !/^C\d{4}$/.test(company.id) || ids.has(company.id)
      || !['name','englishName','country','product','overview'].every(key => typeof company[key] === 'string' && company[key].trim())
      || names.has(company.name.toLowerCase()) || !sectorIds.has(company.sector)
      || typeof company.listed !== 'boolean'
      || !Array.isArray(company.aliases) || !company.aliases.every(alias => typeof alias === 'string' && alias.trim())
      || !Array.isArray(company.sources) || !company.sources.length) throw new Error('추가 기업 식별·분류 정보 오류')
    const listed = company.listed
    if (listed
      ? !(typeof company.ticker === 'string' && company.ticker.trim()
        && typeof company.exchange === 'string' && company.exchange.trim()
        && typeof company.symbol === 'string' && /^[A-Z0-9.-]{1,24}$/.test(company.symbol)
        && typeof company.currency === 'string' && /^[A-Z]{3}$/.test(company.currency))
      : !(company.ticker === null && company.exchange === null && company.symbol == null && company.currency == null)) {
      throw new Error('추가 기업 상장 정보 오류')
    }
    const sources = company.sources.map(source => {
      let url
      try { url = new URL(source.url) } catch { throw new Error('추가 기업 공식 출처 URL 오류') }
      if (url.protocol !== 'https:' || url.username || url.password || typeof source.label !== 'string' || !source.label.trim()) throw new Error('추가 기업 공식 출처 URL 오류')
      return {label:source.label, url:url.href}
    })
    ids.add(company.id); names.add(company.name.toLowerCase())
    issuers.push({id:company.id,name:company.name,country:company.country,listed,exchange:company.exchange || '',ticker:company.ticker || '',sector:company.sector,sectors:[company.sector]})
    const listings = listed ? [{ticker:company.symbol,exchange:company.exchange,currency:company.currency}] : []
    registryRows.push({
      id:company.id,name:company.name,englishName:company.englishName,aliases:[...company.aliases],country:company.country,
      sectorId:sectorIds.get(company.sector),secondarySectorIds:[],tags:[],product:company.product,overview:company.overview,
      listed,listings,listingCodes:listed?[company.ticker]:[],sourceStatus:'linked',sources,financialId:null,dartSymbol:null,discussionTicker:null,
    })
  }
  return {issuers, registryRows}
}
