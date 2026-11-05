import { instruments } from './instruments.js'
import { TODAY_AGENTS, validateTodaySnapshot } from './today-core.js'

export const TODAY_DISCUSSION_MAX_BYTES = 12 * 1024 * 1024
const MAX_ROWS = 2000
const FUTURE_ALLOWANCE = 5 * 60 * 1000
const RESPONSE_KEYS = ['id', 'parentId', 'parentReportSha256', 'agent', 'symbol', 'text', 'rawResponse', 'createdAt', 'provenance']
const FOLLOW_UP_KEYS = [...RESPONSE_KEYS, 'replyToIds']
const PROVENANCE_KEYS = ['provider', 'requestedModel', 'reportedModel', 'cliName', 'cliVersion', 'generatedAt', 'promptVersion', 'runId', 'responseSha256', 'execution', 'reviewedAt']
const STATE_KEYS = ['parentId', 'parentReportSha256', 'agent', 'symbol', 'status', 'reason', 'checkedAt']
const CLI_NAMES = { gpt: ['codex', 'chatgpt-web'], claude: ['claude-code', 'claude-web'], gemini: ['gemini', 'gemini-cli', 'gemini-web', 'antigravity'] }
const REASONS = new Set(['pending_generation', 'cli_unavailable', 'authentication_required', 'provider_disabled', 'terms_not_cleared', 'consumer_client_retired', 'model_unavailable', 'model_skipped', 'generation_failed', 'response_rejected', 'awaiting_manual_review', 'unsupported_cli_version', 'unexpected_model_fallback', 'rate_limited', 'provider_verification_pending'])
const SIMULATION = /(?:fixture|(?:^|[\s_-])test(?:$|[\s_-])|test[\s_-]*only|not[\s_-]*real|mock|synthetic|demo[\s_-]*only)/iu
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keysAre = (value, keys) => object(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key))
const fail = code => { throw new Error(code) }
const clean = (value, min, max) => typeof value === 'string' && value === value.trim().normalize('NFC') && [...value].length >= min && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z')
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const raw = value => typeof value === 'string' && value.trim().length > 0 && [...value].length <= 16000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
const unsafeInvestmentClaim = value => /수익(?:을)?\s*보장|무조건\s*(?:매수|사라)|내부\s*정보/iu.test(value.replace(/수익(?:을)?\s*보장(?:(?:이|은)?\s*(?:아님|아니(?:야|다|고|라|라는|며)|아냐)|(?:을\s*)?(?:하)?지\s*않(?:아|는다|는|을|았))/gu, ''))
const pairKey = row => JSON.stringify([row.parentId, row.agent])

function containsText(rawResponse, text) {
  if (rawResponse.includes(text)) return true
  let value
  try { value = JSON.parse(rawResponse.trim().replace(/^```(?:json)?\s*\n/iu, '').replace(/\n```$/u, '')) } catch { return false }
  const inspect = (row, depth = 0) => {
    if (depth > 12 || row === null || typeof row !== 'object') return false
    if (!Array.isArray(row) && (row.text === text || row.comment === text)) return true
    return Object.values(row).some(child => inspect(child, depth + 1))
  }
  return inspect(value)
}

function anchored(row, parents, pairs) {
  const parent = parents.get(row.parentId)
  if (!parent || !Object.hasOwn(TODAY_AGENTS, row.agent) || row.agent === parent.agent || row.symbol !== parent.symbol ||
    row.parentReportSha256 !== parent.provenance.responseSha256 || !sha(row.parentReportSha256) || pairs.has(pairKey(row))) fail('invalid_today_discussion_parent')
  pairs.add(pairKey(row))
  return parent
}

