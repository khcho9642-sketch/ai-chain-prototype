import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRippleSnapshot } from '../../assets/ripple-core.js'

export async function buildRippleFile({ input = 'data/market.json', output = 'data/ripple.json', companies, now = Date.now(), maxBytes = 500_000, logger = console, allowUnavailable = false } = {}) {
  const snapshot = JSON.parse(await readFile(input, 'utf8'))
  const data = buildRippleSnapshot({ marketSnapshot: snapshot, companies, now })
  if (data.status === 'unavailable' && !allowUnavailable) throw new Error('확정 종가 자료가 없어 이전 파급 파일을 보존합니다.')
  const body = JSON.stringify(data) + '\n'
  if (Buffer.byteLength(body) > maxBytes) throw new Error('파급 파일 크기 제한 초과. 이전 파일을 보존합니다.')
  await mkdir(dirname(resolve(output)), { recursive: true })
  const temporary = output + '.tmp'
  try { await writeFile(temporary, body); await rename(temporary, output) }
  finally { await rm(temporary, { force: true }) }
  logger.log?.(`ripple: ${data.triggers.length} triggers; ${data.coverage.usableCompanies}/${data.coverage.targetCompanies} companies with completed daily history`)
  return data
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), paths = args.filter(arg => !arg.startsWith('--'))
  if (args.some(arg => arg.startsWith('--') && arg !== '--allow-unavailable') || paths.length > 2) {
    console.error('사용법: node scripts/data/build-ripple.mjs [market.json] [ripple.json] [--allow-unavailable]')
    process.exitCode = 1
  } else buildRippleFile({ input: paths[0] || 'data/market.json', output: paths[1] || 'data/ripple.json', allowUnavailable: args.includes('--allow-unavailable') }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
