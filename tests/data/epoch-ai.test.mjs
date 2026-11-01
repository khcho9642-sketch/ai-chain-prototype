import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { EPOCH_DATASETS, EPOCH_SOURCE, MAX_EPOCH_BYTES, emptyEpochSnapshot, validateEpochSnapshot, validEpochDate, epochDatasetCsv } from '../../assets/epoch-ai-core.js'
import { parseCsv, normalizeEpochCsv, collectEpochAi } from '../../scripts/data/collect-epoch-ai.mjs'
import { restoreAiSnapshots } from '../../scripts/deployment/restore-ai-snapshots.mjs'

const BEFORE = '2026-10-30T02:00:00.000Z'
const NOW = '2026-11-01T02:00:00.000Z'
const examples = {
  models: { name:'Model Alpha', organization:'Example Lab', date:'2026-09-30', parameters:1.25e9, trainingCompute:2.4e25, trainingCost:null, confidence:'Unknown', country:'South Korea' },
  hardware: { name:'Example GPU', organization:'Example Silicon', date:'2026-09-30', type:'GPU', fp8:1.75e16, memory:288e9, tdp:700, price:null },
  'data-centers': { name:'Example Campus', organization:'Example Cloud #confident', country:'United States', users:'Example Lab #confident', h100:12500.5, power:40, capitalCost:1.25, chips:'H100,H200' },
  'chip-sales': { name:'Q3 2026 - Example GPU', organization:'Example Silicon', chip:'Example GPU', startDate:'2026-07-01', endDate:'2026-09-30', incomplete:false, units:100, unitsLow:80, unitsHigh:120, h100:150, cost:2000000 }
}
const definition = id => EPOCH_DATASETS.find(d => d.id === id)
const dataset = (snapshot,id) => snapshot.datasets.find(d => d.id === id)
const quote = value => '"'+String(value??'').replaceAll('"','""')+'"'
function csvFor(id, overrides=[{}], { omit=[], extra={} }={}) {
  const def = definition(id)
  const columns = def.columns.filter(c => !omit.includes(c.source))
  const headers = [...columns.map(c => c.source), ...Object.keys(extra)]
  return [headers, ...overrides.map(change => {
    const row = {...examples[id],...change}
    return [...columns.map(c => row[c.key]), ...Object.values(extra)]
  })].map(row => row.map(quote).join(',')).join('\r\n')
}
function goodSnapshot(at=BEFORE) {
  const result = emptyEpochSnapshot()
  result.generatedAt = at
  result.collection = { status:'ok',lastAttemptAt:at,lastSuccessAt:at,message:'fixture' }
  result.datasets = EPOCH_DATASETS.map(d => ({ id:d.id,status:'ok',lastAttemptAt:at,lastSuccessAt:at,error:null,rawRowCount:1,rows:[{id:d.id+':fixture',...examples[d.id]}] }))
  return result
}
function fixtureFetcher(replacements={}) {
  return async (url,options) => {
    const def = EPOCH_DATASETS.find(d => d.downloadUrl === url)
    assert.ok(def,'collector only requests an explicitly registered Epoch source')
    assert.equal(options.redirect,'error')
    assert.ok(options.signal instanceof AbortSignal)
    return Object.hasOwn(replacements,def.id) ? replacements[def.id]() : new Response(csvFor(def.id),{headers:{'content-type':'text/csv'}})
  }
}

// Source CSV must retain quoted separators, multiline evidence and missing cells.
test('Epoch CSV parser handles BOM, CRLF, quoted commas, escaped quotes and multiline fields', () => {
  const result = parseCsv('\uFEFFname,notes,value\r\n"GPU, A","line one\r\nline ""two""",1.25e+9\r\nB,,\r\n\r\n')
  assert.deepEqual(result.headers,['name','notes','value'])
  assert.deepEqual(result.rows,[{name:'GPU, A',notes:'line one\r\nline "two"',value:'1.25e+9'},{name:'B',notes:'',value:''}])
})

test('malformed CSV cannot shift columns or hide a duplicate header', () => {
  for (const text of ['', 'a,a\n1,2', 'a,b\n1', 'a,b\n1,2,3', 'a\n"unfinished', 'a\nno"quote', 'a\n"closed"tail']) {
    assert.throws(() => parseCsv(text),undefined,JSON.stringify(text))
  }
})

