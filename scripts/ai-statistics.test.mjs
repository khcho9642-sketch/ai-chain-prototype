import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildAiStatistics } from './build-ai-statistics.mjs'
import { validateAiStatistics } from '../assets/ai-statistics-core.js'
import { validateDisclosureSnapshot } from '../assets/ai-disclosure-core.js'
import { restoreAiSnapshots } from './restore-ai-snapshots.mjs'
import { aiSnapshotHandler } from '../server/ai-snapshots.mjs'

const root = new URL('../',import.meta.url)
const catalog = JSON.parse(await readFile(new URL('research/ai-statistics-2026-10-26.json',root),'utf8'))
const snapshot = buildAiStatistics(catalog)
const metric = id => snapshot.metrics.find(m => m.id === id)
const latest = id => {const m=metric(id);return m.observations[m.latestIndex]}

test('reviewed data is reproducible and counts definitions separately from company comparisons',async () => {
  const checkedIn=JSON.parse(await readFile(new URL('data/ai-statistics.json',root),'utf8'))
  assert.deepEqual(checkedIn,snapshot)
  assert.equal(snapshot.definitionCount,81)
  assert.equal(snapshot.metrics.length,88)
  assert.equal(snapshot.metrics.filter(m=>m.group==='industry').length,50)
  assert.equal(snapshot.metrics.filter(m=>m.definitionId==='ramp_paid_ai_adoption_by_provider').length,2)
  assert.equal(snapshot.gaps.length,11)
  assert.ok(snapshot.gaps.every(g=>g.value===null && g.reason))
  assert.ok(snapshot.metrics.every(m=>m.fullHistory===false && m.observations.every(o=>o.sourceUrl && o.period)))
})

test('original scale, qualifiers, company scope and source evidence survive normalization',() => {
  assert.equal(metric('openai_company_annualized_revenue').unit,'USD billion per year run rate')
  assert.equal(latest('openai_company_annualized_revenue').evidence,'reported')
  assert.equal(latest('openai_company_annualized_revenue').operator,'approx')
  assert.equal(metric('chatgpt_weekly_active_users').unit,'million weekly users')
  assert.equal(latest('openai_api_token_processing_rate').value,
    catalog.modelBusinessStatistics.modules.openai.metrics.find(m=>m.id==='openai_api_token_processing_rate').latestVerifiedObservation.value)
  assert.equal(latest('china_genai_users').operator,'gt')
  assert.equal(latest('asml_lithography_systems_sold').periodEnd,'2026-09-27')
  assert.equal(latest('ge_vernova_gas_equipment_reserved_capacity').periodEnd,'2026-06-30')
  assert.match(metric('anthropic_operating_loss_reported').unitLabel,/손실/)
  assert.equal(latest('japan_adult_genai_experience').evidence,'estimated')
  assert.equal(latest('japan_adult_genai_experience').period,'FY2025 survey')
  assert.equal(metric('japan_adult_genai_experience').region,'일본')
  assert.equal(metric('china_genai_users').region,'중국')
  assert.equal(latest('us_business_ai_use').period,'two weeks ending 2026-05-03')
  assert.match(metric('us_business_ai_use').notes.join(' '),/과거 확인값/)
  const ramp=metric('ramp_paid_ai_adoption_by_provider__anthropic')
  assert.equal(ramp.observations[ramp.latestIndex].sourceUrl,'https://ramp.com/data/ai-index')
  assert.equal(ramp.sources.length,2)
  const changed=structuredClone(catalog)
  changed.modelBusinessStatistics.modules.openai.metrics[0].latestVerifiedObservation.sourceType='unverified'
  assert.throws(()=>buildAiStatistics(changed),/미확인 출처/)
})

test('invalid values, source protocols, duplicate IDs and invented gap values fail validation',() => {
  for (const mutate of [
    s=>s.metrics[0].observations[0].value=NaN,
    s=>s.metrics[0].observations[0].sourceUrl='javascript:alert(1)',
    s=>s.metrics[0].observations[0].operator='gte',
    s=>s.metrics[1].id=s.metrics[0].id,
    s=>s.metrics[0].latestIndex=999,
    s=>s.definitionCount=88,
    s=>s.gaps[0].value=0,
  ]) {
    const copy=structuredClone(snapshot);mutate(copy)
    assert.throws(()=>validateAiStatistics(copy))
  }
})

test('restoration validates remote JSON and retains local data on HTML or network failure',async t => {
  const dir=await mkdtemp(join(tmpdir(),'ai-restore-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await mkdir(join(dir,'data'))
  const originals={}
  for (const name of ['ai-tokens.json','ai-disclosures.json']) {
    originals[name]=await readFile(new URL('data/'+name,root),'utf8')
    await writeFile(join(dir,'data',name),originals[name])
  }
  const bad=await restoreAiSnapshots({root:dir,fetcher:async()=>new Response('<html>oops</html>')})
  assert.ok(bad.every(r=>r.status==='kept'))
  for (const [name,text] of Object.entries(originals)) assert.equal(await readFile(join(dir,'data',name),'utf8'),text)
  const good=await restoreAiSnapshots({root:dir,fetcher:async url=>new Response(originals[new URL(url).pathname.split('/').at(-1)])})
  assert.ok(good.every(r=>r.status==='restored'))
  const network=await restoreAiSnapshots({root:dir,fetcher:async()=>{throw new Error('offline')}})
  assert.ok(network.every(r=>r.status==='kept'))
})

test('public snapshot proxy validates response, handles HEAD and rejects writes without calling upstream',async () => {
  let calls=0
  const handler=aiSnapshotHandler('ai-statistics',{fetcher:async()=>{calls++;return new Response(JSON.stringify(snapshot))}})
  const response=()=>({headers:{},statusCode:0,setHeader(k,v){this.headers[k]=v},end(v){this.body=v}})
  const get=response();await handler({method:'GET'},get)
  assert.equal(get.statusCode,200);assert.equal(JSON.parse(get.body).definitionCount,81)
  const head=response();await handler({method:'HEAD'},head);assert.equal(head.body,undefined)
  const post=response();await handler({method:'POST'},post);assert.equal(post.statusCode,405);assert.equal(calls,2)
  const bad=response()
  await aiSnapshotHandler('ai-statistics',{fetcher:async()=>new Response('{}')})({method:'GET'},bad)
  assert.equal(bad.statusCode,502)
  assert.throws(()=>aiSnapshotHandler('../private'))
})

test('public disclosure metadata only accepts official article hosts and review states',() => {
  const data={schemaVersion:1,collection:{method:'web-monitor',status:'ok',lastAttemptAt:'2026-10-26T00:00:00Z',lastSuccessAt:'2026-10-26T00:00:00Z'},
    sources:[],notes:[],candidates:[{id:'a',url:'https://www.anthropic.com/news/series-g',title:'Example',detectedAt:'2026-10-26T00:00:00Z',status:'needs-review',reason:'new'}]}
  assert.equal(validateDisclosureSnapshot(data),data)
  data.candidates[0].url='https://anthropic.com.evil.example/news/series-g'
  assert.throws(()=>validateDisclosureSnapshot(data))
})
