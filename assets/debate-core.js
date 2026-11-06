import { buildRippleSnapshot, rippleMarket } from './ripple-core.js'
import { focusCompanies } from './home-focus.js'
import { SECTORS } from './home-map-core.js'

export const DEBATE_SCHEMA_VERSION = 1
export const DEBATE_MAX_BYTES = 2 * 1024 * 1024
export const DEBATE_AGENTS = Object.freeze(['gpt', 'claude', 'gemini'])
const levels = ['bullish', 'neutral', 'bearish']
const sectors = new Set(SECTORS.map(row => row.id))
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw new Error(code) }
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const clean = (value, min = 1, max = 500) => typeof value === 'string' && value === value.trim().normalize('NFC') && [...value].length >= min && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
export const validDebateDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value))
const url = value => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash } catch { return false } }
const raw = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 60000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
export function debateTextAllowed(value) {
  return typeof value === 'string' && !/(?:추천|사라(?=[.!?…\s"'”’]|$)|팔라(?=[.!?…\s"'”’]|$)|매수|매도|목표(?:주)?가|오른다|내린다|수익\s*보장)|<\/?[a-z]|https?:\/\/|www\./iu.test(value)
}
const prose = (value, min, max) => clean(value, min, max) && debateTextAllowed(value)

/** Recursive canonical JSON for a stable, shared-input hash across providers. */
export function canonicalDebatePacket(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalDebatePacket).join(',') + ']'
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalDebatePacket(value[key])).join(',') + '}'
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return JSON.stringify(value)
  fail('invalid_debate_packet')
}

function parseRaw(text) { try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*\n/iu, '').replace(/\n```$/u, '')) } catch { return null } }
function containsValue(text, value) {
  const parsed = parseRaw(text)
  const visit = (row, depth = 0) => {
    if (depth > 12) return false
    if (row === value) return true
    return row !== null && typeof row === 'object' && Object.values(row).some(child => visit(child, depth + 1))
  }
  return visit(parsed)
}
function validateProvenance(row, { agent, packetSha256, publishedAt, writtenAt }) {
  const p = row?.provenance
  const clients = { gpt: ['codex', 'chatgpt-web'], claude: ['claude-code', 'claude-web'], gemini: ['gemini-cli', 'gemini', 'gemini-web', 'antigravity'] }
  if (!raw(row?.rawResponse) || !object(p) || p.provider !== agent || !clients[agent]?.includes(p.cliName) ||
      !clean(p.requestedModel, 1, 120) || !(p.reportedModel === null || clean(p.reportedModel, 1, 120)) ||
      !(p.cliName.endsWith('-web') ? p.cliVersion === null && p.reportedModel === null : clean(p.cliVersion, 1, 120)) ||
      !clean(p.runId, 1, 160) || !clean(p.promptVersion, 1, 120) || !sha(p.responseSha256) || p.packetSha256 !== packetSha256 ||
      p.execution !== 'owner-reviewed-one-off' || !timestamp(p.generatedAt) || !timestamp(p.reviewedAt) ||
      /(?:mock|synthetic|fixture|test-only)/iu.test([p.runId, p.promptVersion, p.requestedModel].join(' '))) fail('invalid_debate_provenance')
  if (Date.parse(p.generatedAt) > Date.parse(p.reviewedAt) || Date.parse(p.reviewedAt) > Date.parse(publishedAt) || Date.parse(p.generatedAt) > Date.parse(writtenAt) || Date.parse(writtenAt) > Date.parse(publishedAt)) fail('invalid_debate_chronology')
  return p
}
function validateTopic(topic) {
  if (!object(topic) || !/^[A-Z0-9.-]{1,24}$/u.test(topic.ticker || '') || !clean(topic.name, 1, 80) || !sectors.has(topic.sectorId) || !finite(topic.changePct) || Math.abs(topic.changePct) > 1000 || !prose(topic.title, 4, 140)) fail('invalid_debate_topic')
}
export function validateDebateDay(value, { now = Date.now() } = {}) {
  if (!object(value) || value.schemaVersion !== 1 || !clean(value.id, 1, 120) || !/^[a-zA-Z0-9.-]+$/u.test(value.id) || !validDebateDate(value.date) || !timestamp(value.publishedAt) || value.date > value.publishedAt.slice(0, 10) || Date.parse(value.publishedAt) > now + 300000) fail('invalid_debate_day')
  validateTopic(value.topic)
  if (!object(value.packet) || !sha(value.packetSha256) || value.packet.topic?.ticker !== value.topic.ticker || value.packet.date !== value.date) fail('invalid_debate_packet')
  const close = value.closePrice
  if (!object(close) || !positive(close.value) || !/^[A-Z]{3}$/u.test(close.currency || '') || close.date !== value.date || !url(close.sourceUrl) || !timestamp(close.observedAt) || Date.parse(close.observedAt) > Date.parse(value.publishedAt) || value.packet.closePrice?.value !== close.value || value.packet.closePrice?.date !== close.date || value.packet.closePrice?.currency !== close.currency) fail('invalid_debate_close')
  if (!(value.headline === null || prose(value.headline, 4, 160)) || !(value.issue === null || prose(value.issue, 4, 90) && /[?？]$/u.test(value.issue))) fail('invalid_debate_issue')
  if (!Array.isArray(value.ripple) || value.ripple.length > 3 || value.ripple.some(row => !object(row) || !/^[A-Z0-9.-]{1,24}$/u.test(row.ticker || '') || !clean(row.name, 1, 80) || !finite(row.changePct) || !validDebateDate(row.date) || !url(row.sourceUrl))) fail('invalid_debate_ripple')
  if (!Array.isArray(value.stances) || value.stances.length < 1 || value.stances.length > 3 || new Set(value.stances.map(row => row.ai)).size !== value.stances.length) fail('invalid_debate_stances')
  const agents = new Set(value.stances.map(row => row.ai)), generated = new Map()
  const packetSources = new Set((value.packet.sources || []).map(row => row.url))
  for (const row of value.stances) {
    if (!object(row) || !DEBATE_AGENTS.includes(row.ai) || !prose(row.stance, 2, 80) || !levels.includes(row.stanceLevel) || !prose(row.reason, 4, 160) || !prose(row.analysis, 80, 6000) || !prose(row.basis, 4, 2000) || !timestamp(row.writtenAt) || row.closeDate !== value.date || row.priceAtWriting !== close.value || !(row.pointEstimate === null || positive(row.pointEstimate))) fail('invalid_debate_stance')
    if (!(row.scenario === null || object(row.scenario) && positive(row.scenario.low) && positive(row.scenario.high) && row.scenario.high >= row.scenario.low && row.scenario.currency === close.currency)) fail('invalid_debate_scenario')
    if (!Array.isArray(row.sources) || row.sources.length < 1 || row.sources.length > 20 || row.sources.some(source => !clean(source.label, 1, 160) || !url(source.url) || !packetSources.has(source.url))) fail('invalid_debate_sources')
    const p = validateProvenance(row, { agent: row.ai, packetSha256: value.packetSha256, publishedAt: value.publishedAt, writtenAt: row.writtenAt })
    for (const text of [row.analysis, row.basis]) if (!containsValue(row.rawResponse, text)) fail('invalid_debate_raw_binding')
    const ownAnalysis = parseRaw(row.rawResponse)
    if (!ownAnalysis || !Object.hasOwn(ownAnalysis, 'scenario') || !Object.hasOwn(ownAnalysis, 'pointEstimate') || canonicalDebatePacket(ownAnalysis.scenario) !== canonicalDebatePacket(row.scenario) || ownAnalysis.pointEstimate !== row.pointEstimate) fail('invalid_debate_scenario_binding')
    if (!containsValue(row.rawResponse, value.topic.ticker) || !containsValue(row.rawResponse, value.date)) fail('invalid_debate_shared_context')
    generated.set(row.ai, p.generatedAt)
  }
  if (value.summary !== null) {
    if (!object(value.summary) || !DEBATE_AGENTS.includes(value.summary.provenance?.provider)) fail('invalid_debate_summary')
    validateProvenance(value.summary, { agent: value.summary.provenance.provider, packetSha256: value.packetSha256, publishedAt: value.publishedAt, writtenAt: value.publishedAt })
    if (Date.parse(value.summary.provenance.generatedAt) < Math.max(...[...generated.values()].map(Date.parse))) fail('invalid_debate_summary_chronology')
  }
  if (value.issue !== null && !containsValue(value.summary?.rawResponse || '', value.issue)) fail('invalid_debate_issue_binding')
  for (const row of value.stances) {
    const own = parseRaw(row.rawResponse), summarized = parseRaw(value.summary?.rawResponse || '')?.stances?.find(item => item.ai === row.ai)
    const matches = source => source && source.stance === row.stance && source.stanceLevel === row.stanceLevel && source.reason === row.reason
    if (!matches(own) && !matches(summarized)) fail('invalid_debate_summary_binding')
  }
  if (!Array.isArray(value.thread) || value.thread.length > 24) fail('invalid_debate_thread')
  const ids = new Map(), peers = new Set(), replied = new Set()
  for (const row of value.thread) {
    if (!object(row) || !clean(row.id, 1, 160) || ids.has(row.id) || !agents.has(row.ai) || !agents.has(row.to) || row.ai === row.to || !['peer', 'reply'].includes(row.kind) || !prose(row.text, 4, 600) || !timestamp(row.writtenAt) || row.closeDate !== value.date || row.priceAtWriting !== close.value) fail('invalid_debate_thread_row')
    const p = validateProvenance(row, { agent: row.ai, packetSha256: value.packetSha256, publishedAt: value.publishedAt, writtenAt: row.writtenAt })
    if (!containsValue(row.rawResponse, row.text)) fail('invalid_debate_raw_binding')
    if (Date.parse(p.generatedAt) < Math.max(Date.parse(generated.get(row.ai)), Date.parse(generated.get(row.to)))) fail('invalid_debate_thread_chronology')
    if (row.kind === 'peer') {
      const pair = row.ai + ':' + row.to
      if (row.replyToId !== null || peers.has(pair) || !parseRaw(row.rawResponse)?.comments?.some(item => item.to === row.to && item.text === row.text)) fail('invalid_debate_peer_target')
      peers.add(pair)
    } else {
      const target = ids.get(row.replyToId)
      if (!target || target.kind !== 'peer' || target.ai !== row.to || target.to !== row.ai || replied.has(target.id) || Date.parse(p.generatedAt) < Date.parse(target.writtenAt) || !parseRaw(row.rawResponse)?.replies?.some(item => item.replyToId === row.replyToId && item.text === row.text)) fail('invalid_debate_reply_target')
      replied.add(target.id)
    }
    ids.set(row.id, row)
  }
  return value
}

export function validateDebateIndex(value) {
  if (!object(value) || value.schemaVersion !== 1 || !(value.publishedAt === null || timestamp(value.publishedAt)) || !(value.latestDate === null || validDebateDate(value.latestDate)) || !Array.isArray(value.days) || value.days.length > 2000) fail('invalid_debate_index')
  const dates = new Set(), ids = new Set()
  for (const row of value.days) {
    if (!object(row) || !clean(row.id, 1, 120) || !/^[a-zA-Z0-9.-]+$/u.test(row.id) || !validDebateDate(row.date) || dates.has(row.date) || ids.has(row.id) || !(row.issue === null || prose(row.issue, 4, 90))) fail('invalid_debate_index_entry')
    validateTopic(row.topic); dates.add(row.date); ids.add(row.id)
  }
  if (value.days.some((row, index) => index > 0 && row.date >= value.days[index - 1].date) || value.latestDate !== (value.days[0]?.date || null) || (!value.days.length && value.publishedAt !== null)) fail('invalid_debate_index_order')
  return value
}

const dateFormatters = new Map()
const sessionDate = (seconds, zone) => {
  let formatter = dateFormatters.get(zone)
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }); dateFormatters.set(zone, formatter) }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
function closedObservations(quote, market, now) {
  if (!quote || !Array.isArray(quote.bars) || !quote.timezone || quote.interval && quote.interval !== '1d') return []
  const capture = Date.parse(quote.fetchedAt || market.generatedAt)
  if (!Number.isFinite(capture) || capture > now + 300000) return []
  if (quote.priceBasis === 'previous-completed-session' && !validDebateDate(quote.closeDate)) return []
  const cutoff = quote.priceBasis === 'previous-completed-session' ? quote.closeDate : null
  const today = sessionDate(now / 1000, quote.timezone), captured = sessionDate(capture / 1000, quote.timezone), points = new Map()
  for (const row of quote.bars) {
    if (!Number.isInteger(row?.time) || row.time * 1000 > Math.min(now, capture) || !positive(row.close)) continue
    const date = sessionDate(row.time, quote.timezone)
    if (date > today || (cutoff ? date > cutoff : date >= today || date >= captured)) continue
    if (!points.has(date) || points.get(date).time < row.time) points.set(date, { date, time: row.time, close: row.close })
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Uses the exact homepage ripple constructor and its 45-company editorial basket. */
export function selectDebateTopic({ marketSnapshot, rippleSnapshot, curated = null, now = Date.now() } = {}) {
  if (!marketSnapshot || !Array.isArray(marketSnapshot.quotes)) fail('invalid_debate_market')
  const ripple = rippleSnapshot?.sourceSnapshotGeneratedAt === marketSnapshot.generatedAt ? rippleSnapshot : buildRippleSnapshot({ marketSnapshot, now })
  const quoteMap = new Map(marketSnapshot.quotes.map(row => [row.symbol, row]))
  const observations = new Map(), calendars = new Map()
  for (const [ticker, quote] of quoteMap) {
    if (!/^[A-Z0-9.-]{1,24}$/u.test(ticker) || /-USD$/u.test(ticker) || quote.group === '시장') continue
    const rows = closedObservations(quote, marketSnapshot, now), market = rippleMarket(ticker, quote), key = market === 'ETC' ? 'ETC:' + quote.timezone : market
    observations.set(ticker, { rows, key })
    if (!calendars.has(key)) calendars.set(key, new Set())
    for (const row of rows) calendars.get(key).add(row.date)
  }
  for (const [key, dates] of calendars) calendars.set(key, [...dates].sort())
  const candidates = focusCompanies.map(company => {
    const quote = quoteMap.get(company.ticker), series = observations.get(company.ticker), rows = series?.rows || [], last = rows.at(-1), before = rows.at(-2), calendar = calendars.get(series?.key)
    return last && before && last.date === calendar?.at(-1) && before.date === calendar?.at(-2) ? { company, quote, last, before, changePct: (last.close / before.close - 1) * 100 } : null
  }).filter(Boolean)
  let selected, method
  if (curated !== null) {
    if (!object(curated) || !validDebateDate(curated.date) || !/^[A-Z0-9.-]{1,24}$/u.test(curated.ticker || '') || !(curated.issue === null || prose(curated.issue, 4, 90) && /[?？]$/u.test(curated.issue))) fail('invalid_debate_curated')
    selected = candidates.find(row => row.company.ticker === curated.ticker && row.last.date === curated.date)
    if (selected) method = 'curated'
  }
  if (!selected) {
    const trigger = ripple.triggers?.[0]
    if (trigger && Math.abs(trigger.changePct) >= 2) selected = candidates.find(row => row.company.ticker === trigger.ticker && row.last.date === trigger.date && Math.abs(row.changePct) >= 2)
    if (selected) method = 'homepage-ripple'
    else { selected = [...candidates].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.company.ticker.localeCompare(b.company.ticker))[0]; method = 'largest-absolute-close-change' }
  }
  if (!selected) return null
  const { company, quote, last, changePct } = selected
  const close = quote.priceBasis === 'previous-completed-session' && quote.closeDate === last.date && positive(quote.price) ? quote.price : last.close
  const related = ripple.ripples?.find(row => row.trigger.ticker === company.ticker && row.trigger.date === last.date)
  return { date: last.date, topic: { ticker: company.ticker, name: company.name, sectorId: company.sectorId, changePct: Number(changePct.toFixed(6)), title: `${company.name} ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%, 이 흐름 ${changePct < 0 ? '멈출까' : '이어질까'}?` },
    issue: method === 'curated' ? curated.issue : null, selectionMethod: method,
    closePrice: { value: close, currency: quote.currency, date: last.date, sourceUrl: quote.sourceUrl || `https://finance.yahoo.com/quote/${encodeURIComponent(company.ticker)}/`, observedAt: new Date(last.time * 1000).toISOString() },
    ripple: [...(related?.upstream || []), ...(related?.downstream || [])].slice(0, 3).map(row => ({ ticker: row.ticker, name: row.name, changePct: row.changePct, date: row.date, sourceUrl: row.sourceUrl })),
    sourceSnapshotGeneratedAt: marketSnapshot.generatedAt }
}

