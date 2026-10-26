// Browser-safe validation of the public monitoring metadata (no article bodies).
function officialUrl(value, discovery = false) {
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false
    const host = u.hostname.replace(/^www\./, '')
    if (!['openai.com','anthropic.com'].includes(host)) return false
    return host === 'openai.com'
      ? /^\/index\/[a-z0-9-]+\/?$/.test(u.pathname) || (discovery && u.pathname === '/news/rss.xml')
      : /^\/news\/[a-z0-9-]+\/?$/.test(u.pathname) || (discovery && u.pathname === '/news')
  } catch { return false }
}
const timestamp = value => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
export function validateDisclosureSnapshot(data) {
  if (data?.schemaVersion !== 1 || data.collection?.method !== 'web-monitor' ||
      !['not-run','ok','partial','error'].includes(data.collection.status) ||
      !timestamp(data.collection.lastAttemptAt) || !timestamp(data.collection.lastSuccessAt) ||
      !Array.isArray(data.sources) || !Array.isArray(data.candidates) || !Array.isArray(data.notes)) {
    throw new Error('발표자료 확인 기록 형식이 올바르지 않습니다.')
  }
  const sources = new Set(), candidates = new Set()
  for (const s of data.sources) {
    if (!officialUrl(s.url) || sources.has(s.url) || typeof s.title !== 'string' ||
        !(s.contentHash === null || /^[a-f0-9]{64}$/.test(s.contentHash || '')) ||
        !timestamp(s.checkedAt) || !timestamp(s.lastChangedAt)) throw new Error('발표자료 출처·확인 날짜가 올바르지 않습니다.')
    sources.add(s.url)
  }
  for (const c of data.candidates) {
    if (!c.id || candidates.has(c.id) || !officialUrl(c.url) || typeof c.title !== 'string' ||
        !timestamp(c.detectedAt) || c.detectedAt === null ||
        !['needs-review','reviewed','dismissed'].includes(c.status) || !c.reason) throw new Error('발표자료 검토 항목이 올바르지 않습니다.')
    candidates.add(c.id)
  }
  for (const d of data.discovery || []) {
    if (!officialUrl(d.url, true) || !timestamp(d.checkedAt)) throw new Error('공식 뉴스 목록의 확인 기록이 올바르지 않습니다.')
  }
  return data
}
