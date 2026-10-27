import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const iso = value => {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
const sourceUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null }
  catch { return null }
}

/** Read existing structured snapshots only. This function never collects or calls a model. */
export function buildEvidenceSnapshot({ symbol, market, disclosures, statistics, now = Date.now() } = {}) {
  if (typeof symbol !== 'string' || !symbol) return null
  const evidence = []
  const add = item => {
    if (!item.observedAt || !item.collectedAt || !item.sourceUrl || Date.parse(item.observedAt) > now + 300000 || Date.parse(item.collectedAt) > now + 300000) return
    const row = { ...item, symbol }
    evidence.push({ id: `e-${digest(row)}`, ...row })
  }
  const quote = market?.quotes?.find(row => row.symbol === symbol)
  if (quote?.status === 'ok') {
    const observedAt = iso(quote.marketTime * 1000)
    const collectedAt = iso(quote.fetchedAt || market.generatedAt)
    const url = sourceUrl(quote.sourceUrl)
    for (const [key, label, unit] of [['price', '관측 시세', quote.currency], ['changePercent', '전일 종가 대비 등락률', '%'], ['volume', '관측 거래량', '주']]) {
      if (Number.isFinite(quote[key]) && typeof unit === 'string' && unit) add({ kind: 'quote', label, value: Number(quote[key].toFixed(8)), unit,
        observedAt, collectedAt, sourceUrl: url, delayed: quote.delayed !== false,
        stale: !!observedAt && now - Date.parse(observedAt) > 36 * 3600000 })
    }
  }
  const company = disclosures?.companies?.find(row => row.symbol === symbol)
  if (company?.status === 'ok') {
    for (const item of (company.items || []).slice(0, 5)) {
      if (typeof item.title !== 'string' || !item.title.trim()) continue
      add({ kind: 'disclosure_title', label: item.title.trim().slice(0, 240), value: null, unit: null,
        observedAt: iso(item.publishedAt), collectedAt: iso(company.lastSuccessAt || disclosures.collection?.lastSuccessAt),
        sourceUrl: sourceUrl(item.sourceUrl), titleOnly: true })
    }
  }
  // No company-name guessing: only explicitly symbol-linked metrics enter a stock prompt.
  for (const metric of (statistics?.metrics || []).filter(row => row.symbol === symbol || row.symbols?.includes(symbol)).slice(0, 5)) {
    const observation = metric.observations?.[metric.latestIndex ?? metric.observations.length - 1]
    if (!Number.isFinite(observation?.value) || !metric.unit || !observation.period) continue
    const published = metric.sources?.find(row => row.url === observation.sourceUrl)
    add({ kind: 'statistic', label: String(metric.name).slice(0, 160), value: observation.value, unit: metric.unit,
      period: observation.period, observedAt: iso(observation.period.length === 7 ? `${observation.period}-01` : observation.period),
      collectedAt: iso(observation.verifiedAt || published?.verifiedAt || statistics.generatedAt), sourceUrl: sourceUrl(observation.sourceUrl) })
  }
  if (!evidence.length) return null
  const dataAsOf = [...evidence].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1).observedAt
  return { id: `ctx-${digest({ symbol, evidence })}`, symbol, createdAt: iso(now), dataAsOf, evidence,
    limitations: ['자료의 관측 시각과 수집 시각은 다르다.', '공시 제목은 본문 분석이나 실적 확인을 뜻하지 않는다.', '근거 ID의 일치는 내용 전체의 사실 검증을 뜻하지 않는다.'] }
}

export function createEvidenceSource({ root = projectRoot, now = Date.now } = {}) {
  const cache = new Map()
  const read = name => {
    try {
      const path = join(root, 'data', name), { mtimeMs, size } = statSync(path)
      const old = cache.get(name)
      if (old?.mtimeMs === mtimeMs && old.size === size) return old.value
      const value = JSON.parse(readFileSync(path, 'utf8'))
      cache.set(name, { mtimeMs, size, value }); return value
    } catch { cache.delete(name); return null }
  }
  return symbol => {
    return buildEvidenceSnapshot({ symbol, market: read('market.json'), disclosures: read('company-disclosures.json'), statistics: read('ai-statistics.json'), now: now() })
  }
}
