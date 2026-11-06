const sourceId = 'kosis-mining-manufacturing'
const table = 'DT_1F02001'
const tableUrl = 'https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=' + table
const industryCode = 'C261'
const metrics = [
  { item: 'T10', id: 'kr-semiconductor-production', name: '국내 반도체 생산지수' },
  { item: 'T11', id: 'kr-semiconductor-shipments', name: '국내 반도체 출하지수' },
  { item: 'T12', id: 'kr-semiconductor-inventory', name: '국내 반도체 재고지수' },
]

function requestUrl(apiKey) {
  const url = new URL('https://kosis.kr/openapi/Param/statisticsParameterData.do')
  url.search = new URLSearchParams({
    method: 'getList', apiKey, orgId: '101', tblId: table, objL1: '00', objL2: industryCode,
    itmId: metrics.map(metric => metric.item).join(' '), prdSe: 'M', newEstPrdCnt: '36',
    format: 'json', jsonVD: 'Y',
  })
  return url
}

function buildSeries(rows, now, previous) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('empty response')
  const month = now.toISOString().slice(0, 7)
  const values = new Map(metrics.map(metric => [metric.item, new Map()]))
  for (const row of rows) {
    const byMonth = values.get(row.ITM_ID)
    const rawMonth = row.PRD_DE
    if (!byMonth || row.ORG_ID !== '101' || row.TBL_ID !== table ||
        row.C1 !== '00' || row.C2 !== industryCode || row.PRD_SE !== 'M' ||
        !/^\d{4}(0[1-9]|1[0-2])$/.test(rawMonth)) throw new Error('invalid row identity')
    const baseYear = String(row.UNIT_NM ?? '').match(/(\d{4})\s*=\s*100/)?.[1]
    if (baseYear && baseYear !== '2020') throw new Error('index base changed')
    const period = rawMonth.slice(0, 4) + '-' + rawMonth.slice(4)
    if (period > month || byMonth.has(period)) throw new Error('invalid or duplicate period')
    const raw = String(row.DT ?? '').trim()
    if (['', '-', '…', '...', '×', 'X'].includes(raw)) {
      byMonth.set(period, null)
      continue
    }
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error('invalid index')
    byMonth.set(period, { period, value: Number(raw), status: 'published', checkedAt: now.toISOString() })
  }
  return metrics.map(metric => {
    const official = values.get(metric.item)
    if (![...official.values()].some(Boolean)) throw new Error('incomplete response')
    const old = previous.find(series => series.id === metric.id)
    const points = new Map((old?.points ?? []).map(point => [point.period, point]))
    for (const [period, point] of official) {
      if (point) points.set(period, point)
      else points.delete(period)
    }
    return {
      id: metric.id, name: metric.name, kind: 'volume-index', unit: '2020=100', chains: [1, 2, 3, 4],
      sourceId, frequency: 'monthly', tableCode: table, itemCode: metric.item, checkedAt: now.toISOString(),
      definition: metric.name + '. 광업제조업동향조사 전국 반도체 제조업 월별 원지수(2020=100).',
      points: [...points.values()].sort((a, b) => a.period.localeCompare(b.period)),
    }
  })
}

export async function collectKosis(previous = {}, { now = new Date(), apiKey = process.env.KOSIS_API_KEY, fetchImpl = fetch } = {}) {
  const priorSource = previous.sources?.find(source => source.id === sourceId)
  const priorSeries = (previous.series ?? []).filter(series => series.sourceId === sourceId)
  const source = {
    ...priorSource, id: sourceId, name: '국가데이터처 KOSIS 광업제조업동향조사', url: tableUrl,
    attemptedAt: now.toISOString(),
  }
  const available = Boolean(apiKey?.trim())
  if (available) {
    try {
      const response = await fetchImpl(requestUrl(apiKey.trim()), { redirect: 'error', signal: AbortSignal.timeout(25000) })
      if (!response.ok) throw new Error('request failed')
      const series = buildSeries(await response.json(), now, priorSeries)
      return { sources: [{ ...source, checkedAt: now.toISOString(), apiMode: 'registered-key' }], series, gaps: [] }
    } catch {
      // Provider responses and fetch errors can contain the private query string.
    }
  }
  const reason = available ? 'KOSIS 통계 갱신에 실패했습니다.' : 'KOSIS 인증키 연결 대기 중입니다.'
  const gap = {
    id: available ? 'kosis-refresh-failed' : 'kosis-key-missing',
    name: '반도체 제조업 생산·출하·재고지수', status: available ? 'refresh-failed' : 'credential-required',
    reason, message: reason, sourceUrl: tableUrl,
  }
  return { sources: [{ ...source, apiMode: available ? 'registered-key' : 'credential-required' }], series: priorSeries, gaps: [gap] }
}
