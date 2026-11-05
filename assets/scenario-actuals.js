import { ASSUMPTION_LIMITS, MODEL_ASSUMPTIONS } from './scenario-data.js'
import { SCENARIO_FINANCIAL_AS_OF } from './scenario-financial-baselines.js'

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

export function financialProfile(record, assumptions, overrides = {}) {
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
  const forecast = Array.from({ length: MODEL_ASSUMPTIONS.forecastYears }, (_, index) =>
    Object.fromEntries(forecastFields.map(field => {
      const weight = Math.max(0, 1 - index / 2)
      return [field, weight * firstYear[field] + (1 - weight) * assumptions[field]]
    })))
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
    firstYearCapexToRevenuePct: firstYear.capexToRevenuePct, fieldSources, forecast,
  }
}
