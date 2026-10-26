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
