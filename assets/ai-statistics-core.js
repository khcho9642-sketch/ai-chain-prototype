export const AI_CATEGORIES = ['usage','revenue','customers','profitability','tokens','adoption','investment','supply','energy','infrastructure','economics']
export const AI_EVIDENCE = ['official','reported','estimated','research']
export function safeSourceUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null } catch { return null }
}
export function validateAiStatistics(data) {
  if (data?.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(data.asOf || '') || !Array.isArray(data.metrics) || !Array.isArray(data.gaps)) throw new Error('AI 통계 형식이 올바르지 않습니다.')
  const ids = new Set(), definitions = new Set()
  for (const m of data.metrics) {
    if (!m || typeof m.id !== 'string' || ids.has(m.id) || typeof m.definitionId !== 'string' || !m.name || !m.entity || !m.unit || !['business','industry'].includes(m.group) || !AI_CATEGORIES.includes(m.category)) throw new Error('AI 통계 지표 식별자·분류가 올바르지 않습니다.')
    ids.add(m.id); definitions.add(m.definitionId)
    if (!Array.isArray(m.observations) || !m.observations.length || !Number.isInteger(m.latestIndex) || m.latestIndex < 0 || m.latestIndex >= m.observations.length || !Array.isArray(m.notes)) throw new Error('AI 통계 관측값이 없습니다.')
    for (const o of m.observations) {
      if (typeof o.value !== 'number' || !Number.isFinite(o.value) || !['eq','gt','lt','approx'].includes(o.operator) || typeof o.period !== 'string' || !o.period || !safeSourceUrl(o.sourceUrl) || !AI_EVIDENCE.includes(o.evidence) || !/^\d{4}-\d{2}-\d{2}$/.test(o.verifiedAt || '')) throw new Error('AI 통계 값·단위·출처를 확인하세요.')
    }
  }
  if (data.definitionCount !== definitions.size) throw new Error('AI 통계 정의 수가 일치하지 않습니다.')
  const gapIds = new Set()
  for (const gap of data.gaps) {
    if (!gap?.id || gapIds.has(gap.id) || gap.value !== null || !gap.name || !gap.reason) throw new Error('미확인 통계는 null과 사유가 필요합니다.')
    gapIds.add(gap.id)
  }
  return data
}
