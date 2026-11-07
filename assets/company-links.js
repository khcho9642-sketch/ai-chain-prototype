import { catalog, findCompanyByTicker } from './company-catalog.js';

const directoryRow = company => '#company-info?' + new URLSearchParams({tab:'all',q:company.name});

export function companyHrefForTicker(ticker, tab = '') {
  const company = findCompanyByTicker(ticker);
  if (!company) return null;
  if (!company.selection) return tab === 'quote' ? null : directoryRow(company);
  const route = '#company-info/company/' + encodeURIComponent(company.id) + (tab ? '/' + tab : '');
  if (tab === 'quote' && company.listings.length > 1) {
    const listing = company.listings.find(item => item.ticker.toUpperCase() === String(ticker).toUpperCase());
    if (listing) return route + '?listing=' + encodeURIComponent(listing.ticker);
  }
  return route;
}

const searchKey = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function companyHrefForQuery(query) {
  const ticker = query.trim().toUpperCase();
  const quote = companyHrefForTicker(ticker, 'quote');
  if (quote) return quote;
  const row = findCompanyByTicker(ticker);
  if (row) return directoryRow(row);
  if (/^\d{6}$/.test(ticker)) {
    const matches = [ticker + '.KS', ticker + '.KQ'].map(symbol => companyHrefForTicker(symbol, 'quote') || companyHrefForTicker(symbol)).filter(Boolean);
    if (matches.length === 1) return matches[0];
  }
  const needle = searchKey(query);
  if (!needle) return null;
  const issuers = catalog.companies.filter(row =>
    [row.name, row.englishName, ...row.aliases].some(alias => searchKey(alias) === needle));
  return issuers.length === 1 ? (issuers[0].selection ? '#company-info/company/' + encodeURIComponent(issuers[0].id) : directoryRow(issuers[0])) : null;
}
