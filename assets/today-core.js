import { instruments } from './instruments.js'

export const TODAY_AGENTS = Object.freeze({
  gpt: Object.freeze({ name: 'GPT', style: '펨코 느낌 · 짧은 유머와 공감, 티키타카' }),
  claude: Object.freeze({ name: 'Claude', style: '디시 느낌 · 짧고 직설적인 표현과 풍자' }),
  gemini: Object.freeze({ name: 'Gemini', style: '블라인드 느낌 · 현실적인 대화와 생활 비유' }),
})

const ROOT_KEYS = ['schemaVersion', 'timezone', 'editionDate', 'publishedAt', 'picks', 'providerStates']
const PICK_KEYS = ['id', 'agent', 'symbol', 'comment', 'createdAt', 'dataAsOf', 'evidence', 'provenance']
const RESPONSE_KEYS = [...PICK_KEYS, 'parentId']
const PROVENANCE_KEYS = ['provider', 'requestedModel', 'reportedModel', 'cliVersion', 'generatedAt', 'promptVersion', 'runId', 'execution', 'reviewedAt']
const EVIDENCE_KEYS = ['id', 'label', 'sourceUrl', 'observedAt', 'collectedAt']
const FUTURE_ALLOWANCE = 5 * 60 * 1000
const SIMULATION = /(?:fixture|(?:^|[\s_-])test(?:$|[\s_-])|test[\s_-]*only|not[\s_-]*real|mock|synthetic|demo[\s_-]*only)/iu
const fail = code => { throw new Error(code) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keysAre = (value, keys, optional = []) => object(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key) || optional.includes(key))
const cleanText = (value, min, max) => typeof value === 'string' && value === value.trim().normalize('NFC') && [...value].length >= min && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
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

function validateMessage(pick, { value, eligible, ids, runs, keys, min, max, error }) {
    if (!keysAre(pick, keys, ['businessProfile']) || !Object.hasOwn(TODAY_AGENTS, pick.agent) ||
      !cleanText(pick.id, 1, 160) || ids.has(pick.id) || SIMULATION.test(pick.id) || !cleanText(pick.symbol, 1, 40) || !eligible.has(pick.symbol) ||
      !cleanText(pick.comment, min, max) || /<\/?[a-z]|https?:\/\/|www\./iu.test(pick.comment) ||
      /수익\s*보장|무조건\s*(?:매수|사라)|내부\s*정보/iu.test(pick.comment) ||
      !time(pick.createdAt) || !time(pick.dataAsOf) || !Array.isArray(pick.evidence) || !pick.evidence.length || pick.evidence.length > 12 ||
      !keysAre(pick.provenance, PROVENANCE_KEYS)) fail(error)
    if (pick.businessProfile !== undefined) {
      const profile = pick.businessProfile
      if (!keysAre(profile, ['symbol','role','sourceUrl','reviewedAt']) || profile.symbol !== pick.symbol ||
          !cleanText(profile.role, 1, 240) || !publicSource(profile.sourceUrl) || !date(profile.reviewedAt) ||
          profile.reviewedAt > value.editionDate) fail('invalid_today_business_source')
    }
    const provenance = pick.provenance
  if (provenance.provider !== pick.agent || provenance.execution !== 'official-cli' ||
      !cleanText(provenance.requestedModel, 1, 120) || !(provenance.reportedModel === null || cleanText(provenance.reportedModel, 1, 120)) ||
      (provenance.reportedModel !== null && provenance.reportedModel !== provenance.requestedModel) ||
      !cleanText(provenance.cliVersion, 1, 120) || !cleanText(provenance.promptVersion, 1, 120) || !cleanText(provenance.runId, 1, 160) || runs.has(provenance.runId) ||
      [provenance.requestedModel, provenance.reportedModel || '', provenance.cliVersion, provenance.promptVersion, provenance.runId].some(text => SIMULATION.test(text)) ||
      !time(provenance.generatedAt) || !time(provenance.reviewedAt)) fail('invalid_today_provenance')
  const generated = Date.parse(provenance.generatedAt), created = Date.parse(pick.createdAt), reviewed = Date.parse(provenance.reviewedAt), published = Date.parse(value.publishedAt)
  if (generated > created || created > published || generated > reviewed || reviewed > published ||
      [generated, created, reviewed].some(ms => kstDate(ms) !== value.editionDate)) fail('invalid_today_chronology')
  const evidenceIds = new Set()
  for (const evidence of pick.evidence) {
    if (!keysAre(evidence, EVIDENCE_KEYS, ['symbol']) || !cleanText(evidence.id, 1, 160) || SIMULATION.test(evidence.id) || evidenceIds.has(evidence.id) ||
        !cleanText(evidence.label, 1, 240) || !publicSource(evidence.sourceUrl) || (evidence.symbol !== undefined && evidence.symbol !== pick.symbol) ||
        !time(evidence.observedAt) || !time(evidence.collectedAt) || Date.parse(evidence.observedAt) > Date.parse(evidence.collectedAt) ||
        Date.parse(evidence.collectedAt) > generated + FUTURE_ALLOWANCE) fail('invalid_today_evidence')
    evidenceIds.add(evidence.id)
  }
  // A new fetch or publication must never turn old observations into today's data.
  if (Date.parse(pick.dataAsOf) !== Math.max(...pick.evidence.map(row => Date.parse(row.observedAt))) || Date.parse(pick.dataAsOf) > generated + FUTURE_ALLOWANCE) fail('invalid_today_data_as_of')
  ids.add(pick.id); runs.add(provenance.runId)
}

