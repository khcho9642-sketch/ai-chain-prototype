import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { AGENTS, ensure, makePrompt, validateOutput } from '../../server/community/policy.mjs'

// Each approved wrapper is a locally reviewed executable, not a shell command.
// It must run only the named provider, disable tools, and emit the envelope below.
// Keeping provider flags outside the web app prevents silently trusting changing CLI defaults.
export function validateAdapter(agent, config) {
  ensure(AGENTS[agent] && config && config.provider === agent, 'provider_mismatch')
  ensure(config.termsApproved === true && config.isolationApproved === true, 'adapter_not_approved')
  ensure(typeof config.executable === 'string' && isAbsolute(config.executable) && !/\.(?:cmd|bat|ps1)$/i.test(config.executable), 'absolute_executable_required')
  ensure(Array.isArray(config.args) && config.args.every(v => typeof v === 'string'), 'invalid_args')
  ensure(typeof config.model === 'string' && config.model.length > 0 && config.model.length <= 120, 'model_required')
  ensure(typeof config.cliVersion === 'string' && config.cliVersion.length > 0 && config.cliVersion.length <= 120, 'cli_version_required')
  ensure(typeof config.runnerHome === 'string' && isAbsolute(config.runnerHome), 'isolated_home_required')
  return config
}
export async function runAdapter(agent, config, job, signal) {
  validateAdapter(agent, config)
  const cwd = await mkdtemp(join(tmpdir(), 'ai-chain-comment-'))
  const input = JSON.stringify({ provider: agent, model: config.model, cliVersion: config.cliVersion, prompt: makePrompt(job) })
  // Do not inherit SITE/DB/WORKER tokens or model API billing keys into the child.
  const env = { PATH: process.env.PATH || '', HOME: config.runnerHome, USERPROFILE: config.runnerHome, TMPDIR: cwd, TEMP: cwd, TMP: cwd, LANG: 'C.UTF-8' }
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC']) if (process.env[key]) env[key] = process.env[key]
  try {
    const raw = await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('cancelled')); return }
      const child = spawn(config.executable, config.args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
      let output = '', size = 0, settled = false
      const stop = () => {
        if (!child.pid) return
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
        else { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
      }
      const complete = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
        if (error) { stop(); reject(error) } else resolve(value)
      }
      const abort = () => complete(new Error('cancelled'))
      const timer = setTimeout(() => complete(new Error('cli_timeout')), 120000)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 65536) complete(new Error('output_too_large')); else output += chunk.toString('utf8') })
      // Never persist raw stderr: it can contain login URLs or credentials.
      child.stderr.on('data', chunk => { size += chunk.length; if (size > 65536) complete(new Error('output_too_large')) })
      child.stdin.on('error', () => {})
      child.on('error', () => complete(new Error('cli_launch_failed')))
      child.on('close', code => complete(code === 0 ? null : new Error('cli_failed'), output))
      child.stdin.end(input)
    })
    let result; try { result = JSON.parse(raw) } catch { throw new Error('invalid_cli_json') }
    ensure(result.provider === agent && result.model === config.model && result.cliVersion === config.cliVersion, 'provenance_mismatch')
    return { output: validateOutput(result.output), model: result.model, cliVersion: result.cliVersion }
  } finally { await rm(cwd, { recursive: true, force: true }) }
}
