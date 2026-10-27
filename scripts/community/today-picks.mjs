import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instruments } from '../../assets/instruments.js'
import { kstDate, validateTodaySnapshot } from '../../assets/today-core.js'
import { createEvidenceSource } from '../../server/community/evidence.mjs'
import { ensure, PROMPT_VERSION, validateOutput } from '../../server/community/policy.mjs'
import { runAdapter, validateAdapter } from './ai-cli.mjs'
import { requiredProviderFlags } from './ai-provider.mjs'

export const todayProjectRoot = fileURLToPath(new URL('../../', import.meta.url))
const AGENTS = ['gpt', 'claude', 'gemini']
const fixtureMarker = /(?:fixture|mock|test-only|fake|not-real|example\.com)/i
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const clone = value => JSON.parse(JSON.stringify(value))
const instant = now => typeof now === 'function' ? now() : now
const approvedBridge = fileURLToPath(new URL('./ai-provider.mjs', import.meta.url))
const selectedFields = ['id', 'label', 'sourceUrl', 'observedAt', 'collectedAt', 'symbol']
const adapterFailures = new Set(['cli_version_not_verified', 'cli_help_not_verified', 'unsupported_cli_flag', 'unexpected_model_fallback', 'provider_execution_failed', 'unsafe_policy_directory', 'native_executable_required', 'absolute_cli_command_required', 'cancelled', 'cli_timeout', 'output_too_large', 'cli_launch_failed', 'cli_failed', 'invalid_cli_json'])
const safeReason = error => typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code) ? error.code : adapterFailures.has(error?.message) ? error.message : 'generation_failed'
function fail(code) { const error = new Error(code); error.code = code; throw error }
function inside(base, target) { const part = relative(base, target); return part !== '' && !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep) }
function candidateChecksum(value) { const { checksum, ...body } = value; return digest(body) }
export function sealTodayCandidate(value) { const copy = clone(value); copy.checksum = candidateChecksum(copy); return copy }

/** One shared bounded pool, from already collected structured data; no collector runs here. */
export function dailyCandidatePool({ catalog = instruments, evidenceSource, now = Date.now(), maxBytes = 20000 } = {}) {
  const eligible = catalog.filter(row => row.chains?.some(chain => chain > 0))
  const available = []
  for (const row of eligible) {
    const snapshot = evidenceSource(row.symbol)
    if (!snapshot || snapshot.symbol !== row.symbol || !Array.isArray(snapshot.evidence) || !snapshot.evidence.length) continue
    if (!snapshot.evidence.some(item => item.symbol === row.symbol && item.stale !== true && Number.isFinite(Date.parse(item.observedAt)) && Date.parse(item.observedAt) <= now + 300000 && now - Date.parse(item.observedAt) <= 7 * 86400000)) continue
    const ordered = snapshot.evidence.filter(item => item.symbol === row.symbol).sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)))
    const price = ordered.find(item => item.kind === 'quote' && item.unit !== '%' && item.unit !== '주')
    const recentOther = ordered.find(item => item.kind !== 'quote')
    const evidence = [...new Map([price, recentOther, ordered[0]].filter(Boolean).map(item => [item.id, item])).values()].slice(0, 2)
    const compact = { ...clone(snapshot), evidence: clone(evidence), dataAsOf: evidence.map(item => item.observedAt).sort().at(-1) }
    available.push({ symbol: row.symbol, company: row.name, snapshot: compact })
  }
  available.sort((a, b) => String(b.snapshot.dataAsOf || '').localeCompare(String(a.snapshot.dataAsOf || '')) || a.symbol.localeCompare(b.symbol))
  const candidates = []
  for (const item of available) if (Buffer.byteLength(JSON.stringify([...candidates, item])) <= maxBytes) candidates.push(item)
  return { candidates, eligibleCount: eligible.length, availableCount: available.length, omittedForSize: available.length - candidates.length }
}

