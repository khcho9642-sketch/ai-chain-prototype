import { SECTORS } from '../../assets/home-map-core.js'

export function applySectorReclassifications(rows, document) {
  if (!Array.isArray(rows) || document?.schemaVersion !== 1 || !Array.isArray(document.changes)
    || document.source?.type !== 'user-request' || !document.source.note?.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(document.source.requestedOn || '')) {
    throw new Error('섹터 재분류 출처 오류')
  }
  const sectors = new Set(SECTORS.map(sector => sector.id))
  const byId = new Map(rows.map(row => [row.id, row]))
  const changed = new Set()
  for (const change of document.changes) {
    if (!/^C\d{4}$/.test(change?.companyId || '') || changed.has(change.companyId)
      || !sectors.has(change.sectorId) || !byId.has(change.companyId)) {
      throw new Error('섹터 재분류 기업·분류 오류')
    }
    changed.add(change.companyId)
    const row = byId.get(change.companyId)
    const sources = change.sources == null ? row.sources : change.sources.map(source => {
      let url
      try { url = new URL(source.url) } catch { throw new Error('섹터 재분류 출처 URL 오류') }
      if (url.protocol !== 'https:' || url.username || url.password || !source.label?.trim()) throw new Error('섹터 재분류 출처 URL 오류')
      return {label:source.label.trim(),url:url.href}
    })
    byId.set(change.companyId, {
      ...row,
      sectorId: change.sectorId,
      secondarySectorIds: (row.secondarySectorIds || []).filter(id => id !== change.sectorId),
      sources,
      sourceStatus: sources.length ? 'linked' : row.sourceStatus,
    })
  }
  return rows.map(row => byId.get(row.id))
}