test('normalization preserves exponent values, zero, missing numbers and literal Unknown confidence', () => {
  const text = '\uFEFF'+csvFor('models',[{name:'Model, "Alpha"',organization:'Lab\nDivision',parameters:'1.25e+9',trainingCompute:'2.4E25',trainingCost:'',confidence:'Unknown'},
    {name:'Model Zero',parameters:'0',trainingCompute:'N/A',trainingCost:'Unknown',confidence:'Speculative'}],{extra:{'Private source notes':'unpublished bookkeeping'}})
  const normalized = normalizeEpochCsv(definition('models'),text)
  assert.equal(normalized.rawRowCount,2)
  assert.equal(normalized.rows[0].name,'Model, "Alpha"')
  assert.equal(normalized.rows[0].organization,'Lab\nDivision')
  assert.equal(normalized.rows[0].parameters,1.25e9)
  assert.equal(normalized.rows[0].trainingCompute,2.4e25)
  assert.equal(normalized.rows[0].trainingCost,null)
  assert.equal(normalized.rows[0].confidence,'Unknown')
  assert.equal(normalized.rows[1].parameters,0)
  assert.equal(normalized.rows[1].trainingCompute,null)
  assert.equal(normalized.rows[1].trainingCost,null)
  assert.equal(normalized.rows[1].confidence,'Speculative')
  assert.equal(JSON.stringify(normalized.rows).includes('unpublished bookkeeping'),false)
  assert.equal(normalized.sha256,createHash('sha256').update(text).digest('hex'))
})

test('malformed numbers are rejected rather than silently converted into different quantities', () => {
  for (const value of ['1,2','1,000,2','0x10','Infinity','-1','1e999','~100','<100','10-20','100 units']) {
    assert.throws(() => normalizeEpochCsv(definition('models'),csvFor('models',[{trainingCompute:value}])),undefined,value)
  }
})

test('Epoch dates reject calendar rollover and preserve valid source precision', () => {
  for (const date of ['2026','2026-10','2024-02-29','2026-09-30']) assert.equal(validEpochDate(date),true,date)
  for (const date of ['2026-02-29','2026-04-31','2026-13-01','2026-00-10','2026-10-00','2026-1-01','not-a-date',null]) assert.equal(validEpochDate(date),false,String(date))
  assert.throws(() => normalizeEpochCsv(definition('models'),csvFor('models',[{date:'2026-02-29'}])))
})

test('source incomplete flags remain explicit booleans and unknown flag formats fail', () => {
  const flags = ['', 'True','False','true','0']
  const rows = normalizeEpochCsv(definition('chip-sales'),csvFor('chip-sales',flags.map((flag,i) => ({name:'period '+i,incomplete:flag})))).rows
  assert.deepEqual(rows.map(row => row.incomplete),[false,true,false,true,false])
  assert.throws(() => normalizeEpochCsv(definition('chip-sales'),csvFor('chip-sales',[{incomplete:'maybe'}])))
})

test('required source columns, nonempty data and bounded row counts are enforced', () => {
  for (const def of EPOCH_DATASETS) {
    assert.throws(() => normalizeEpochCsv(def,csvFor(def.id,[{}],{omit:[def.columns.at(-1).source]})),/필수 열/)
    assert.throws(() => normalizeEpochCsv(def,csvFor(def.id,[])),/행 수/)
  }
  assert.throws(() => normalizeEpochCsv(definition('models'),csvFor('models',Array.from({length:10001},(_,i) => ({name:'model '+i})))),/행 수/)
})

test('normalized row identifiers survive source row reordering', () => {
  const first = {name:'Alpha',organization:'Lab A',date:'2026-01-01'}
  const second = {name:'Beta',organization:'Lab B',date:'2026-02-01'}
  const a = normalizeEpochCsv(definition('models'),csvFor('models',[first,second])).rows
  const b = normalizeEpochCsv(definition('models'),csvFor('models',[second,first])).rows
  assert.equal(a[0].id,b[1].id)
  assert.equal(a[1].id,b[0].id)
  assert.notEqual(a[0].id,a[1].id)
})

