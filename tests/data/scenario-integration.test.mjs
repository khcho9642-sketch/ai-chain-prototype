import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from '../../scripts/build.mjs'
import { createSiteServer } from '../../scripts/serve.mjs'
import { createEmptyCompanyDisclosures } from '../../assets/company-disclosures-core.js'
import { emptyEpochSnapshot } from '../../assets/epoch-ai-core.js'
import { companyMarketFixture } from '../helpers/company-market-fixture.mjs'
import {
  BIG7_COMPANY_IDS,
  COMPANIES,
  MODEL_ASSUMPTIONS,
  SCENARIO_DEFINITIONS,
  SEGMENTS,
} from '../../assets/scenario-data.js'
import {
  buildDefaultScenarioRequest,
  evaluateScenario,
  validateScenarioRequest,
} from '../../assets/scenario-core.js'
import {
  REPRESENTATIVE_COMPANY_IDS,
  VIEW_MODEL_GRADE,
  buildScenarioView,
} from '../../assets/scenario-view-model.js'

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const scenarioAssets = ['scenario-core.js', 'scenario-data.js', 'scenario-actuals.js', 'scenario-financial-baselines.js', 'scenario-rate-fits.js', 'scenario-view-model.js', 'scenario-drag.js', 'scenario-explorer.js', 'scenario-format.js', 'scenario-profit-check.js', 'scenario.css', 'scenario.js']
const segmentNames = [
  '반도체 소부장', '파운드리·패키징', '메모리', 'AI 칩', 'AI 장비',
  '전력·냉각', '데이터센터', '클라우드·GPU 컴퓨팅', 'AI 모델',
]
const scenarioIds = ['interest_rate', 'hyperscaler_capex', 'hbm_market', 'gpu_dc_rent', 'model_growth']
const big7Symbols = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']
const representativeIds = ['ASML', 'TSM', '000660.KS', 'NVDA', 'SMCI', 'VRT', 'EQIX', 'MSFT', 'META']

async function fixtureRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-chain-scenario-integration-'))
  t.after(async () => {
    const target = resolve(root), parent = resolve(tmpdir())
    if (!target.startsWith(parent + sep)) throw new Error('Unsafe temporary cleanup path')
    await rm(target, { recursive: true, force: true })
  })
  await Promise.all([
    mkdir(join(root, 'assets'), { recursive: true }),
    mkdir(join(root, 'data'), { recursive: true }),
    mkdir(join(root, 'design'), { recursive: true }),
  ])
  await copyFile(join(sourceRoot, 'index.html'), join(root, 'index.html'))
  await Promise.all(scenarioAssets.map(name => copyFile(join(sourceRoot, 'assets', name), join(root, 'assets', name))))
  await writeFile(join(root, 'assets', 'private.txt'), 'PRIVATE')
  await writeFile(join(root, 'data', 'private-research.json'), 'PRIVATE')
  await writeFile(join(root, 'design', 'notes.md'), 'PRIVATE')
  await writeFile(join(root, '.env'), 'PRIVATE')

  const snapshots = {
    'company-market.json': companyMarketFixture(),
    'market.json': { quotes: [] },
    'industry.json': { schemaVersion: 1, sources: [], series: [] },
    'epoch-ai.json': emptyEpochSnapshot(),
    'ai-statistics.json': { schemaVersion: 1, asOf: '2026-11-05', definitionCount: 0, metrics: [], gaps: [] },
    'ai-tokens.json': {
      schemaVersion: 1,
      source: { name: 'OpenRouter', url: 'https://openrouter.ai/rankings', license: 'CC BY 4.0' },
      timezone: 'UTC',
      coverage: { kind: 'reviewed-top-model-snapshot', completePublicTotal: false, publicOnly: true },
      collection: { method: 'api', status: 'not-connected', lastAttemptAt: null, lastSuccessAt: null },
      rows: [],
    },
    'ai-disclosures.json': {
      schemaVersion: 1,
      collection: { method: 'web-monitor', status: 'not-run', lastAttemptAt: null, lastSuccessAt: null },
      sources: [], candidates: [], notes: [],
    },
    'company-disclosures.json': createEmptyCompanyDisclosures({ now: new Date('2026-11-05T00:00:00Z') }),
    'comparison-history.json': {
      schemaVersion: 1, range: '3y', interval: '1d', generatedAt: '2024-01-01T00:00:00Z', source: 'Yahoo Finance', quotes: [],
    },
    'today-discussion.json': { schemaVersion: 1, publishedAt: null, responses: [], states: [] },
    'today-personas.json': { schemaVersion: 1, publishedAt: null, rewrites: [] },
    'today-picks.json': {
      schemaVersion: 1, timezone: 'Asia/Seoul', editionDate: null, publishedAt: null, picks: [],
      providerStates: Object.fromEntries(['gpt', 'claude', 'gemini'].map(agent => [agent, { status: 'disabled', reason: 'verification_pending' }])),
    },
  }
  await Promise.all(Object.entries(snapshots).map(([name, value]) => writeFile(join(root, 'data', name), JSON.stringify(value))))
  return root
}