async function approvedDailyAdapter(agent, config) {
  if (!config?.enabled) fail('provider_disabled')
  validateAdapter(agent, config)
  ensure(config.dailyPicksApproved === true, 'daily_pick_use_not_approved')
  ensure(await realpath(config.executable) === await realpath(process.execPath), 'official_node_runner_required')
  ensure((config.args.length === 2 || config.args.length === 3) && config.args.every(value => typeof value === 'string' && isAbsolute(value)), 'absolute_cli_command_required')
  ensure(config.args[0] && resolve(config.args[0]) === resolve(approvedBridge), 'official_bridge_required')
  const info = await lstat(approvedBridge)
  ensure(info.isFile() && !info.isSymbolicLink(), 'official_bridge_required')
  ensure(await realpath(config.args[0]) === await realpath(approvedBridge), 'official_bridge_required')
  if (config.args.length === 3) {
    ensure(await realpath(config.args[1]) === await realpath(process.execPath), 'official_node_runner_required')
    const script = await lstat(config.args[2])
    ensure(script.isFile() && !script.isSymbolicLink() && /\.(?:c|m)?js$/i.test(config.args[2]), 'official_cli_script_required')
  }
}

export async function generateTodayPicks({ adapters = {}, catalog = instruments, root = todayProjectRoot, evidenceSource,
  now = Date.now, run = runAdapter, signal, maxCandidateBytes = 20000 } = {}) {
  const startedAt = instant(now), date = kstDate(startedAt)
  evidenceSource ||= createEvidenceSource({ root, now: () => startedAt })
  const pool = dailyCandidatePool({ catalog, evidenceSource, now: startedAt, maxBytes: maxCandidateBytes })
  const result = { schemaVersion: 1, kind: 'today-picks-candidate', timezone: 'Asia/Seoul', editionDate: date,
    generatedAt: new Date(startedAt).toISOString(), candidateCount: pool.candidates.length, eligibleCount: pool.eligibleCount,
    omittedForSize: pool.omittedForSize, coverage: { eligibleCount: pool.eligibleCount, includedCount: pool.candidates.length,
      excludedWithoutFreshEvidence: pool.eligibleCount - pool.availableCount, excludedForSize: pool.omittedForSize }, picks: [], receipts: {}, providerStates: {}, attempted: 0 }
  for (const agent of AGENTS) {
    const config = adapters[agent]
    try {
      await approvedDailyAdapter(agent, config)
      ensure(pool.candidates.length > 0, 'insufficient_fresh_evidence')
      ensure(!signal?.aborted, 'generation_cancelled')
      ensure(kstDate(instant(now)) === date, 'edition_changed_during_generation')
      const job = { agent, task: 'daily-pick', date, messageType: 'opinion', candidates: clone(pool.candidates), context: [], parent: null, previousOpinionId: null }
      result.attempted++
      const generated = await run(agent, config, job, signal)
      const provider = generated.provider, requestedModel = generated.requestedModel ?? generated.model, reportedModel = generated.reportedModel ?? null
      ensure(provider === agent && requestedModel === config.model && generated.cliVersion === config.cliVersion, 'provenance_mismatch')
      ensure(reportedModel === null || reportedModel === requestedModel, 'unexpected_model_fallback')
      const technical = generated.technical
      ensure(technical?.actualVersion === config.cliVersion && Array.isArray(technical.supportedFlags) && requiredProviderFlags(agent).every(flag => technical.supportedFlags.includes(flag)), 'cli_not_verified')
      const valid = validateOutput(generated.output, job)
      if (valid.action === 'skip') { result.providerStates[agent] = { status: 'unavailable', reason: 'model_skipped' }; continue }
      ensure(kstDate(instant(now)) === date, 'edition_changed_during_generation')
      const symbol = generated.output.symbol, selected = pool.candidates.find(row => row.symbol === symbol)
      ensure(selected, 'invalid_daily_pick_symbol')
      const ids = new Set(valid.evidenceIds || generated.output.evidence_ids || [])
      const evidence = selected.snapshot.evidence.filter(row => ids.has(row.id)).map(row => Object.fromEntries(selectedFields.filter(key => row[key] !== undefined).map(key => [key, row[key]])))
      ensure(evidence.length > 0, 'daily_pick_evidence_required')
      const dataAsOf = evidence.map(row => row.observedAt).sort().at(-1), generatedAt = new Date(instant(now)).toISOString(), runId = randomUUID()
      const pick = { id: randomUUID(), agent, symbol, comment: valid.text, createdAt: generatedAt, dataAsOf, evidence,
        provenance: { provider, requestedModel, reportedModel, cliVersion: generated.cliVersion, generatedAt,
          promptVersion: PROMPT_VERSION, runId, execution: 'official-cli', reviewedAt: null } }
      result.picks.push(pick)
      result.receipts[agent] = { execution: 'official-cli', runId, outputDigest: digest(pick), taskDigest: digest(job), technical,
        fixture: run !== runAdapter || generated.fixture === true || fixtureMarker.test(JSON.stringify({ requestedModel, reportedModel, cliVersion: generated.cliVersion, evidence })) }
      result.providerStates[agent] = { status: 'ready', reason: 'awaiting_manual_review' }
    } catch (error) {
      const reason = safeReason(error)
      result.providerStates[agent] = { status: reason === 'provider_disabled' ? 'disabled' : 'blocked', reason }
    }
  }
  result.generatedAt = new Date(instant(now)).toISOString()
  return sealTodayCandidate(result)
}

