export function resolveCommunityOrigin(value, currentOrigin) {
  if (!value) return currentOrigin
  const url = new URL(value)
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid_community_api_origin')
  return url.origin
}
export function resolveDiscussionSymbol(hash, catalog, fallback) {
  let part
  try { part = decodeURIComponent(hash.replace(/^#/, '').split('/')[1] || '') } catch { return null }
  if (!part) return fallback || catalog[0]?.symbol
  if (/^[1-8]$/.test(part)) return catalog.find(x => x.chains.includes(Number(part)))?.symbol || null
  return catalog.some(x => x.symbol === part) ? part : null
}
export function mergeComments(previous, incoming) {
  const byId = new Map(previous.map(x => [x.id, x]))
  incoming.forEach(x => byId.set(x.id, x))
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

export function opinionEntry(value = {}) {
  value ||= {}
  const latest = value.latest?.id && !value.latest.hidden && value.latest.messageType === 'opinion' ? value.latest : null
  const byId = new Map((Array.isArray(value.history) ? value.history : [])
    .filter(message => message?.id && !message.hidden && message.messageType === 'opinion' && message.id !== latest?.id)
    .map(message => [message.id, message]))
  return { latest, history: [...byId.values()].sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0)), state: value.state || null }
}

export function communityStateLabel(value) {
  const status = typeof value === 'string' ? value : value?.status || value?.state
  return ({ queued: '생성 대기', running: '생성 중', awaiting_approval: '승인 대기', published: '게시됨',
    failed: '생성 실패', blocked: '생성 차단', disabled: '현재 참여 중지', paused: '현재 참여 중지',
    skipped: '생성 건너뜀', expired: '작업 만료', cancelled: '작업 취소', rejected: '승인 거절',
    idle: '아직 의견 없음', empty: '아직 의견 없음', no_opinion: '아직 의견 없음', not_requested: '아직 의견 없음', 'not-generated': '아직 의견 없음',
  })[status] || (status ? String(status) : '의견 확인 전')
}

export function communityReasonLabel(value) {
  if (!value) return ''
  return ({ missing_snapshot: '사용할 자료가 없습니다.', no_data: '사용할 자료가 없습니다.',
    insufficient_evidence: '확인된 자료가 부족하여 생성하지 않았습니다.',
    stale_snapshot: '자료 기준이 오래되어 생성하지 않았습니다.', daily_limit: '모델의 일일 한도에 도달했습니다.',
    symbol_daily_limit: '종목의 일일 한도에 도달했습니다.', user_symbol_daily_limit: '사용자·종목의 일일 한도에 도달했습니다.',
    agent_disabled: '이 AI의 참여가 중지되어 있습니다.', symbol_disabled: '이 종목의 AI 참여가 중지되어 있습니다.',
    admin_paused: '관리자가 AI 참여를 중지했습니다.', lease_expired: '작업 점유 시간이 지나 다시 확인합니다.',
    expired: '작업의 유효 시간이 지났습니다.', superseded: '새 의견 요청으로 이전 작업을 취소했습니다.',
    opinion_superseded: '새 의견 요청으로 이전 작업을 취소했습니다.',
    no_longer_eligible: '원문 또는 참여 조건이 바뀌어 취소했습니다.',
  })[value] || String(value)
}

export function messageProvenance(message) {
  const value = message?.metadata || {}
  return {
    provider: value.provider || message?.agent || '',
    requestedModel: value.requestedModel || value.requested_model || value.model || '',
    reportedModel: value.reportedModel || value.reported_model || null,
    cliVersion: value.cliVersion || value.cli_version || '',
    generatedAt: value.generatedAt || value.generated_at || null,
    dataAsOf: value.dataAsOf || value.data_as_of || null,
    contextSnapshotId: value.contextSnapshotId || value.context_snapshot_id || null,
    evidenceIds: value.evidenceIds || value.evidence_ids || [],
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    previousOpinionId: value.previousOpinionId || value.previous_opinion_id || null,
    promptVersion: value.promptVersion || value.prompt_version || '',
  }
}

export function communityEvidenceUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}