test('scenario contract keeps five cases, nine named segments and the complete Big 7', () => {
  assert.deepEqual(SCENARIO_DEFINITIONS.map(item => item.id), scenarioIds)
  assert.deepEqual(SEGMENTS.map(item => item.name), segmentNames)
  assert.deepEqual(BIG7_COMPANY_IDS, big7Symbols)
  assert.equal(new Set(BIG7_COMPANY_IDS).size, 7)
  assert.deepEqual(BIG7_COMPANY_IDS.map(id => COMPANIES.find(company => (company.companyId ?? company.id) === id)?.symbol), big7Symbols)
  assert.equal(MODEL_ASSUMPTIONS.aggregation.big7, 'equal-weighted normalized company indices; not market-cap weighted')

  for (const scenarioId of scenarioIds) {
    const request = buildDefaultScenarioRequest(scenarioId)
    assert.equal(Object.hasOwn(request, 'durationMonths'), false)
    assert.throws(() => validateScenarioRequest({ ...request, durationMonths: 12 }), /지원하지 않는 요청 필드.*durationMonths/u)
    assert.deepEqual(validateScenarioRequest(structuredClone(request)), request)
    const output = evaluateScenario(request)
    assert.equal(output.segments.length, 9)
    assert.equal(output.companies.length, COMPANIES.length)
    assert.deepEqual(output.big7.members.map(member => member.companyId), BIG7_COMPANY_IDS)
    assert.equal(output.big7.members.length, 7)
    for (const company of output.companies) {
      if (company.valuation.baselineEnterpriseValueUnits <= 0) {
        assert.equal(company.scenarioValueIndex, null)
        assert.equal(company.valuation.comparisonStatus, 'nonpositive-baseline')
      } else {
        assert.ok(Number.isFinite(company.scenarioValueIndex))
      }
    }
    assert.equal(output.companies.filter(company => company.financialBasis.status === 'actual').length, 38)
    assert.equal(output.companies.filter(company => company.financialBasis.status === 'illustrative').length, 3)
    assert.ok(output.segments.every(segment => Number.isFinite(segment.scenarioValueIndex)))
    const view = buildScenarioView(output)
    assert.equal(VIEW_MODEL_GRADE, 'C')
    assert.deepEqual(REPRESENTATIVE_COMPANY_IDS, representativeIds)
    assert.deepEqual(view.representativeRows.map(company => company.companyId), representativeIds)
    assert.deepEqual(view.big7Rows.map(company => company.companyId), BIG7_COMPANY_IDS)
    assert.equal(view.otherRows.length, 28)
    assert.equal(new Set([...view.representativeRows, ...view.big7Rows, ...view.otherRows].map(company => company.companyId)).size, COMPANIES.length)
  }
})

test('scenario engine and browser module do not call external source endpoints', async () => {
  for (const name of scenarioAssets.filter(asset => asset.endsWith('.js'))) {
    const source = await readFile(join(sourceRoot, 'assets', name), 'utf8')
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/u, `${name} must remain a local deterministic consumer`)
  }
})

test('static build publishes the scenario chapter without widening the public file boundary', async t => {
  const root = await fixtureRoot(t)
  const output = await build(root)
  assert.deepEqual((await readdir(join(output, 'assets'))).sort(), [...scenarioAssets].sort())
  assert.deepEqual((await readdir(join(output, 'data'))).sort(), [
    'ai-disclosures.json', 'ai-statistics.json', 'ai-tokens.json', 'company-disclosures.json','company-market.json',
    'comparison-history.json', 'epoch-ai.json', 'industry.json', 'market-display.json', 'market.json', 'ripple.json', 'today-discussion.json', 'today-personas.json', 'today-picks.json',
  ])

  const server = createSiteServer({ root: output, liveApi: true })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())))
  const origin = `http://127.0.0.1:${server.address().port}`

  for (const name of scenarioAssets) {
    const response = await fetch(`${origin}/assets/${name}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', name.endsWith('.css') ? /^text\/css/u : /^text\/javascript/u)
  }
  assert.deepEqual(await (await fetch(`${origin}/data/today-personas.json`)).json(), { schemaVersion: 1, publishedAt: null, rewrites: [] })
  const deepLink = await fetch(`${origin}/#scenario`)
  assert.equal(deepLink.status, 200)
  const html = await deepLink.text()
  assert.match(html, /href="#scenario"[^>]*data-r="scenario"/u)
  assert.match(html, /id="v-scenario"/u)
  assert.match(html, /src="\.\/assets\/scenario\.js"/u)
  assert.match(html, /href="\.\/assets\/scenario\.css"/u)
  assert.equal((html.match(/data-r="today"[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)?오늘의 변화<\/a>/gu) || []).length, 3)
  assert.match(html, />가정 기반 조건부 계산값이며 목표주가·예측이 아님<\/p>/u)
  for (const route of ['today', 'map', 'data', 'compare', 'industry', 'talk', 'ai']) {
    assert.match(html, new RegExp(`(?:href="#${route}"|id="v-${route}")`, 'u'))
  }
  assert.equal((html.match(/data-r="industry"/gu) || []).length, 3)
  assert.equal((html.match(/data-r="ai-stats"/gu) || []).length, 0)
  assert.doesNotMatch(html, /id="v-ai-stats"/u)
  assert.match(html, /if\(h\[0\]===['"]ai-stats['"]\)/u)
  assert.match(html, /history\.replaceState\(null,'','#'\+h\.join\('\/'\)\)/u)
  const industryModule = await readFile(join(sourceRoot, 'assets', 'industry.js'), 'utf8')
  assert.match(industryModule, /import \{ SECTORS \} from ['"]\.\/home-map-core\.js['"]/u)
  assert.match(industryModule, /renderAiStatisticsPanel\(content/u)
  assert.match(industryModule, /월별 산업통계/u)
  assert.match(industryModule, /AI 통계/u)
  assert.match(industryModule, /Epoch AI/u)
  assert.equal((await fetch(`${origin}/api/snapshot`)).status, 200)
  for (const path of ['/assets/private.txt', '/data/private-research.json', '/design/notes.md', '/.env']) {
    assert.equal((await fetch(origin + path)).status, 404)
  }
})