test('stored live Epoch snapshot is populated, attributed and valid for all four datasets', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../../data/epoch-ai.json',import.meta.url),'utf8'))
  assert.equal(validateEpochSnapshot(snapshot),snapshot)
  assert.equal(snapshot.source.licenseUrl,'https://creativecommons.org/licenses/by/4.0/')
  assert.equal(snapshot.source.attribution,EPOCH_SOURCE.attribution)
  assert.deepEqual(new Set(snapshot.datasets.map(d => d.id)),new Set(EPOCH_DATASETS.map(d => d.id)))
  for (const source of snapshot.datasets) {
    assert.ok(source.rows.length>0,source.id+' has collected data')
    assert.equal(source.rawRowCount,source.rows.length)
    assert.ok(source.lastSuccessAt,source.id+' keeps its actual success time')
  }
  assert.ok(dataset(snapshot,'models').rows.some(row => row.trainingCompute === null))
  assert.ok(dataset(snapshot,'chip-sales').rows.some(row => row.incomplete === true))
})

test('snapshot validator rejects invalid types, unknown public fields and inconsistent identifiers', () => {
  const invalid = [
    s => {dataset(s,'models').rows[0].trainingCompute='2.4e25'},
    s => {dataset(s,'models').rows[0].trainingCompute=NaN},
    s => {dataset(s,'models').rows[0].trainingCompute=Infinity},
    s => {dataset(s,'models').rows[0].parameters=-1},
    s => {dataset(s,'models').rows[0].confidence=3},
    s => {dataset(s,'models').rows[0].date='2026-02-29'},
    s => {dataset(s,'models').rows[0].name=''},
    s => {dataset(s,'models').rows[0].id=''},
    s => {delete dataset(s,'models').rows[0].country},
    s => {dataset(s,'models').rows[0].privateNotes='not public'},
    s => {dataset(s,'models').rows[0].organization='x'.repeat(4001)},
    s => {dataset(s,'chip-sales').rows[0].incomplete='True'},
    s => {dataset(s,'chip-sales').rows[0].endDate='2026-06-30'},
    s => {dataset(s,'chip-sales').rows[0].unitsLow=121},
    s => {const d=dataset(s,'hardware');d.rows.push({...d.rows[0]});d.rawRowCount++},
    s => {s.datasets[1]=structuredClone(s.datasets[0])},
    s => {dataset(s,'models').rawRowCount++},
    s => {dataset(s,'models').lastSuccessAt=null},
    s => {dataset(s,'models').status='error'},
    s => {s.generatedAt='invalid'},
    s => {s.source.licenseUrl='https://example.com/no-license'}
  ]
  assert.doesNotThrow(() => validateEpochSnapshot(emptyEpochSnapshot()))
  for (const change of invalid) {
    const snapshot=goodSnapshot();change(snapshot)
    assert.throws(() => validateEpochSnapshot(snapshot))
  }
})

test('public snapshot byte limit prevents unexpectedly large browser downloads', () => {
  const snapshot=goodSnapshot()
  const target=dataset(snapshot,'models')
  target.rows=Array.from({length:1000},(_,i) => ({...examples.models,id:'size:'+i,name:'M'.repeat(3900)}))
  target.rawRowCount=target.rows.length
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot))>MAX_EPOCH_BYTES)
  assert.throws(() => validateEpochSnapshot(snapshot),/크기 제한/)
})

test('successful collection refreshes all four sources and retains evidence hashes', async () => {
  const evidence=[]
  const previous=emptyEpochSnapshot()
  const copy=structuredClone(previous)
  const result=await collectEpochAi(previous,{now:new Date(NOW),fetcher:fixtureFetcher(),onSource:async source => evidence.push(source)})
  assert.equal(result.collection.status,'ok')
  assert.equal(result.collection.lastSuccessAt,NOW)
  assert.equal(result.generatedAt,NOW)
  assert.equal(evidence.length,4)
  assert.deepEqual(previous,copy)
  for (const d of result.datasets) {
    assert.equal(d.status,'ok');assert.equal(d.lastAttemptAt,NOW);assert.equal(d.lastSuccessAt,NOW)
    const item=evidence.find(e => e.definition.id===d.id)
    assert.equal(item.rowCount,d.rows.length)
    assert.equal(item.sha256,createHash('sha256').update(item.text).digest('hex'))
  }
})

