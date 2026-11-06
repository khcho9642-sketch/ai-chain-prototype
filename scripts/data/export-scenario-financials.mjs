// Export the selected public financial inputs. The SQLite file, observations and raw payloads stay local.
import { DatabaseSync } from 'node:sqlite'
import { rename, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { COMPANIES } from '../../assets/scenario-data.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fields = new Map([
  ['revenue', 'revenue'], ['operating_cash_flow', 'operatingCashFlow'],
  ['capital_expenditure', 'capitalExpenditure'], ['free_cash_flow', 'freeCashFlow'],
  ['gross_profit', 'grossProfit'], ['operating_income', 'operatingIncome'],
  ['pretax_income', 'pretaxIncome'], ['net_income', 'netIncome'],
])
const marginHistoryMetrics = new Set(['revenue', 'gross_profit', 'pretax_income', 'net_income'])
const officialHosts = {
  SEC: ['www.sec.gov', 'data.sec.gov'],
  SGX: ['links.sgx.com'],
  DART: ['dart.fss.or.kr'],
  EDINET: ['disclosure2dl.edinet-fsa.go.jp', 'disclosure2.edinet-fsa.go.jp'],
  MOPS: ['mopsov.twse.com.tw', 'mops.twse.com.tw'],
  ISSUER_IR: ['www.se.com', 'www.asml.com', 'investor.tsmc.com', 'investor.oracle.com',
    'investors.delltechnologies.com', 'abc.xyz', 'investor.atmeta.com', 'investors.coreweave.com',
    'investor.digitalrealty.com', 'investors.hpe.com', 'investors.ironmountain.com',
    'media-aseholdco.todayir.com', 'ir.supermicro.com', 'www.gevernova.com', 'ir.tesla.com'],
}

