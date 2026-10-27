import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeProviderResult, providerArgs, requiredProviderFlags, validateCliSupport, createGeminiDenyPolicy } from '../../scripts/community/ai-provider.mjs'
import { runAdapter, validateAdapter } from '../../scripts/community/ai-cli.mjs'
import { WorkerResultOutbox, workerResultPayload, runWorker, developmentReconciliationEnabled } from '../../scripts/community/ai-worker.mjs'
import { validateOutput } from '../../server/community/policy.mjs'

const origin = 'https://worker-fixture.example'
const token = 'fixture-worker-token-never-save'.padEnd(48,'x')
const output = () => ({ action:'reply',text:'일단 흐름을 더 보고 이야기하자.' })
const job = (override = {}) => ({ id:'fixture-job',lease:'fixture-lease',agent:'gpt',symbol:'NVDA',company:'엔비디아',context:[],parent:null,...override })
const adapter = (home, override = {}) => ({ enabled:true,provider:'gpt',termsApproved:true,isolationApproved:true,executable:process.execPath,args:[],model:'fixture-only',cliVersion:'fixture-cli-v4',runnerHome:home,...override })
const generated = () => ({ output:output(),model:'fixture-only',cliVersion:'fixture-cli-v4' })
async function temporary(t) {
  const base = resolve(tmpdir()), directory = resolve(await mkdtemp(join(base,'community-cli-v4-')))
  assert.ok(directory.startsWith(base+sep))
  t.after(async () => { assert.ok(directory.startsWith(base+sep)); await rm(directory,{ recursive:true,force:true }) })
  return directory
}
const json = (value, status = 200) => new Response(JSON.stringify(value),{ status,headers:{'Content-Type':'application/json'} })
function events(signal) {
  return new Response(new ReadableStream({ start(controller) {
    const close = () => { try { controller.close() } catch {} }
    if (signal.aborted) close()
    else { signal.addEventListener('abort',close,{once:true}); controller.enqueue(new TextEncoder().encode('event: wake\ndata: {}\n\n')) }
  } }),{ headers:{'Content-Type':'text/event-stream'} })
}

test('provider provenance records an unknown actual model instead of copying the requested model', () => {
  const gpt = JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(output())}})
  const claude = JSON.stringify({result:JSON.stringify(output())})
  const gemini = JSON.stringify({response:JSON.stringify(output())})
  for (const [provider,raw] of [['gpt',gpt],['claude',claude],['gemini',gemini]]) assert.equal(decodeProviderResult(provider,raw,'fixture-only').reportedModel,null)
  assert.equal(decodeProviderResult('claude',JSON.stringify({result:JSON.stringify(output()),modelUsage:{'fixture-only':{}}}),'fixture-only').reportedModel,'fixture-only')
  assert.equal(decodeProviderResult('gemini',JSON.stringify({response:JSON.stringify(output()),stats:{models:{'fixture-only':{}}}}),'fixture-only').reportedModel,'fixture-only')
  for (const [provider,raw] of [
    ['gpt',JSON.stringify({type:'turn.started',model:'different'})+'\n'+gpt],
    ['claude',JSON.stringify({result:JSON.stringify(output()),modelUsage:{different:{}}})],
    ['gemini',JSON.stringify({response:JSON.stringify(output()),stats:{models:{different:{}}}})],
  ]) assert.throws(() => decodeProviderResult(provider,raw,'fixture-only'),/unexpected_model_fallback/)
})

test('official bridge checks exact versions and required flags while Gemini never assumes --policy support', () => {
  for (const provider of ['gpt','claude','gemini']) {
    const help = requiredProviderFlags(provider).join('\n')
    assert.equal(validateCliSupport(provider,'fixture-cli-v4','fixture-cli-v4',help).actualVersion,'fixture-cli-v4')
    assert.throws(() => validateCliSupport(provider,'other-version','fixture-cli-v4',help),/cli_version_not_verified/)
    assert.throws(() => validateCliSupport(provider,'fixture-cli-v4','fixture-cli-v4','--modelish'),/unsupported_cli_flag/)
  }
  assert.ok(!providerArgs('gemini','fixture-only').includes('--policy'))
  assert.ok(providerArgs('gemini','fixture-only').includes('--sandbox'))
  assert.ok(providerArgs('claude','fixture-only').includes('mcp__*'))
  assert.throws(() => validateAdapter('gpt',{provider:'gpt'}),/adapter_not_approved/)
})