test('each failed source retains its own values and success time while other datasets refresh', async () => {
  for (const failed of EPOCH_DATASETS) {
    const previous=goodSnapshot(),copy=structuredClone(previous)
    const result=await collectEpochAi(previous,{now:new Date(NOW),fetcher:fixtureFetcher({[failed.id]:() => {throw new Error('temporary offline')}})})
    assert.equal(result.collection.status,'partial')
    assert.equal(result.collection.lastSuccessAt,BEFORE)
    assert.equal(result.collection.lastAttemptAt,NOW)
    assert.deepEqual(previous,copy)
    for (const d of result.datasets) {
      if (d.id===failed.id) {
        assert.equal(d.status,'error');assert.equal(d.lastAttemptAt,NOW);assert.equal(d.lastSuccessAt,BEFORE)
        assert.deepEqual(d.rows,dataset(previous,d.id).rows)
        assert.match(d.error,/temporary offline/)
      } else {assert.equal(d.status,'ok');assert.equal(d.lastSuccessAt,NOW)}
    }
  }
})

test('total source outage retains the last good snapshot values without pretending a new success', async () => {
  const previous=goodSnapshot()
  const result=await collectEpochAi(previous,{now:new Date(NOW),fetcher:async () => {throw new Error('offline')}})
  assert.equal(result.collection.status,'error')
  assert.equal(result.collection.lastSuccessAt,BEFORE)
  for (const d of result.datasets) {
    assert.equal(d.status,'error');assert.equal(d.lastSuccessAt,BEFORE)
    assert.deepEqual(d.rows,dataset(previous,d.id).rows)
  }
  const empty=await collectEpochAi(emptyEpochSnapshot(),{now:new Date(NOW),fetcher:async () => new Response('unavailable',{status:503})})
  assert.equal(empty.collection.lastSuccessAt,null)
  assert.ok(empty.datasets.every(d => d.rows.length===0 && d.lastSuccessAt===null))
})

test('HTTP errors, missing columns and duplicate source rows cannot replace prior good data', async () => {
  const failures=[
    () => new Response('unavailable',{status:503}),
    () => new Response(csvFor('models',[{}],{omit:['Training compute (FLOP)']})),
    () => new Response(csvFor('models',[{},{}])),
    () => new Response(csvFor('models',[{trainingCompute:'1,2'}])),
    () => new Response('<html>upstream error</html>')
  ]
  for (const failed of failures) {
    const previous=goodSnapshot()
    const result=await collectEpochAi(previous,{now:new Date(NOW),fetcher:fixtureFetcher({models:failed})})
    assert.equal(dataset(result,'models').status,'error')
    assert.equal(dataset(result,'models').lastSuccessAt,BEFORE)
    assert.deepEqual(dataset(result,'models').rows,dataset(previous,'models').rows)
  }
})

test('oversized advertised or streamed CSV is rejected and the stream is cancelled', async () => {
  let bodyRead=false,cancelled=false
  const responses=[
    {ok:true,headers:new Headers({'content-length':'20000001'}),text:async () => {bodyRead=true;return csvFor('models')}},
    {ok:true,headers:new Headers(),body:{getReader:() => ({read:async () => ({done:false,value:new Uint8Array(20000001)}),cancel:async () => {cancelled=true}})}}
  ]
  for (const response of responses) {
    const previous=goodSnapshot()
    const result=await collectEpochAi(previous,{now:new Date(NOW),fetcher:fixtureFetcher({models:() => response})})
    assert.equal(dataset(result,'models').status,'error')
    assert.match(dataset(result,'models').error,/크기 제한/)
    assert.deepEqual(dataset(result,'models').rows,dataset(previous,'models').rows)
  }
  assert.equal(bodyRead,false)
  assert.equal(cancelled,true)
})

test('daily throttle avoids repeat source requests and force explicitly bypasses it', async () => {
  const previous=goodSnapshot(NOW)
  let calls=0
  const fetcher=async (...args) => {calls++;return fixtureFetcher()(...args)}
  assert.equal(await collectEpochAi(previous,{now:new Date('2026-11-01T20:00:00.000Z'),fetcher}),previous)
  assert.equal(calls,0)
  const forced=await collectEpochAi(previous,{now:new Date('2026-11-01T20:00:00.000Z'),fetcher,force:true})
  assert.equal(calls,4)
  assert.equal(forced.collection.lastSuccessAt,'2026-11-01T20:00:00.000Z')
  await collectEpochAi(previous,{now:new Date('2026-11-02T02:00:00.000Z'),fetcher})
  assert.equal(calls,8)
})

