export const validSymbol = value => /^[A-Z0-9^=.-]{1,24}$/.test(value)
export function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase()
  return /^\d{6}$/.test(symbol) ? `${symbol}.KS` : symbol
}
export function readSymbols(raw) {
  try { const values=JSON.parse(raw || '[]'); return Array.isArray(values) ? [...new Set(values.filter(v=>typeof v==='string').map(normalizeSymbol).filter(validSymbol))].slice(0,100) : [] } catch { return [] }
}
export function filterQuotes(quotes,{group='전체',chain=0,search='',watch=[]}={}) {
  return quotes.filter(q=>(!chain || q.chains?.includes(Number(chain))) && (group==='전체' || (group==='관심'?watch.includes(q.symbol):q.group===group)) && `${q.name} ${q.symbol}`.toLowerCase().includes(search.trim().toLowerCase()))
}
export function snapshotBars(q,range) {
  if (['1d','5d','5y'].includes(range)) return q?.histories?.[range] || []
  const days={'1mo':31,'3mo':93,'1y':366}[range]
  const last=q?.bars?.at(-1)?.time || 0
  return (q?.bars || []).filter(b=>b.time>=last-days*86400)
}
export function chooseBars(snapshotQuote, range, liveChart) {
  return liveChart?.range===range ? liveChart.bars : snapshotBars(snapshotQuote,range)
}
export function newestQuote(snapshotQuote, apiQuote) {
  if(!apiQuote)return snapshotQuote || {}
  if(!snapshotQuote)return apiQuote
  return Date.parse(apiQuote.fetchedAt || 0)>=Date.parse(snapshotQuote.fetchedAt || 0)?apiQuote:snapshotQuote
}
