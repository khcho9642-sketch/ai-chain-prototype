import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCompanyPreview } from '../../assets/scenario-core.js'

const preview = (request, id) => evaluateCompanyPreview(request, [id]).companies[0]
const sum = numbers => numbers.reduce((total, value) => total + value, 0)
test('direct rate effects reconcile to the discount path and the marginal direct demand effect', () => {
  for (const rate of [-2, 0, 1, 3]) {
    for (const id of ['NVDA', '000660.KS']) {
      const row = preview({ scenarioId: 'interest_rate', inputs: { rateChangePctPoints: rate } }, id)
      const { directPct, rateDiscountPct, rateDirectDemandPct } = row.effectAttribution
      assert.equal(rateDiscountPct, row.paths.find(p => p.pathId === 'interestRate:discountRate')?.impactPoints ?? 0)
      assert.ok(Math.abs(rateDiscountPct + rateDirectDemandPct - directPct) <= 1e-9)
      if (rate === 0) assert.deepEqual([rateDiscountPct, rateDirectDemandPct], [0, 0])
    }
  }
  assert.equal('rateDiscountPct' in preview({ scenarioId: 'model_growth', inputs: {
    modelBaselineGrowthPct: 50, modelTargetGrowthPct: 80 } }, 'NVDA').effectAttribution, false)
})
function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < Math.max(0.0001, Math.abs(expected) * 1e-10),
    `${actual} differs from ${expected}`)
}

test('96 month-end cash payments and the terminal amount reproduce the rate-shocked EV', () => {
  const row = preview({ scenarioId: 'interest_rate', durationMonths: 6,
    inputs: { rateChangePctPoints: 1, rateCapexSensitivity: 5 } }, 'NVDA')
  const { monthly, terminalValueAtMonth96, scenarioFcff, scenarioEnterpriseValueUnits } = row.valuation
  for (const series of Object.values(monthly)) {
    assert.equal(series.length, 96)
    assert.ok(series.every(Number.isFinite))
  }
  let pv = 0
  let discount = 1
  for (let i = 0; i < monthly.scenarioFcff.length; i++) {
    discount *= (1 + monthly.annualizedDiscountRatesPct[i] / 100) ** (1 / 12)
    pv += monthly.scenarioFcff[i] / discount
  }
  close(pv + terminalValueAtMonth96 / discount, scenarioEnterpriseValueUnits)
  scenarioFcff.forEach((annual, i) => close(sum(monthly.scenarioFcff.slice(i * 12, (i + 1) * 12)), annual))
})

test('a flat perpetual monthly cash flow has its monthly perpetuity value at both endpoints', () => {
  const row = preview({ scenarioId: 'hbm_market', inputs: { hbmPriceChangePct: 0, hbmSupplyChangePct: 0 },
    companyOverrides: { NVDA: { assumptions: { baseGrowthPct: 0, fcffMarginPct: 10, terminalGrowthPct: 0, discountRatePct: 10 } } },
  }, 'NVDA')
  const monthlyRate = 1.10 ** (1 / 12) - 1
  const perpetuity = row.valuation.startingRevenue * 0.10 / 12 / monthlyRate
  close(row.valuation.terminalValueAtMonth96, perpetuity)
  close(row.valuation.baselineEnterpriseValueUnits, perpetuity)
  close(row.valuation.baselineTerminalValuePvSharePct, 100 / 1.10 ** 8)
})

test('a temporary rate below terminal growth is valid when the permanent discount spread is positive', () => {
  const row = preview({ scenarioId: 'interest_rate', inputs: { rateChangePctPoints: -2, rateCapexSensitivity: 0 },
    companyOverrides: { NVDA: { assumptions: { discountRatePct: 4, rateDiscountPassThrough: 1, terminalGrowthPct: 3 } } },
  }, 'NVDA')
  assert.equal(row.valuation.monthly.annualizedDiscountRatesPct[0], 2)
  assert.equal(row.valuation.monthly.annualizedDiscountRatesPct.at(-1), 4)
  assert.ok(row.valueChangePct > 0)
})

test('a price-only rent increase adds incremental cash even when the historical cash margin is negative', () => {
  const row = preview({ scenarioId: 'gpu_dc_rent', inputs: { gpuRentChangePct: 20, dcRentChangePct: 0 } }, 'CRWV')
  const { monthly } = row.valuation
  assert.ok(monthly.baselineFcff[0] < 0)
  assert.equal(monthly.revenueVolumePct[0], 0)
  assert.ok(monthly.aspPct[0] > 0)
  assert.ok(monthly.scenarioFcff[0] > monthly.baselineFcff[0])
  assert.ok(row.valueChangePct > 0)
  close(monthly.scenarioFcff[0] - monthly.baselineFcff[0], row.valuation.baselineRevenue[0] / 12 *
    monthly.aspPct[0] / 100 * row.financialBasis.forecast[0].priceContributionMarginPct / 100)
})

test('price-volume interaction is calculated for the same month on HBM sales', () => {
  const run = (price, supply) => preview({ scenarioId: 'hbm_market', inputs: {
    hbmPriceChangePct: price, hbmSupplyChangePct: supply,
  } }, '000660.KS')
  const both = run(20, 20)
  const price = run(20, 0).valuation.monthly
  const supply = run(0, 20).valuation.monthly
  for (const i of [0, 12, 20, 24]) {
    const { monthly, baselineRevenue } = both.valuation
    const year = Math.floor(i / 12)
    const interaction = monthly.scenarioFcff[i] - price.scenarioFcff[i] - supply.scenarioFcff[i] + monthly.baselineFcff[i]
    const priceRetention = both.financialBasis.forecast[year].priceContributionMarginPct / 100
    close(interaction, baselineRevenue[year] / 12 * price.aspPct[i] / 100 * supply.revenueVolumePct[i] / 100 * priceRetention)
  }
})

test('annual model growth compounds monthly before company exposure, then its level gap fades in 12 months', () => {
  for (const [base, target] of [[50, 80], [-50, 150], [150, -50]]) {
    const row = preview({ scenarioId: 'model_growth', durationMonths: 36,
      inputs: { modelBaselineGrowthPct: base, modelTargetGrowthPct: target } }, 'OPENAI')
    const annualRatio = (1 + target / 100) / (1 + base / 100)
    const volume = row.valuation.monthly.revenueVolumePct
    const exposure = volume[11] / (annualRatio - 1)
    assert.ok(exposure > 0)
    for (const m of [1, 12, 24, 36]) close(volume[m - 1], exposure * (annualRatio ** (m / 12) - 1))
    close(volume[41], volume[35] * 0.5)
    assert.equal(volume[47], 0)
    assert.equal(volume[95], 0)
  }
})