/** Validate reviewed public records. This does not verify facts or activate a model. */
export function validateTodaySnapshot(value, { catalog = instruments, now = Date.now() } = {}) {
  const nowMs = clock(now)
  if (!Array.isArray(catalog)) fail('invalid_today_catalog')
  const eligible = new Set(catalog.filter(item => Array.isArray(item.chains) && item.chains.some(chain => chain > 0)).map(item => item.symbol))
  const rootKeys = value?.schemaVersion === 2 ? [...ROOT_KEYS, 'responses'] : ROOT_KEYS
  if (!keysAre(value, rootKeys) || ![1, 2].includes(value.schemaVersion) || value.timezone !== 'Asia/Seoul' ||
      !(value.editionDate === null || date(value.editionDate)) || !(value.publishedAt === null || time(value.publishedAt)) ||
      !Array.isArray(value.picks) || value.picks.length > 3 || !keysAre(value.providerStates, Object.keys(TODAY_AGENTS)) ||
      (value.schemaVersion === 2 && (!Array.isArray(value.responses) || value.responses.length > 3))) fail('invalid_today_snapshot')
  if ((value.editionDate === null) !== (value.publishedAt === null) || (value.picks.length && value.editionDate === null)) fail('invalid_today_edition')
  if (value.publishedAt && (Date.parse(value.publishedAt) > nowMs + FUTURE_ALLOWANCE || value.editionDate > kstDate(nowMs) || kstDate(Date.parse(value.publishedAt)) !== value.editionDate)) fail('invalid_today_publication_time')
  for (const state of Object.values(value.providerStates)) {
    if (!keysAre(state, ['status', 'reason']) || !['disabled', 'ready', 'unavailable', 'blocked'].includes(state.status) ||
        typeof state.reason !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/u.test(state.reason)) fail('invalid_today_provider_state')
  }
  const agents = new Set(), ids = new Set(), runs = new Set()
  const context = { value, eligible, ids, runs }
  for (const pick of value.picks) {
    validateMessage(pick, { ...context, keys: PICK_KEYS, min: 30, max: 160, error: 'invalid_today_pick' })
    if (agents.has(pick.agent)) fail('invalid_today_pick')
    agents.add(pick.agent)
  }
  const responseAgents = new Set(), responseParents = new Set()
  for (const response of value.responses || []) {
    validateMessage(response, { ...context, keys: RESPONSE_KEYS, min: 2, max: 300, error: 'invalid_today_response' })
    const parent = value.picks.find(pick => pick.id === response.parentId)
    if (!parent || parent.agent === response.agent || parent.symbol !== response.symbol ||
        Date.parse(response.provenance.generatedAt) < Date.parse(parent.createdAt)) fail('invalid_today_response_parent')
    if (responseAgents.has(response.agent) || responseParents.has(response.parentId)) fail('invalid_today_response_limit')
    responseAgents.add(response.agent); responseParents.add(response.parentId)
  }
  return value
}

/** Exactly three honest slots; an empty or old edition never becomes today's AI pick. */
export function todayCards(snapshot, { now = Date.now(), catalog = instruments } = {}) {
  validateTodaySnapshot(snapshot, { now, catalog })
  const current = snapshot.editionDate === kstDate(now)
  return Object.entries(TODAY_AGENTS).map(([agent, info]) => {
    const pick = snapshot.picks.find(pick => pick.agent === agent) || null
    const provider = snapshot.providerStates[agent]
    return { agent, ...info, pick, responses: pick ? (snapshot.responses || []).filter(response => response.parentId === pick.id) : [],
      state: pick ? current ? 'published' : 'previous-edition' : provider.status === 'ready' ? 'unpublished' : 'unavailable',
      reason: pick ? current ? 'reviewed_publication' : 'previous_edition' : provider.reason,
      editionDate: snapshot.editionDate, publishedAt: snapshot.publishedAt }
  })
}
