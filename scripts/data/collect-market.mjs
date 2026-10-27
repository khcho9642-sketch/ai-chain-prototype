import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instruments } from '../../assets/instruments.js'
import { chart } from '../../server/market.mjs'
export { instruments }

export async function collect(output = 'data/market.json') {
  let previous = {}
  try { previous = JSON.parse(await readFile(output, 'utf8')) } catch {}
  const queue = [...instruments], quotes = []
  await Promise.all(Array.from({length:3}, async () => {
    while (queue.length) {
      const item = queue.shift()
      const old = previous.quotes?.find(q => q.symbol === item.symbol && Number.isFinite(q.price))
      try {
        const yearly = await chart(item.symbol, '1y')
        const histories = {}, historyErrors = {}
        for (const range of ['1d','5d','5y']) {
          try { histories[range] = (await chart(item.symbol,range)).bars }
          catch(error) { histories[range] = old?.histories?.[range] || []; historyErrors[range] = error.message }
        }
        quotes.push({...item,...yearly,name:item.name,histories,historyErrors,status:'ok',error:null})
      } catch(error) {
        quotes.push({...(old || {}),...item,status:old?'stale':'error',error:error.message})
        console.error(item.symbol,error.message)
      }
    }
  }))
  quotes.sort((a,b) => instruments.findIndex(i=>i.symbol===a.symbol)-instruments.findIndex(i=>i.symbol===b.symbol))
  const data = {schemaVersion:1,generatedAt:new Date().toISOString(),source:'Yahoo Finance',mode:'scheduled-snapshot',refreshMinutes:30,quotes}
  await mkdir(dirname(resolve(output)),{recursive:true})
  await writeFile(output+'.tmp',JSON.stringify(data)+'\n')
  await rename(output+'.tmp',output)
  const ok=quotes.filter(q=>q.status==='ok').length
  const failures=quotes.reduce((n,q)=>n+Object.keys(q.historyErrors||{}).length,0)
  console.log(`market snapshot: ${ok}/${quotes.length} successful; ${failures} history range errors`)
  if(!ok)throw new Error('전체 시세 수집 실패. 이전 시세는 기준시각과 실패 상태로 유지합니다.')
  return data
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))collect().catch(error=>{console.error(error);process.exitCode=1})
