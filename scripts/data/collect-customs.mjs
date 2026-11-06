import { XMLParser, XMLValidator } from 'fast-xml-parser'

const sourceId = 'customs-itemtrade'
const catalogUrl = 'https://www.data.go.kr/data/15101609/openapi.do'
const endpoint = 'https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList'
const parser = new XMLParser({ parseTagValue: false, ignoreAttributes: true, processEntities: false })
export const CUSTOMS_GROUPS = [
  { id: 'memory', label: '메모리 집적회로', codes: ['854232'], chains: [3], scope: 'HS 854232 메모리 집적회로 전체' },
  { id: 'transformer', label: '변압기', codes: ['850421', '850422', '850423', '850431', '850432', '850433', '850434'], chains: [5, 6], scope: 'HS 850421~850423 및 850431~850434 변압기 7개 품목 합계' },
]

function monthAt(date, offset) {
  const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
  return month.toISOString().slice(0, 7)
}

function periodsBetween(start, end) {
  const periods = []
  for (let period = start; period <= end; period = monthAt(new Date(period + '-01T00:00:00Z'), 1)) periods.push(period)
  return periods
}

function amount(value) {
  const raw = String(value ?? '').trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) throw new Error('Missing trade value')
  const numeric = Number(raw.replaceAll(',', ''))
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > Number.MAX_SAFE_INTEGER) throw new Error('Invalid trade value')
  return numeric
}

export function parseCustomsXml(xml, code, start, end) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid customs XML')
  const response = parser.parse(xml).response
  if (response?.header?.resultCode !== '00') throw new Error('Customs API rejected request')
  const entries = response.body?.items?.item
  const rows = entries ? (Array.isArray(entries) ? entries : [entries]) : []
  const periods = new Map()
  for (const row of rows) {
    const year = String(row.year ?? '').trim()
    if (/^(총계|합계|총 계|합 계)$/.test(year)) continue
    const match = /^(\d{4})\.(0[1-9]|1[0-2])$/.exec(year)
    const period = match ? match[1] + '-' + match[2] : ''
    if (String(row.hsCode).trim() !== code || !period || period < start || period > end || periods.has(period)) throw new Error('Customs series identity changed')
    periods.set(period, { period, usd: amount(row.expDlr), kg: amount(row.expWgt) })
  }
  if (periods.size !== periodsBetween(start, end).length) throw new Error('Incomplete customs monthly response')
  return periods
}

async function readWindow(code, start, end, serviceKey, fetchImpl) {
  const url = new URL(endpoint)
  url.search = new URLSearchParams({ serviceKey, strtYymm: start.replace('-', ''), endYymm: end.replace('-', ''), hsSgn: code })
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/xml' } })
  if (!response.ok) throw new Error('Customs request failed')
  return parseCustomsXml(await response.text(), code, start, end)
}

export async function collectCustoms(previous = {}, { now = new Date(), serviceKey = process.env.CUSTOMS_SERVICE_KEY, fetchImpl = fetch } = {}) {
  const checkedAt = now.toISOString()
  const oldSource = previous.sources?.find(source => source.id === sourceId)
  const oldSeries = (previous.series ?? []).filter(series => series.sourceId === sourceId)
  const source = { ...oldSource, id: sourceId, name: '관세청 품목별 수출입실적', url: catalogUrl, attemptedAt: checkedAt, note: '월별 통계·수정 가능. 수출액은 FOB 미국 달러, 중량은 순중량 kg. 전월 자료는 매월 15일경 정정·취하 내역을 반영합니다.' }
  const available = Boolean(serviceKey?.trim())
  const series = new Map(oldSeries.map(item => [item.id, item]))
  const failures = []
  let successes = 0
  // Until the monthly revision around the 15th, collect through the preceding complete release month.
  const end = monthAt(now, now.getUTCDate() >= 15 ? -1 : -2)
  const start = monthAt(new Date(end + '-01T00:00:00Z'), -35)
  const periods = periodsBetween(start, end)
  if (available) {
    let key = serviceKey.trim()
    try { key = decodeURIComponent(key) } catch { /* A raw key may contain a percent sign. */ }
    for (const group of CUSTOMS_GROUPS) {
      try {
        const sums = new Map(periods.map(period => [period, { usd: 0, kg: 0 }]))
        for (const code of group.codes) {
          for (let offset = 0; offset < periods.length; offset += 12) {
            const rows = await readWindow(code, periods[offset], periods[Math.min(offset + 11, periods.length - 1)], key, fetchImpl)
            for (const [period, values] of rows) {
              const sum = sums.get(period)
              sum.usd += values.usd
              sum.kg += values.kg
            }
          }
        }
        for (const field of ['usd', 'kg']) {
          const suffix = field === 'usd' ? 'usd' : 'weight'
          const id = `kr-${group.id}-export-${suffix}`
          const old = series.get(id)
          const points = new Map((old?.points ?? []).map(point => [point.period, point]))
          for (const [period, values] of sums) points.set(period, { period, value: values[field], status: 'published', checkedAt })
          series.set(id, {
            id, name: `한국 ${group.label} 수출${field === 'usd' ? '액' : ' 순중량'}`,
            kind: field === 'usd' ? 'value' : 'weight', unit: field === 'usd' ? 'USD' : 'kg',
            chains: group.chains, sourceId, frequency: 'monthly', checkedAt, hsCodes: group.codes,
            definition: `${group.scope}. 한국의 전 세계 대상 월별 수출${field === 'usd' ? '신고금액(FOB, USD)' : '순중량(kg)'}. 품목별 관세청 통계이며 이후 수정될 수 있습니다.`,
            points: [...points.values()].sort((a, b) => a.period.localeCompare(b.period)),
          })
        }
        successes++
      } catch {
        // URL-bearing transport errors may include the service key. Only publish a fixed status.
        failures.push(group.label)
      }
    }
  }
  const reason = available ? '관세청 품목별 통계 갱신에 실패했습니다.' : '관세청 품목별 통계 인증키 연결 대기 중입니다.'
  return {
    sources: [{ ...source, apiMode: available ? 'registered-key' : 'credential-required', ...(successes ? { checkedAt } : {}) }],
    series: [...series.values()],
    gaps: !available || failures.length ? [{
      id: available ? 'customs-itemtrade-refresh-failed' : 'customs-itemtrade-key-missing', name: '메모리·변압기 수출액·순중량',
      status: available ? 'refresh-failed' : 'credential-required', reason, message: reason, sourceUrl: catalogUrl,
      ...(failures.length ? { groups: failures } : {}),
    }] : [],
  }
}