test('Gemini deny policy uses the approved isolated home, blocks all tools and never overwrites existing files', async t => {
  const home = await temporary(t)
  const policy = createGeminiDenyPolicy(home,'fixture-policy')
  const body = await readFile(policy.path,'utf8')
  assert.match(body,/toolName = "\*"/)
  assert.match(body,/decision = "deny"/)
  assert.match(body,/priority = 999/)
  if (process.platform !== 'win32') assert.equal((await stat(policy.path)).mode & 0o777,0o600)
  assert.throws(() => createGeminiDenyPolicy(home,'fixture-policy'),error => error.code === 'EEXIST')
  assert.equal(await readFile(policy.path,'utf8'),body)
  policy.cleanup()
  assert.deepEqual(await readdir(join(home,'.gemini','policies')),[])
})

test('fixture-only official bridge probes help before execution and rejects unsupported versions or flags', async t => {
  const directory = await temporary(t), fake = join(directory,'fake-cli.mjs'), marker = join(directory,'generated.txt')
  const bridge = fileURLToPath(new URL('../../scripts/community/ai-provider.mjs',import.meta.url))
  const writeCli = help => writeFile(fake,`import {writeFileSync} from 'node:fs';const args=process.argv.slice(2);if(args.includes('--version'))console.log('fixture-cli-v4');else if(args.includes('--help'))console.log(${JSON.stringify(help)});else{writeFileSync(${JSON.stringify(marker)},'fixture invocation only');let raw='';for await(const part of process.stdin)raw+=part;if(process.env.COMMUNITY_WORKER_TOKEN||process.env.OPENAI_API_KEY)process.exit(8);console.log(JSON.stringify({result:JSON.stringify({action:'reply',text:'테스트 응답만 확인하는 중이야.'}),modelUsage:{'fixture-only':{}}}));}`)
  const config = adapter(directory,{provider:'claude',args:[bridge,process.execPath,fake]})
  await writeCli('--model')
  await assert.rejects(runAdapter('claude',config,job({agent:'claude'})),/unsupported_cli_flag/)
  await assert.rejects(readFile(marker),error => error.code === 'ENOENT')
  await writeCli(requiredProviderFlags('claude').join('\n'))
  await assert.rejects(runAdapter('claude',{...config,cliVersion:'unverified-version'},job({agent:'claude'})),/cli_version_not_verified/)
  await assert.rejects(readFile(marker),error => error.code === 'ENOENT')
  const result = await runAdapter('claude',config,job({agent:'claude'}))
  assert.equal(result.provider,'claude')
  assert.equal(result.requestedModel,'fixture-only')
  assert.equal(result.reportedModel,'fixture-only')
  assert.equal(result.output.text,'테스트 응답만 확인하는 중이야.')
})

test('v4 opinion output stays snake_case across provider, adapter and worker transport validation', async t => {
  const directory = await temporary(t)
  const opinionJob = job({messageType:'opinion',snapshot:{id:'snapshot-fixture',evidence:[]}})
  const wire = {action:'publish',message_type:'opinion',text:'자료가 충분하지 않아 방향을 단정하기는 어렵네. 새 근거가 확인되면 다시 생각해 보자.',reply_to:null,evidence_ids:[],previous_opinion_id:null,referenced_message_ids:[]}
  const decoded = decodeProviderResult('claude',JSON.stringify({result:JSON.stringify(wire)}),'fixture-only',opinionJob)
  assert.equal(decoded.output.message_type,'opinion')
  assert.equal(Object.hasOwn(decoded.output,'messageType'),false)
  const payload = workerResultPayload(opinionJob,adapter(directory),{...generated(),output:decoded.output})
  assert.equal(payload.requestedModel,'fixture-only')
  assert.equal(payload.reportedModel,null)
  assert.doesNotThrow(() => validateOutput(payload.output,opinionJob))
  assert.throws(() => workerResultPayload(opinionJob,adapter(directory),{...generated(),output:wire,reportedModel:'substituted'}),/unexpected_model_fallback/)
})

