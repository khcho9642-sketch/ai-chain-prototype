import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { SECTORS } from '../../assets/home-map-core.js'
import { instruments } from '../../assets/instruments.js'
import { dartCompanies } from '../../assets/company-disclosure-sources.js'
import { approvedCatalog } from '../../assets/company-approved-catalog.js'
import { MAP_COMPANIES, MAP_UNIVERSE } from '../../assets/home-map-universe.js'
import { registryRows } from '../../assets/company-registry-rows.js'

const sectorIds = new Set(SECTORS.map(s => s.id))
const registryIds = new Set(registryRows.map(row => row.id))
const coreIds = new Map(MAP_COMPANIES.map(row => [row.id, row]))
const discussionSymbols = new Set(instruments.filter(row => row.chains.some(id => id > 0)).map(row => row.symbol))
const dartSymbols = new Set(dartCompanies.map(row => row.symbol))
const output = fileURLToPath(new URL('../../assets/company-approved-catalog.js', import.meta.url))

function requireValue(ok, message) {
  if (!ok) throw new Error(message)
}

function text(value, name) {
  requireValue(typeof value === 'string' && value.trim(), name + ' 값이 필요합니다.')
  return value.trim()
}

function date(value, field) {
  const result = text(value, field)
  const ms = Date.parse(result)
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(result) && Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === result, field + ' 날짜가 잘못되었습니다.')
  return result
}

function sourceURL(value) {
  const url = new URL(text(value, '출처 URL'))
  requireValue(url.protocol === 'https:' && !url.username && !url.password, '출처 URL 형식 오류')
  return url.href
}

function sources(rows, allowPending = false) {
  requireValue(Array.isArray(rows) && (allowPending || rows.length), '원문 출처가 필요합니다.')
  return rows.map(s => ({ label: text(s.label, '출처 이름'), url: sourceURL(s.url) }))
}

function unique(values, label) {
  requireValue(new Set(values).size === values.length, label + ' 중복')
}

function publicCompany(row) {
  const id = text(row.id, '회사 ID')
  requireValue(/^[A-Za-z0-9_-]+$/.test(id), '회사 ID에 허용되지 않은 문자가 있습니다.')
  const sectorId = row.sectorId
  requireValue(sectorIds.has(sectorId), id + ' 주 섹터 오류')
  const secondarySectorIds = (row.secondarySectorIds || []).map(s => {
    requireValue(sectorIds.has(s) && s !== sectorId, id + ' 보조 섹터 오류')
    return s
  })
  unique(secondarySectorIds, id + ' 보조 섹터')
  requireValue(typeof row.listed === 'boolean' && Array.isArray(row.listings), id + ' 상장 정보 오류')
  const listings = row.listings.map(l => ({
    ticker: text(l.ticker, '티커').toUpperCase(),
    exchange: text(l.exchange, '거래소'),
    currency: text(l.currency, '거래 통화'),
  }))
  requireValue(listings.every(l => /^[A-Z]{3}$/.test(l.currency)), id + ' 거래 통화 코드 오류')
  requireValue(row.listed || !listings.length, id + ' 비상장사에는 시세 티커를 연결할 수 없습니다.')
  for (const key of ['dartSymbol', 'discussionTicker']) {
    requireValue(row[key] == null || listings.some(l => l.ticker === row[key]), id + ' ' + key + ' 연결 오류')
  }
  requireValue(row.dartSymbol == null || dartSymbols.has(row.dartSymbol), id + ' DART 수집 대상 오류')
  requireValue(row.discussionTicker == null || discussionSymbols.has(row.discussionTicker), id + ' 종목 토론 대상 오류')
  const financialId = row.financialId == null ? null : text(row.financialId, '재무 DB ID')
  const references = sources(row.sources, row.sourceStatus === 'pending' && !coreIds.has(id))
  const tags = (row.tags || []).map(s => text(s, '사업 특징'))
  const listingCodes = (row.listingCodes || []).map(s => text(s, '원장 종목코드'))
  requireValue(row.listed || !listingCodes.length, id + ' 비상장 종목코드 오류')
  if (id === 'C0041' || id === 'SCN038') {
    requireValue(tags.includes('자체 설계 칩') && sectorId !== 'ai-chips' && !secondarySectorIds.includes('ai-chips'), id + ' 자체 설계 칩 분류 오류')
  }
  return {
    id, name: text(row.name, '기업명'), englishName: row.englishName ? text(row.englishName, '영문명') : '',
    aliases: (row.aliases || []).map(s => text(s, '별칭')),
    country: text(row.country, '국가'), sectorId, secondarySectorIds,
    product: text(row.product, '주요 제품'), overview: text(row.overview, '기업 개요'),
    listed: row.listed, listings, listingCodes, tags, sources: references,
    sourceStatus: references.length ? 'linked' : 'pending', financialId,
    dartSymbol: row.dartSymbol || null, discussionTicker: row.discussionTicker || null,
    selection: null, analysis: null,
  }
}

