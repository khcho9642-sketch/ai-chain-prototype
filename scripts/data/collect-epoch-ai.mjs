import {readFile,writeFile,rename,mkdir} from 'node:fs/promises'
import {resolve,dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {EPOCH_DATASETS,emptyEpochSnapshot,validateEpochSnapshot,validEpochDate} from '../../assets/epoch-ai-core.js'
const root=fileURLToPath(new URL('../../',import.meta.url))
export function parseCsv(text){
  text=text.replace(/^\uFEFF/,'')
  const rows=[];let row=[],field='',quoted=false,closed=false
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
    if(c==='"'){if(field||closed)throw new Error('CSV 따옴표 오류');quoted=true}
    else if(c===','){row.push(field);field='';closed=false}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field='';closed=false}
    else {if(closed)throw new Error('CSV 필드 종료 오류');field+=c}
  }
  if(quoted)throw new Error('CSV 미완료 따옴표')
  if(field||row.length){row.push(field);rows.push(row)}
  const headers=rows.shift()
  if(!headers?.length||new Set(headers).size!==headers.length)throw new Error('CSV 헤더 오류')
  return {headers,rows:rows.map(row=>{if(row.length!==headers.length)throw new Error('CSV 열 개수 오류');return Object.fromEntries(headers.map((h,i)=>[h,row[i]]))})}
}
export function normalizeEpochCsv(definition,text){
  const parsed=parseCsv(text)
  for(const c of definition.columns)if(!parsed.headers.includes(c.source))throw new Error('필수 열 없음: '+c.source)
  if(!parsed.rows.length||parsed.rows.length>10000)throw new Error('CSV 행 수 오류')
  const rows=parsed.rows.map((source,index)=>{
    const row={id:definition.id+':'+(index+1)}
    for(const c of definition.columns){
      const v=source[c.source].trim()
      if(c.type==='boolean'){
        if(!v||/^(false|0|no|unchecked)$/i.test(v))row[c.key]=false
        else if(/^(true|1|yes|checked|x)$/i.test(v))row[c.key]=true
        else throw new Error('미완료 여부 형식 오류')
      }else if(!v||(c.type!=='text'&&/^(unknown|n\/a|na|none|nan|null|-)$/i.test(v)))row[c.key]=null
      else if(c.type==='number'){
        if(!/^[+]?\d+(?:\.\d*)?(?:e[+-]?\d+)?$/i.test(v))throw new Error('수치 형식 오류: '+c.source)
        const n=Number(v)
        if(!Number.isFinite(n)||n<0)throw new Error('수치 형식 오류: '+c.source)
        row[c.key]=n
      }else if(c.type==='date'){
        if(!validEpochDate(v))throw new Error('날짜 형식 오류: '+c.source)
        row[c.key]=v
      }else row[c.key]=v
    }
    row.id=definition.id+':'+createHash('sha256').update([row.name,row.organization,row.date,row.startDate,row.endDate].join('|')).digest('hex').slice(0,20)
    return row
  })
  return {rows,rawRowCount:parsed.rows.length,sha256:createHash('sha256').update(text).digest('hex')}
}
async function readCsvResponse(response){
  if(!response.ok)throw new Error('원자료 HTTP '+response.status)
  if(Number(response.headers?.get?.('content-length')||0)>20_000_000)throw new Error('원자료 크기 제한')
  if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>20_000_000)throw new Error('원자료 크기 제한');return text}
  const reader=response.body.getReader(),chunks=[];let size=0
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20_000_000){await reader.cancel();throw new Error('원자료 크기 제한')}chunks.push(Buffer.from(value))}
  return Buffer.concat(chunks).toString('utf8')
}
export async function collectEpochAi(previous=emptyEpochSnapshot(),{now=new Date(),fetcher=fetch,force=false,onSource=null}={}){
  validateEpochSnapshot(previous)
  const at=now.toISOString()
  if(!force&&previous.collection.lastAttemptAt?.slice(0,10)===at.slice(0,10))return previous
  const datasets=await Promise.all(EPOCH_DATASETS.map(async definition=>{
    const old=previous.datasets.find(d=>d.id===definition.id)
    try{
      const response=await fetcher(definition.downloadUrl,{signal:AbortSignal.timeout(45000),redirect:'error',headers:{'Accept':'text/csv','User-Agent':'AI-CHAIN Epoch public data collector'}})
      const text=await readCsvResponse(response)
      const {rows,rawRowCount,sha256}=normalizeEpochCsv(definition,text)
      const dataset={id:definition.id,status:'ok',lastAttemptAt:at,lastSuccessAt:at,error:null,rawRowCount,rows}
      const test={...emptyEpochSnapshot(),datasets:previous.datasets.map(d=>d.id===dataset.id?dataset:d)}
      validateEpochSnapshot(test)
      if(onSource)await onSource({definition,text,sha256,collectedAt:at,rowCount:rows.length,headers:parseCsv(text).headers})
      return dataset
    }catch(error){
      return {...old,status:'error',lastAttemptAt:at,error:'수집 또는 형식 검증 실패: '+String(error.message).slice(0,220)}
    }
  }))
  const success=datasets.filter(d=>d.status==='ok').length
  return validateEpochSnapshot({...previous,generatedAt:at,datasets,collection:{status:success===datasets.length?'ok':success?'partial':'error',lastAttemptAt:at,
    lastSuccessAt:success===datasets.length?at:previous.collection.lastSuccessAt,
    message:success+' / '+datasets.length+'개 데이터셋 수집 성공. 실패한 데이터셋은 이전 성공 자료를 유지합니다.'}})
}
export async function collectEpochFile({output=join(root,'data/epoch-ai.json'),now=new Date(),fetcher=fetch,force=false,evidence=true}={}){
  let previous=emptyEpochSnapshot()
  try{previous=validateEpochSnapshot(JSON.parse(await readFile(output,'utf8')))}catch(error){if(error.code!=='ENOENT')throw error}
  const evidenceDir=join(root,'research','epoch-ai',now.toISOString().slice(0,10))
  const onSource=evidence?async({definition,text,sha256,collectedAt,rowCount,headers})=>{
    await mkdir(evidenceDir,{recursive:true})
    await writeFile(join(evidenceDir,definition.id+'.csv'),text)
    await writeFile(join(evidenceDir,definition.id+'.source.json'),JSON.stringify({url:definition.downloadUrl,page:definition.sourceUrl,license:'CC BY 4.0',collectedAt,rowCount,sha256,headers},null,2)+'\n')
  }:null
  const result=await collectEpochAi(previous,{now,fetcher,force,onSource})
  if(result!==previous){
    await mkdir(dirname(output),{recursive:true})
    await writeFile(output+'.tmp',JSON.stringify(result)+'\n')
    await rename(output+'.tmp',output)
  }
  console.log('Epoch AI: '+result.collection.status+' · '+result.datasets.map(d=>d.id+' '+d.rows.length+'행 ('+d.status+')').join(' · '))
  return result
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  collectEpochFile({force:process.argv.includes('--force'),evidence:!process.argv.includes('--no-evidence')}).then(result=>{if(['partial','error'].includes(result.collection.status))process.exitCode=1}).catch(error=>{console.error(error.message);process.exitCode=1})
}
