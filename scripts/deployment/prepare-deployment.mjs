import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, projectRoot } from '../build.mjs'
import { instruments } from '../../assets/instruments.js'
import { restoreAiSnapshots } from './restore-ai-snapshots.mjs'
import { buildRippleFile } from '../data/build-ripple.mjs'

const source = 'https://khcho9642-sketch.github.io/ai-chain-prototype/data/'

export async function prepareDeployment({
  root = projectRoot, fetcher = fetch, buildSite = build, restoreSnapshots = restoreAiSnapshots,
  now = Date.now, logger = console,
} = {}) {
  // Keep the API deployment aligned with the independently refreshed snapshot.
  const response = await fetcher(source + 'market.json?t=' + now(), { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`배포용 시세 스냅샷 HTTP ${response.status}`)
  const snapshot = await response.json()
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.quotes)
    || !instruments.every(item => snapshot.quotes.some(quote => quote.symbol === item.symbol))) {
    throw new Error('배포용 스냅샷의 통합 종목이 누락되었습니다.')
  }
  await mkdir(join(root, 'data'), { recursive: true })
  await writeFile(join(root, 'data', 'market.json'), JSON.stringify(snapshot) + '\n')
  logger.log?.('시세 스냅샷 준비:', snapshot.quotes.length)
  // Derive from the downloaded file, not a second remote feed that may belong to
  // another collector run. An unavailable result stays explicit and date-aligned.
  await buildRippleFile({ input: join(root, 'data', 'market.json'), output: join(root, 'data', 'ripple.json'), allowUnavailable: true, now: now(), logger })

  const industryResponse = await fetcher(source + 'industry.json?t=' + now(), { signal: AbortSignal.timeout(30000) })
  if (!industryResponse.ok) throw new Error('배포용 산업통계 HTTP ' + industryResponse.status)
  const industry = await industryResponse.json()
  await writeFile(join(root, 'data', 'industry.json'), JSON.stringify(industry) + '\n')
  await restoreSnapshots({ root, fetcher, includeComparison: true })
  return buildSite(root)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDeployment().catch(error => { console.error(error.message); process.exitCode = 1 })
}
