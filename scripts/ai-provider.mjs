// Official-CLI bridge. No SDK or paid-API fallback. Install/login/version verification is manual.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensure, validateOutput } from '../server/community/policy.mjs'

export function providerArgs(provider, model, policyPath) {
  ensure(typeof model === 'string' && model.length > 0, 'model_required')
  if (provider === 'gpt') return ['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--model',model,'-c','features.shell_tool=false','-c','features.unified_exec=false','-c','web_search="disabled"','-c','mcp_servers={}','-']
  if (provider === 'claude') return ['-p','--safe-mode','--tools','','--strict-mcp-config','--no-session-persistence','--output-format','json','--model',model]
  if (provider === 'gemini') return ['--prompt','Follow the JSON-only comment instruction supplied on stdin.','--output-format','json','--approval-mode','default','--sandbox','--policy',policyPath,'--model',model]
  throw new Error('unknown_provider')
}
export function decodeProvider(provider, raw, requestedModel) {
  let value, reported = []
  if (provider === 'gpt') {
    const events = raw.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    ensure(!events.some(e => e.type === 'error' || e.type === 'turn.failed' || ['command_execution','mcp_tool_call','web_search','file_change'].includes(e.item?.type)), 'cli_error_or_tool_use')
    const messages = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message')
    ensure(messages.length > 0, 'missing_model_response'); value = JSON.parse(messages.at(-1).item.text)
  } else {
    const envelope = JSON.parse(raw)
    ensure(!envelope.is_error && !envelope.error, 'cli_error')
    if (provider === 'claude') { value = JSON.parse(envelope.result); reported = Object.keys(envelope.modelUsage || {}) }
    else { value = JSON.parse(envelope.response); reported = Object.keys(envelope.stats?.models || {}) }
    // Do not label an unexpected fallback model as the configured model.
    if (reported.length) ensure(reported.every(model => model === requestedModel), 'unexpected_model_fallback')
  }
  return validateOutput(value)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv.slice(2)
    ensure(command.length >= 1 && command.length <= 2 && command.every(isAbsolute), 'absolute_cli_command_required')
    ensure(!/\.(cmd|bat|ps1)$/i.test(command[0]), 'native_executable_required')
    let raw = ''
    for await (const chunk of process.stdin) { raw += chunk; ensure(Buffer.byteLength(raw) <= 65536, 'prompt_too_large') }
    const input = JSON.parse(raw)
    const version = spawnSync(command[0], [...command.slice(1),'--version'], { encoding:'utf8',timeout:10000,maxBuffer:8192,windowsHide:true,shell:false })
    ensure(version.status === 0 && version.stdout.trim() === input.cliVersion, 'cli_version_not_verified')
    const policyPath = join(process.cwd(),'deny-tools.toml')
    if (input.provider === 'gemini') writeFileSync(policyPath, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', { mode:0o600 })
    const generated = spawnSync(command[0], [...command.slice(1),...providerArgs(input.provider,input.model,policyPath)], { input:input.prompt,encoding:'utf8',timeout:100000,maxBuffer:524288,windowsHide:true,shell:false })
    ensure(generated.status === 0 && !generated.error, 'provider_execution_failed')
    const output = decodeProvider(input.provider,generated.stdout,input.model)
    process.stdout.write(JSON.stringify({provider:input.provider,model:input.model,cliVersion:version.stdout.trim(),output}))
  } catch (e) { console.error(e.code || 'provider_bridge_failed'); process.exitCode = 1 }
}
