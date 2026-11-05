import { instruments } from './instruments.js'
import { TODAY_AGENTS, validateTodaySnapshot } from './today-core.js'

export const TODAY_PERSONAS_MAX_BYTES = 12 * 1024 * 1024
const KEYS = ['id', 'parentId', 'parentReportSha256', 'agent', 'symbol', 'headline', 'comment', 'analysis', 'rawResponse', 'createdAt', 'provenance']
const PROVENANCE_KEYS = ['provider', 'requestedModel', 'reportedModel', 'cliName', 'cliVersion', 'generatedAt', 'promptVersion', 'runId', 'responseSha256', 'execution', 'reviewedAt']
const CLI_NAMES = { gpt: ['codex', 'chatgpt-web'], claude: ['claude-code', 'claude-web'], gemini: ['gemini', 'gemini-cli', 'gemini-web', 'antigravity'] }
const SIMULATION = /(?:fixture|(?:^|[\s_-])test(?:$|[\s_-])|test[\s_-]*only|not[\s_-]*real|mock|synthetic|demo[\s_-]*only)/iu
const POLITE = /(?:합니다|입니다|됩니다|있습니다|없습니다|드립니다|바랍니다|겠습니다|해요|이에요|예요|했어요|돼요|네요|어요|아요|세요)(?=[.!?…\s"'”’]|$)/u
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keysAre = (value, keys) => object(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key))
const fail = code => { throw new Error(code) }
const clean = (value, min, max) => typeof value === 'string' && value === value.trim().normalize('NFC') && [...value].length >= min && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z')
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const unsafeInvestmentClaim = value => /수익(?:을)?\s*보장|무조건\s*(?:매수|사라)|내부\s*정보/iu.test(value.replace(/수익(?:을)?\s*보장(?:(?:이|은)?\s*(?:아님|아니(?:야|다|고|라|라는|며)|아냐)|(?:을\s*)?(?:하)?지\s*않(?:아|는다|는|을|았))/gu, ''))
const safeText = value => !/<\/?[a-z]|https?:\/\/|www\./iu.test(value) && !unsafeInvestmentClaim(value) && !POLITE.test(value)

function containsRewrite(rawResponse, rewrite) {
  let value
  try { value = JSON.parse(rawResponse.trim().replace(/^```(?:json)?\s*\n/iu, '').replace(/\n```$/u, '')) } catch { return false }
  const inspect = (row, depth = 0) => {
    if (depth > 12 || !object(row) && !Array.isArray(row)) return false
    if (row.headline === rewrite.headline && row.comment === rewrite.comment && row.analysis === rewrite.analysis) return true
    return Object.values(row).some(child => inspect(child, depth + 1))
  }
  return inspect(value)
}

/** A separate expression layer anchored to the unchanged source report. */
export function validateTodayPersonas(value, { today, catalog = instruments, now = Date.now() } = {}) {
  const instant = now instanceof Date ? now.getTime() : now
  if (!Number.isFinite(instant)) fail('invalid_today_personas_clock')
  validateTodaySnapshot(today, { catalog, now: instant })
  if (!keysAre(value, ['schemaVersion', 'publishedAt', 'rewrites']) || value.schemaVersion !== 1 || !Array.isArray(value.rewrites) || value.rewrites.length > 100 ||
    (value.publishedAt !== null && (!time(value.publishedAt) || Date.parse(value.publishedAt) > instant + 300000)) ||
    (value.publishedAt === null && value.rewrites.length)) fail('invalid_today_personas_snapshot')
  const parents = new Map([...(today.reports || []), ...(today.reportHistory || [])].map(report => [report.id, report]))
  const ids = new Set(), rewritten = new Set(), runs = new Map()
  for (const row of value.rewrites) {
    if (!keysAre(row, KEYS) || !clean(row.id, 1, 160) || SIMULATION.test(row.id) || ids.has(row.id) ||
      !clean(row.headline, 12, 60) || !clean(row.comment, 40, 220) || !clean(row.analysis, 400, 2400) ||
      ![row.headline, row.comment, row.analysis].every(safeText) ||
      typeof row.rawResponse !== 'string' || !clean(row.rawResponse.trim(), 1, 24000) || !containsRewrite(row.rawResponse, row) ||
      !time(row.createdAt) || !keysAre(row.provenance, PROVENANCE_KEYS)) fail('invalid_today_persona_rewrite')
    const parent = parents.get(row.parentId)
    if (!parent || !Object.hasOwn(TODAY_AGENTS, row.agent) || row.agent !== parent.agent || row.symbol !== parent.symbol ||
      row.parentReportSha256 !== parent.provenance.responseSha256 || !sha(row.parentReportSha256) || rewritten.has(row.parentId)) fail('invalid_today_persona_parent')
    const p = row.provenance, web = p.cliName?.endsWith('-web')
    if (p.provider !== row.agent || p.execution !== 'owner-reviewed-one-off' || !CLI_NAMES[row.agent].includes(p.cliName) ||
      !clean(p.requestedModel, 1, 120) || !(p.reportedModel === null || clean(p.reportedModel, 1, 120)) ||
      (p.reportedModel !== null && p.reportedModel !== p.requestedModel && !(!web && p.requestedModel === 'native-default')) ||
      (web ? p.cliVersion !== null || p.reportedModel !== null : !clean(p.cliVersion, 1, 120)) ||
      !clean(p.promptVersion, 1, 120) || !clean(p.runId, 1, 160) ||
      [p.requestedModel, p.reportedModel || '', p.cliVersion || '', p.promptVersion, p.runId].some(item => SIMULATION.test(item)) ||
      !sha(p.responseSha256) || !time(p.generatedAt) || !time(p.reviewedAt)) fail('invalid_today_persona_provenance')
    if (Date.parse(p.generatedAt) < Date.parse(parent.createdAt) || Date.parse(p.generatedAt) > Date.parse(p.reviewedAt) ||
      Date.parse(p.reviewedAt) > Date.parse(row.createdAt) || Date.parse(row.createdAt) > Date.parse(value.publishedAt)) fail('invalid_today_persona_chronology')
    const signature = JSON.stringify([PROVENANCE_KEYS.map(key => p[key]), row.rawResponse])
    if (runs.has(p.runId) && runs.get(p.runId) !== signature) fail('invalid_today_persona_provenance')
    ids.add(row.id); rewritten.add(row.parentId); runs.set(p.runId, signature)
  }
  return value
}

export function getPersonaForReport(value, report) {
  if (!Array.isArray(value?.rewrites)) return null
  return value.rewrites.find(row => object(row) && row.parentId === report?.id && row.parentReportSha256 === report?.provenance?.responseSha256 &&
    row.agent === report?.agent && Object.hasOwn(TODAY_AGENTS, row.agent) && row.symbol === report?.symbol) || null
}
