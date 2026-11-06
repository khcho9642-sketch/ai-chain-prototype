import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalDebatePacket, DEBATE_MAX_BYTES, selectDebateTopic, validateDebateDay, validateDebateIndex } from '../../assets/debate-core.js'
import { analysisPrompt } from '../../server/community/debate-prompts.mjs'

export const debateRoot = fileURLToPath(new URL('../../', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const fail = code => { throw new Error(code) }
export const hashDebatePacket = value => hash(canonicalDebatePacket(value))
export function verifyDebateHashes(day) {
  if (hashDebatePacket(day.packet) !== day.packetSha256) fail('debate_packet_hash_mismatch')
  const runs = new Map()
  for (const row of [...day.stances, ...day.thread, ...(day.summary ? [day.summary] : [])]) {
    const p = row.provenance
    if (hash(row.rawResponse) !== p.responseSha256) fail('debate_response_hash_mismatch')
    const signature = JSON.stringify([p, row.rawResponse])
    if (runs.has(p.runId) && runs.get(p.runId) !== signature) fail('debate_reused_run_mismatch')
    runs.set(p.runId, signature)
  }
  return day
}

const emptyIndex = () => ({ schemaVersion: 1, publishedAt: null, latestDate: null, days: [] })
async function readJson(path, maxBytes = DEBATE_MAX_BYTES) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) fail('invalid_debate_file')
  return JSON.parse(await readFile(path, 'utf8'))
}
/** Build and API loaders only publish listed, verified day files. */
export async function loadPublishedDebates(root = debateRoot, { allowMissing = true, now = Date.now() } = {}) {
  const directory = join(resolve(root), 'data', 'debate')
  let index
  try { index = validateDebateIndex(await readJson(join(directory, 'index.json'))) }
  catch (error) { if (allowMissing && error.code === 'ENOENT') return { index: emptyIndex(), days: [] }; throw error }
  const days = []
  for (const entry of index.days) {
    const day = verifyDebateHashes(validateDebateDay(await readJson(join(directory, entry.date + '.json')), { now }))
    if (day.id !== entry.id || day.date !== entry.date || canonicalDebatePacket(day.topic) !== canonicalDebatePacket(entry.topic) || day.issue !== entry.issue) fail('debate_manifest_mismatch')
    days.push(day)
  }
  return { index, days }
}

async function safeDirectory(directory) {
  await mkdir(directory, { recursive: true })
  if ((await lstat(directory)).isSymbolicLink()) fail('unsafe_debate_path')
}
async function atomicWrite(path, text) {
  const temporary = path + '.' + process.pid + '.' + Date.now() + '.tmp'
  try { await writeFile(temporary, text, { flag: 'wx' }); await rename(temporary, path) }
  catch (error) { await rm(temporary, { force: true }); throw error }
}
/** A published session is immutable. A later run creates another session file. */
export async function publishDebateDay({ day, root = debateRoot, now = Date.now() } = {}) {
  verifyDebateHashes(validateDebateDay(day, { now }))
  const directory = join(resolve(root), 'data', 'debate')
  await safeDirectory(resolve(root)); await safeDirectory(join(resolve(root), 'data')); await safeDirectory(directory)
  const lock = join(directory, '.publish.lock')
  try { await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString() }) + '\n', { flag: 'wx' }) }
  catch (error) { if (error.code === 'EEXIST') fail('debate_publication_busy'); throw error }
  try {
  const { index } = await loadPublishedDebates(root, { now })
  const path = join(directory, day.date + '.json'), encoded = JSON.stringify(day, null, 2) + '\n'
  if (Buffer.byteLength(encoded) > DEBATE_MAX_BYTES) fail('debate_day_too_large')
  let existing
  try { existing = await readJson(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existing && canonicalDebatePacket(existing) !== canonicalDebatePacket(day)) fail('debate_published_day_immutable')
  const duplicate = index.days.find(row => row.date === day.date || row.id === day.id)
  if (duplicate && (duplicate.date !== day.date || duplicate.id !== day.id)) fail('debate_identity_conflict')
  // The manifest is the publication boundary. A date file is create-only, even
  // if another writer does not participate in this coordinator's lock.
  if (!existing) await writeFile(path, encoded, { flag: 'wx' })
  if (duplicate) return { path, index: join(directory, 'index.json'), days: index.days.length, unchanged: true }
  const days = [...index.days, { id: day.id, date: day.date, topic: day.topic, issue: day.issue }].sort((a, b) => b.date.localeCompare(a.date))
  const next = validateDebateIndex({ schemaVersion: 1, publishedAt: new Date(now).toISOString(), latestDate: days[0].date, days })
  await atomicWrite(join(directory, 'index.json'), JSON.stringify(next, null, 2) + '\n')
  return { path, index: join(directory, 'index.json'), days: next.days.length, unchanged: false }
  } finally { await rm(lock) }
}

/** Prepare equal source packets/prompts; this never silently invokes a provider. */
export async function prepareDebate({ marketSnapshot, rippleSnapshot, curated, output = '.local/debate-prepared', root = debateRoot, now = Date.now() } = {}) {
  const selection = selectDebateTopic({ marketSnapshot, rippleSnapshot, curated, now })
  if (!selection) fail('debate_no_closed_topic')
  const packet = { schemaVersion: 1, ...selection, sources: [{ label: 'Yahoo Finance · 확정 종가', url: selection.closePrice.sourceUrl }], fundamentals: null,
    warnings: ['확정 종가와 일별 변화만 수집됐다. 실적·전망·가격 범위는 별도 공식 근거가 없으면 만들지 않는다.'] }
  const directory = resolve(root, output)
  await safeDirectory(directory)
  await writeFile(join(directory, 'packet.json'), JSON.stringify(packet, null, 2) + '\n')
  await writeFile(join(directory, 'packet.sha256'), hashDebatePacket(packet) + '\n')
  await Promise.all(['gpt', 'claude', 'gemini'].map(agent => writeFile(join(directory, agent + '-analysis-prompt.txt'), analysisPrompt({ agent, packet }) + '\n')))
  return { directory, ticker: selection.topic.ticker, date: selection.date, packetSha256: hashDebatePacket(packet) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, input, output] = process.argv.slice(2)
  if (command === '--publish' && input && !output) console.log(await publishDebateDay({ day: await readJson(resolve(input)) }))
  else if (command === '--validate' && input && !output) { verifyDebateHashes(validateDebateDay(await readJson(resolve(input)))); console.log('토론 자료 검증 완료') }
  else if (command === '--prepare' && input) console.log(await prepareDebate({ marketSnapshot: await readJson(resolve(input), 64 * 1024 * 1024), output: output || '.local/debate-prepared' }))
  else throw new Error('Usage: node scripts/community/debate.mjs --prepare <market.json> [private-output] | --validate <reviewed-day.json> | --publish <reviewed-day.json>')
}
