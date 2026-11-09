import { realtimeEnabled } from '../assets/site-runtime.js'
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCommunityOrigin } from '../assets/community-ui-core.js'
import { validateIndustry } from '../assets/industry-core.js'
import { validateAiStatistics } from '../assets/ai-statistics-core.js'
import { validateTokenSnapshot } from '../assets/token-core.js'
import { validateDisclosureSnapshot } from '../assets/ai-disclosure-core.js'
import { validateCompanyDisclosures } from '../assets/company-disclosures-core.js'
import { validateTodaySnapshot } from '../assets/today-core.js'
import { validateTodayDiscussion, TODAY_DISCUSSION_MAX_BYTES } from '../assets/today-discussion-core.js'
import { verifyTodayDiscussionHashes } from './community/today-discussion.mjs'
import { validateTodayPersonas, TODAY_PERSONAS_MAX_BYTES } from '../assets/today-persona-core.js'
import { verifyTodayPersonaHashes } from './community/today-persona.mjs'
import { validateComparisonHistorySnapshot, MAX_COMPARISON_HISTORY_BYTES } from '../assets/comparison-history-core.js'
import { buildRippleSnapshot, validateRippleSnapshot, rippleMatchesSelection } from '../assets/ripple-core.js'
import { buildDebatePublication } from './deployment/debate-publication.mjs'
import { buildMarketDisplaySnapshot } from './data/market-display.mjs'

import { validateEpochSnapshot } from '../assets/epoch-ai-core.js'
import { validateCompanyMarket } from '../assets/company-market-data.js'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const publicSnapshotFiles = ['market.json','market-display.json','industry.json','ai-statistics.json','ai-tokens.json','ai-disclosures.json','company-disclosures.json','company-market.json','today-picks.json','today-discussion.json','today-personas.json','comparison-history.json','epoch-ai.json','ripple.json']

// A derived feed is only meaningful for the exact market snapshot in this build.
// Older collectors and isolated fixtures may have no ripple file; derive it from
// their local source without fetching prices or modifying the source directory.
export async function resolveBuildRippleSnapshot(root, marketSnapshot, { now = Date.now() } = {}) {
  const expectedSource = marketSnapshot?.generatedAt ?? null
  try {
    const value = validateRippleSnapshot(JSON.parse(await readFile(join(root, 'data', 'ripple.json'), 'utf8')))
    if (value.sourceSnapshotGeneratedAt === expectedSource && rippleMatchesSelection(value)) return value
  } catch {}
  return validateRippleSnapshot(buildRippleSnapshot({ marketSnapshot, now }))
}

