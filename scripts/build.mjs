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

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const publicSnapshotFiles = ['market.json','industry.json','ai-statistics.json','ai-tokens.json','ai-disclosures.json','company-disclosures.json','today-picks.json']
export async function build(root = projectRoot, { communityOrigin = process.env.COMMUNITY_API_ORIGIN || '' } = {}) {
  // Only a public endpoint is emitted. Secrets never enter the browser build.
  if (communityOrigin) communityOrigin = resolveCommunityOrigin(communityOrigin, '')
  const source = resolve(root)
  const output = resolve(source, 'dist')
  // Only the generated dist folder directly inside this project can be replaced.
  if (dirname(output) !== source || output === source) throw new Error('안전하지 않은 빌드 출력 경로입니다.')
  try { if ((await lstat(output)).isSymbolicLink()) throw new Error('dist 심볼릭 링크에는 빌드할 수 없습니다.') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const data = JSON.parse(await readFile(join(source, 'data', 'market.json'), 'utf8'))
  if (!Array.isArray(data.quotes)) throw new Error('시세 스냅샷 형식이 올바르지 않습니다.')
  validateIndustry(JSON.parse(await readFile(join(source, 'data', 'industry.json'), 'utf8')))
  validateAiStatistics(JSON.parse(await readFile(join(source, 'data', 'ai-statistics.json'), 'utf8')))
  validateTokenSnapshot(JSON.parse(await readFile(join(source, 'data', 'ai-tokens.json'), 'utf8')))
  validateDisclosureSnapshot(JSON.parse(await readFile(join(source, 'data', 'ai-disclosures.json'), 'utf8')))
  validateCompanyDisclosures(JSON.parse(await readFile(join(source, 'data', 'company-disclosures.json'), 'utf8')))
  validateTodaySnapshot(JSON.parse(await readFile(join(source, 'data', 'today-picks.json'), 'utf8')))
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
  await Promise.all(assets.map(entry => copyFile(join(source, 'assets', entry.name), join(output, 'assets', entry.name))))
  await Promise.all(publicSnapshotFiles.map(name=>copyFile(join(source,'data',name),join(output,'data',name))))
  if (assets.some(entry => entry.name === 'community.js')) await writeFile(join(output, 'assets', 'community-runtime.js'), `export const communityApiOrigin = ${JSON.stringify(communityOrigin)}\n`)
  return output
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then(output => console.log(`정적 사이트 빌드 완료: ${output}`)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
