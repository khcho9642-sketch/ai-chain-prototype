import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTokenSnapshot } from '../../assets/token-core.js'
import { validateDisclosureSnapshot } from '../../assets/ai-disclosure-core.js'
import { validateCompanyDisclosures } from '../../assets/company-disclosures-core.js'
import { validateComparisonHistorySnapshot, MAX_COMPARISON_HISTORY_BYTES } from '../../assets/comparison-history-core.js'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const baseUrl = 'https://khcho9642-sketch.github.io/ai-chain-prototype/data/'
const definitions = [['ai-tokens.json', validateTokenSnapshot], ['ai-disclosures.json', validateDisclosureSnapshot], ['company-disclosures.json', validateCompanyDisclosures]]

// Restore only validated collector state; approved statistics remain versioned in Git.
export async function restoreAiSnapshots({root = projectRoot, fetcher = fetch, now = new Date(), includeComparison = false} = {}) {
  const selected = includeComparison ? [...definitions, ['comparison-history.json', validateComparisonHistorySnapshot]] : definitions
  return Promise.all(selected.map(async ([name, validate]) => {
    const output = join(root, 'data', name)
    let temp
    try {
      const response = await fetcher(baseUrl + name + '?t=' + now.getTime(), {signal:AbortSignal.timeout(15000), redirect:'error'})
      if (!response.ok) return {name, status:'kept', reason:'HTTP ' + response.status}
      const text = await response.text()
      const comparison = name === 'comparison-history.json'
      if (Buffer.byteLength(text) > (comparison ? MAX_COMPARISON_HISTORY_BYTES : 12 * 1024 * 1024)) throw new Error('응답 크기 제한')
      const data = validate(JSON.parse(text), {now})
      let local
      try { local = validate(JSON.parse(await readFile(output, 'utf8')), {now}) }
      catch (error) { if (!comparison) throw error }
      if (comparison && local) {
        const stamp = value => Date.parse(value || '') || 0
        const remoteTimes = new Map(data.quotes.map(quote => [quote.symbol, stamp(quote.fetchedAt)]))
        if (stamp(local.generatedAt) > stamp(data.generatedAt) || local.quotes.some(quote => stamp(quote.fetchedAt) > (remoteTimes.get(quote.symbol) || 0))) {
          return {name, status:'kept', reason:'newer local comparison history'}
        }
      }
      if (name === 'ai-tokens.json' && data.coverage.kind !== 'api-top50-plus-other' &&
          String(local.asOf || '') > String(data.asOf || '')) return {name, status:'kept', reason:'newer local snapshot'}
      if (!comparison && local.collection.lastSuccessAt && local.collection.lastSuccessAt > (data.collection.lastSuccessAt || '')) {
        return {name, status:'kept', reason:'newer local success'}
      }
      temp = output + '.restore.tmp'
      const serialized = JSON.stringify(data, null, comparison ? undefined : 2) + '\n'
      if (comparison && Buffer.byteLength(serialized) > MAX_COMPARISON_HISTORY_BYTES) throw new Error('응답 크기 제한')
      await writeFile(temp, serialized)
      await rename(temp, output)
      return {name, status:'restored'}
    } catch {
      if (temp) await rm(temp, {force:true})
      return {name, status:'kept', reason:'이전 배포 자료를 확인하지 못해 저장소 자료 유지'}
    }
  }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const item of await restoreAiSnapshots({includeComparison:process.argv.includes('--with-comparison')})) console.log(item.name + ': ' + item.status + (item.reason ? ' (' + item.reason + ')' : ''))
}
