import { instruments } from './instruments.js'

export const TODAY_AGENTS = Object.freeze({
  gpt: Object.freeze({ name: 'GPT' }),
  claude: Object.freeze({ name: 'Claude' }),
  gemini: Object.freeze({ name: 'Gemini' }),
})

const ROOT_KEYS = ['schemaVersion', 'timezone', 'editionDate', 'publishedAt', 'picks', 'providerStates']
const PICK_KEYS = ['id', 'agent', 'symbol', 'comment', 'createdAt', 'dataAsOf', 'evidence', 'provenance']
const RESPONSE_KEYS = [...PICK_KEYS, 'parentId']
const REPORT_KEYS = [...PICK_KEYS, 'kind', 'report', 'reviewNotes']
const CONVERSATION_COMMENT_KEYS = ['id', 'text', 'response', 'sourceReportSha256', 'createdAt', 'provenance']
const PROVENANCE_KEYS = ['provider', 'requestedModel', 'reportedModel', 'cliVersion', 'generatedAt', 'promptVersion', 'runId', 'execution', 'reviewedAt']
const REPORT_PROVENANCE_KEYS = [...PROVENANCE_KEYS, 'cliName', 'responseSha256']
const REPORT_CLI_NAMES = Object.freeze({ gpt: 'codex', claude: 'claude-code', gemini: 'antigravity' })
const EVIDENCE_KEYS = ['id', 'label', 'sourceUrl', 'observedAt', 'collectedAt']
const FAIR_VALUE_KEYS = ['price', 'currency', 'asOf', 'method', 'assumptions', 'evidenceIds']
const FUTURE_ALLOWANCE = 5 * 60 * 1000
const SIMULATION = /(?:fixture|(?:^|[\s_-])test(?:$|[\s_-])|test[\s_-]*only|not[\s_-]*real|mock|synthetic|demo[\s_-]*only)/iu
const fail = code => { throw new Error(code) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keysAre = (value, keys, optional = []) => object(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key) || optional.includes(key))
const cleanText = (value, min, max) => typeof value === 'string' && value === value.trim().normalize('NFC') && [...value].length >= min && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
// Preserve the original CLI response bytes, including its final line ending.
const nativeReport = value => typeof value === 'string' && value.normalize('NFC') === value && value.trim().length > 0 && [...value].length <= 16000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z')
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const clock = now => {
  const value = now instanceof Date ? now.getTime() : now
  if (!Number.isFinite(value)) fail('invalid_today_clock')
  return value
}

export function kstDate(now = Date.now()) {
  return new Date(clock(now) + 9 * 3600000).toISOString().slice(0, 10)
}

function publicSource(value) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && !url.username && !url.password && !SIMULATION.test(value) &&
      !/(?:^|\.)(?:example\.(?:com|org|net)|localhost|local|invalid|example)$/u.test(host) &&
      !/^(?:\[|\d{1,3}(?:\.\d{1,3}){3}$)/u.test(host)
  } catch { return false }
}