export function debateStanceChanges(day, previous) {
  if (!day || !previous || day.topic.ticker !== previous.topic.ticker || previous.date >= day.date) return []
  return day.stances.flatMap(row => { const old = previous.stances.find(item => item.ai === row.ai); return old && old.stanceLevel !== row.stanceLevel ? [{ ai: row.ai, from: old.stanceLevel, to: row.stanceLevel }] : [] })
}
export function debateCharacterHistory(days) {
  const totals = { gpt: 0, claude: 0, gemini: 0 }, previous = new Map()
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const change of debateStanceChanges(day, previous.get(day.topic.ticker))) if ((change.ai === 'gpt' && change.from === 'bullish') || (change.ai === 'claude' && change.from === 'bearish') || (change.ai === 'gemini' && change.from === 'neutral')) totals[change.ai]++
    previous.set(day.topic.ticker, day)
  }
  return totals
}
export function debateWritingDatesDiffer(day) {
  const dates = day.stances.map(row => sessionDate(Date.parse(row.writtenAt) / 1000, 'Asia/Seoul')).sort()
  if (dates.length < 2) return false
  let weekdays = 0
  for (let ms = Date.parse(dates[0] + 'T00:00:00Z') + 86400000; ms <= Date.parse(dates.at(-1) + 'T00:00:00Z'); ms += 86400000) if (![0, 6].includes(new Date(ms).getUTCDay())) weekdays++
  return weekdays >= 3
}
