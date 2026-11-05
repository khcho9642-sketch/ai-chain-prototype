import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTodayDiscussion, TODAY_DISCUSSION_MAX_BYTES } from '../../assets/today-discussion-core.js'

export const todayDiscussionRoot = fileURLToPath(new URL('../../', import.meta.url))
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex')
const fail = code => { throw new Error(code) }

/** Import actual raw output without rewriting its bytes or inferring a model identity. */
export function createTodayDiscussionResponse({ parent, agent, text, rawResponse, provenance, createdAt, id = randomUUID() }) {
  if (typeof rawResponse !== 'string' || !provenance || typeof parent?.provenance?.responseSha256 !== 'string') fail('invalid_today_discussion_import')
  return { id, parentId: parent.id, parentReportSha256: parent.provenance.responseSha256, agent, symbol: parent.symbol,
    text, rawResponse, createdAt, provenance: { ...provenance, responseSha256: hash(rawResponse) } }
}

/** Node publication check: browser validation alone cannot authenticate a SHA-256 claim. */
export function verifyTodayDiscussionHashes(value, { today } = {}) {
  const parents = new Map([...(today?.reports || []), ...(today?.reportHistory || [])].map(report => [report.id, report]))
  for (const response of value.responses) {
    if (hash(response.rawResponse) !== response.provenance.responseSha256) fail('today_discussion_response_hash_mismatch')
  }
  if (today !== undefined) {
    for (const response of [...value.responses, ...value.states]) {
      const parent = parents.get(response.parentId)
      if (!parent || hash(parent.report) !== response.parentReportSha256 || parent.provenance.responseSha256 !== response.parentReportSha256) fail('today_discussion_parent_hash_mismatch')
    }
  }
  return value
}

/** Publish a reviewed separate snapshot. This never edits the original Today report file. */
export async function publishTodayDiscussion({ snapshot, today, root = todayDiscussionRoot, now = Date.now(), catalog } = {}) {
  const source = resolve(root), directory = join(source, 'data'), output = join(directory, 'today-discussion.json')
  try { if ((await lstat(source)).isSymbolicLink()) fail('unsafe_today_discussion_path') } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(directory, { recursive: true })
  if ((await lstat(directory)).isSymbolicLink()) fail('unsafe_today_discussion_path')
  try { if (!(await lstat(output)).isFile() || (await lstat(output)).isSymbolicLink()) fail('unsafe_today_discussion_path') } catch (error) { if (error.code !== 'ENOENT') throw error }
  today ||= JSON.parse(await readFile(join(directory, 'today-picks.json'), 'utf8'))
  validateTodayDiscussion(snapshot, { today, now, ...(catalog ? { catalog } : {}) })
  verifyTodayDiscussionHashes(snapshot, { today })
  const encoded = JSON.stringify(snapshot, null, 2) + '\n'
  if (Buffer.byteLength(encoded) > TODAY_DISCUSSION_MAX_BYTES) fail('today_discussion_too_large')
  const temporary = join(directory, '.today-discussion-' + randomUUID() + '.tmp')
  try {
    await writeFile(temporary, encoded, { flag: 'wx' })
    await rename(temporary, output)
  } catch (error) { await rm(temporary, { force: true }); throw error }
  return { output, responses: snapshot.responses.length, states: snapshot.states.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--publish') throw new Error('Usage: node scripts/community/today-discussion.mjs --publish <reviewed-snapshot.json>')
  const candidate = resolve(args[1])
  const info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink() || info.size > TODAY_DISCUSSION_MAX_BYTES) fail('invalid_today_discussion_candidate')
  const result = await publishTodayDiscussion({ snapshot: JSON.parse(await readFile(candidate, 'utf8')) })
  console.log('추천별 AI 교차 의견 발행:', result.responses, '개 · 미발행 상태', result.states, '개')
}