// Only the browser-facing finance page or a known public filing is exported, never collector credentials.
export function publicSource(row, ticker) {
  const provider = row.selected_provider_id
  if (provider === 'YAHOO') {
    const incomeStatement = row.metric_id === 'operating_income' || marginHistoryMetrics.has(row.metric_id)
    const statement = incomeStatement ? 'financials' : 'cash-flow'
    return { provider, url: 'https://finance.yahoo.com/quote/' + encodeURIComponent(ticker) + '/' + statement + '/', grade: 'C' }
  }
  const u = new URL(row.source_url)
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (provider === 'NAVER') {
    if (!['api.stock.naver.com','m.stock.naver.com'].includes(u.hostname) ||
        !/^\/(?:api\/)?stock\/[\w.-]+\/finance\/annual$/.test(u.pathname)) return null
    return { provider, url: u.origin + u.pathname, grade: 'C' }
  }
  if (!Object.hasOwn(officialHosts, provider) || !officialHosts[provider].includes(u.hostname) || u.pathname === '/') return null
  const link = new URL(u.origin + u.pathname)
  const allowed = provider === 'MOPS' ? ['functionName','step','co_id','year','season','report_id'] :
    provider === 'DART' ? ['rcpNo'] : []
  for (const name of allowed) {
    const value = u.searchParams.get(name)
    if (value && /^[\w.-]{1,64}$/.test(value)) link.searchParams.set(name,value)
  }
  if (/^#page=\d+$/.test(u.hash)) link.hash = u.hash
  return { provider, url: link.href, grade: 'A' }
}

function eligibleValue(row, currency) {
  if (row.currency !== currency || !/^[A-Z]{3}$/.test(currency) ||
      row.statement_scope !== 'consolidated' || !row.value_text?.trim()) return null
  const value = Number(row.value_text) * 10 ** row.scale_exponent
  if (!Number.isFinite(value) || (row.metric_id === 'revenue' && value <= 0)) return null
  return value
}

// Keep the canonical sale while exposing a comparable denominator only when the cash-flow basis differs.
function attachComparableRevenue(db, dbCompanies, periods, byPeriod, asOf) {
  const comparableSale = db.prepare(
    "SELECT n.normalized_value_text AS value_text, n.scale_exponent, n.currency, n.statement_scope, " +
    "n.metric_id, n.accounting_standard, r.provider_id AS selected_provider_id, d.source_url " +
    "FROM normalized_financial_observations n JOIN raw_financial_observations r USING (raw_observation_id) " +
    "JOIN source_documents d ON d.document_id=r.document_id AND d.company_id=r.company_id AND d.provider_id=r.provider_id " +
    "WHERE n.period_id=? AND r.company_id=? AND r.provider_id=? AND n.accounting_standard=? AND n.currency=? " +
    "AND n.metric_id='revenue' AND n.statement_scope='consolidated' AND n.normalization_status='accepted' " +
    "AND date(d.retrieved_at)<=? AND (d.published_at IS NULL OR date(d.published_at)<=?) " +
    "ORDER BY COALESCE(d.published_at,d.retrieved_at) DESC, d.retrieved_at DESC, n.normalized_at DESC, n.normalized_observation_id DESC LIMIT 1")
  for (const period of periods) {
    const year = byPeriod.get(period.period_id)
    if (!year?.facts.revenue) continue // A missing or disputed canonical sale must never be replaced.
    const company = dbCompanies.get(period.company_id)
    const latest = company.years[0]
    const { revenue, operatingCashFlow: cash, capitalExpenditure: capex, freeCashFlow: fcf } = latest.facts
    const isCashBasis = fact => fact?.provider === cash?.provider && fact?.accountingStandard === cash?.accountingStandard
    if (!revenue?.accountingStandard || !cash?.accountingStandard || revenue.accountingStandard === cash.accountingStandard ||
        !isCashBasis(capex) || (fcf && !isCashBasis(fcf)) || latest.currency !== year.currency || isCashBasis(year.facts.revenue)) continue
    if (year !== latest && !latest.facts.cashFlowBasisRevenue) continue
    const row = comparableSale.get(period.period_id, period.company_id, cash.provider, cash.accountingStandard, year.currency, asOf, asOf)
    if (!row) continue
    const value = eligibleValue(row, year.currency)
    const source = publicSource(row, company.companyId)
    if (value === null || !source) continue
    year.facts.cashFlowBasisRevenue = { value, ...source, accountingStandard: row.accounting_standard,
      selectionReason: 'same_provider_and_accounting_standard_as_cash_flow' }
  }
}

export function extractFinancialBaselines(db, today = new Date().toISOString().slice(0,10)) {
  const { asOf } = db.prepare("SELECT max(date(retrieved_at)) AS asOf FROM source_documents WHERE date(retrieved_at) <= ?").get(today)
  if (!asOf) throw new Error('재무 DB에 조회할 수 있는 수집일이 없습니다.')
  const roster = db.prepare('SELECT c.company_id, c.display_name, c.listing_status, l.ticker FROM companies c ' +
    'LEFT JOIN security_listings l ON l.company_id=c.company_id AND l.is_primary=1').all()
  const matchedIds = new Set()
  const dbCompanies = new Map()
  for (const company of COMPANIES) {
    const matches = roster.filter(row => row.listing_status === company.listingStatus &&
      (company.symbol ? row.ticker === company.symbol : row.display_name === company.name))
    if (matches.length !== 1 || matchedIds.has(matches[0].company_id)) throw new Error('재무 DB 기업 매핑 불일치: ' + company.companyId)
    const id = matches[0].company_id
    matchedIds.add(id)
    dbCompanies.set(id, { companyId: company.companyId, status: 'unavailable', years: [] })
  }
  // Anchor each year on the completed fiscal period, even when a selected metric is missing.
  const periods = db.prepare("SELECT * FROM fiscal_periods WHERE period_type='annual' AND is_completed=1 " +
    "AND period_end_date<=? AND fiscal_year IS NOT NULL ORDER BY company_id, fiscal_year DESC, " +
    "CASE statement_scope WHEN 'consolidated' THEN 0 ELSE 1 END, period_end_date DESC, period_id").all(asOf)
  const byPeriod = new Map()
  for (const period of periods) {
    const company = dbCompanies.get(period.company_id)
    if (!company || company.years.length >= 4 || company.years.some(year => year.fiscalYear === period.fiscal_year)) continue
    const year = { fiscalYear: period.fiscal_year, endDate: period.period_end_date, scope: period.statement_scope,
      currency: period.presentation_currency, facts: {} }
    company.years.push(year)
    byPeriod.set(period.period_id, year)
  }

  const rows = db.prepare(
    "SELECT f.*, d.source_url FROM v_current_canonical_financial_facts f " +
    "JOIN normalized_financial_observations n ON n.normalized_observation_id=f.selected_normalized_observation_id " +
    "AND n.normalization_status='accepted' AND n.period_id=f.period_id AND n.metric_id=f.metric_id " +
    "JOIN raw_financial_observations r ON r.raw_observation_id=n.raw_observation_id AND r.company_id=f.company_id " +
    "JOIN source_documents d ON d.document_id=r.document_id AND d.company_id=r.company_id AND d.provider_id=f.selected_provider_id " +
    "WHERE f.metric_id IN ('revenue','operating_cash_flow','capital_expenditure','free_cash_flow','gross_profit','operating_income','pretax_income','net_income') " +
    "AND date(d.retrieved_at)<=? AND (d.published_at IS NULL OR date(d.published_at)<=?) " +
    "AND NOT EXISTS (SELECT 1 FROM reconciliation_issues i WHERE i.company_id=f.company_id " +
      "AND (i.period_id IS NULL OR i.period_id=f.period_id) AND (i.metric_id IS NULL OR i.metric_id=f.metric_id) " +
      "AND i.resolution_status='open' AND (i.requires_user_decision=1 OR i.severity IN ('high','material'))) " +
    "ORDER BY f.company_id, f.period_id, f.metric_id").all(asOf, asOf)
  for (const row of rows) {
    const year = byPeriod.get(row.period_id)
    if (!year || year.scope !== 'consolidated') continue
    const company = dbCompanies.get(row.company_id)
    // Use the three most recent completed income statements to estimate contribution margins.
    // Keep operating income only for the latest year's operating-margin check; the fourth year's sales anchor growth.
    const yearIndex = company.years.indexOf(year)
    if (yearIndex > 0 && !marginHistoryMetrics.has(row.metric_id)) continue
    if (yearIndex > 2 && row.metric_id !== 'revenue') continue
    const value = eligibleValue(row, year.currency)
    if (value === null) continue
    const source = publicSource(row, company.companyId)
    if (!source) throw new Error('공개 출처 확인 필요: ' + company.companyId + ' / ' + row.selected_provider_id)
    year.facts[fields.get(row.metric_id)] = { value, ...source, accountingStandard: row.accounting_standard }
  }
  attachComparableRevenue(db, dbCompanies, periods, byPeriod, asOf)
  for (const company of dbCompanies.values()) {
    if (company.years[0]?.facts.revenue) company.status = 'available'
  }
  const baselines = Object.fromEntries([...dbCompanies.values()].map(row => [row.companyId, row]))
  return { asOf, baselines }
}

export function serializeFinancialBaselines({ asOf, baselines }) {
  // One line per fiscal year keeps source review and revision diffs small.
  const entries = Object.values(baselines).map(({ companyId, status, years }) => {
    const yearLines = years.map(y => '      ' + JSON.stringify(y)).join(',\n')
    return '  ' + JSON.stringify(companyId) + ': { companyId: ' + JSON.stringify(companyId) +
      ', status: ' + JSON.stringify(status) + ', years: [' + (yearLines ? '\n' + yearLines + '\n  ' : '') + '] }'
  })
  return '// Generated by scripts/data/export-scenario-financials.mjs from selected annual statements.\n' +
    'export const SCENARIO_FINANCIAL_AS_OF = ' + JSON.stringify(asOf) + '\n' +
    'export const SCENARIO_FINANCIAL_BASELINES = {\n' + entries.join(',\n') + '\n}\n'
}

async function run() {
  const { values } = parseArgs({ options: { db: { type: 'string' }, output: { type: 'string' } } })
  const db = new DatabaseSync(values.db ?? resolve(root, '.local/financials/financials.sqlite'), { readOnly: true })
  let snapshot
  try {
    db.exec('BEGIN')
    snapshot = extractFinancialBaselines(db)
    db.exec('COMMIT')
  } finally { db.close() }
  const target = values.output ?? resolve(root, 'assets/scenario-financial-baselines.js')
  const temp = target + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temp, serializeFinancialBaselines(snapshot), { flag: 'wx' })
    await rename(temp, target)
  } finally { await rm(temp, { force: true }) }
  const companies = Object.values(snapshot.baselines)
  console.log(snapshot.asOf, companies.filter(c => c.status === 'available').length + '/' + companies.length, target)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run()
