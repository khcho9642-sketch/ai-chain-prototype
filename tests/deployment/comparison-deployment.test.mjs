import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restoreAiSnapshots } from '../../scripts/deployment/restore-ai-snapshots.mjs'
import { MAX_COMPARISON_HISTORY_BYTES } from '../../assets/comparison-history-core.js'

const now = new Date('2026-11-01T00:00:00Z')
function snapshot(generatedAt = '2026-10-30T22:00:00Z', fetchedAt = generatedAt) {
  return {schemaVersion:1, range:'3y', interval:'1d', source:'Yahoo Finance', generatedAt, quotes:[{
    symbol:'NVDA', name:'엔비디아', currency:'USD', timezone:'America/New_York', range:'3y', interval:'1d',
    source:'Yahoo Finance', sourceUrl:'https://finance.yahoo.com/quote/NVDA/', fetchedAt, status:'ok', error:null,
    bars:[{time:Date.parse('2023-10-20T13:30:00Z')/1000,close:40},{time:Date.parse('2026-10-30T13:30:00Z')/1000,close:200}]
  }]}
}
async function fixture(t, value = snapshot()) {
  const root = await mkdtemp(join(tmpdir(), 'comparison-restore-'))
  t.after(() => rm(root, {recursive:true,force:true}))
  await mkdir(join(root, 'data'))
  const file = join(root, 'data', 'comparison-history.json')
  if (value) await writeFile(file, JSON.stringify(value))
  return {root, file}
}
async function restore(root, value, options = {}) {
  const results = await restoreAiSnapshots({root,now,includeComparison:true,
    fetcher:async url => new URL(url).pathname.endsWith('/comparison-history.json')
      ? new Response(typeof value === 'string' ? value : JSON.stringify(value)) : new Response('', {status:404}), ...options})
  return results.find(item => item.name === 'comparison-history.json')
}

test('comparison restore is opt-in and does not fetch it in the legacy restore flow', async t => {
  const {root,file} = await fixture(t), before = await readFile(file,'utf8'), urls = []
  const results = await restoreAiSnapshots({root,now,fetcher:async url=>{urls.push(url);return new Response('',{status:404})}})
  assert.equal(results.length,3)
  assert.equal(urls.some(url=>url.includes('comparison-history')),false)
  assert.equal(await readFile(file,'utf8'),before)
})

test('validated newer history restores compactly with original observation times', async t => {
  const {root,file}=await fixture(t,snapshot('2026-10-29T22:00:00Z'))
  const remote=snapshot()
  assert.equal((await restore(root,remote)).status,'restored')
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),remote)
  assert.ok(Buffer.byteLength(await readFile(file)) <= MAX_COMPARISON_HISTORY_BYTES)
  assert.deepEqual(await readdir(join(root,'data')),['comparison-history.json'])
})

test('a newer local per-company fetch prevents regression even with a later remote envelope', async t => {
  const local=snapshot('2026-10-30T23:00:00Z','2026-10-30T22:30:00Z')
  const {root,file}=await fixture(t,local)
  const result=await restore(root,snapshot('2026-10-31T12:00:00Z','2026-10-29T22:00:00Z'))
  assert.equal(result.status,'kept')
  assert.match(result.reason,/newer local/)
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),local)
})

test('missing local history can be initialized from a validated deployed snapshot', async t => {
  const {root,file}=await fixture(t,null)
  assert.equal((await restore(root,snapshot())).status,'restored')
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),snapshot())
})

test('malformed, oversize, and unavailable histories preserve the local file byte-for-byte', async t => {
  const {root,file}=await fixture(t), before=await readFile(file,'utf8')
  for (const value of ['<html>not a snapshot</html>', ' '.repeat(MAX_COMPARISON_HISTORY_BYTES+1), {...snapshot(),range:'1y'}]) {
    assert.equal((await restore(root,value)).status,'kept')
    assert.equal(await readFile(file,'utf8'),before)
  }
  assert.equal((await restore(root,null,{fetcher:async()=>{throw new Error('offline')}})).status,'kept')
  assert.equal(await readFile(file,'utf8'),before)
  assert.deepEqual(await readdir(join(root,'data')),['comparison-history.json'])
})