async function normalRoot(root) {
  const path = resolve(root), info = await lstat(path)
  ensure(info.isDirectory() && !info.isSymbolicLink(), 'unsafe_project_root')
  return realpath(path)
}
async function normalDirectory(root, parts, { create = false } = {}) {
  let cursor = root
  for (const part of parts) {
    cursor = join(cursor, part)
    ensure(inside(root, cursor), 'unsafe_today_path')
    let info
    try { info = await lstat(cursor) } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error
      await mkdir(cursor, { mode: 0o700 }); info = await lstat(cursor)
    }
    ensure(info.isDirectory() && !info.isSymbolicLink(), 'unsafe_today_path')
    ensure(inside(root, await realpath(cursor)), 'unsafe_today_path')
  }
  return cursor
}
async function regularFile(path) {
  const info = await lstat(path)
  ensure(info.isFile() && !info.isSymbolicLink() && info.size <= 2 * 1024 * 1024, 'unsafe_today_file')
  return readFile(path)
}
export async function stageTodayCandidate(candidate, { root = todayProjectRoot } = {}) {
  ensure(candidate?.kind === 'today-picks-candidate' && candidate.checksum === candidateChecksum(candidate), 'invalid_candidate_checksum')
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(candidate.editionDate), 'invalid_candidate_edition')
  root = await normalRoot(root)
  const directory = await normalDirectory(root, ['.local', 'tmp'], { create: true })
  const path = join(directory, `today-picks-${candidate.editionDate}-${randomUUID()}.json`)
  await writeFile(path, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return path
}
function immutablePick(pick) { const value = clone(pick); delete value.provenance.reviewedAt; return value }

