import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { resolveCommunityOrigin } from '../../assets/community-ui-core.js'
import { ensure, validateOutput } from '../../server/community/policy.mjs'
import { validateAdapter, runAdapter } from './ai-cli.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const resultKey = (id, lease) => digest(JSON.stringify([id, lease]))
const finishStates = new Set(['awaiting_approval','published','skipped','cancelled','expired','rejected','blocked'])
const failStates = new Set(['queued','blocked','cancelled','expired','failed'])
const cliFailures = new Set(['cli_timeout','cli_failed','invalid_cli_json','provenance_mismatch','unexpected_model_fallback','cli_version_not_verified','cli_help_not_verified','unsupported_cli_flag','cli_launch_failed','output_too_large','invalid_output','invalid_action','unexpected_output_field','needs_verified_evidence','provider_execution_failed','invalid_text','invalid_message_type','message_type_mismatch','message_too_short','private_information','invalid_evidence_ids','unknown_evidence_id','invalid_reply_target','invalid_previous_opinion','unknown_message_reference','unsupported_evidence_date','unsupported_numeric_claim','missing_evidence_unit','missing_evidence_date','stale_current_claim','title_only_claim'])

/** Durable generated results, not prompts, cookies, worker tokens or model credentials. */
export class WorkerResultOutbox {
  constructor({ directory = resolve('.local/ai-worker-outbox'), origin }) {
    this.origin = new URL(origin).origin
    this.directory = resolve(directory)
    mkdirSync(this.directory, { recursive:true, mode:0o700 })
    const info = lstatSync(this.directory)
    ensure(info.isDirectory() && !info.isSymbolicLink(), 'unsafe_outbox_directory')
    this.path = join(this.directory, `${digest(this.origin)}.sqlite`)
    try { closeSync(openSync(this.path,'wx',0o600)) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const file = lstatSync(this.path)
    ensure(file.isFile() && !file.isSymbolicLink(), 'unsafe_outbox_file')
    chmodSync(this.path,0o600)
    this.db = new DatabaseSync(this.path)
    // SQLite journals inherit the private database mode; FULL commits survive process loss.
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS worker_result_outbox (
        result_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, lease TEXT NOT NULL,
        provider TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', reason TEXT
      )`)
  }
  put(job, kind, payload, now = Date.now()) {
    ensure(job && typeof job.id === 'string' && job.id.length > 0 && typeof job.lease === 'string' && job.lease.length > 0, 'invalid_outbox_job')
    ensure(['finish','fail'].includes(kind), 'invalid_outbox_kind')
    const key = resultKey(job.id,job.lease), bytes = JSON.stringify(payload)
    ensure(Buffer.byteLength(bytes) <= 131072, 'outbox_payload_too_large')
    const hash = digest(bytes), existing = this.db.prepare('SELECT payload_hash,kind FROM worker_result_outbox WHERE result_key=?').get(key)
    ensure(!existing || (existing.payload_hash === hash && existing.kind === kind), 'outbox_result_conflict')
    this.db.prepare('INSERT OR IGNORE INTO worker_result_outbox(result_key,job_id,lease,provider,kind,payload,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(key,job.id,job.lease,job.agent,kind,bytes,hash,now)
    return key
  }
  records({ includeQuarantined = false } = {}) {
    const rows = this.db.prepare(`SELECT * FROM worker_result_outbox ${includeQuarantined ? '' : "WHERE state='pending'"} ORDER BY created_at,result_key`).all()
    return rows.map(row => {
      ensure(digest(row.payload) === row.payload_hash && resultKey(row.job_id,row.lease) === row.result_key, 'outbox_corrupt')
      const payload = JSON.parse(row.payload)
      ensure(payload.id === row.job_id && payload.lease === row.lease, 'outbox_corrupt')
      return { key:row.result_key, id:row.job_id, lease:row.lease, provider:row.provider, kind:row.kind, payload, state:row.state, reason:row.reason }
    })
  }
  hasGeneratedResult(id) { return !!this.db.prepare("SELECT 1 FROM worker_result_outbox WHERE job_id=? AND kind='finish'").get(id) }
  acknowledge(key) { this.db.prepare('DELETE FROM worker_result_outbox WHERE result_key=?').run(key) }
  quarantine(key, reason) { this.db.prepare("UPDATE worker_result_outbox SET state='quarantined',reason=? WHERE result_key=?").run(reason,key) }
  close() { this.db.close() }
}

export function workerResultPayload(job, config, generated, now = Date.now()) {
  const provider = generated.provider ?? job.agent
  const requestedModel = generated.requestedModel ?? generated.model ?? config.model
  const reportedModel = generated.reportedModel ?? null
  ensure(provider === job.agent && requestedModel === config.model && generated.cliVersion === config.cliVersion, 'provenance_mismatch')
  ensure(reportedModel === null || (typeof reportedModel === 'string' && reportedModel === requestedModel), 'unexpected_model_fallback')
  const valid = validateOutput(generated.output,job)
  return {
    id:job.id, lease:job.lease, jobId:job.id, leaseToken:job.lease,
    provider, model:requestedModel, requestedModel, reportedModel, cliVersion:generated.cliVersion,
    generatedAt:new Date(now).toISOString(), output:{ ...generated.output,text:valid.text,reason:valid.reason },
  }
}

export function developmentReconciliationEnabled(development, nodeEnv) {
  return nodeEnv !== 'production' && (development === true || ['development','test'].includes(nodeEnv))
}

export async function runWorker({ base, token, adapters, signal, run = runAdapter, log = console.log,
  fetcher = fetch, outboxDir, deliveryRetryMs = 5000, development = false, nodeEnv = process.env.NODE_ENV }) {
  if (!base) throw new Error('api_origin_required')
  const url = new URL(resolveCommunityOrigin(base, ''))
  const workerId = randomUUID()
  if (typeof token !== 'string' || token.length < 32) throw new Error('worker_token_required')
  const agents = Object.keys(adapters).filter(a => adapters[a].enabled === true)
  if (!agents.length) throw new Error('no_enabled_adapters')
  agents.forEach(a => validateAdapter(a, adapters[a]))
  const outbox = new WorkerResultOutbox({ directory:outboxDir, origin:url.origin })
  const stop = new AbortController()
  signal = AbortSignal.any([signal,stop.signal].filter(Boolean))
  const api = async (path, input) => {
    const response = await fetcher(`${url.origin}/api/community/worker/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Worker-Id': workerId, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), redirect: 'error' })
    let body
    try { body = await response.json() } catch { if (response.ok) throw new Error('invalid_worker_ack') }
    if (!response.ok) {
      const error = new Error(`worker_http_${response.status}`)
      error.permanent = response.status === 410 || (response.status === 409 && body?.error === 'stale_lease') || response.status === 400
      throw error
    }
    return body
  }
  const blocked = new Set()
  let running = false, runningTask, again = false, retryTimer, maintenance, failures = 0, fatalError
  const later = delay => {
    clearTimeout(retryTimer)
    if (!signal.aborted) retryTimer = setTimeout(wake,Math.min(2147483647,Math.max(1,delay)))
  }
  const replay = async () => {
    for (const record of outbox.records()) {
      if (signal.aborted) return false
      if (record.kind === 'fail' && !record.payload.retryable) blocked.add(record.provider)
      try {
        const ack = await api(record.kind,record.payload)
        ensure((record.kind === 'finish' ? finishStates : failStates).has(ack?.state), 'invalid_worker_ack')
        outbox.acknowledge(record.key)
        log(`AI ${record.kind} acknowledged: ${record.provider} (${record.id}; ${ack.state})`)
        if (ack.nextDue) later(Math.max(100,ack.nextDue-Date.now()))
      } catch (error) {
        if (error.permanent) {
          outbox.quarantine(record.key,error.message)
          if (record.kind === 'finish') blocked.add(record.provider)
          log(`AI delivery requires review: ${record.provider} (${record.id})`)
          continue
        }
        if (!signal.aborted) later(deliveryRetryMs)
        return false
      }
    }
    return true
  }
  const wake = () => {
    again = true
    if (running || signal?.aborted) return
    running = true
    clearTimeout(retryTimer)
    runningTask = (async () => {
      do {
        again = false
        // Replay persisted finish/fail outcomes before claiming any fresh task.
        if (!await replay()) break
        for (;;) {
          if (signal?.aborted) break
          const available = agents.filter(agent => !blocked.has(agent))
          if (!available.length) break
          const { job, nextDue } = await api('claim', { agents: available })
          if (!job) {
            if (nextDue) later(Math.max(100,nextDue-Date.now()))
            break
          }
          if (outbox.hasGeneratedResult(job.id)) {
            blocked.add(job.agent)
            outbox.put(job,'fail',{ id:job.id,lease:job.lease,code:'previous_result_requires_review',retryable:false })
            if (!await replay()) break
            continue
          }
          let payload, kind = 'finish'
          try { payload = workerResultPayload(job,adapters[job.agent],await run(job.agent,adapters[job.agent],job,signal)) }
          catch (e) {
            if (signal?.aborted) break
            kind = 'fail'
            const reportedCode = e.code || e.message
            const code = cliFailures.has(reportedCode) ? reportedCode : 'cli_failed'
            payload = { id:job.id,lease:job.lease,code,retryable:code === 'cli_timeout' }
            if (!payload.retryable) { blocked.add(job.agent); log(`Adapter blocked for this worker session: ${job.agent}`) }
          }
          // Commit before the first POST, including if shutdown arrived after generation.
          try { outbox.put(job,kind,payload) }
          catch { fatalError = new Error('worker_result_storage_failed'); stop.abort(); break }
          if (!await replay()) break
        }
      } while (again && !signal?.aborted)
    })().catch(error => {
      if (signal.aborted) return
      if (error.message === 'outbox_corrupt' || (typeof error.code === 'string' && error.code.startsWith('ERR_SQLITE'))) { fatalError = new Error('worker_result_storage_failed'); stop.abort() }
      else if (!signal.aborted) { log('Worker delivery interrupted; saved outcomes remain pending.'); later(deliveryRetryMs) }
    }).finally(() => { running = false; if (again && !signal?.aborted) wake() })
  }
  // Only an explicitly selected development/test environment gets periodic reconciliation.
  if (developmentReconciliationEnabled(development,nodeEnv)) maintenance = setInterval(wake, 2 * 60 * 60 * 1000)
  const sleep = ms => new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms); signal?.addEventListener('abort', done, { once: true })
  })
  wake()
  try {
    while (!signal?.aborted) {
      const connection = new AbortController()
      let watchdog
      const resetWatchdog = () => { clearTimeout(watchdog); watchdog = setTimeout(() => connection.abort(), 90000) }
      try {
        resetWatchdog()
        const response = await fetcher(`${url.origin}/api/community/worker/events`, { headers: { Authorization: `Bearer ${token}`, 'X-Worker-Id': workerId }, redirect: 'error', signal: AbortSignal.any([signal, connection.signal]) })
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('event_stream_failed')
        failures = 0; wake(); resetWatchdog()
        const decoder = new TextDecoder(); let buffer = ''
        for await (const chunk of response.body) {
          resetWatchdog(); buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '')
          if (buffer.length > 65536) throw new Error('event_too_large')
          let end
          while ((end = buffer.indexOf('\n\n')) >= 0) { const event = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (event.includes('event: wake')) wake() }
        }
      } catch { if (!signal?.aborted) log('Event connection interrupted; reconnecting.') }
      finally { clearTimeout(watchdog); connection.abort() }
      if (!signal?.aborted) await sleep(Math.min(60000, 1000 * 2 ** Math.min(failures++, 6)))
    }
  } finally { clearInterval(maintenance); clearTimeout(retryTimer); if (runningTask) await runningTask; outbox.close() }
  if (fatalError) throw fatalError
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = new AbortController()
  process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort())
  try {
    if (process.argv.includes('--managed')) {
      try { await readFile('.local/ai-worker.disabled'); process.exit(0) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const config = JSON.parse(await readFile(process.env.AI_WORKER_CONFIG || '.local/ai-worker.json', 'utf8'))
    await runWorker({ base: process.env.AI_SITE_ORIGIN || 'http://127.0.0.1:5175', token: process.env.COMMUNITY_WORKER_TOKEN, adapters: config.adapters, signal: stop.signal, outboxDir:process.env.AI_WORKER_OUTBOX || config.resultOutbox, development:config.development === true || process.argv.includes('--development') })
  } catch (e) { console.error(`AI worker not started: ${e.message}`); process.exitCode = 1 }
}