test('evidence recording failure is not reported as a successful data refresh', async () => {
  const previous=goodSnapshot()
  const result=await collectEpochAi(previous,{now:new Date(NOW),fetcher:fixtureFetcher(),onSource:async ({definition:def}) => {if(def.id==='hardware')throw new Error('evidence unavailable')}})
  assert.equal(result.collection.status,'partial')
  assert.equal(dataset(result,'hardware').lastSuccessAt,BEFORE)
  assert.deepEqual(dataset(result,'hardware').rows,dataset(previous,'hardware').rows)
})

test('download CSV round-trips text and neutralizes spreadsheet formulas while retaining provenance', () => {
  const target=dataset(goodSnapshot(),'models')
  const values=['=1+1','+SUM(A1:A2)','-1+2','@SUM(A1:A2)','\t=1+1','\r=1+1','ordinary, "quoted"\nline']
  target.rows=values.map((name,i) => ({...examples.models,id:'export:'+i,name}))
  target.rawRowCount=target.rows.length
  const csv=epochDatasetCsv(target)
  assert.equal(csv.charCodeAt(0),0xfeff)
  const result=parseCsv(csv)
  assert.deepEqual(result.rows.map(row => row['모델']),values.map((value,i) => i<6 ? "'"+value:value))
  for (const row of result.rows) {
    assert.equal(row['출처'],definition('models').sourceUrl)
    assert.equal(row['라이선스'],EPOCH_SOURCE.licenseUrl)
    assert.equal(row['마지막 수집 성공'],BEFORE)
    assert.equal(row['학습 비용 추정 (2023 USD)'],'')
  }
})

test('deployment restore preserves newer local dataset successes even when remote overall success is equal or newer', async t => {
  const root = await mkdtemp(join(tmpdir(),'epoch-restore-'))
  const resolved = resolve(root)
  assert.ok(resolved.startsWith(resolve(tmpdir())+sep))
  t.after(() => rm(resolved,{recursive:true,force:true}))
  await mkdir(join(root,'data'))
  const file = join(root,'data','epoch-ai.json')
  const local = goodSnapshot()
  local.generatedAt=NOW
  local.collection={status:'partial',lastAttemptAt:NOW,lastSuccessAt:BEFORE,message:'models refreshed; other sources unavailable'}
  for (const d of local.datasets) {d.status='error';d.lastAttemptAt=NOW;d.error='offline'}
  Object.assign(dataset(local,'models'),{status:'ok',lastSuccessAt:NOW,error:null})
  dataset(local,'models').rows[0].trainingCompute=9.9e25
  validateEpochSnapshot(local)
  const original=JSON.stringify(local)+'\n'
  const remoteAttempt='2026-11-02T02:00:00.000Z'
  for (const remoteSuccess of [BEFORE,'2026-10-31T02:00:00.000Z']) {
    const remote=goodSnapshot(remoteSuccess)
    remote.generatedAt=remoteAttempt
    remote.collection={status:'partial',lastAttemptAt:remoteAttempt,lastSuccessAt:remoteSuccess,message:'hardware refreshed; other sources unavailable'}
    for (const d of remote.datasets) {d.status='error';d.lastAttemptAt=remoteAttempt;d.error='offline'}
    Object.assign(dataset(remote,'hardware'),{status:'ok',lastSuccessAt:remoteAttempt,error:null})
    validateEpochSnapshot(remote)
    assert.ok(remote.collection.lastAttemptAt>local.collection.lastAttemptAt)
    assert.ok(remote.collection.lastSuccessAt>=local.collection.lastSuccessAt)
    assert.ok(dataset(local,'models').lastSuccessAt>dataset(remote,'models').lastSuccessAt)
    await writeFile(file,original)
    const results=await restoreAiSnapshots({root,now:new Date(remoteAttempt),fetcher:async url =>
      new URL(url).pathname.endsWith('/epoch-ai.json') ? new Response(JSON.stringify(remote)) : new Response('',{status:404})})
    assert.deepEqual(results.find(result => result.name==='epoch-ai.json'),{name:'epoch-ai.json',status:'kept',reason:'newer local Epoch data'})
    assert.equal(await readFile(file,'utf8'),original)
  }
})

