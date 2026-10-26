import {validateIndustry} from '../assets/industry-core.js'
export default async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options','nosniff')
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');res.statusCode=405;return res.end(JSON.stringify({error:'GET 또는 HEAD 요청만 지원합니다.'}))}
  try{
    const response=await fetch('https://khcho9642-sketch.github.io/ai-chain-prototype/data/industry.json?t='+Math.floor(Date.now()/60000),{signal:AbortSignal.timeout(15000)})
    if(!response.ok)throw new Error('산업통계 HTTP '+response.status)
    const body=validateIndustry(await response.json())
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=300');res.statusCode=200;res.end(req.method==='HEAD'?undefined:JSON.stringify(body))
  }catch(error){console.error('industry-snapshot:',error.message);res.statusCode=502;res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({error:'최신 산업통계를 읽지 못했습니다.'}))}
}