function validateMessage(pick, { value, eligible, ids, runs, keys, min, max, error, fairValueAllowed = false, reviewedReport = false }) {
    if (!keysAre(pick, keys, ['businessProfile', ...(fairValueAllowed ? ['fairValue'] : []), ...(reviewedReport ? ['conversationComment'] : [])]) || !Object.hasOwn(TODAY_AGENTS, pick.agent) ||
      !cleanText(pick.id, 1, 160) || ids.has(pick.id) || SIMULATION.test(pick.id) || !cleanText(pick.symbol, 1, 40) || !eligible.has(pick.symbol) ||
      !cleanText(pick.comment, min, max) || /<\/?[a-z]|https?:\/\/|www\./iu.test(pick.comment) ||
      /수익\s*보장|무조건\s*(?:매수|사라)|내부\s*정보/iu.test(pick.comment) ||
      !time(pick.createdAt) || !time(pick.dataAsOf) || !Array.isArray(pick.evidence) || !pick.evidence.length || pick.evidence.length > 12 ||
      !keysAre(pick.provenance, reviewedReport ? REPORT_PROVENANCE_KEYS : PROVENANCE_KEYS)) fail(error)
    if (reviewedReport && (!nativeReport(pick.report) || /<\/?[a-z]/iu.test(pick.report) || !pick.report.includes(pick.comment) ||
        pick.kind !== (pick.agent === 'claude' ? 'earnings-review' : 'stock-opinion') ||
        (pick.kind === 'earnings-review' && Object.hasOwn(pick, 'fairValue')) ||
        !Array.isArray(pick.reviewNotes) || !pick.reviewNotes.length || pick.reviewNotes.length > 16 ||
        pick.reviewNotes.some(note => !cleanText(note, 1, 1500) || /<\/?[a-z]/iu.test(note)) || new Set(pick.reviewNotes).size !== pick.reviewNotes.length)) fail('invalid_today_report')
    if (pick.businessProfile !== undefined) {
      const profile = pick.businessProfile
      if (!keysAre(profile, ['symbol','role','sourceUrl','reviewedAt']) || profile.symbol !== pick.symbol ||
          !cleanText(profile.role, 1, 240) || !publicSource(profile.sourceUrl) || !date(profile.reviewedAt) ||
          profile.reviewedAt > value.editionDate) fail('invalid_today_business_source')
    }
    const provenance = pick.provenance
  if (provenance.provider !== pick.agent || provenance.execution !== (reviewedReport ? 'owner-reviewed-one-off' : 'official-cli') ||
      (reviewedReport && (provenance.cliName !== REPORT_CLI_NAMES[pick.agent] || typeof provenance.responseSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(provenance.responseSha256))) ||
      !cleanText(provenance.requestedModel, 1, 120) || !(provenance.reportedModel === null || cleanText(provenance.reportedModel, 1, 120)) ||
      (provenance.reportedModel !== null && provenance.reportedModel !== provenance.requestedModel) ||
      !cleanText(provenance.cliVersion, 1, 120) || !cleanText(provenance.promptVersion, 1, 120) || !cleanText(provenance.runId, 1, 160) || runs.has(provenance.runId) ||
      [provenance.requestedModel, provenance.reportedModel || '', provenance.cliVersion, provenance.promptVersion, provenance.runId].some(text => SIMULATION.test(text)) ||
      !time(provenance.generatedAt) || !time(provenance.reviewedAt)) fail('invalid_today_provenance')
  const generated = Date.parse(provenance.generatedAt), created = Date.parse(pick.createdAt), reviewed = Date.parse(provenance.reviewedAt), published = Date.parse(value.publishedAt)
  if (generated > created || created > published || generated > reviewed || reviewed > published ||
      (reviewedReport && reviewed > created) ||
      (reviewedReport ? [created, reviewed] : [generated, created, reviewed]).some(ms => kstDate(ms) !== value.editionDate)) fail('invalid_today_chronology')
  const evidenceLimit = (reviewedReport ? reviewed : generated) + FUTURE_ALLOWANCE
  const evidenceIds = new Set()
  for (const evidence of pick.evidence) {
    if (!keysAre(evidence, EVIDENCE_KEYS, ['symbol']) || !cleanText(evidence.id, 1, 160) || SIMULATION.test(evidence.id) || evidenceIds.has(evidence.id) ||
        !cleanText(evidence.label, 1, 240) || !publicSource(evidence.sourceUrl) || (evidence.symbol !== undefined && evidence.symbol !== pick.symbol) ||
        !time(evidence.observedAt) || !time(evidence.collectedAt) || Date.parse(evidence.observedAt) > Date.parse(evidence.collectedAt) ||
        Date.parse(evidence.collectedAt) > evidenceLimit) fail('invalid_today_evidence')
    evidenceIds.add(evidence.id)
  }
  // A new fetch or publication must never turn old observations into today's data.
  if (Date.parse(pick.dataAsOf) !== Math.max(...pick.evidence.map(row => Date.parse(row.observedAt))) || Date.parse(pick.dataAsOf) > evidenceLimit) fail('invalid_today_data_as_of')
  if (Object.hasOwn(pick, 'fairValue')) {
    const estimate = pick.fairValue
    if (!keysAre(estimate, FAIR_VALUE_KEYS) || !Number.isFinite(estimate.price) || estimate.price <= 0 ||
        typeof estimate.currency !== 'string' || !/^[A-Z]{3}$/u.test(estimate.currency) ||
        !time(estimate.asOf) || Date.parse(estimate.asOf) > generated ||
        !cleanText(estimate.method, 1, 1000) ||
        !Array.isArray(estimate.assumptions) || !estimate.assumptions.length || estimate.assumptions.length > 12 ||
        estimate.assumptions.some(item => !cleanText(item, 1, 400)) || new Set(estimate.assumptions).size !== estimate.assumptions.length ||
        !Array.isArray(estimate.evidenceIds) || !estimate.evidenceIds.length || estimate.evidenceIds.length > 12 ||
        estimate.evidenceIds.some(id => !cleanText(id, 1, 160) || !evidenceIds.has(id)) || new Set(estimate.evidenceIds).size !== estimate.evidenceIds.length ||
        pick.evidence.some(row => estimate.evidenceIds.includes(row.id) && Date.parse(row.observedAt) > Date.parse(estimate.asOf))) fail('invalid_today_fair_value')
  }
  ids.add(pick.id); runs.add(provenance.runId)
}

