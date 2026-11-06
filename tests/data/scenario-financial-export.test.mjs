import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { COMPANIES, SEGMENTS } from '../../assets/scenario-data.js'
import { financialProfile } from '../../assets/scenario-actuals.js'
import { extractFinancialBaselines, serializeFinancialBaselines } from '../../scripts/data/export-scenario-financials.mjs'

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec([
    'CREATE TABLE companies (company_id,display_name,listing_status)',
    'CREATE TABLE security_listings (company_id,ticker,is_primary)',
    'CREATE TABLE fiscal_periods (period_id,company_id,period_type,is_completed,period_end_date,fiscal_year,statement_scope,presentation_currency)',
    "CREATE TABLE source_documents (document_id,provider_id,source_url,published_at,retrieved_at,company_id DEFAULT 'db-AAPL')",
    'CREATE TABLE v_current_canonical_financial_facts (company_id,period_id,metric_id,value_text,currency,scale_exponent,statement_scope,selected_provider_id,selected_normalized_observation_id,accounting_standard)',
    'CREATE TABLE normalized_financial_observations (normalized_observation_id,normalization_status,period_id,metric_id,raw_observation_id,normalized_value_text,currency,scale_exponent,statement_scope,accounting_standard,normalized_at)',
    'CREATE TABLE raw_financial_observations (raw_observation_id,company_id,document_id,provider_id)',
    'CREATE TABLE reconciliation_issues (company_id,period_id,metric_id,resolution_status,requires_user_decision,severity)',
  ].join(';\n'))
  for (const c of COMPANIES) {
    const key = 'db-' + c.companyId
    db.prepare('INSERT INTO companies VALUES (?,?,?)').run(key, c.name, c.listingStatus)
    if (c.symbol) db.prepare('INSERT INTO security_listings VALUES (?,?,1)').run(key,c.symbol)
  }
  db.prepare("INSERT INTO source_documents VALUES ('doc','YAHOO','https://query2.finance.yahoo.com/data?api_key=private-only',NULL,'2026-11-05','db-AAPL')").run()
  return db
}

function period(db, year) {
  db.prepare("INSERT INTO fiscal_periods VALUES (?,'db-AAPL','annual',1,?,?,'consolidated','USD')")
    .run(String(year), year + '-09-30', year)
}

function fact(db, year, metric, value, { currency = 'USD', exponent = 0, doc = 'doc', provider = 'YAHOO',
  standard = null, canonical = true, normalization = 'accepted' } = {}) {
  const id = year + '-' + metric + '-' + doc
  if (canonical) {
    db.prepare("INSERT INTO v_current_canonical_financial_facts VALUES ('db-AAPL',?,?,?,?,?,'consolidated',?,?,?)")
      .run(String(year),metric,value,currency,exponent,provider,id,standard)
  }
  db.prepare("INSERT INTO normalized_financial_observations VALUES (?,?,?,?,?,?,?,?,'consolidated',?,'2026-11-05')")
    .run(id,normalization,String(year),metric,id,value,currency,exponent,standard)
  db.prepare("INSERT INTO raw_financial_observations VALUES (?,'db-AAPL',?,?)").run(id,doc,provider)
}

test('financial extract preserves the latest period and exports only comparable accepted public facts', t => {
  const db = database()
  t.after(() => db.close())
  for (const y of [2024,2025,2027]) period(db,y)
  fact(db,2024,'revenue','11',{exponent:3})
  fact(db,2024,'operating_income','5')
  fact(db,2024,'capital_expenditure','-16')
  fact(db,2025,'revenue','10',{exponent:3})
  fact(db,2025,'operating_income','-2',{exponent:3})
  fact(db,2025,'operating_cash_flow','-3')
  fact(db,2025,'capital_expenditure','0',{currency:'KRW'})
  fact(db,2025,'free_cash_flow','22')
  fact(db,2027,'revenue','20')
  db.exec("INSERT INTO reconciliation_issues VALUES ('db-AAPL','2025','free_cash_flow','open',1,'high')")
  const snapshot = extractFinancialBaselines(db,'2026-11-05')
  const company = snapshot.baselines.AAPL
  assert.equal(company.status,'available')
  assert.deepEqual(company.years.map(y => y.fiscalYear),[2025,2024])
  const latest = company.years[0].facts
  assert.equal(latest.revenue.value,10000)
  assert.equal(latest.operatingIncome.value,-2000)
  assert.equal(latest.operatingIncome.grade,'C')
  assert.equal(latest.operatingIncome.url,'https://finance.yahoo.com/quote/AAPL/financials/')
  assert.equal(latest.operatingCashFlow.value,-3)
  assert.equal(latest.freeCashFlow,undefined)
  assert.equal(latest.capitalExpenditure,undefined)
  assert.equal(latest.revenue.grade,'C')
  assert.equal(latest.revenue.url,'https://finance.yahoo.com/quote/AAPL/financials/')
  assert.deepEqual(Object.keys(company.years[1].facts),['revenue'])
  assert.ok(!serializeFinancialBaselines(snapshot).includes('private-only'))
  assert.equal(snapshot.baselines.OPENAI.status,'unavailable')
})