test('outbox survives process replacement, isolates API origins and stores no prompt or worker credentials', async t => {
  const directory = await temporary(t), config = adapter(directory)
  const fullJob = job({prompt:'PROMPT_MUST_NOT_PERSIST',context:[{id:'source-id',text:'RAW_CONTEXT_MUST_NOT_PERSIST'}],credentials:'AUTH_MUST_NOT_PERSIST'})
  const payload = workerResultPayload(fullJob,config,{...generated(),rawStderr:'STDERR_MUST_NOT_PERSIST'})
  let outbox = new WorkerResultOutbox({directory,origin})
  const path = outbox.path
  outbox.put(fullJob,'finish',payload)
  outbox.close()
  outbox = new WorkerResultOutbox({directory,origin})
  assert.deepEqual(outbox.records()[0].payload,payload)
  assert.equal(outbox.hasGeneratedResult(fullJob.id),true)
  const other = new WorkerResultOutbox({directory,origin:'https://other-fixture.example'})
  assert.deepEqual(other.records(),[])
  other.close(); outbox.close()
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777,0o600)
  const bytes = await readFile(path)
  for (const forbidden of [token,'PROMPT_MUST_NOT_PERSIST','RAW_CONTEXT_MUST_NOT_PERSIST','AUTH_MUST_NOT_PERSIST','STDERR_MUST_NOT_PERSIST']) assert.equal(bytes.includes(Buffer.from(forbidden)),false)
})

test('an existing durable result cannot be overwritten by a different generated result', async t => {
  const directory = await temporary(t), task = job(), payload = workerResultPayload(task,adapter(directory),generated())
  const outbox = new WorkerResultOutbox({directory,origin})
  try {
    outbox.put(task,'finish',payload)
    assert.throws(() => outbox.put(task,'finish',{...payload,output:{action:'skip',reason:'changed'}}),/outbox_result_conflict/)
    assert.deepEqual(outbox.records()[0].payload,payload)
  } finally { outbox.close() }
})

test('a lost finish response survives worker restart and replays the exact result before any claim', async t => {
  const directory = await temporary(t), config = adapter(directory), first = new AbortController()
  let calls = 0, accepted, claimed = false
  const firstFetch = async (url,options) => {
    const route = new URL(url).pathname.split('/').at(-1)
    if (route === 'events') return events(options.signal)
    if (route === 'claim') { if (claimed) return json({job:null}); claimed = true; return json({job:job()}) }
    if (route === 'finish') { accepted = JSON.parse(options.body); first.abort(); throw new Error('response lost after server commit') }
    throw new Error('unexpected fixture request')
  }
  await runWorker({base:origin,token,adapters:{gpt:config},signal:first.signal,outboxDir:directory,fetcher:firstFetch,log:()=>{},run:async()=>{calls++;return generated()}})
  let saved = new WorkerResultOutbox({directory,origin})
  assert.deepEqual(saved.records()[0].payload,accepted)
  saved.close()
  const second = new AbortController(), trace = []
  const secondFetch = async (url,options) => {
    const route = new URL(url).pathname.split('/').at(-1)
    if (route === 'events') return events(options.signal)
    trace.push(route)
    if (route === 'finish') { assert.deepEqual(JSON.parse(options.body),accepted); return json({state:'awaiting_approval'}) }
    if (route === 'claim') { second.abort(); return json({job:null}) }
    throw new Error('unexpected fixture request')
  }
  await runWorker({base:origin,token,adapters:{gpt:config},signal:second.signal,outboxDir:directory,fetcher:secondFetch,log:()=>{},run:async()=>{calls++;throw new Error('must not regenerate')}})
  assert.equal(calls,1)
  assert.deepEqual(trace,['finish','claim'])
  saved = new WorkerResultOutbox({directory,origin}); assert.deepEqual(saved.records(),[]); saved.close()
})

