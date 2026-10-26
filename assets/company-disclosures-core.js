import { dartCompanies } from './company-disclosure-sources.js'

export const DART_SOURCE = Object.freeze({ name: '금융감독원 DART', url: 'https://dart.fss.or.kr/introduction/content6.do' })
export const DART_COVERAGE = Object.freeze({ kind: 'dart-company-rss', businessDays: 5, retentionDays: 90, historyComplete: false })
export const MAX_COMPANY_DISCLOSURES = 500
const FUTURE_ALLOWANCE = 15 * 60 * 1000
const fail = message => { throw new Error(message) }
const keysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
const isoTime = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
const errorText = value => value === null || text(value, 250)
export const normalizeDartName = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR')
export const dartFilingUrl = receipt => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt}`

export function validateDartCompanySources(companies) {
  if (!Array.isArray(companies) || !companies.length || companies.length > 100) fail('DART 회사 연결 목록이 올바르지 않습니다.')
  const symbols = new Set(), codes = new Set()
  for (const company of companies) {
    if (!/^[0-9]{6}\.(KS|KQ)$/.test(company.symbol || '') || company.stockCode !== company.symbol.slice(0, 6) ||
        !/^[0-9]{8}$/.test(company.corpCode || '') || !text(company.dartName, 100) ||
        company.rssUrl !== `https://dart.fss.or.kr/api/companyRSS.xml?crpCd=${company.corpCode}` ||
        symbols.has(company.symbol) || codes.has(company.corpCode)) fail('DART 회사 코드와 종목 연결이 올바르지 않습니다.')
    symbols.add(company.symbol); codes.add(company.corpCode)
  }
  return companies
}

export function createEmptyCompanyDisclosures({ companies = dartCompanies } = {}) {
  validateDartCompanySources(companies)
  return {
    schemaVersion: 1, source: { ...DART_SOURCE }, coverage: { ...DART_COVERAGE },
    collection: { status: 'idle', lastAttemptAt: null, lastSuccessAt: null, error: null },
    companies: companies.map(company => ({
      symbol: company.symbol, stockCode: company.stockCode, corpCode: company.corpCode,
      companyName: company.dartName, feedUrl: company.rssUrl, status: 'not-collected',
      lastAttemptAt: null, lastSuccessAt: null, error: null, feedItemCount: 0, excludedItemCount: 0, items: [],
    })),
  }
}

