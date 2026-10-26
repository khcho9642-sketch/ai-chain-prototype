import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCommunityOrigin } from '../assets/community-ui-core.js'
import { validateAdapter, runAdapter } from './ai-cli.mjs'

export async function runWorker({ base, token, adapters, signal, run = runAdapter, log = console.log }) {
  if (!base) throw new Error('api_origin_required')
  const url = new URL(resolveCommunityOrigin(base, ''))
  const workerId = randomUUID()
  if (typeof token !== 'string' || token.length < 32) throw new Error('worker_token_required')
  const agents = Object.keys(adapters).filter(a => adapters[a].enabled === true)
  if (!agents.length) throw new Error('no_enabled_adapters')
  agents.forEach(a => validateAdapter(a, adapters[a]))
  const api = async (path, input) => {
    const response = await fetch(`${url.origin}/api/community/worker/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Worker-Id': workerId, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)].filter(Boolean)), redirect: 'error' })
    if (!response.ok) throw new Error(`worker_http_${response.status}`)
    return response.json()
  }
  const blocked = new Set()
  let running = false, again = false, retryTimer, maintenance, failures = 0
  const wake = () => {
    again = true
    if (running || signal?.aborted) return
    running = true
    ;(async () => {
      do {
        again = false
        for (;;) {
          if (signal?.aborted) break
          const available = agents.filter(agent => !blocked.has(agent))
          if (!available.length) break
          const { job, nextDue } = await api('claim', { agents: available })
          if (!job) {
            clearTimeout(retryTimer)
            if (nextDue) retryTimer = setTimeout(wake, Math.min(2147483647, Math.max(100, nextDue - Date.now())))
            break
          }
          let generated
          try { generated = await run(job.agent, adapters[job.agent], job, signal) }
          catch (e) {
            if (signal?.aborted) break
            await api('fail', { id: job.id, lease: job.lease, code: e.message, retryable: e.message === 'cli_timeout' })
            if (e.message !== 'cli_timeout') { blocked.add(job.agent); log(`Adapter blocked for this worker session: ${job.agent}`) }
            continue
          }
          // Retry posting this exact result once; never re-generate after an ambiguous POST.
          const payload = { id: job.id, lease: job.lease, ...generated }
          try { await api('finish', payload) }
          catch { if (!signal?.aborted) await api('finish', payload) }
          log(`AI result delivered: ${job.agent} ${job.symbol} (${job.id})`)
        }
      } while (again && !signal?.aborted)
    })().catch(() => {
      log('Worker task delivery failed; retrying the affected durable queue after the lease timeout.')
      clearTimeout(retryTimer); if (!signal?.aborted) retryTimer = setTimeout(wake, 180000)
    }).finally(() => { running = false; if (again && !signal?.aborted) wake() })
  }
  // Two-hour development reconciliation, not a post-list polling loop.
  maintenance = setInterval(wake, 2 * 60 * 60 * 1000)
  const sleep = ms => new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms); signal?.addEventListener('abort', done, { once: true })
  })
  try {
    while (!signal?.aborted) {
      const connection = new AbortController()
      let watchdog
      const resetWatchdog = () => { clearTimeout(watchdog); watchdog = setTimeout(() => connection.abort(), 90000) }
      try {
        resetWatchdog()
        const response = await fetch(`${url.origin}/api/community/worker/events`, { headers: { Authorization: `Bearer ${token}`, 'X-Worker-Id': workerId }, redirect: 'error', signal: AbortSignal.any([signal, connection.signal].filter(Boolean)) })
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
  } finally { clearInterval(maintenance); clearTimeout(retryTimer) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = new AbortController()
  process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort())
  try {
    if (process.argv.includes('--managed')) {
      try { await readFile('.local/ai-worker.disabled'); process.exit(0) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const config = JSON.parse(await readFile(process.env.AI_WORKER_CONFIG || '.local/ai-worker.json', 'utf8'))
    await runWorker({ base: process.env.AI_SITE_ORIGIN || 'http://127.0.0.1:5175', token: process.env.COMMUNITY_WORKER_TOKEN, adapters: config.adapters, signal: stop.signal })
  } catch (e) { console.error(`AI worker not started: ${e.message}`); process.exitCode = 1 }
}
