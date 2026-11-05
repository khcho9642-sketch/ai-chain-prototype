import { ASSUMPTION_LIMITS, COMPANIES, MODEL_ASSUMPTIONS } from './scenario-data.js'
import { SCENARIO_FINANCIAL_AS_OF, SCENARIO_FINANCIAL_BASELINES } from './scenario-financial-baselines.js'

const forecastFields = ['baseGrowthPct', 'fcffMarginPct', 'capexToRevenuePct']

function conflictingStandards(...facts) {
  return new Set(facts.map(fact => fact?.accountingStandard).filter(Boolean)).size > 1
}

// Compare consecutive fiscal years of the same issuer, scope, currency and known accounting basis.
function revenueHistory(years, alternateAnchor) {
  const latest = years[0]
  const comparable = [{ fiscalYear: latest.fiscalYear, revenue: alternateAnchor ?? latest.facts.revenue }]
  for (const prior of years.slice(1, 4)) {
    if (prior.fiscalYear !== comparable.at(-1).fiscalYear - 1 || prior.scope !== latest.scope || prior.currency !== latest.currency) break
    let revenue = prior.facts.revenue
    if (alternateAnchor) {
      revenue = [prior.facts.cashFlowBasisRevenue, revenue].find(fact => fact &&
        fact.provider === alternateAnchor.provider && fact.accountingStandard === alternateAnchor.accountingStandard)
    }
    if (!Number.isFinite(revenue?.value) || revenue.value <= 0 || conflictingStandards(revenue, ...comparable.map(year => year.revenue))) break
    comparable.push({ fiscalYear: prior.fiscalYear, revenue })
  }
  return comparable
}

// Pool amounts within an issuer, then compare ratios across issuers. Never add amounts in different currencies.
function measuredMargins(record) {
  const latest = record?.years[0]
  const grossYears = []
  const taxYears = []
  let grossProfit = 0, sales = 0, pretaxIncome = 0, netIncome = 0
  for (const year of record?.status === 'available' ? record.years : []) {
    if (year.fiscalYear < latest.fiscalYear - 2 || year.scope !== 'consolidated' || year.currency !== latest.currency) continue
    const facts = year.facts
    const gross = facts.grossProfit
    const revenue = [facts.revenue, facts.cashFlowBasisRevenue].find(fact =>
      Number.isFinite(fact?.value) && fact.value > 0 && !conflictingStandards(fact, gross))
    if (revenue && Number.isFinite(gross?.value) && gross.value <= revenue.value) {
      sales += revenue.value
      grossProfit += gross.value
      grossYears.push(year.fiscalYear)
    }
    const pretax = facts.pretaxIncome, net = facts.netIncome
    // Losses do not establish whether a tax benefit will be realized on the next sale.
    if (Number.isFinite(pretax?.value) && pretax.value > 0 && Number.isFinite(net?.value) && !conflictingStandards(pretax, net)) {
      pretaxIncome += pretax.value
      netIncome += net.value
      taxYears.push(year.fiscalYear)
    }
  }
  const retained = pretaxIncome > 0 ? 100 * netIncome / pretaxIncome : null
  return {
    grossMarginPct: sales > 0 ? 100 * grossProfit / sales : null,
    taxRetentionPct: retained !== null && retained >= 0 && retained <= 100 ? retained : null,
    grossYears, taxYears,
  }
}

const calibratedCompanies = COMPANIES.map(company => ({
  id: company.companyId, segmentId: company.primarySegmentId,
  ...measuredMargins(SCENARIO_FINANCIAL_BASELINES[company.companyId]),
}))