export async function build(root = projectRoot, { communityOrigin = process.env.COMMUNITY_API_ORIGIN || '' } = {}) {
  // Only a public endpoint is emitted. Secrets never enter the browser build.
  if (communityOrigin) communityOrigin = resolveCommunityOrigin(communityOrigin, '')
  if (!realtimeEnabled) communityOrigin = ''
  const source = resolve(root)
  const output = resolve(source, 'dist')
  // Only the generated dist folder directly inside this project can be replaced.
  if (dirname(output) !== source || output === source) throw new Error('안전하지 않은 빌드 출력 경로입니다.')
  try { if ((await lstat(output)).isSymbolicLink()) throw new Error('dist 심볼릭 링크에는 빌드할 수 없습니다.') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const data = JSON.parse(await readFile(join(source, 'data', 'market.json'), 'utf8'))
  if (!Array.isArray(data.quotes)) throw new Error('시세 스냅샷 형식이 올바르지 않습니다.')
  const displayData = buildMarketDisplaySnapshot(data)
  const ripple = await resolveBuildRippleSnapshot(source, data)
  validateCompanyMarket(JSON.parse(await readFile(join(source,'data','company-market.json'),'utf8')))
  validateEpochSnapshot(JSON.parse(await readFile(join(source, 'data', 'epoch-ai.json'), 'utf8')))
  validateIndustry(JSON.parse(await readFile(join(source, 'data', 'industry.json'), 'utf8')))
  validateAiStatistics(JSON.parse(await readFile(join(source, 'data', 'ai-statistics.json'), 'utf8')))
  validateTokenSnapshot(JSON.parse(await readFile(join(source, 'data', 'ai-tokens.json'), 'utf8')))
  validateDisclosureSnapshot(JSON.parse(await readFile(join(source, 'data', 'ai-disclosures.json'), 'utf8')))
  validateCompanyDisclosures(JSON.parse(await readFile(join(source, 'data', 'company-disclosures.json'), 'utf8')))
  const today = JSON.parse(await readFile(join(source, 'data', 'today-picks.json'), 'utf8'))
  validateTodaySnapshot(today)
  const discussionText = await readFile(join(source, 'data', 'today-discussion.json'), 'utf8')
  if (Buffer.byteLength(discussionText) > TODAY_DISCUSSION_MAX_BYTES) throw new Error('AI 교차 의견 크기 제한 초과')
  const discussion = validateTodayDiscussion(JSON.parse(discussionText), { today })
  verifyTodayDiscussionHashes(discussion, { today })
  const personasText = await readFile(join(source, 'data', 'today-personas.json'), 'utf8')
  if (Buffer.byteLength(personasText) > TODAY_PERSONAS_MAX_BYTES) throw new Error('AI 분석 표현 크기 제한 초과')
  const personas = validateTodayPersonas(JSON.parse(personasText), { today })
  verifyTodayPersonaHashes(personas, { today })
  const comparisonText = await readFile(join(source, 'data', 'comparison-history.json'), 'utf8')
  if (Buffer.byteLength(comparisonText) > MAX_COMPARISON_HISTORY_BYTES) throw new Error('비교 이력 크기 제한 초과')
  validateComparisonHistorySnapshot(JSON.parse(comparisonText))
  const assets = (await readdir(join(source, 'assets'), { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(?:js|css)$/.test(entry.name))
  await rm(output, { recursive: true, force: true })
  await mkdir(join(output, 'assets'), { recursive: true })
  await mkdir(join(output, 'data'), { recursive: true })
  let html = await readFile(join(source, 'index.html'), 'utf8')
  // Leave the original design source intact; the built site uses the shared discussion module.
  if (assets.some(entry => entry.name === 'community.js') && !html.includes('src="./assets/community.js"')) {
    html = html.replace('</head>', '<link rel="stylesheet" href="./assets/community.css">\n</head>')
      .replace('</body>', '<script type="module" src="./assets/community.js"></script>\n</body>')
  }
  await writeFile(join(output, 'index.html'), html)
  await writeFile(join(output, '404.html'), '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="robots" content="noindex"><title>404</title><main><h1>페이지를 찾을 수 없습니다</h1></main></html>\n')
  // Only authentication runs on Pages Functions; saved pages/assets stay static.
  await writeFile(join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/auth/*'], exclude: [] }) + '\n')
  await writeFile(join(output, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n\n/data/*\n  Cache-Control: public, max-age=60, must-revalidate\n')
  await Promise.all(assets.map(entry => copyFile(join(source, 'assets', entry.name), join(output, 'assets', entry.name))))
  await Promise.all(publicSnapshotFiles.filter(name => !['ripple.json', 'market-display.json'].includes(name)).map(name=>copyFile(join(source,'data',name),join(output,'data',name))))
  await writeFile(join(output, 'data', 'market-display.json'), JSON.stringify(displayData) + '\n')
  await writeFile(join(output, 'data', 'ripple.json'), JSON.stringify(ripple) + '\n')
  await buildDebatePublication(source, output)
  if (assets.some(entry => entry.name === 'community.js')) await writeFile(join(output, 'assets', 'community-runtime.js'), `export const communityApiOrigin = ${JSON.stringify(communityOrigin)}\n`)
  return output
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then(output => console.log(`정적 사이트 빌드 완료: ${output}`)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
