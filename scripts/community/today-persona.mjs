import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTodayPersonas, TODAY_PERSONAS_MAX_BYTES } from '../../assets/today-persona-core.js'

export const todayPersonasRoot = fileURLToPath(new URL('../../', import.meta.url))
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex')
const fail = code => { throw new Error(code) }

export function createPersonaRewrite({ parent, headline, comment, analysis, rawResponse, provenance, createdAt, id = randomUUID() }) {
  if (typeof rawResponse !== 'string' || !provenance || typeof parent?.provenance?.responseSha256 !== 'string') fail('invalid_today_persona_import')
  return { id, parentId: parent.id, parentReportSha256: parent.provenance.responseSha256, agent: parent.agent, symbol: parent.symbol,
    headline, comment, analysis, rawResponse, createdAt, provenance: { ...provenance, responseSha256: hash(rawResponse) } }
}

export function verifyTodayPersonaHashes(value, { today } = {}) {
  const parents = new Map([...(today?.reports || []), ...(today?.reportHistory || [])].map(report => [report.id, report]))
  for (const row of value.rewrites) {
    if (hash(row.rawResponse) !== row.provenance.responseSha256) fail('today_persona_response_hash_mismatch')
    if (today !== undefined) {
      const parent = parents.get(row.parentId)
      if (!parent || hash(parent.report) !== row.parentReportSha256 || parent.provenance.responseSha256 !== row.parentReportSha256) fail('today_persona_parent_hash_mismatch')
    }
  }
  return value
}

/** Publish expressions separately; never mutate the original prices, sources or reports. */
export async function publishTodayPersonas({ snapshot, today, root = todayPersonasRoot, now = Date.now(), catalog } = {}) {
  const source = resolve(root), directory = join(source, 'data'), output = join(directory, 'today-personas.json')
  try { if ((await lstat(source)).isSymbolicLink()) fail('unsafe_today_personas_path') } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(directory, { recursive: true })
  if ((await lstat(directory)).isSymbolicLink()) fail('unsafe_today_personas_path')
  try { if (!(await lstat(output)).isFile() || (await lstat(output)).isSymbolicLink()) fail('unsafe_today_personas_path') } catch (error) { if (error.code !== 'ENOENT') throw error }
  today ||= JSON.parse(await readFile(join(directory, 'today-picks.json'), 'utf8'))
  validateTodayPersonas(snapshot, { today, now, ...(catalog ? { catalog } : {}) })
  verifyTodayPersonaHashes(snapshot, { today })
  const encoded = JSON.stringify(snapshot, null, 2) + '\n'
  if (Buffer.byteLength(encoded) > TODAY_PERSONAS_MAX_BYTES) fail('today_personas_too_large')
  const temporary = join(directory, '.today-personas-' + randomUUID() + '.tmp')
  try { await writeFile(temporary, encoded, { flag: 'wx' }); await rename(temporary, output) }
  catch (error) { await rm(temporary, { force: true }); throw error }
  return { output, rewrites: snapshot.rewrites.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--publish') throw new Error('Usage: node scripts/community/today-persona.mjs --publish <reviewed-snapshot.json>')
  const candidate = resolve(args[1]), info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink() || info.size > TODAY_PERSONAS_MAX_BYTES) fail('invalid_today_personas_candidate')
  const result = await publishTodayPersonas({ snapshot: JSON.parse(await readFile(candidate, 'utf8')) })
  console.log('AI 페르소나 분석 발행:', result.rewrites, '개')
}