/** Explicit manual review only. No DB or service is touched and no model is invoked. */
export async function publishTodayCandidate(candidatePath, { approve = false, root = todayProjectRoot, catalog = instruments, now = Date.now } = {}) {
  ensure(approve === true, 'manual_approval_required')
  root = await normalRoot(root)
  const privateDirectory = await normalDirectory(root, ['.local', 'tmp'])
  const path = resolve(root, candidatePath)
  ensure(dirname(path) === privateDirectory && /^today-picks-[a-zA-Z0-9-]+\.json$/.test(path.slice(privateDirectory.length + 1)), 'private_candidate_required')
  const candidate = JSON.parse((await regularFile(path)).toString('utf8'))
  ensure(candidate.kind === 'today-picks-candidate' && candidate.checksum === candidateChecksum(candidate), 'invalid_candidate_checksum')
  const at = instant(now), date = kstDate(at), publishedAt = new Date(at).toISOString()
  ensure(candidate.editionDate === date && kstDate(Date.parse(candidate.generatedAt)) === date, 'candidate_not_current_edition')
  ensure(Array.isArray(candidate.picks) && candidate.picks.length > 0 && candidate.picks.length <= 3, 'no_generated_picks')
  ensure(new Set(candidate.picks.map(pick => pick.agent)).size === candidate.picks.length, 'duplicate_daily_agent')
  const picks = candidate.picks.map(pick => {
    const receipt = candidate.receipts?.[pick.agent]
    ensure(AGENTS.includes(pick.agent) && receipt?.execution === 'official-cli' && receipt.fixture === false && receipt.runId === pick.provenance?.runId && receipt.outputDigest === digest(pick), 'unverified_execution_receipt')
    ensure(!fixtureMarker.test(JSON.stringify(pick)), 'fixture_publication_forbidden')
    ensure(receipt.technical?.actualVersion === pick.provenance.cliVersion && requiredProviderFlags(pick.agent).every(flag => receipt.technical?.supportedFlags?.includes(flag)), 'cli_not_verified')
    return { ...clone(pick), provenance: { ...clone(pick.provenance), reviewedAt: publishedAt } }
  })
  const providerStates = Object.fromEntries(AGENTS.map(agent => [agent, candidate.providerStates?.[agent] || { status: 'disabled', reason: 'provider_disabled' }]))
  const next = { schemaVersion: 1, timezone: 'Asia/Seoul', editionDate: date, publishedAt, picks, providerStates }
  validateTodaySnapshot(next, { catalog, now: at })
  const data = await normalDirectory(root, ['data']), backupDirectory = await normalDirectory(root, ['.local', 'archive', 'today-picks'], { create: true })
  const destination = join(data, 'today-picks.json'), lockPath = join(privateDirectory, 'today-picks-publish.lock')
  const lock = await open(lockPath, 'wx', 0o600)
  let temporary, backupPath = null
  try {
    let previous = null
    try { previous = await regularFile(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (previous) {
      const old = JSON.parse(previous.toString('utf8'))
      validateTodaySnapshot(old, { catalog, now: at })
      ensure(!old.editionDate || old.editionDate <= date, 'newer_edition_exists')
      if (old.editionDate === date) {
        for (const published of old.picks) {
          const incomingIndex = next.picks.findIndex(pick => pick.agent === published.agent)
          const incoming = next.picks[incomingIndex]
          if (incoming) {
            ensure(digest(immutablePick(incoming)) === digest(immutablePick(published)), 'daily_pick_already_published')
            next.picks[incomingIndex] = published
          }
          else next.picks.push(published)
        }
        for (const published of old.picks) next.providerStates[published.agent] = old.providerStates[published.agent]
      }
      backupPath = join(backupDirectory, `today-picks-${old.editionDate || 'empty'}-${randomUUID()}.json`)
      await writeFile(backupPath, previous, { flag: 'wx', mode: 0o600 })
      ensure(digest((await regularFile(destination)).toString('utf8')) === digest(previous.toString('utf8')), 'public_snapshot_changed')
    }
    for (const pick of next.picks) next.providerStates[pick.agent] = { status: 'ready', reason: 'published' }
    validateTodaySnapshot(next, { catalog, now: at })
    temporary = join(data, `.today-picks-${randomUUID()}.tmp`)
    const reservation = await open(temporary, 'wx', 0o644)
    try { await reservation.writeFile(JSON.stringify(next, null, 2) + '\n'); await reservation.sync() } finally { await reservation.close() }
    await rename(temporary, destination); temporary = null
    return { path: destination, backupPath, editionDate: date, agents: next.picks.map(pick => pick.agent), snapshot: next }
  } finally {
    if (temporary) await unlink(temporary).catch(() => {})
    await lock.close(); await unlink(lockPath)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--generate') {
    let config = {}
    try { config = JSON.parse(await readFile(process.env.AI_WORKER_CONFIG || join(todayProjectRoot, '.local', 'ai-worker.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const candidate = await generateTodayPicks({ adapters: config.adapters || {} })
    const path = await stageTodayCandidate(candidate)
    console.log(JSON.stringify({ candidate: relative(todayProjectRoot, path), editionDate: candidate.editionDate, attempted: candidate.attempted,
      generated: candidate.picks.length, providerStates: candidate.providerStates, published: false }))
    return
  }
  if (args.length === 3 && args[0] === '--publish' && args[2] === '--approve') {
    const result = await publishTodayCandidate(args[1], { approve: true })
    console.log(JSON.stringify({ path: relative(todayProjectRoot, result.path), backup: result.backupPath ? relative(todayProjectRoot, result.backupPath) : null,
      editionDate: result.editionDate, agents: result.agents, actualDeploymentPerformed: false }))
    return
  }
  fail('usage_generate_or_publish_with_approve')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`Today picks stopped: ${safeReason(error)}`); process.exitCode = 1 })
