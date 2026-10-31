import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { instruments } from '../../assets/instruments.js'
import { validateComparisonHistorySnapshot, MAX_COMPARISON_HISTORY_BYTES } from '../../assets/comparison-history-core.js'
import { collectComparisonHistory, compactComparisonQuote } from '../../scripts/data/collect-comparison-history.mjs'
import { aiSnapshotHandler } from '../../server/ai-snapshots.mjs'
const now=Date.parse('2024-01-10T12:00:00Z'), iso=new Date(now).toISOString()
const catalog=[{symbol:'A',name:'Company A',chains:[1]},{symbol:'B',name:'Company B',chains:[2]},{symbol:'OTHER',name:'Outside AI',chains:[]}]
const quote=(item=catalog[0],overrides={})=>({
  symbol:item.symbol,name:item.name,currency:'USD',timezone:'America/New_York',
  range:'3y',interval:'1d',source:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(item.symbol)+'/',
  fetchedAt:iso,status:'ok',bars:[{time:1704196800,close:10},{time:1704283200,close:12}],error:null,...overrides,
})
const snapshot=(quotes=[quote()],overrides={})=>({schemaVersion:1,range:'3y',interval:'1d',generatedAt:iso,source:'Yahoo Finance',quotes,...overrides})
const validate=data=>validateComparisonHistorySnapshot(data,{catalog,now})
const quiet={log(){},error(){}}
async function outputFile(t){
  const folder=await mkdtemp(join(tmpdir(),'ai-chain-comparison-'))
  t.after(async()=>{
    if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe temporary cleanup')
    await rm(folder,{recursive:true,force:true})
  })
  return {folder,output:join(folder,'comparison-history.json')}
}
test('comparison snapshot permits known partial coverage, never foreign or duplicate companies',()=>{
  const data=snapshot()
  assert.equal(validate(data),data)
  assert.deepEqual(validate(snapshot([])).quotes,[])
  assert.equal(MAX_COMPARISON_HISTORY_BYTES,4_000_000)
  assert.throws(()=>validate(snapshot([quote(),quote()])),/중복/)
  assert.throws(()=>validate(snapshot([quote(catalog[2])])),/알 수 없/)
  assert.throws(()=>validate(snapshot([quote(catalog[0],{name:'Wrong company'})])),/이름/)
})
test('comparison validator rejects weekly, invalid, future, unsorted and nonpublic observations',()=>{
  for(const update of [
    {interval:'1wk'},{range:'1y'},{timezone:'Wrong/Zone'},{currency:null},
    {bars:[{time:1704196800,close:0},{time:1704283200,close:12}]},
    {bars:[{time:1704283200,close:12},{time:1704196800,close:10}]},
    {bars:[{time:1704196800,close:10},{time:Math.floor(now/1000)+600,close:12}]},
    {bars:[{time:1704196800,close:10,open:9},{time:1704283200,close:12}]},
    {sourceUrl:'https://example.com/private'},{fetchedAt:'bad'},{account:'PRIVATE'},
  ])assert.throws(()=>validate(snapshot([quote(catalog[0],update)])))
  assert.throws(()=>validate(snapshot([],{interval:'1wk'})))
  assert.throws(()=>validate(snapshot([],{private:'PRIVATE'})))
  assert.throws(()=>validateComparisonHistorySnapshot(snapshot(),{catalog,now:NaN}))
})
test('failed and stale states cannot fabricate observations or freshness',()=>{
  const missing=quote(catalog[0],{status:'error',currency:null,timezone:null,fetchedAt:null,bars:[],error:'Unavailable'})
  assert.equal(validate(snapshot([missing])).quotes[0].bars.length,0)
  assert.throws(()=>validate(snapshot([{...missing,bars:quote().bars}])))
  assert.throws(()=>validate(snapshot([{...missing,fetchedAt:iso}])))
  assert.throws(()=>validate(snapshot([quote(catalog[0],{status:'stale',error:null})])))
  const stale=quote(catalog[0],{status:'stale',error:'Unavailable',fetchedAt:'2024-01-01T12:00:00Z'})
  assert.equal(validate(snapshot([stale])).quotes[0].fetchedAt,stale.fetchedAt)
})
test('compaction preserves exact closes and removes OHLCV and invalid or future bars',()=>{
  const result=compactComparisonQuote(catalog[0],quote(catalog[0],{bars:[
    {time:1704283200,close:12.123456789,open:11,volume:100},
    {time:1704196800,close:10},{time:1704196800,close:10.5},
    {time:1704000000,close:0},{time:1704100000,close:NaN},{time:Math.floor(now/1000)+60,close:99},
  ]}),now)
  assert.deepEqual(result.bars,[{time:1704196800,close:10.5},{time:1704283200,close:12.123456789}])
  assert.throws(()=>compactComparisonQuote(catalog[0],quote(catalog[1]),now),/종목/)
  assert.throws(()=>compactComparisonQuote(catalog[0],quote(catalog[0],{interval:'1wk'}),now),/일봉/)
})
test('collector requests only AI members and stores compact daily closes with bounded concurrency',async t=>{
  const {output}=await outputFile(t),calls=[]
  let active=0,maximum=0
  const data=await collectComparisonHistory(output,{catalog,now:()=>now,logger:quiet,concurrency:2,chartService:async(symbol,range)=>{
    calls.push([symbol,range]);active++;maximum=Math.max(maximum,active)
    await new Promise(resolve=>setTimeout(resolve,5));active--
    return quote(catalog.find(item=>item.symbol===symbol))
  }})
  assert.deepEqual(calls.sort(),[['A','3y'],['B','3y']]);assert.ok(maximum<=2)
  assert.deepEqual(data.quotes.map(item=>item.symbol),['A','B'])
  assert.ok(data.quotes.every(item=>item.status==='ok'&&Object.keys(item.bars[0]).join(',')==='time,close'))
  assert.deepEqual(JSON.parse(await readFile(output,'utf8')),data)
})
test('partial failures retain actual old quote times, not the new snapshot time',async t=>{
  const {output}=await outputFile(t),old=quote(catalog[1],{fetchedAt:'2024-01-02T12:00:00Z'})
  await writeFile(output,JSON.stringify(snapshot([old])))
  const data=await collectComparisonHistory(output,{catalog,now:()=>now,logger:quiet,chartService:async symbol=>{
    if(symbol==='B')throw new Error('Provider unavailable')
    return quote()
  }})
  const fallback=data.quotes.find(item=>item.symbol==='B')
  assert.equal(data.generatedAt,iso);assert.equal(fallback.fetchedAt,old.fetchedAt)
  assert.equal(fallback.status,'stale');assert.deepEqual(fallback.bars,old.bars)
  assert.match(fallback.error,/Provider unavailable/)
})
test('missing prior observations stay unavailable and one-year responses never become three years',async t=>{
  const {output}=await outputFile(t)
  const data=await collectComparisonHistory(output,{catalog,now:()=>now,logger:quiet,chartService:async symbol=>symbol==='A'?quote():quote(catalog[1],{range:'1y'})})
  const missing=data.quotes.find(item=>item.symbol==='B')
  assert.equal(missing.status,'error');assert.equal(missing.fetchedAt,null);assert.deepEqual(missing.bars,[])
  assert.match(missing.error,/3년 일봉/)
})
test('all failures and oversize responses preserve the old file byte for byte',async t=>{
  const {output,folder}=await outputFile(t),original=JSON.stringify(snapshot([quote(),quote(catalog[1])]))+'\n'
  await writeFile(output,original)
  await assert.rejects(collectComparisonHistory(output,{catalog,now:()=>now,logger:quiet,chartService:async()=>{throw new Error('Unavailable')}}),/전체/)
  assert.equal(await readFile(output,'utf8'),original)
  await assert.rejects(collectComparisonHistory(output,{catalog,now:()=>now,logger:quiet,maxBytes:100,chartService:async symbol=>quote(catalog.find(item=>item.symbol===symbol))}),/크기 제한/)
  assert.equal(await readFile(output,'utf8'),original);assert.deepEqual(await readdir(folder),['comparison-history.json'])
})
function responseRecorder(){return {headers:{},statusCode:0,body:undefined,setHeader(name,value){this.headers[name]=value},end(body){this.body=body}}}
test('comparison API serves validated public Pages data with GET, HEAD and method restrictions',async()=>{
  const data=snapshot([quote(instruments.find(item=>item.chains.length))]),urls=[]
  const handler=aiSnapshotHandler('comparison-history',{fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>data}}})
  const get=responseRecorder();await handler({method:'GET'},get)
  assert.equal(get.statusCode,200);assert.deepEqual(JSON.parse(get.body),data)
  assert.match(urls[0],/^https:\/\/khcho9642-sketch.github.io\/ai-chain-prototype\/data\/comparison-history.json\?t=\d+$/)
  assert.equal(get.headers['Cache-Control'],'public, max-age=0, s-maxage=300')
  const head=responseRecorder();await handler({method:'HEAD'},head)
  assert.equal(head.statusCode,200);assert.equal(head.body,undefined)
  const post=responseRecorder();await handler({method:'POST'},post)
  assert.equal(post.statusCode,405);assert.equal(post.headers.Allow,'GET, HEAD');assert.equal(urls.length,2)
  const broken=aiSnapshotHandler('comparison-history',{fetcher:async()=>({ok:true,json:async()=>({...data,interval:'1wk'})})})
  const error=responseRecorder();await broken({method:'GET'},error)
  assert.equal(error.statusCode,502);assert.equal(error.headers['Cache-Control'],'no-store')
  assert.ok(!error.body.includes('비교 일봉 스냅샷 오류'))
})