/** Validate displayable peer opinions against unchanged, trusted published reports. */
export function validateTodayDiscussion(value, { today, catalog = instruments, now = Date.now() } = {}) {
  const instant = now instanceof Date ? now.getTime() : now
  if (!Number.isFinite(instant)) fail('invalid_today_discussion_clock')
  validateTodaySnapshot(today, { catalog, now: instant })
  const rootKeys = ['schemaVersion', 'publishedAt', 'responses', 'states', ...(Object.hasOwn(value || {}, 'followUps') ? ['followUps'] : [])]
  if (!keysAre(value, rootKeys) || value.schemaVersion !== 1 ||
    !Array.isArray(value.responses) || !Array.isArray(value.states) || (Object.hasOwn(value, 'followUps') && !Array.isArray(value.followUps)) ||
    value.responses.length + value.states.length + (value.followUps?.length || 0) > MAX_ROWS ||
    (value.publishedAt !== null && (!time(value.publishedAt) || Date.parse(value.publishedAt) > instant + FUTURE_ALLOWANCE)) ||
    (value.publishedAt === null && (value.responses.length || value.states.length || value.followUps?.length))) fail('invalid_today_discussion_snapshot')
  const parents = new Map([...(today.reports || []), ...(today.reportHistory || [])].map(report => [report.id, report]))
  const pairs = new Set(), ids = new Set(), runs = new Map()
  const published = value.publishedAt === null ? null : Date.parse(value.publishedAt)
  for (const response of value.responses) {
    if (!keysAre(response, RESPONSE_KEYS) || !clean(response.id, 1, 160) || SIMULATION.test(response.id) || ids.has(response.id) ||
      !clean(response.parentId, 1, 160) || !clean(response.symbol, 1, 40) || !clean(response.text, 1, 300) ||
      /<\/?[a-z]|https?:\/\/|www\./iu.test(response.text) || unsafeInvestmentClaim(response.text) ||
      (/^community-banmal-/u.test(response.provenance?.promptVersion || '') && /(?:합니다|입니다|됩니다|있습니다|없습니다|드립니다|바랍니다|겠습니다|해요|이에요|예요|했어요|돼요|네요|어요|아요|세요)(?=[.!?…\s"'”’]|$)/u.test(response.text)) ||
      !raw(response.rawResponse) || !containsText(response.rawResponse, response.text) || !time(response.createdAt) ||
      !keysAre(response.provenance, PROVENANCE_KEYS)) fail('invalid_today_discussion_response')
    const parent = anchored(response, parents, pairs), provenance = response.provenance
    const web = provenance.cliName?.endsWith('-web')
    if (provenance.provider !== response.agent || provenance.execution !== 'owner-reviewed-one-off' ||
      !CLI_NAMES[response.agent].includes(provenance.cliName) || !clean(provenance.requestedModel, 1, 120) ||
      !(provenance.reportedModel === null || clean(provenance.reportedModel, 1, 120)) ||
      (provenance.reportedModel !== null && provenance.reportedModel !== provenance.requestedModel &&
        !(!web && provenance.requestedModel === 'native-default')) ||
      (web ? provenance.cliVersion !== null || provenance.reportedModel !== null : !clean(provenance.cliVersion, 1, 120)) ||
      !clean(provenance.promptVersion, 1, 120) || !clean(provenance.runId, 1, 160) ||
      [provenance.requestedModel, provenance.reportedModel || '', provenance.cliVersion || '', provenance.promptVersion, provenance.runId].some(item => SIMULATION.test(item)) ||
      !sha(provenance.responseSha256) || !time(provenance.generatedAt) || !time(provenance.reviewedAt)) fail('invalid_today_discussion_provenance')
    const generated = Date.parse(provenance.generatedAt), reviewed = Date.parse(provenance.reviewedAt), created = Date.parse(response.createdAt)
    if (generated < Date.parse(parent.createdAt) || generated > reviewed || reviewed > created || created > published) fail('invalid_today_discussion_chronology')
    // One authentic batch may produce multiple peer opinions; reused runs must
    // retain the exact same raw bytes and provenance rather than claim a new run.
    const runSignature = JSON.stringify([PROVENANCE_KEYS.map(key => provenance[key]), response.rawResponse])
    if (runs.has(provenance.runId) && runs.get(provenance.runId) !== runSignature) fail('invalid_today_discussion_provenance')
    ids.add(response.id); runs.set(provenance.runId, runSignature)
  }
  const responsesById = new Map(value.responses.map(response => [response.id, response]))
  const followed = new Set(), followCounts = new Map()
  for (const response of value.followUps || []) {
    if (!keysAre(response, FOLLOW_UP_KEYS) || !clean(response.id, 1, 160) || SIMULATION.test(response.id) || ids.has(response.id) ||
      !clean(response.parentId, 1, 160) || !clean(response.symbol, 1, 40) || !clean(response.text, 1, 300) ||
      /<\/?[a-z]|https?:\/\/|www\./iu.test(response.text) || unsafeInvestmentClaim(response.text) ||
      /(?:합니다|입니다|됩니다|있습니다|없습니다|드립니다|바랍니다|겠습니다|해요|이에요|예요|했어요|돼요|네요|어요|아요|세요)(?=[.!?…\s"'”’]|$)/u.test(response.text) ||
      !raw(response.rawResponse) || !containsText(response.rawResponse, response.text) || !time(response.createdAt) ||
      !keysAre(response.provenance, PROVENANCE_KEYS)) fail('invalid_today_discussion_follow_up')
    const parent = parents.get(response.parentId)
    if (!parent || !Object.hasOwn(TODAY_AGENTS, response.agent) || response.agent !== parent.agent || response.symbol !== parent.symbol ||
      response.parentReportSha256 !== parent.provenance.responseSha256 || !sha(response.parentReportSha256) || (followCounts.get(parent.id) || 0) >= 2) fail('invalid_today_discussion_follow_up_parent')
    if (!Array.isArray(response.replyToIds) || response.replyToIds.length !== 1 ||
      followed.has(response.replyToIds[0]) || response.replyToIds.some(id => {
        const peer = responsesById.get(id)
        return !peer || peer.parentId !== response.parentId || peer.parentReportSha256 !== response.parentReportSha256 || peer.symbol !== response.symbol
      })) fail('invalid_today_discussion_reply_to')
    const provenance = response.provenance, web = provenance.cliName?.endsWith('-web')
    if (provenance.provider !== response.agent || provenance.execution !== 'owner-reviewed-one-off' ||
      !CLI_NAMES[response.agent].includes(provenance.cliName) || !clean(provenance.requestedModel, 1, 120) ||
      !(provenance.reportedModel === null || clean(provenance.reportedModel, 1, 120)) ||
      (provenance.reportedModel !== null && provenance.reportedModel !== provenance.requestedModel && !(!web && provenance.requestedModel === 'native-default')) ||
      (web ? provenance.cliVersion !== null || provenance.reportedModel !== null : !clean(provenance.cliVersion, 1, 120)) ||
      !clean(provenance.promptVersion, 1, 120) || !clean(provenance.runId, 1, 160) ||
      [provenance.requestedModel, provenance.reportedModel || '', provenance.cliVersion || '', provenance.promptVersion, provenance.runId].some(item => SIMULATION.test(item)) ||
      !sha(provenance.responseSha256) || !time(provenance.generatedAt) || !time(provenance.reviewedAt)) fail('invalid_today_discussion_provenance')
    const earliest = Math.max(Date.parse(parent.createdAt), ...response.replyToIds.map(id => Date.parse(responsesById.get(id).createdAt)))
    const generated = Date.parse(provenance.generatedAt), reviewed = Date.parse(provenance.reviewedAt), created = Date.parse(response.createdAt)
    if (generated < earliest || generated > reviewed || reviewed > created || created > published) fail('invalid_today_discussion_chronology')
    const runSignature = JSON.stringify([PROVENANCE_KEYS.map(key => provenance[key]), response.rawResponse])
    if (runs.has(provenance.runId) && runs.get(provenance.runId) !== runSignature) fail('invalid_today_discussion_provenance')
    ids.add(response.id); followed.add(response.replyToIds[0]); followCounts.set(parent.id, (followCounts.get(parent.id) || 0) + 1); runs.set(provenance.runId, runSignature)
  }
  for (const state of value.states) {
    if (!keysAre(state, STATE_KEYS) || !clean(state.parentId, 1, 160) || !clean(state.symbol, 1, 40) ||
      !['unavailable', 'blocked', 'pending'].includes(state.status) || !REASONS.has(state.reason) || !time(state.checkedAt)) fail('invalid_today_discussion_state')
    const parent = anchored(state, parents, pairs)
    if (Date.parse(state.checkedAt) < Date.parse(parent.createdAt) || Date.parse(state.checkedAt) > published) fail('invalid_today_discussion_chronology')
  }
  return value
}

/** Hash binding is repeated here so stale peer text is never moved to a replacement report. */
export function todayDiscussionForReport(value, report) {
  const matches = row => object(row) && row.parentId === report?.id && row.parentReportSha256 === report?.provenance?.responseSha256 &&
    row.symbol === report?.symbol && Object.hasOwn(TODAY_AGENTS, row.agent) && row.agent !== report?.agent
  const matchesOwn = row => object(row) && row.parentId === report?.id && row.parentReportSha256 === report?.provenance?.responseSha256 &&
    row.symbol === report?.symbol && Object.hasOwn(TODAY_AGENTS, row.agent) && row.agent === report?.agent
  return { responses: (Array.isArray(value?.responses) ? value.responses : []).filter(matches), states: (Array.isArray(value?.states) ? value.states : []).filter(matches),
    followUps: (Array.isArray(value?.followUps) ? value.followUps : []).filter(matchesOwn) }
}
