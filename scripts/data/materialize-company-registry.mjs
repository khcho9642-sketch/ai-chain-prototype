import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { registryRows } from '../../assets/company-registry-rows.js'
import { buildCompanyAdditions } from './company-additions.mjs'
import { applySectorReclassifications } from './sector-reclassifications.mjs'

const registryPath = new URL('../../assets/company-registry-rows.js', import.meta.url)

export async function materializeCompanyRegistry() {
  const [master, additions, reclassifications] = await Promise.all([
    readFile(new URL('../../research/market/company-universe.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../research/market/company-additions.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../research/market/sector-reclassifications.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const extra = buildCompanyAdditions({master, additions})
  const extraIds = new Set(extra.registryRows.map(row => row.id))
  const rows = applySectorReclassifications([
    ...registryRows.filter(row => !extraIds.has(row.id)),
    ...extra.registryRows,
  ], reclassifications).sort((a, b) => a.id.localeCompare(b.id))
  const source = '// Generated from the original company worksheet, verified listing map and separately approved user additions.\nexport const registryRows = [\n'
    + rows.map(row => '  ' + JSON.stringify(row)).join(',\n') + '\n]\n'
  await writeFile(registryPath, source)
  return rows
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  materializeCompanyRegistry().then(rows => console.log('신기업정보 원장: ' + rows.length + '개사'))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
