import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build, projectRoot } from '../build.mjs'
import { instruments } from '../../assets/instruments.js'
import { restoreAiSnapshots } from './restore-ai-snapshots.mjs'

// Keep the API deployment aligned with the independently refreshed public snapshot.
const response=await fetch('https://khcho9642-sketch.github.io/ai-chain-prototype/data/market.json?t='+Date.now(),{signal:AbortSignal.timeout(30000)})
if(!response.ok)throw new Error(`배포용 시세 스냅샷 HTTP ${response.status}`)
const snapshot=await response.json()
if(snapshot.schemaVersion!==1 || !Array.isArray(snapshot.quotes) || !instruments.every(item=>snapshot.quotes.some(q=>q.symbol===item.symbol)))throw new Error('배포용 스냅샷의 통합 종목이 누락되었습니다.')
await mkdir(join(projectRoot,'data'),{recursive:true})
await writeFile(join(projectRoot,'data','market.json'),JSON.stringify(snapshot)+'\n')
console.log('시세 스냅샷 준비:',snapshot.quotes.length)
const industryResponse=await fetch('https://khcho9642-sketch.github.io/ai-chain-prototype/data/industry.json?t='+Date.now(),{signal:AbortSignal.timeout(30000)})
if(!industryResponse.ok)throw new Error('배포용 산업통계 HTTP '+industryResponse.status)
const industry=await industryResponse.json()
await writeFile(join(projectRoot,'data','industry.json'),JSON.stringify(industry)+'\n')
await restoreAiSnapshots()
await build()
