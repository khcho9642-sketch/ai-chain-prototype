import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fetchCompanySeries } from './company-market-series.mjs'
import { buildCompanyMarket } from './company-market-table.mjs'
import { validateCompanyMarket } from '../../assets/company-market-data.js'
import { catalog } from '../../assets/company-catalog.js'
import { MARKET_DATA_POLICY } from '../../assets/market-data-policy.js'

const root=fileURLToPath(new URL('../../',import.meta.url))
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'))
const output=join(root,'data/company-market.json')
const publicSnapshot='https://khcho9642-sketch.github.io/ai-chain-prototype/data/company-market.json'

async function saveSnapshot(snapshot){
  const temp=output+'.'+process.pid+'.tmp'
  try{await writeFile(temp,JSON.stringify(snapshot)+'\n',{flag:'wx'});await rename(temp,output)}
  finally{await rm(temp,{force:true})}
}

export function validateValuations(file,companies){
  const ids=new Set(companies.filter(c=>!c.listed).map(c=>c.id))
  const seen=new Set()
  if(!/^\d{4}-\d{2}-\d{2}$/.test(file.reviewedThrough)||!Array.isArray(file.observations))throw Error('비상장 가치 검토 정보 오류')
  for(const v of file.observations){
    if(!ids.has(v.companyId)||seen.has(v.companyId)||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||v.date>file.reviewedThrough||
      !/^[A-Z]{3}$/.test(v.currency)||!Number.isFinite(v.value)||v.value<=0||!v.kind||
      !URL.canParse(v.url)||new URL(v.url).protocol!=='https:'||v.qualifier&&!['above'].includes(v.qualifier))throw Error('비상장 가치 관측 오류 '+v.companyId)
    seen.add(v.companyId)
  }
  return file.observations
}

export async function collectCompanyMarket({marketFile=join(root,'data/market.json'),seriesDir,restore=false,logger=console,collectionEnabled=MARKET_DATA_POLICY.collectionEnabled}={}){
  if(!collectionEnabled && !seriesDir){
    logger.log?.(MARKET_DATA_POLICY.statusLabel)
    return {status:'paused',paused:true,output}
  }
  const [market,privateFile]=await Promise.all([readJSON(marketFile),
    readJSON(join(root,'research/market/private-valuations.json'))])
  // Project into the published directory, whose issuer reconciliation is distinct
  // from the wider raw collection master (for example Tesla replaces xAI's proxy).
  const companies=catalog.companies
  const valuations=validateValuations(privateFile,companies)
  let previous
  try{previous=validateCompanyMarket(await readJSON(output))}catch(e){if(e.code!=='ENOENT')throw e}
  if(restore && collectionEnabled){
    try{
      const response=await fetch(publicSnapshot,{signal:AbortSignal.timeout(15000)})
      if(response.ok){
        const remote=validateCompanyMarket(await response.json())
        if(!previous||remote.asOf>previous.asOf||remote.asOf===previous.asOf&&remote.generatedAt>previous.generatedAt)previous=remote
      }
    }catch{logger.warn('이전 배포 조회 실패 · 번들 기준 사용')}
  }
  const mapped=new Map(),ids=new Set(companies.map(c=>c.id))
  for(const quote of market.quotes){
    if(ids.has(quote.companyId)&&(!mapped.has(quote.companyId)||quote.primaryForCompany))mapped.set(quote.companyId,quote)
  }
  if(![...mapped.values()].some(q=>q.priceBasis==='previous-completed-session'&&q.closeDate)){
    if(!previous)throw Error('확정 종가 또는 이전 성공본이 필요합니다.')
    logger.warn('확정 종가 갱신 실패. 기업 비교표의 최근 성공본을 유지합니다.',previous.asOf)
    await saveSnapshot(previous)
    return previous
  }
  const queue=[...mapped],seriesById=new Map()
  await Promise.all(Array.from({length:4},async()=>{
    while(queue.length){
      const [id,quote]=queue.shift()
      try{
        const data=seriesDir?await readJSON(join(seriesDir,id+'.json')):await fetchCompanySeries(quote.symbol)
        if(data.ticker===quote.symbol)seriesById.set(id,data)
      }catch(error){logger.warn(id,quote.symbol,'재무·시총 확인 실패',error.message)}
    }
  }))
  let snapshot=validateCompanyMarket(buildCompanyMarket({market,companies,seriesById,valuations,previous}))
  if(previous&&(previous.asOf>snapshot.asOf||previous.asOf===snapshot.asOf&&previous.priceSnapshotAt>snapshot.priceSnapshotAt)){
    logger.warn('원본 시세가 이전 성공 파일보다 오래되어 최신 성공본을 유지합니다.')
    snapshot=previous
  }
  await saveSnapshot(snapshot)
  logger.log('기업 시세',snapshot.asOf,snapshot.coverage,'시계열 응답',seriesById.size)
  return snapshot
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{'market-file':{type:'string'},'series-dir':{type:'string'},restore:{type:'boolean'},'allow-network':{type:'boolean'}}})
  collectCompanyMarket({marketFile:values['market-file'],seriesDir:values['series-dir'],restore:values.restore,
    ...(values['allow-network']?{collectionEnabled:true}:{})})
    .catch(e=>{console.error(e.message);process.exitCode=1})
}
