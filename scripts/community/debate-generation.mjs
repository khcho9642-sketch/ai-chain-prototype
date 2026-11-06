import { createHash } from 'node:crypto'
import { DEBATE_AGENTS, debateTextAllowed } from '../../assets/debate-core.js'
import { hashDebatePacket } from './debate.mjs'
import { analysisPrompt, peerPrompt, replyPrompt, summaryPrompt, DEBATE_ANALYSIS_PROMPT_VERSION, DEBATE_PEER_PROMPT_VERSION, DEBATE_REPLY_PROMPT_VERSION, DEBATE_SUMMARY_PROMPT_VERSION } from '../../server/community/debate-prompts.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, min, max) => typeof value === 'string' && value === value.trim().normalize('NFC') && [...value].length >= min && [...value].length <= max && debateTextAllowed(value)
const dateTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const parse = value => JSON.parse(value.trim().replace(/^```(?:json)?\s*\n/iu, '').replace(/\n```$/u, ''))
const compact = row => Object.fromEntries(['ai', 'stance', 'stanceLevel', 'reason', 'analysis', 'basis', 'scenario', 'pointEstimate'].map(key => [key, row[key]]))

/**
 * Actual model execution is injected by an authenticated official-provider adapter.
 * This coordinator cannot infer credentials, replace a failed provider, or publish.
 * Attempt diagnostics are returned separately and belong in private .local storage.
 */
