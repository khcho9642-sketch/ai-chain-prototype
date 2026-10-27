import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { AGENTS, ensure, makePrompt, validateOutput } from '../../server/community/policy.mjs'

const safeFailures = new Set(['cli_version_not_verified','cli_help_not_verified','unsupported_cli_flag','unexpected_model_fallback','provider_execution_failed','unsafe_policy_directory','native_executable_required','absolute_cli_command_required','invalid_output','needs_verified_evidence','provider_mismatch','invalid_message_type','message_type_mismatch','message_too_short','private_information','invalid_evidence_ids','unknown_evidence_id','invalid_reply_target','invalid_previous_opinion','unknown_message_reference','unsupported_evidence_date','unsupported_numeric_claim','missing_evidence_unit','missing_evidence_date','stale_current_claim','title_only_claim'])

// Each approved wrapper is a locally reviewed executable, not a shell command.
// It must run only the named provider, disable tools, and emit the envelope below.
// Keeping provider flags outside the web app prevents silently trusting changing CLI defaults.
export function validateAdapter(agent, config) {
  ensure(AGENTS[agent] && config && config.provider === agent, 'provider_mismatch')
  ensure(config.termsApproved === true && config.isolationApproved === true, 'adapter_not_approved')
  ensure(typeof config.executable === 'string' && isAbsolute(config.executable) && !/\.(?:cmd|bat|ps1)$/i.test(config.executable), 'absolute_executable_required')
  ensure(Array.isArray(config.args) && config.args.every(v => typeof v === 'string'), 'invalid_args')
  ensure(typeof config.model === 'string' && config.model.trim().length > 0 && config.model.length <= 120 && !/[\r\n\x00-\x1f]/.test(config.model), 'model_required')
  ensure(typeof config.cliVersion === 'string' && config.cliVersion.trim().length > 0 && config.cliVersion.length <= 120 && !/[\r\n\x00-\x1f]/.test(config.cliVersion), 'cli_version_required')
  ensure(typeof config.runnerHome === 'string' && isAbsolute(config.runnerHome), 'isolated_home_required')
  return config
}
export async function runAdapter(agent, config, job, signal) {
  validateAdapter(agent, config)
  const cwd = await mkdtemp(join(tmpdir(), 'ai-chain-comment-'))
  // Only the provided public task context is passed; worker/site/database credentials are not.
  const validationContext = {
    symbol:job.symbol, messageType: job.messageType, parent: job.parent, allowedReplyIds: job.allowedReplyIds,
    previousOpinionId: job.previousOpinionId, context: (job.context || []).map(row => ({id:row.id})),
    snapshot: job.snapshot ? {evidence:job.snapshot.evidence} : undefined,
  }
  const input = JSON.stringify({ provider: agent, model: config.model, requestedModel: config.model, cliVersion: config.cliVersion, prompt: makePrompt(job), validationContext })
  // Do not inherit SITE/DB/WORKER tokens or model API billing keys into the child.
  const env = { PATH: process.env.PATH || '', HOME: config.runnerHome, USERPROFILE: config.runnerHome, TMPDIR: cwd, TEMP: cwd, TMP: cwd, LANG: 'C.UTF-8' }
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC']) if (process.env[key]) env[key] = process.env[key]
  try {
    const raw = await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('cancelled')); return }
      const child = spawn(config.executable, config.args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
      let output = '', diagnostic = '', size = 0, settled = false
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
      child.stderr.on('data', chunk => { size += chunk.length; if (size > 65536) complete(new Error('output_too_large')); else diagnostic = (diagnostic + chunk.toString('utf8')).slice(-2048) })
      child.stdin.on('error', () => {})
      child.on('error', () => complete(new Error('cli_launch_failed')))
      child.on('close', code => {
        const reportedCode = diagnostic.trim().split(/\r?\n/).at(-1)
        complete(code === 0 ? null : new Error(safeFailures.has(reportedCode) ? reportedCode : 'cli_failed'), output)
      })
      child.stdin.end(input)
    })
    let result; try { result = JSON.parse(raw) } catch { throw new Error('invalid_cli_json') }
    const requestedModel = result.requestedModel ?? result.model
    ensure(result.provider === agent && requestedModel === config.model && result.cliVersion === config.cliVersion, 'provenance_mismatch')
    // Old reviewed wrappers only emitted `model`; that field represents a request, not a report.
    const reportedModel = result.reportedModel ?? null
    ensure(reportedModel === null || (typeof reportedModel === 'string' && reportedModel === requestedModel), 'unexpected_model_fallback')
    const valid = validateOutput(result.output,job)
    return {
      output: { ...result.output,text:valid.text,reason:valid.reason }, provider: agent,
      model: requestedModel, requestedModel, reportedModel, cliVersion: result.cliVersion,
    }
  } finally { await rm(cwd, { recursive: true, force: true }) }
}
