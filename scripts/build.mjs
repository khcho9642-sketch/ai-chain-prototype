import { copyFile, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateIndustry } from '../assets/industry-core.js'
import { validateAiStatistics } from '../assets/ai-statistics-core.js'
import { validateTokenSnapshot } from '../assets/token-core.js'
import { validateDisclosureSnapshot } from '../assets/ai-disclosure-core.js'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const publicSnapshotFiles = ['market.json','industry.json','ai-statistics.json','ai-tokens.json','ai-disclosures.json']
export async function build(root = projectRoot) {
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
  const assets = (await readdir(join(source, 'assets'), { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(?:js|css)$/.test(entry.name))
  await rm(output, { recursive: true, force: true })
  await mkdir(join(output, 'assets'), { recursive: true })
  await mkdir(join(output, 'data'), { recursive: true })
  await copyFile(join(source, 'index.html'), join(output, 'index.html'))
  await Promise.all(assets.map(entry => copyFile(join(source, 'assets', entry.name), join(output, 'assets', entry.name))))
  await Promise.all(publicSnapshotFiles.map(name=>copyFile(join(source,'data',name),join(output,'data',name))))
  return output
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then(output => console.log(`정적 사이트 빌드 완료: ${output}`)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