function peerMargin(segmentId, field, fallback, excludedId) {
  const available = calibratedCompanies.filter(item => item.id !== excludedId && Number.isFinite(item[field]))
  const segmentPeers = available.filter(item => item.segmentId === segmentId)
  const peers = segmentPeers.length ? segmentPeers : available
  if (!peers.length) return { value: fallback, source: 'assumption', peers: [] }
  const values = peers.map(item => item[field]).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return { value: (values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2,
    source: segmentPeers.length ? 'sector-peer-median' : 'universe-peer-median', peers: peers.map(item => item.id) }
}

function incrementalMargins(record, segmentId, assumptions) {
  const own = measuredMargins(record)
  const segment = segmentId ?? calibratedCompanies.find(item => item.id === record?.companyId)?.segmentId
  // A legacy snapshot may have no historical income-statement components for any firm.
  // In that case use its existing normalized pre-investment cash margin and a pre-tax price bridge.
  const fallbackMargin = Math.min(100, Math.max(0, assumptions.fcffMarginPct + assumptions.capexToRevenuePct))
  const gross = own.grossMarginPct === null ? peerMargin(segment, 'grossMarginPct', fallbackMargin, record?.companyId) : { value: own.grossMarginPct, source: 'company-db', peers: [] }
  const retention = own.taxRetentionPct === null ? peerMargin(segment, 'taxRetentionPct', 100, record?.companyId) : { value: own.taxRetentionPct, source: 'company-db', peers: [] }
  return {
    grade: 'C', grossMarginPct: gross.value, grossMarginSource: gross.source,
    grossMarginFiscalYears: gross.source === 'company-db' ? own.grossYears : [], grossMarginPeerIds: gross.peers,
    taxRetentionPct: retention.value, taxRetentionSource: retention.source,
    taxRetentionFiscalYears: retention.source === 'company-db' ? own.taxYears : [], taxRetentionPeerIds: retention.peers,
    volumeContributionMarginPct: gross.value * retention.value / 100,
    priceContributionMarginPct: retention.value, costOfRevenueSharePct: 100 - gross.value,
    method: 'pooled-gross-profit-over-sales-and-net-over-positive-pretax-income',
  }
}

export function financialProfile(record, assumptions, overrides = {}, segmentId) {
  const latest = record?.status === 'available' ? record.years[0] : null
  const actual = Number.isFinite(latest?.facts.revenue?.value) && latest.facts.revenue.value > 0
  const facts = actual ? latest.facts : {}
  const startingRevenue = actual ? facts.revenue.value : MODEL_ASSUMPTIONS.normalizedStartingRevenue
  const cash = facts.operatingCashFlow?.value
  const capex = Number.isFinite(facts.capitalExpenditure?.value) ? Math.abs(facts.capitalExpenditure.value) : null
  // Issuer/vendor FCF definitions differ. Missing gross investment must not become a zero cash outflow.
  // A second revenue observation can bridge different reporting standards within the same consolidated FY and currency.
  const alternativeRevenue = facts.cashFlowBasisRevenue
  const cashFacts = [facts.operatingCashFlow, facts.capitalExpenditure].filter(Boolean)
  const useCashFlowBasisRevenue = conflictingStandards(facts.revenue, ...cashFacts) &&
    Number.isFinite(alternativeRevenue?.value) && alternativeRevenue.value > 0 && Boolean(alternativeRevenue.accountingStandard) &&
    cashFacts.every(fact => fact.accountingStandard === alternativeRevenue.accountingStandard)
  const ratioRevenue = useCashFlowBasisRevenue ? alternativeRevenue : facts.revenue
  const periods = actual ? revenueHistory(record.years, useCashFlowBasisRevenue ? alternativeRevenue : null) : []
  const oldest = periods.at(-1)
  const growthYears = Math.max(0, periods.length - 1)
  const historicalGrowthPct = growthYears ? 100 * ((periods[0].revenue.value / oldest.revenue.value) ** (1 / growthYears) - 1) : null
  let capexFallbackReason = null
  if (!actual) capexFallbackReason = 'missing-annual-financials'
  else if (capex === null) capexFallbackReason = 'missing-gross-capex'
  else if (conflictingStandards(ratioRevenue, facts.capitalExpenditure)) capexFallbackReason = 'incompatible-accounting-standards'
  let marginFallbackReason = capexFallbackReason
  if (!marginFallbackReason && !Number.isFinite(cash)) marginFallbackReason = 'missing-operating-cash-flow'
  if (!marginFallbackReason && conflictingStandards(ratioRevenue, ...cashFacts)) {
    marginFallbackReason = 'incompatible-accounting-standards'
  }
  const historicalCashMarginPct = marginFallbackReason ? null : (cash - capex) / ratioRevenue.value * 100
  const historicalCapexToRevenuePct = capexFallbackReason ? null : capex / ratioRevenue.value * 100
  const historical = { baseGrowthPct: historicalGrowthPct, fcffMarginPct: historicalCashMarginPct, capexToRevenuePct: historicalCapexToRevenuePct }
  const fieldSources = {}
  const firstYear = {}
  for (const field of forecastFields) {
    fieldSources[field] = Number.isFinite(historical[field]) ? 'historical' : 'sector'
    if (Object.hasOwn(overrides, field)) fieldSources[field] = 'user'
    firstYear[field] = fieldSources[field] === 'historical' ? historical[field] : assumptions[field]
  }
  const [minGrowth, maxGrowth] = ASSUMPTION_LIMITS.baseGrowthPct
  firstYear.baseGrowthPct = Math.max(minGrowth, Math.min(maxGrowth, firstYear.baseGrowthPct))
  // Explicit forecast policy: FY1 starts at the selected baseline, FY2 blends, FY3 onward uses the mature profile.
  // An override sets both endpoints of its field, so that value remains under the user's control throughout.
  const margins = incrementalMargins(record, segmentId, assumptions)
  const forecast = Array.from({ length: MODEL_ASSUMPTIONS.forecastYears }, (_, index) => ({
    ...Object.fromEntries(forecastFields.map(field => {
      const weight = Math.max(0, 1 - index / 2)
      return [field, weight * firstYear[field] + (1 - weight) * assumptions[field]]
    })),
    volumeContributionMarginPct: margins.volumeContributionMarginPct,
    priceContributionMarginPct: margins.priceContributionMarginPct, costOfRevenueSharePct: margins.costOfRevenueSharePct,
  }))
  const selectedFacts = [facts.revenue]
  if (fieldSources.baseGrowthPct === 'historical') selectedFacts.push(oldest.revenue, periods[0].revenue)
  if (fieldSources.fcffMarginPct === 'historical') selectedFacts.push(ratioRevenue, facts.operatingCashFlow, facts.capitalExpenditure)
  if (fieldSources.capexToRevenuePct === 'historical') selectedFacts.push(ratioRevenue, facts.capitalExpenditure)
  const grades = selectedFacts.map(fact => fact?.grade ?? 'C')
  const sourceGrade = grades.includes('C') ? 'C' : grades.includes('B') ? 'B' : 'A'
  return {
    status: actual ? 'actual' : 'illustrative',
    asOfDate: SCENARIO_FINANCIAL_AS_OF, fiscalYear: latest?.fiscalYear ?? null, endDate: latest?.endDate ?? null,
    scope: latest?.scope ?? null, currency: actual ? latest.currency : null, startingRevenue, facts,
    sourceGrade, historicalGrowthPct, historicalCashMarginPct, historicalCapexToRevenuePct,
    growthStartRevenueFact: growthYears ? oldest.revenue : null,
    growthEndRevenueFact: growthYears ? periods[0].revenue : null,
    growthYears, growthStartFiscalYear: growthYears ? oldest.fiscalYear : null,
    growthEndFiscalYear: growthYears ? latest.fiscalYear : null,
    marginMethod: historicalCashMarginPct === null ? 'sector' : 'cfo-minus-capex',
    marginFallbackReason, capexFallbackReason,
    cashFlowRevenueFactKey: capexFallbackReason ? null : (useCashFlowBasisRevenue ? 'cashFlowBasisRevenue' : 'revenue'),
    forecastMethod: actual ? 'historical-to-sector-by-year-three' : 'sector-profile',
    firstYearGrowthPct: firstYear.baseGrowthPct, firstYearCashMarginPct: firstYear.fcffMarginPct,
    firstYearCapexToRevenuePct: firstYear.capexToRevenuePct, fieldSources, incrementalMargins: margins, forecast,
  }
}
