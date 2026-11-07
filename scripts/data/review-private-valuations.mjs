// Collection for a human editor. News leads are never imported as valuations.
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateValuations } from './collect-company-market.mjs'

const root=new URL('../../',import.meta.url)
const read=path=>readFile(new URL(path,root),'utf8').then(JSON.parse)
const [master,file]=await Promise.all([read('research/market/company-universe.json'),read('research/market/private-valuations.json')])
const confirmed=new Map(validateValuations(file,master.companies).map(item=>[item.companyId,item]))
const queue=master.companies.filter(company=>!company.listed)
const rows=[]
function textTag(xml,tag){
  return (xml.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>','i'))?.[1]||'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,'')
    .replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").slice(0,1200)
}
await Promise.all(Array.from({length:3},async()=>{
  while(queue.length){
    const company=queue.shift()
    const search=new URL('https://news.google.com/rss/search')
    search.search=new URLSearchParams({q:'"'+company.name+'" (funding OR valuation OR 투자유치 OR 기업가치) when:100d',
      hl:'en-US',gl:'US',ceid:'US:en'}).toString()
    const row={id:company.id,name:company.name,lastConfirmed:confirmed.get(company.id)||null,search:search.href,status:'ok',candidates:[]}
    try{
      const response=await fetch(search,{signal:AbortSignal.timeout(12000)})
      if(!response.ok)throw Error('HTTP '+response.status)
      const xml=await response.text()
      if(xml.length>2_000_000||!/<rss[\s>]/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unexpected RSS response')
      for(const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)){
        const title=textTag(match[1],'title'),link=textTag(match[1],'link'),date=textTag(match[1],'pubDate')
        if(title&&URL.canParse(link)&&new URL(link).protocol==='https:')row.candidates.push({title,link,date})
        if(row.candidates.length===5)break
      }
    }catch(e){row.status='unavailable';row.error=String(e.message).slice(0,160)}
    rows.push(row)
  }
}))
rows.sort((a,b)=>a.id.localeCompare(b.id))
const path=new URL('.local/private-valuation-review.json',root)
await mkdir(new URL('.',path),{recursive:true})
await writeFile(path,JSON.stringify({generatedAt:new Date().toISOString(),reviewedThrough:file.reviewedThrough,rows},null,2))
console.log('비상장 가치 검토 후보',rows.length,'개 기업 · 파일',fileURLToPath(path))
if(!rows.some(row=>row.status==='ok'))process.exitCode=1