function publishedAnalysis(edition) {
  const article = {}
  for (const field of ['conclusion', 'problem', 'solution', 'verification', 'outlook', 'reviewer']) {
    article[field] = text(edition[field], field)
  }
  for (const field of ['asOf', 'publishedAt', 'updatedAt']) article[field] = date(edition[field], field)
  requireValue(article.asOf <= article.updatedAt && article.publishedAt <= article.updatedAt, '발행본 날짜 순서 오류')
  article.sources = sources(edition.sources)
  requireValue(Array.isArray(edition.metrics), '분석 수치 목록이 필요합니다.')
  article.metrics = edition.metrics.map(m => {
    requireValue(m.value === null || Number.isFinite(m.value), '수치는 숫자 또는 미공개(null)로 입력하세요.')
    const currency = m.currency === '' ? '' : text(m.currency, '수치 통화')
    requireValue(!currency || /^[A-Z]{3}$/.test(currency), '수치의 통화 코드 오류')
    const monetary = /매출|이익|현금흐름|revenue|income|profit|cash flow/i.test(m.label) && !/률|비율|율|margin|ratio|growth|share/i.test(m.label)
    requireValue(!monetary || currency, '재무 수치의 통화가 필요합니다.')
    return {
      label: text(m.label, '지표 이름'), period: text(m.period, '측정 기간'),
      scope: text(m.scope, '측정 범위'), unit: text(m.unit, '단위'),
      currency, value: m.value, sourceUrl: sourceURL(m.sourceUrl),
    }
  })
  return article
}

// The input stays outside the static site. Build the public projection field by field,
// including only the latest reviewed publication and no editorial notes or draft text.
export function buildCompanyRelease(input, previous = null) {
  requireValue(input.status === 'approved', '승인된 공개 원장이 필요합니다.')
  const approvedAt = date(input.approvedAt, '원장 승인일')
  const reviewer = text(input.reviewer, '원장 검토자')
  requireValue(Array.isArray(input.companies) && Array.isArray(input.selections) && Array.isArray(input.editions), '원장 배열 오류')
  unique(input.companies.map(row => text(row.id, '회사 ID')), '회사 ID')
  requireValue(input.companies.every(row => typeof row.public === 'boolean'), '회사 공개 여부 누락')
  const companies = input.companies.filter(row => row.public).map(publicCompany)
  requireValue(companies.length === registryIds.size && companies.every(c => registryIds.has(c.id)), '공개 기업 ID는 신기업정보 원장 ' + registryIds.size + '개사와 일치해야 합니다.')
  unique(companies.flatMap(c => c.listings.map(l => l.ticker)), '시세 티커')
  unique(companies.map(c => c.financialId).filter(Boolean), '재무 DB ID')
  const byId = new Map(companies.map(c => [c.id, c]))
  requireValue(coreIds.size === MAP_COMPANIES.length && MAP_UNIVERSE.companyCount === MAP_COMPANIES.length, '핵심 기업 선정표 건수 불일치')
  requireValue(input.selections.length === coreIds.size, '핵심 기업은 선정표와 같은 ' + coreIds.size + '개사여야 합니다.')
  for (const entry of input.selections) {
    const company = byId.get(entry.companyId)
    const selected = coreIds.get(entry.companyId)
    requireValue(company && selected && !company.selection, '선정표 밖 또는 중복 핵심 기업 ' + entry.companyId)
    requireValue(company.sectorId === selected.sectorId && company.listed === selected.listed &&
      (company.listings[0]?.ticker || null) === selected.primaryTicker, '핵심 회사 섹터·상장 정보 불일치: ' + company.id)
    requireValue(entry.order === selected.sourceOrder, '핵심 기업 표시 순서 오류')
    company.selection = { reason: text(entry.reason, '선정 이유'), role:selected.role, order: entry.order }
  }
  requireValue(new Set(companies.filter(c => c.selection).map(c => c.sectorId)).size === SECTORS.length, SECTORS.length + '개 핵심 섹터 모두에 기업이 필요합니다.')
  for (const old of previous?.companies || []) {
    const current = byId.get(old.id)
    if (current?.selection && old.analysis) current.analysis = publishedAnalysis(old.analysis)
  }
  const versions = new Set()
  for (const edition of input.editions) {
    requireValue(['draft','review','published'].includes(edition.status), '분석 발행 상태 오류')
    if (edition.status !== 'published') continue
    const company = byId.get(edition.companyId)
    requireValue(company?.selection, '공개 분석은 원장 내 핵심 기업에만 연결할 수 있습니다.')
    const article = publishedAnalysis(edition)
    const version = JSON.stringify([company.id, article.updatedAt])
    requireValue(!versions.has(version), '같은 날짜의 발행본이 중복됩니다.')
    versions.add(version)
    if (!company.analysis || company.analysis.updatedAt <= article.updatedAt) company.analysis = article
  }
  return { approvedAt, reviewer, companies }
}

async function main() {
  const args = process.argv.slice(2)
  const inputFile = args.filter(arg => arg !== '--check')
  requireValue(inputFile.length === 1, '사용법: node scripts/data/publish-company-catalog.mjs <비공개 원장.json> [--check]')
  const release = buildCompanyRelease(JSON.parse(await readFile(inputFile[0], 'utf8')), approvedCatalog)
  if (!args.includes('--check')) {
    const temporary = output + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, 'export const approvedCatalog = ' + JSON.stringify(release) + '\n', { flag: 'wx' })
      await rename(temporary, output)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  console.log('전체 기업 ' + release.companies.length + '개사 · 핵심 기업 ' + release.companies.filter(c => c.selection).length + '개사 · 발행본 ' + release.companies.filter(c => c.analysis).length + '건')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