function validateConversationComment(report, context) {
  const comment = report.conversationComment
  if (!keysAre(comment, CONVERSATION_COMMENT_KEYS) || comment.sourceReportSha256 !== report.provenance.responseSha256 ||
      !time(comment.provenance?.generatedAt) || Date.parse(comment.provenance.generatedAt) < Date.parse(report.provenance.generatedAt)) fail('invalid_today_conversation_comment')
  // Reuse the report boundary without changing the original report, excerpt or source metadata.
  const message = { id: comment.id, agent: report.agent, symbol: report.symbol, comment: comment.text,
    report: comment.response, createdAt: comment.createdAt, dataAsOf: report.dataAsOf,
    evidence: report.evidence, provenance: comment.provenance, kind: report.kind, reviewNotes: report.reviewNotes }
  validateMessage(message, { ...context, keys: REPORT_KEYS, min: 2, max: 300,
    error: 'invalid_today_conversation_comment', reviewedReport: true })
}

/** A separately generated comment never replaces its source report or original excerpt. */
export function getTodayComment(message) {
  return message.conversationComment || { id: message.id, text: message.comment, createdAt: message.createdAt, provenance: message.provenance }
}

/** Validate reviewed public records. This does not verify facts or activate a model. */
export function validateTodaySnapshot(value, { catalog = instruments, now = Date.now() } = {}) {
  const nowMs = clock(now)
  if (!Array.isArray(catalog)) fail('invalid_today_catalog')
  const eligible = new Set(catalog.filter(item => Array.isArray(item.chains) && item.chains.some(chain => chain > 0)).map(item => item.symbol))
  const rootKeys = value?.schemaVersion === 3 ? [...ROOT_KEYS, 'responses', 'reports'] : value?.schemaVersion === 2 ? [...ROOT_KEYS, 'responses'] : ROOT_KEYS
  if (!keysAre(value, rootKeys) || ![1, 2, 3].includes(value.schemaVersion) || value.timezone !== 'Asia/Seoul' ||
      !(value.editionDate === null || date(value.editionDate)) || !(value.publishedAt === null || time(value.publishedAt)) ||
      !Array.isArray(value.picks) || value.picks.length > 3 || !keysAre(value.providerStates, Object.keys(TODAY_AGENTS)) ||
      (value.schemaVersion >= 2 && (!Array.isArray(value.responses) || value.responses.length > 3)) ||
      (value.schemaVersion === 3 && (!Array.isArray(value.reports) || value.reports.length > 3))) fail('invalid_today_snapshot')
  if ((value.editionDate === null) !== (value.publishedAt === null) || ((value.picks.length || value.reports?.length) && value.editionDate === null)) fail('invalid_today_edition')
  if (value.publishedAt && (Date.parse(value.publishedAt) > nowMs + FUTURE_ALLOWANCE || value.editionDate > kstDate(nowMs) || kstDate(Date.parse(value.publishedAt)) !== value.editionDate)) fail('invalid_today_publication_time')
  for (const state of Object.values(value.providerStates)) {
    if (!keysAre(state, ['status', 'reason']) || !['disabled', 'ready', 'unavailable', 'blocked'].includes(state.status) ||
        typeof state.reason !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/u.test(state.reason)) fail('invalid_today_provider_state')
  }
  const agents = new Set(), ids = new Set(), runs = new Set()
  const context = { value, eligible, ids, runs }
  // v3 preserves earlier publications without relabeling their original generation or review dates.
  const legacyContext = message => value.schemaVersion === 3 ? { ...context, value: { ...value, editionDate: time(message?.createdAt) ? kstDate(Date.parse(message.createdAt)) : value.editionDate } } : context
  for (const pick of value.picks) {
    validateMessage(pick, { ...legacyContext(pick), keys: PICK_KEYS, min: 30, max: 160, error: 'invalid_today_pick', fairValueAllowed: true })
    if (agents.has(pick.agent)) fail('invalid_today_pick')
    agents.add(pick.agent)
  }
  const responseAgents = new Set(), responseParents = new Set()
  for (const response of value.responses || []) {
    validateMessage(response, { ...legacyContext(response), keys: RESPONSE_KEYS, min: 2, max: 300, error: 'invalid_today_response' })
    const parent = value.picks.find(pick => pick.id === response.parentId)
    if (!parent || parent.agent === response.agent || parent.symbol !== response.symbol ||
        Date.parse(response.provenance.generatedAt) < Date.parse(parent.createdAt) ||
        kstDate(Date.parse(response.createdAt)) !== kstDate(Date.parse(parent.createdAt))) fail('invalid_today_response_parent')
    if (responseAgents.has(response.agent) || responseParents.has(response.parentId)) fail('invalid_today_response_limit')
    responseAgents.add(response.agent); responseParents.add(response.parentId)
  }
  const reportAgents = new Set()
  for (const report of value.reports || []) {
    validateMessage(report, { ...context, keys: REPORT_KEYS, min: 2, max: 2000, error: 'invalid_today_report', fairValueAllowed: report?.agent !== 'claude', reviewedReport: true })
    if (reportAgents.has(report.agent)) fail('invalid_today_report_limit')
    reportAgents.add(report.agent)
    if (Object.hasOwn(report, 'conversationComment')) validateConversationComment(report, context)
  }
  return value
}

/** Exactly three honest slots; an empty or old edition never becomes today's AI pick. */
export function todayCards(snapshot, { now = Date.now(), catalog = instruments } = {}) {
  validateTodaySnapshot(snapshot, { now, catalog })
  const current = snapshot.editionDate === kstDate(now)
  return Object.entries(TODAY_AGENTS).map(([agent, info]) => {
    const pick = snapshot.picks.find(pick => pick.agent === agent) || null
    const report = (snapshot.reports || []).find(report => report.agent === agent) || null
    const provider = snapshot.providerStates[agent]
    const messageCurrent = report ? current : pick ? kstDate(Date.parse(pick.createdAt)) === kstDate(now) : false
    return { agent, ...info, pick, report, responses: pick ? (snapshot.responses || []).filter(response => response.parentId === pick.id) : [],
      state: report || pick ? messageCurrent ? 'published' : 'previous-edition' : provider.status === 'ready' ? 'unpublished' : 'unavailable',
      reason: report || pick ? messageCurrent ? report ? 'reviewed_one_off_publication' : 'reviewed_publication' : 'previous_edition' : provider.reason,
      editionDate: snapshot.editionDate, publishedAt: snapshot.publishedAt }
  })
}