export async function generateDebate({ packet, invoke, now = Date.now } = {}) {
  if (!object(packet) || typeof invoke !== 'function') throw new Error('invalid_debate_generation_adapter')
  const packetSha256 = hashDebatePacket(packet), attempts = [], failures = []
  const clock = () => new Date(typeof now === 'function' ? now() : now).toISOString()
  const context = parsed => object(parsed) && parsed.ticker === packet.topic.ticker && parsed.date === packet.date

  async function stage(agent, name, prompt, promptVersion, validate) {
    let best = null
    for (let attempt = 0; attempt < 2; attempt++) {
      let result
      try { result = await invoke(agent, prompt + (attempt ? '\n\n앞 응답은 형식 또는 공개 문구 검증을 통과하지 못했어. 동일 자료만 사용해 지정한 JSON 형식과 금지 표현 규칙을 다시 확인해. 이번이 마지막 재작성 기회야.' : ''), name) }
      catch (error) {
        const code = /^[a-zA-Z0-9_-]{1,100}$/u.test(error?.code || '') ? error.code : 'provider_execution_failed'
        failures.push({ agent, stage: name, code }); return best
      }
      const p = result?.provenance, rawResponse = result?.rawResponse
      if (typeof rawResponse !== 'string' || !rawResponse.trim() || rawResponse.length > 60000 || !object(p) || p.provider !== agent || p.packetSha256 !== packetSha256 || !p.cliName || !p.requestedModel || !p.runId || !dateTime(p.generatedAt) || p.responseSha256 !== hash(rawResponse)) {
        failures.push({ agent, stage: name, code: 'unverified_provider_receipt' }); return best
      }
      let parsed, accepted = null
      try { parsed = parse(rawResponse); accepted = validate(parsed) } catch {}
      const provenance = { ...p, promptVersion, execution: p.execution || 'review-required', reviewedAt: p.reviewedAt ?? null }
      const record = { agent, stage: name, attempt: attempt + 1, rawResponse, provenance, accepted: !!accepted?.complete }
      attempts.push(record)
      // A source disclosure contains the complete provider response. Do not expose
      // an otherwise valid row from a batch that still contains a rejected row.
      if (accepted?.complete) best = { value: accepted.value, rawResponse, provenance }
      if (accepted?.complete) return best
    }
    failures.push({ agent, stage: name, code: best ? 'partially_valid_model_output' : 'model_output_rejected' })
    return best
  }

  const analysisResults = await Promise.all(DEBATE_AGENTS.map(async ai => {
    const generated = await stage(ai, 'analysis', analysisPrompt({ agent: ai, packet }), DEBATE_ANALYSIS_PROMPT_VERSION, parsed => {
      const scenario = parsed?.scenario
      const valid = context(parsed) && text(parsed.stance, 2, 80) && ['bullish', 'neutral', 'bearish'].includes(parsed.stanceLevel) && text(parsed.reason, 4, 160) && text(parsed.analysis, 80, 6000) && text(parsed.basis, 4, 2000) &&
        (scenario === null || object(scenario) && positive(scenario.low) && positive(scenario.high) && scenario.high >= scenario.low && scenario.currency === packet.closePrice.currency) && (parsed.pointEstimate === null || positive(parsed.pointEstimate))
      return valid ? { complete: true, value: parsed } : null
    })
    if (!generated) return null
    const row = generated.value
    return { ai, stance: row.stance, stanceLevel: row.stanceLevel, reason: row.reason, analysis: row.analysis, basis: row.basis, scenario: row.scenario, pointEstimate: row.pointEstimate,
      writtenAt: generated.provenance.generatedAt, priceAtWriting: packet.closePrice.value, closeDate: packet.date, sources: packet.sources,
      rawResponse: generated.rawResponse, provenance: generated.provenance }
  }))
  const stances = analysisResults.filter(Boolean)
  if (stances.length < 2) return { day: null, failures, attempts, publication: 'insufficient_participants' }
  const participants = stances.map(row => row.ai), thread = []

  const peers = await Promise.all(stances.map(async analysis => {
    const ai = analysis.ai, targets = participants.filter(agent => agent !== ai)
    const result = await stage(ai, 'peer', peerPrompt({ agent: ai, packet, analyses: stances.map(compact) }), DEBATE_PEER_PROMPT_VERSION, parsed => {
      if (!context(parsed) || !Array.isArray(parsed.comments)) return null
      const seen = new Set(), accepted = parsed.comments.filter(row => object(row) && targets.includes(row.to) && !seen.has(row.to) && text(row.text, 4, 600) && seen.add(row.to))
      return { value: accepted.length ? accepted : null, complete: accepted.length === targets.length && parsed.comments.length === targets.length }
    })
    return result ? result.value.map(row => ({ id: 'peer-' + ai + '-' + row.to + '-' + hash(result.rawResponse).slice(0, 12), ai, to: row.to, kind: 'peer', replyToId: null, text: row.text,
      writtenAt: result.provenance.generatedAt, priceAtWriting: packet.closePrice.value, closeDate: packet.date, rawResponse: result.rawResponse, provenance: result.provenance })) : []
  }))
  thread.push(...peers.flat())

  const replies = await Promise.all(stances.map(async analysis => {
    const ai = analysis.ai, targets = thread.filter(row => row.to === ai)
    if (!targets.length) return []
    const result = await stage(ai, 'reply', replyPrompt({ agent: ai, packet, analysis: compact(analysis), peerComments: targets.map(row => ({ id: row.id, ai: row.ai, to: row.to, text: row.text })) }), DEBATE_REPLY_PROMPT_VERSION, parsed => {
      if (!context(parsed) || !Array.isArray(parsed.replies)) return null
      const seen = new Set(), accepted = parsed.replies.filter(row => object(row) && targets.some(target => target.id === row.replyToId) && !seen.has(row.replyToId) && text(row.text, 4, 600) && seen.add(row.replyToId))
      return { value: accepted.length ? accepted : null, complete: accepted.length === targets.length && parsed.replies.length === targets.length }
    })
    return result ? result.value.map(row => ({ id: 'reply-' + ai + '-' + row.replyToId + '-' + hash(result.rawResponse).slice(0, 12), ai, to: targets.find(target => target.id === row.replyToId).ai, kind: 'reply', replyToId: row.replyToId, text: row.text,
      writtenAt: result.provenance.generatedAt, priceAtWriting: packet.closePrice.value, closeDate: packet.date, rawResponse: result.rawResponse, provenance: result.provenance })) : []
  }))
  thread.push(...replies.flat())
  thread.sort((a, b) => Date.parse(a.writtenAt) - Date.parse(b.writtenAt) || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'peer' ? -1 : 1))

  let issue = null, summary = null
  const summarized = await stage('gpt', 'summary', summaryPrompt({ packet, analyses: stances.map(compact), thread: thread.map(row => ({ id: row.id, ai: row.ai, to: row.to, kind: row.kind, replyToId: row.replyToId, text: row.text })) }), DEBATE_SUMMARY_PROMPT_VERSION, parsed => {
    if (!object(parsed)) return null
    const acceptedIssue = text(parsed.issue, 4, 90) && /[?？]$/u.test(parsed.issue) ? parsed.issue : null
    const rows = Array.isArray(parsed.stances) ? parsed.stances : []
    const accepted = participants.map(ai => rows.find(row => row.ai === ai && text(row.stance, 2, 80) && text(row.reason, 4, 160) && ['bullish', 'neutral', 'bearish'].includes(row.stanceLevel))).filter(Boolean)
    return { value: acceptedIssue || accepted.length ? { issue: acceptedIssue, stances: accepted } : null, complete: !!acceptedIssue && accepted.length === participants.length && rows.length === participants.length }
  })
  if (summarized) {
    issue = summarized.value.issue; summary = { rawResponse: summarized.rawResponse, provenance: summarized.provenance }
    for (const item of summarized.value.stances) Object.assign(stances.find(row => row.ai === item.ai), { stance: item.stance, stanceLevel: item.stanceLevel, reason: item.reason })
  }
  const day = { schemaVersion: 1, id: 'debate-' + packet.date + '-' + packet.topic.ticker, date: packet.date, publishedAt: clock(), headline: null,
    topic: packet.topic, issue, ripple: packet.ripple || [], stances, thread, closePrice: packet.closePrice, packet, packetSha256, summary }
  return { day, failures, attempts, publication: 'review_required' }
}
