const compareNames = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
export const pageSize = 25
export const defaultList = Object.freeze({ tab: 'core', q: '', sector: '', country: '', listing: '', limit: pageSize })

export function listHref(state) {
  const params = new URLSearchParams()
  for (const key of Object.keys(defaultList)) {
    if (state[key] !== undefined && state[key] !== defaultList[key]) params.set(key, state[key])
  }
  return '#company-info' + (params.size ? '?' + params : '')
}

export function readList(hash, catalog) {
  const params = new URLSearchParams(hash.split('?')[1])
  const sector = params.get('sector')
  const country = params.get('country')
  const listing = params.get('listing')
  const requested = Number(params.get('limit'))
  return {
    tab: params.get('tab') === 'all' ? 'all' : 'core',
    q: params.get('q') || '',
    sector: catalog.sectors.some(item => item.id === sector) ? sector : '',
    country: catalog.companies.some(item => item.country === country) ? country : '',
    listing: ['listed','private'].includes(listing) ? listing : '',
    limit: Number.isSafeInteger(requested) && requested >= pageSize ? Math.min(requested, Math.max(pageSize, catalog.companies.length)) : pageSize,
  }
}

const normalized = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '')
export function matchCompanies(companies, state) {
  const query = normalized(state.q)
  return companies.filter(company => {
    if (state.tab === 'core' && !company.selection) return false
    if (state.sector && state.sector !== company.sectorId &&
      (state.tab === 'core' || !company.secondarySectorIds.includes(state.sector))) return false
    if (state.country && state.country !== company.country) return false
    if (state.listing && company.listed !== (state.listing === 'listed')) return false
    return !query || [company.name, company.englishName, ...company.aliases, company.product, ...company.listings.map(l => l.ticker)]
      .some(field => normalized(field).includes(query))
  }).sort((a,b) => (state.tab === 'core' ? a.selection.order - b.selection.order : 0) || compareNames.compare(a.name, b.name) || a.id.localeCompare(b.id))
}

export function parseCompanyRoute(hash) {
  const [page, section, encoded, tab = 'overview', ...extra] = hash.split('?')[0].split('/')
  if (page !== '#company-info') return null
  if (!section) return { kind: 'list' }
  if (section !== 'company' || !encoded || extra.length) return { kind: 'missing' }
  try { return { kind: 'detail', id: decodeURIComponent(encoded), tab } }
  catch { return { kind: 'missing' } }
}