test('stale generated results remain quarantined and a reclaimed job cannot trigger regeneration', async t => {
  const directory = await temporary(t), config = adapter(directory), task = job()
  let saved = new WorkerResultOutbox({directory,origin})
  saved.put(task,'finish',workerResultPayload(task,config,generated())); saved.close()
  const first = new AbortController()
  await runWorker({base:origin,token,adapters:{gpt:config},signal:first.signal,outboxDir:directory,log:message=>{if(message.includes('requires review'))first.abort()},run:async()=>{throw new Error('must not generate')},fetcher:async(url,options)=>{
    const route = new URL(url).pathname.split('/').at(-1)
    if(route==='events')return events(options.signal)
    assert.equal(route,'finish');return json({error:'stale_lease'},409)
  }})
  saved = new WorkerResultOutbox({directory,origin})
  assert.equal(saved.records({includeQuarantined:true})[0].state,'quarantined'); saved.close()
  const second = new AbortController()
  let invoked = 0
  await runWorker({base:origin,token,adapters:{gpt:config},signal:second.signal,outboxDir:directory,log:()=>{},run:async()=>{invoked++;return generated()},fetcher:async(url,options)=>{
    const route = new URL(url).pathname.split('/').at(-1)
    if(route==='events')return events(options.signal)
    if(route==='claim')return json({job:job({lease:'reclaimed-lease'})})
    assert.equal(route,'fail');assert.equal(JSON.parse(options.body).code,'previous_result_requires_review');second.abort();return json({state:'blocked'})
  }})
  assert.equal(invoked,0)
})

test('a malformed success response keeps the result, while an explicit cancelled ACK retires it without generation', async t => {
  const directory = await temporary(t), config = adapter(directory), task = job()
  let saved = new WorkerResultOutbox({directory,origin})
  saved.put(task,'finish',workerResultPayload(task,config,generated()));saved.close()
  for (const [ack,remaining] of [[{},1],[{state:'cancelled'},0]]) {
    const controller = new AbortController()
    await runWorker({base:origin,token,adapters:{gpt:config},signal:controller.signal,outboxDir:directory,log:()=>{},run:async()=>{throw new Error('must not generate')},fetcher:async(url,options)=>{
      if (new URL(url).pathname.endsWith('/events'))return events(options.signal)
      assert.ok(new URL(url).pathname.endsWith('/finish'))
      controller.abort();return json(ack)
    }})
    saved = new WorkerResultOutbox({directory,origin});assert.equal(saved.records().length,remaining);saved.close()
  }
})

test('failed generation outcomes also survive an ambiguous fail POST without persisting raw exceptions', async t => {
  const directory = await temporary(t), config = adapter(directory), first = new AbortController()
  await runWorker({base:origin,token,adapters:{gpt:config},signal:first.signal,outboxDir:directory,log:()=>{},run:async()=>{throw new Error('RAW_AUTH_VALUE_MUST_NOT_PERSIST')},fetcher:async(url,options)=>{
    const route = new URL(url).pathname.split('/').at(-1)
    if(route==='events')return events(options.signal)
    if(route==='claim')return json({job:job()})
    assert.equal(route,'fail');first.abort();throw new Error('lost acknowledgement')
  }})
  let saved = new WorkerResultOutbox({directory,origin})
  assert.equal(saved.records()[0].payload.code,'cli_failed'); saved.close()
  const second = new AbortController()
  await runWorker({base:origin,token,adapters:{gpt:config},signal:second.signal,outboxDir:directory,log:()=>{},run:async()=>{throw new Error('must not generate')},fetcher:async(url,options)=>{
    const route = new URL(url).pathname.split('/').at(-1)
    if(route==='events')return events(options.signal)
    assert.equal(route,'fail');second.abort();return json({state:'blocked'})
  }})
  saved = new WorkerResultOutbox({directory,origin});assert.deepEqual(saved.records(),[]);saved.close()
})

test('periodic reconciliation requires development or test and production always overrides it', () => {
  assert.equal(developmentReconciliationEnabled(false,undefined),false)
  assert.equal(developmentReconciliationEnabled(false,'production'),false)
  assert.equal(developmentReconciliationEnabled(true,'production'),false)
  assert.equal(developmentReconciliationEnabled(false,'development'),true)
  assert.equal(developmentReconciliationEnabled(false,'test'),true)
  assert.equal(developmentReconciliationEnabled(true,undefined),true)
})

test('abort during a pending API call with a numeric DOMException code leaves the worker stopped cleanly', async t => {
  const directory = await temporary(t), controller = new AbortController()
  await assert.doesNotReject(runWorker({base:origin,token,adapters:{gpt:adapter(directory)},signal:controller.signal,outboxDir:directory,log:()=>{},fetcher:async(url,options)=>{
    if (new URL(url).pathname.endsWith('/events')) return events(options.signal)
    controller.abort()
    throw new DOMException('The operation was aborted.','AbortError')
  },run:async()=>{throw new Error('must not invoke a model')}}))
})
