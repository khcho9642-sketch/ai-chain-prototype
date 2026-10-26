import {readFile,writeFile,rename,mkdir} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {collectOfficialTrade} from './official-trade.mjs'
import {collectTsmc} from './collect-tsmc.mjs'
import {validateIndustry} from '../assets/industry-core.js'
export async function collectIndustry(output='data/industry.json'){
  const previous=validateIndustry(JSON.parse(await readFile(output,'utf8')))
  const now=new Date(),attemptedAt=now.toISOString()
  if(!process.argv.includes('--force')&&previous.attemptedAt?.slice(0,10)===attemptedAt.slice(0,10)){console.log('산업통계: 오늘 확인한 자료 유지 (하루 한 번 갱신)');return previous}
  const trade=await collectOfficialTrade(previous,{now})
  const oldRevenue=previous.series.find(s=>s.id==='tsmc-revenue'),revenue=await collectTsmc(oldRevenue,{now})
  const ids=new Set(trade.series.map(s=>s.id))
  const series=previous.series.filter(s=>!ids.has(s.id)&&s.id!=='tsmc-revenue')
  series.push(...trade.series.map(s=>({...s,checkedAt:s.fetchedAt||s.checkedAt,error:s.refreshError||s.error})),revenue)
  const order=new Map(previous.series.map((s,i)=>[s.id,i]));series.sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999))
  const sources=new Map(previous.sources.map(s=>[s.id,s]))
  for(const source of trade.sources)sources.set(source.id,source)
  const data=validateIndustry({...previous,generatedAt:attemptedAt,attemptedAt,sources:[...sources.values()],series,gaps:[...(previous.gaps||[]).filter(g=>!g.id?.startsWith('ecos-')&&g.id!=='customs-hs-weight'),...trade.gaps.map(g=>({...g,name:g.name||'한국은행 통계 갱신',reason:g.reason||g.message}))]})
  await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output+'.tmp',JSON.stringify(data)+'\n');await rename(output+'.tmp',output)
  console.log(`산업통계 ${data.series.length}개 · ${data.series.reduce((n,s)=>n+s.points.length,0)}개 월별 관측치 · 갱신 실패 ${data.series.filter(s=>s.error).length}개`)
  return data
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))collectIndustry().catch(error=>{console.error(error.message);process.exitCode=1})