test('missing latest sales keeps its actual year and never substitutes an older baseline', t => {
  const db = database()
  t.after(() => db.close())
  for (const y of [2024,2025]) period(db,y)
  fact(db,2024,'revenue','30')
  db.exec("INSERT INTO source_documents VALUES ('future','YAHOO','https://finance.yahoo.com','2027-01-03','2026-11-05','db-AAPL')")
  fact(db,2025,'revenue','4',{doc:'future'})
  fact(db,2025,'operating_income','2',{currency:'EUR'})
  const company = extractFinancialBaselines(db,'2026-11-05').baselines.AAPL
  assert.equal(company.status,'unavailable')
  assert.equal(company.years[0].fiscalYear,2025)
  assert.equal(company.years[0].facts.revenue,undefined)
  assert.equal(company.years[0].facts.operatingIncome,undefined)
  assert.equal(company.years[1].facts.revenue.value,30)
})

test('income-statement calibration pools amounts, excludes loss years from tax and never charges historical capex on incremental price', t => {
  const db = database()
  t.after(() => db.close())
  for (const [year, sales, gross, pretax, net] of [
    [2022, 1000, 999, 900, 900], // Outside the three-year calibration window.
    [2023, 100, -10, -20, -40],
    [2024, 100, 40, 10, 6],
    [2025, 200, 110, 40, 34],
  ]) {
    period(db, year)
    for (const [metric, value] of [['revenue',sales],['gross_profit',gross],['pretax_income',pretax],['net_income',net]]) {
      fact(db, year, metric, String(value))
    }
  }
  fact(db, 2025, 'operating_cash_flow', '10')
  fact(db, 2025, 'capital_expenditure', '-300')
  const record = extractFinancialBaselines(db,'2026-11-05').baselines.AAPL
  const profile = financialProfile(record, SEGMENTS[0].illustrativeAssumptions)
  const margins = profile.incrementalMargins
  assert.equal(margins.grossMarginPct,35)
  assert.equal(margins.taxRetentionPct,80)
  assert.equal(margins.priceContributionMarginPct,80)
  assert.equal(margins.volumeContributionMarginPct,28)
  assert.equal(margins.costOfRevenueSharePct,65)
  assert.deepEqual(margins.taxRetentionFiscalYears,[2025,2024])
  assert.deepEqual(margins.grossMarginFiscalYears,[2025,2024,2023])
  assert.equal(profile.historicalCashMarginPct,-145)
  assert.equal(record.years[0].facts.grossProfit.url,'https://finance.yahoo.com/quote/AAPL/financials/')
  assert.ok(record.years[3].facts.grossProfit === undefined)
  assert.ok(profile.forecast.every(year => year.volumeContributionMarginPct === 28))
  for (const year of record.years) delete year.facts.netIncome
  const fallback = financialProfile(record, SEGMENTS[0].illustrativeAssumptions).incrementalMargins
  assert.equal(fallback.taxRetentionSource,'sector-peer-median')
  assert.deepEqual(fallback.taxRetentionFiscalYears,[])
  assert.ok(fallback.taxRetentionPeerIds.length > 0)
  assert.equal(fallback.grade,'C')
})

test('an open decision excludes even a filing on an official hostname', t => {
  const db = database()
  t.after(() => db.close())
  period(db,2025)
  db.exec("INSERT INTO source_documents VALUES ('filing','SEC','https://www.sec.gov/Archives/edgar/data/123/filing.htm?api_key=private-only',NULL,'2026-11-05','db-AAPL')")
  fact(db,2025,'revenue','42',{doc:'filing',provider:'SEC'})
  db.exec("INSERT INTO reconciliation_issues VALUES ('db-AAPL','2025','revenue','open',1,'warning')")
  const extract = () => extractFinancialBaselines(db,'2026-11-05').baselines.AAPL.years[0].facts
  assert.equal(extract().revenue,undefined)
  db.exec("UPDATE reconciliation_issues SET resolution_status='resolved'")
  assert.equal(extract().revenue.grade,'A')
  assert.equal(extract().revenue.url,'https://www.sec.gov/Archives/edgar/data/123/filing.htm')
})

test('comparable revenue is separate from the canonical revenue, checked for period, currency, basis and approval', t => {
  const db = database()
  t.after(() => db.close())
  db.exec("INSERT INTO source_documents VALUES ('naver','NAVER','https://api.stock.naver.com/stock/AAPL/finance/annual',NULL,'2026-11-05','db-AAPL')")
  const canonical = { doc:'naver', provider:'NAVER', standard:'T-IFRS' }
  const sameStandard = { standard: 'IFRS-IASB' }
  for (const y of [2023,2024,2025]) {
    period(db,y)
    fact(db,y,'revenue','100',canonical)
    fact(db,y,'revenue','99',{...sameStandard, canonical:false, currency:y===2023?'EUR':'USD'})
  }
  for (const [metric, value] of [['capital_expenditure','-12'],['operating_cash_flow','20'],['free_cash_flow','8']]) {
    fact(db,2025,metric,value,sameStandard)
  }
  const extract = () => extractFinancialBaselines(db,'2026-11-05').baselines.AAPL.years
  const [latest,previous,mismatched] = extract()
  assert.equal(latest.facts.revenue.value,100)
  assert.equal(latest.facts.revenue.provider,'NAVER')
  assert.deepEqual(latest.facts.cashFlowBasisRevenue,{value:99,provider:'YAHOO',grade:'C',
    url:'https://finance.yahoo.com/quote/AAPL/financials/',accountingStandard:'IFRS-IASB',
    selectionReason:'same_provider_and_accounting_standard_as_cash_flow'})
  assert.equal(previous.facts.cashFlowBasisRevenue.value,99)
  assert.equal(mismatched.facts.cashFlowBasisRevenue,undefined)
  db.exec("UPDATE normalized_financial_observations SET normalization_status='rejected' WHERE normalized_observation_id='2025-revenue-doc'")
  assert.ok(extract().every(y => !y.facts.cashFlowBasisRevenue))
})
