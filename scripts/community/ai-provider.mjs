// Official-CLI bridge. No SDK or paid-API fallback. Install/login/version verification is manual.
import { spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensure, validateOutput, MAX_CLI_INPUT_BYTES } from '../../server/community/policy.mjs'

export function providerArgs(provider, model) {
  ensure(typeof model === 'string' && model.length > 0, 'model_required')
  if (provider === 'gpt') return ['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--model',model,'-c','forced_login_method="chatgpt"','-c','features.shell_tool=false','-c','features.unified_exec=false','-c','features.apps=false','-c','features.multi_agent=false','-c','features.hooks=false','-c','features.remote_plugin=false','-c','tools.view_image=false','-c','web_search="disabled"','-c','mcp_servers={}','-']
  if (provider === 'claude') return ['-p','--restricted','--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disallowedTools','mcp__*','--disable-slash-commands','--no-chrome','--no-session-persistence','--output-format','json','--model',model]
  // Current official policy documentation loads user TOML files from HOME/.gemini/policies.
  // --policy is not a documented CLI option and must not be assumed to work.
  if (provider === 'gemini') return ['--prompt','Follow the JSON-only comment instruction supplied on stdin.','--output-format','json','--approval-mode','default','--sandbox','--model',model]
  throw new Error('unknown_provider')
}
export function requiredProviderFlags(provider) {
  if (provider === 'gpt') return ['--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','--json','--model','--config']
  if (provider === 'claude') return ['--print','--restricted','--safe-mode','--tools','--strict-mcp-config','--mcp-config','--disallowedTools','--disable-slash-commands','--no-chrome','--no-session-persistence','--output-format','--model']
  if (provider === 'gemini') return ['--prompt','--output-format','--approval-mode','--sandbox','--model']
  throw new Error('unknown_provider')
}
export function validateCliSupport(provider, actualVersion, expectedVersion, help) {
  ensure(typeof actualVersion === 'string' && actualVersion.trim() === expectedVersion, 'cli_version_not_verified')
  ensure(typeof help === 'string' && help.length > 0, 'cli_help_not_verified')
  const flags = requiredProviderFlags(provider)
  for (const flag of flags) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ensure(new RegExp(`(?:^|[\\s,])${escaped}(?=[\\s=,<\\[]|$)`, 'm').test(help), 'unsupported_cli_flag')
  }
  return { actualVersion: actualVersion.trim(), supportedFlags: flags }
}
export function decodeProviderResult(provider, raw, requestedModel, context) {
  ensure(['gpt','claude','gemini'].includes(provider), 'unknown_provider')
  let value, reported = []
  if (provider === 'gpt') {
    const events = raw.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    ensure(!events.some(e => e.type === 'error' || e.type === 'turn.failed' || (e.item?.type && !['agent_message','reasoning'].includes(e.item.type))), 'cli_error_or_tool_use')
    reported = events.filter(e => ['thread.started','turn.started','response.completed'].includes(e.type)).map(e => e.model ?? e.response?.model).filter(model => typeof model === 'string' && model.length > 0)
    const messages = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message')
    ensure(messages.length > 0, 'missing_model_response'); value = JSON.parse(messages.at(-1).item.text)
  } else {
    const envelope = JSON.parse(raw)
    ensure(!envelope.is_error && !envelope.error, 'cli_error')
    ensure(!(envelope.num_turns > 1) && !(envelope.stats?.tools?.totalCalls > 0), 'cli_error_or_tool_use')
    if (provider === 'claude') { value = JSON.parse(envelope.result); reported = Object.keys(envelope.modelUsage || {}) }
    else { value = JSON.parse(envelope.response); reported = Object.keys(envelope.stats?.models || {}) }
  }
  // A configured/requested model is never evidence of the model actually reported by a CLI.
  // Pin full model identifiers: aliases cannot establish an exact backend-model match.
  if (reported.length) ensure(reported.every(model => model === requestedModel), 'unexpected_model_fallback')
  const models = [...new Set(reported)]
  const valid = validateOutput(value, context)
  // Policy returns internal camelCase metadata; transport keeps the validated wire schema.
  return { output: { ...value,text:valid.text,reason:valid.reason }, reportedModel: models.length === 1 ? models[0] : null }
}
export function decodeProvider(provider, raw, requestedModel, context) {
  return decodeProviderResult(provider, raw, requestedModel, context).output
}

export function createGeminiDenyPolicy(home, id = randomUUID()) {
  ensure(typeof home === 'string' && isAbsolute(home), 'isolated_home_required')
  ensure(/^[a-zA-Z0-9-]{1,80}$/.test(id), 'invalid_policy_id')
  const base = resolve(home)
  for (const path of [base, join(base,'.gemini'), join(base,'.gemini','policies')]) {
    try {
      const info = lstatSync(path)
      ensure(info.isDirectory() && !info.isSymbolicLink(), 'unsafe_policy_directory')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      mkdirSync(path, { mode:0o700 })
    }
  }
  const path = join(base,'.gemini','policies',`ai-chain-deny-${id}.toml`)
  // Never overwrite existing policy or credential files. No authentication material is read/copied.
  writeFileSync(path, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', { flag:'wx',mode:0o600 })
  chmodSync(path,0o600)
  return { path, cleanup: () => unlinkSync(path) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let policy
  try {
    const command = process.argv.slice(2)
    ensure(command.length >= 1 && command.length <= 2 && command.every(isAbsolute), 'absolute_cli_command_required')
    ensure(!/\.(cmd|bat|ps1)$/i.test(command[0]), 'native_executable_required')
    let raw = ''
    for await (const chunk of process.stdin) { raw += chunk; ensure(Buffer.byteLength(raw) <= MAX_CLI_INPUT_BYTES, 'prompt_too_large') }
    const input = JSON.parse(raw)
    const model = input.requestedModel ?? input.model
    const version = spawnSync(command[0], [...command.slice(1),'--version'], { encoding:'utf8',timeout:10000,maxBuffer:8192,windowsHide:true,shell:false })
    ensure(version.status === 0 && !version.error, 'cli_version_not_verified')
    const help = spawnSync(command[0], [...command.slice(1),...(input.provider === 'gpt' ? ['exec','--help'] : ['--help'])], { encoding:'utf8',timeout:10000,maxBuffer:131072,windowsHide:true,shell:false })
    ensure(help.status === 0 && !help.error, 'cli_help_not_verified')
    const technical = validateCliSupport(input.provider, version.stdout.trim(), input.cliVersion, help.stdout)
    if (input.provider === 'gemini') policy = createGeminiDenyPolicy(process.env.HOME)
    const generated = spawnSync(command[0], [...command.slice(1),...providerArgs(input.provider,model)], { input:input.prompt,encoding:'utf8',timeout:100000,maxBuffer:524288,windowsHide:true,shell:false })
    ensure(generated.status === 0 && !generated.error, 'provider_execution_failed')
    const result = decodeProviderResult(input.provider,generated.stdout,model,input.validationContext)
    process.stdout.write(JSON.stringify({provider:input.provider,model,requestedModel:model,reportedModel:result.reportedModel,cliVersion:technical.actualVersion,technical,generatedAt:new Date().toISOString(),output:result.output}))
  } catch (e) { console.error(e.code || 'provider_bridge_failed'); process.exitCode = 1 }
  finally { if (policy) { try { policy.cleanup() } catch {} } }
}
