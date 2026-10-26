import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTokenSnapshot } from '../assets/token-core.js'
import { validateDisclosureSnapshot } from '../assets/ai-disclosure-core.js'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const baseUrl = 'https://khcho9642-sketch.github.io/ai-chain-prototype/data/'
const definitions = [['ai-tokens.json', validateTokenSnapshot], ['ai-disclosures.json', validateDisclosureSnapshot]]

// Restore only validated collector state; approved statistics remain versioned in Git.
export async function restoreAiSnapshots({root = projectRoot, fetcher = fetch, now = new Date()} = {}) {
  return Promise.all(definitions.map(async ([name, validate]) => {
    const output = join(root, 'data', name)
    let temp
    try {
      const response = await fetcher(baseUrl + name + '?t=' + now.getTime(), {signal:AbortSignal.timeout(15000), redirect:'error'})
      if (!response.ok) return {name, status:'kept', reason:'HTTP ' + response.status}
      const text = await response.text()
      if (Buffer.byteLength(text) > 12 * 1024 * 1024) throw new Error('응답 크기 제한')
      const data = validate(JSON.parse(text), {now})
      const local = validate(JSON.parse(await readFile(output, 'utf8')), {now})
      if (name === 'ai-tokens.json' && data.coverage.kind !== 'api-top50-plus-other' &&
          String(local.asOf || '') > String(data.asOf || '')) return {name, status:'kept', reason:'newer local snapshot'}
      if (local.collection.lastSuccessAt && local.collection.lastSuccessAt > (data.collection.lastSuccessAt || '')) {
        return {name, status:'kept', reason:'newer local success'}
      }
      temp = output + '.restore.tmp'
      await writeFile(temp, JSON.stringify(data, null, 2) + '\n')
      await rename(temp, output)
      return {name, status:'restored'}
    } catch {
      if (temp) await rm(temp, {force:true})
      return {name, status:'kept', reason:'이전 배포 자료를 확인하지 못해 저장소 자료 유지'}
    }
  }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const item of await restoreAiSnapshots()) console.log(item.name + ': ' + item.status + (item.reason ? ' (' + item.reason + ')' : ''))
}