/** Only public filing metadata is allowed; author, body, credentials and arbitrary fields are rejected. */
export function validateCompanyDisclosures(data, { now = new Date(), companies = dartCompanies } = {}) {
  validateDartCompanySources(companies)
  const nowMs = now instanceof Date ? now.getTime() : NaN
  if (!Number.isFinite(nowMs)) fail('DART 공시 검증 기준시각이 올바르지 않습니다.')
  if (!keysAre(data, ['schemaVersion', 'source', 'coverage', 'collection', 'companies']) || data.schemaVersion !== 1 ||
      !keysAre(data.source, ['name', 'url']) || data.source.name !== DART_SOURCE.name || data.source.url !== DART_SOURCE.url ||
      !keysAre(data.coverage, ['kind', 'businessDays', 'retentionDays', 'historyComplete']) ||
      Object.entries(DART_COVERAGE).some(([key, value]) => data.coverage[key] !== value) ||
      !keysAre(data.collection, ['status', 'lastAttemptAt', 'lastSuccessAt', 'error']) ||
      !['idle', 'ok', 'partial', 'error'].includes(data.collection.status) ||
      !Array.isArray(data.companies) || data.companies.length !== companies.length) fail('DART 공시 자료 형식이 올바르지 않습니다.')
  const registry = new Map(companies.map(company => [company.symbol, company])), seen = new Set(), globalReceipts = new Set()
  const checkTimes = record => {
    if (!isoTime(record.lastAttemptAt) || !isoTime(record.lastSuccessAt) || !errorText(record.error) ||
        (record.lastAttemptAt && Date.parse(record.lastAttemptAt) > nowMs + FUTURE_ALLOWANCE) ||
        (record.lastSuccessAt && (!record.lastAttemptAt || record.lastSuccessAt > record.lastAttemptAt))) fail('DART 공시 수집 시각이 올바르지 않습니다.')
  }
  checkTimes(data.collection)
  for (const company of data.companies) {
    const definition = registry.get(company.symbol)
    if (!keysAre(company, ['symbol', 'stockCode', 'corpCode', 'companyName', 'feedUrl', 'status', 'lastAttemptAt', 'lastSuccessAt', 'error', 'feedItemCount', 'excludedItemCount', 'items']) ||
        !definition || seen.has(company.symbol) || company.stockCode !== definition.stockCode || company.corpCode !== definition.corpCode ||
        company.companyName !== definition.dartName || company.feedUrl !== definition.rssUrl ||
        !['not-collected', 'ok', 'error'].includes(company.status) ||
        !Number.isInteger(company.feedItemCount) || company.feedItemCount < 0 || company.feedItemCount > 1000 ||
        !Number.isInteger(company.excludedItemCount) || company.excludedItemCount < 0 || company.excludedItemCount > company.feedItemCount ||
        !Array.isArray(company.items) || company.items.length > MAX_COMPANY_DISCLOSURES) fail('DART 회사별 공시 자료가 올바르지 않습니다.')
    seen.add(company.symbol); checkTimes(company)
    if ((company.status === 'not-collected' && (company.lastAttemptAt !== null || company.lastSuccessAt !== null || company.error !== null || company.items.length || company.feedItemCount || company.excludedItemCount)) ||
        (company.status === 'ok' && (!company.lastAttemptAt || company.lastSuccessAt !== company.lastAttemptAt || company.error !== null)) ||
        (company.status === 'error' && (!company.lastAttemptAt || !company.error)) ||
        (company.items.length && !company.lastSuccessAt)) fail('DART 공시 수집 상태와 기록이 일치하지 않습니다.')
    let previous = null
    for (const item of company.items) {
      if (!keysAre(item, ['receiptNumber', 'title', 'publishedAt', 'sourceUrl']) || !/^[0-9]{14}$/.test(item.receiptNumber || '') ||
          !text(item.title, 500) || item.title !== item.title.trim() || !isoTime(item.publishedAt) || item.publishedAt === null ||
          Date.parse(item.publishedAt) > Math.min(nowMs, Date.parse(company.lastSuccessAt)) + FUTURE_ALLOWANCE ||
          item.sourceUrl !== dartFilingUrl(item.receiptNumber) || globalReceipts.has(item.receiptNumber)) fail('DART 공시 접수번호·제목·원문 주소가 올바르지 않습니다.')
      const seoulDay = new Date(Date.parse(item.publishedAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '')
      if (item.receiptNumber.slice(0, 8) !== seoulDay) fail('DART 공시 접수일과 발표시각이 일치하지 않습니다.')
      if (previous && (previous.publishedAt < item.publishedAt || (previous.publishedAt === item.publishedAt && previous.receiptNumber < item.receiptNumber))) fail('DART 공시 정렬 순서가 올바르지 않습니다.')
      globalReceipts.add(item.receiptNumber); previous = item
    }
  }
  const currentSuccesses = data.companies.filter(company => company.status === 'ok' && company.lastSuccessAt === data.collection.lastAttemptAt).length
  if ((data.collection.status === 'idle' && (data.collection.lastAttemptAt !== null || data.collection.lastSuccessAt !== null || data.collection.error !== null || data.companies.some(company => company.status !== 'not-collected'))) ||
      (data.collection.status !== 'idle' && !data.collection.lastAttemptAt) ||
      (data.collection.status === 'ok' && (currentSuccesses !== companies.length || data.collection.lastSuccessAt !== data.collection.lastAttemptAt || data.collection.error !== null)) ||
      (data.collection.status === 'partial' && (!currentSuccesses || currentSuccesses === companies.length || !data.collection.error)) ||
      (data.collection.status === 'error' && (currentSuccesses || !data.collection.error))) fail('DART 전체 수집 상태가 회사별 결과와 일치하지 않습니다.')
  return data
}
