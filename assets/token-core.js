// Public OpenRouter aggregates. Raw integer counts stay strings throughout storage.
const DAY_MS = 86400000
const COUNT = /^(?:0|[1-9]\d{0,29})$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const COVERAGE = new Set(['reviewed-top-model-snapshot', 'api-top50-plus-other'])
const STATES = new Set(['not-connected', 'ok', 'missing-key', 'error'])

export function validTokenDate(value) {
  return typeof value === 'string' && DATE.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function validTimestamp(value) {
  return value === null || (typeof value === 'string' && value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
}

export function validateTokenSnapshot(data, { now = new Date() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10)
  if (data?.schemaVersion !== 1 || data.timezone !== 'UTC' || !Array.isArray(data.rows) ||
      data.source?.name !== 'OpenRouter' || data.source?.url !== 'https://openrouter.ai/rankings' ||
      data.source?.license !== 'CC BY 4.0' || !COVERAGE.has(data.coverage?.kind) ||
      typeof data.coverage.completePublicTotal !== 'boolean' || data.coverage.publicOnly !== true ||
      data.collection?.method !== 'api' || !STATES.has(data.collection.status) ||
      !validTimestamp(data.collection.lastAttemptAt) || !validTimestamp(data.collection.lastSuccessAt)) {
    throw new Error('토큰 통계 정의와 수집 상태를 확인하세요.')
  }
  const isApi = data.coverage.kind === 'api-top50-plus-other'
  if (data.coverage.completePublicTotal !== isApi) throw new Error('토큰 합계의 집계 범위가 일치하지 않습니다.')
  const identities = new Set(), perDay = new Map()
  for (const row of data.rows) {
    if (!validTokenDate(row.date) || row.date >= today || row.date < '2025-01-01' ||
        typeof row.model !== 'string' || !row.model || row.model.length > 250 || /[\r\n\u0000]/.test(row.model) ||
        typeof row.author !== 'string' || !row.author || row.author.length > 100 || /[\r\n\u0000]/.test(row.author) ||
        typeof row.totalTokens !== 'string' || !COUNT.test(row.totalTokens) || typeof row.rounded !== 'boolean') {
      throw new Error('토큰 관측에 잘못된 날짜·집계값·모델 정보가 있습니다.')
    }
    const identity = `${row.date}\u0000${row.model}`
    if (identities.has(identity)) throw new Error('같은 날짜·모델의 토큰 관측이 중복되었습니다.')
    identities.add(identity)
    if (isApi && (row.rounded || (row.model === 'other' ? row.author !== 'other' :
      !/^[^\s/]+\/[^\s]+$/.test(row.model) || row.author !== row.model.split('/')[0]))) {
      throw new Error('API 모델 식별자와 개발사 구분을 확인하세요.')
    }
    const count = perDay.get(row.date) || { models: 0, other: 0 }
    row.model === 'other' ? count.other++ : count.models++
    if (isApi && (count.models > 50 || count.other > 1)) throw new Error('일별 상위 50개 모델 범위를 벗어났습니다.')
    perDay.set(row.date, count)
  }
  return data
}

export function latestTokenDate(snapshot) {
  return (snapshot?.rows || []).reduce((date, row) => row.date > date ? row.date : date, '') || null
}

export function tokenRowsForDate(snapshot, date = latestTokenDate(snapshot)) {
  return (snapshot?.rows || []).filter(row => row.date === date).sort((a, b) => {
    if (a.model === 'other') return 1
    if (b.model === 'other') return -1
    const first = BigInt(a.totalTokens), second = BigInt(b.totalTokens)
    return first === second ? a.model.localeCompare(b.model) : first > second ? -1 : 1
  })
}

// A reviewed top-model snapshot has no known platform denominator.
export function tokenDailyTotals(snapshot) {
  if (!snapshot?.coverage?.completePublicTotal || snapshot.coverage.kind !== 'api-top50-plus-other') return []
  const totals = new Map()
  for (const row of snapshot.rows) totals.set(row.date, (totals.get(row.date) || 0n) + BigInt(row.totalTokens))
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, totalTokens: total.toString() }))
}

// These are visible-model lower bounds, not all traffic for a developer.
export function visibleAuthorTotals(snapshot, date = latestTokenDate(snapshot)) {
  const totals = new Map()
  for (const row of tokenRowsForDate(snapshot, date)) {
    if (row.model === 'other' || row.author === 'other') continue
    totals.set(row.author, (totals.get(row.author) || 0n) + BigInt(row.totalTokens))
  }
  return [...totals].map(([author, total]) => ({ author, totalTokens: total.toString() }))
    .sort((a, b) => BigInt(a.totalTokens) === BigInt(b.totalTokens) ? a.author.localeCompare(b.author) :
      BigInt(a.totalTokens) > BigInt(b.totalTokens) ? -1 : 1)
}

// totalTokens is the integer-floor display value of an average, never a raw count.
// value is an approximate Number for chart geometry; sumTokens/divisor retains the exact rational value.
export function tokenMovingAverage(totals, days = 7) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('이동평균 기간이 올바르지 않습니다.')
  const seen = new Set()
  const ordered = [...totals].sort((a, b) => a.date.localeCompare(b.date))
  for (const point of ordered) {
    if (!validTokenDate(point.date) || seen.has(point.date) || typeof point.totalTokens !== 'string' || !COUNT.test(point.totalTokens)) {
      throw new Error('이동평균의 일별 합계를 확인하세요.')
    }
    seen.add(point.date)
  }
  return ordered.map((point, index) => {
    const window = ordered.slice(Math.max(0, index - days + 1), index + 1)
    const contiguous = window.length === days && window.every((entry, i) => !i ||
      Date.parse(`${entry.date}T00:00:00Z`) - Date.parse(`${window[i - 1].date}T00:00:00Z`) === DAY_MS)
    if (!contiguous) return { date: point.date, totalTokens: null, value: null, sumTokens: null, divisor: days }
    const sum = window.reduce((total, entry) => total + BigInt(entry.totalTokens), 0n)
    return { date: point.date, totalTokens: (sum / BigInt(days)).toString(), value: Number(sum) / days, sumTokens: sum.toString(), divisor: days }
  })
}

export function formatTokens(value) {
  if (value === null || value === undefined || value === '') return '—'
  let count
  try {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return '—'
      count = BigInt(Math.floor(value))
    } else if (typeof value === 'bigint') count = value
    else if (typeof value === 'string' && COUNT.test(value)) count = BigInt(value)
    else return '—'
  } catch { return '—' }
  if (count < 0n) return '—'
  for (const [scale, label] of [[1000000000000n, '조'], [100000000n, '억'], [10000n, '만']]) {
    if (count >= scale) {
      const hundredths = (count * 100n + scale / 2n) / scale
      const decimals = String(hundredths % 100n).padStart(2, '0').replace(/0+$/, '')
      return `${(hundredths / 100n).toLocaleString('ko-KR')}${decimals ? '.' + decimals : ''}${label}`
    }
  }
  return count.toLocaleString('ko-KR')
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}

export function tokenTotalsCsv(snapshot) {
  const rows = [['date_utc', 'model', 'model_author', 'prompt_plus_completion_tokens', 'rounded', 'coverage', 'source_url', 'as_of'],
    ...[...(snapshot?.rows || [])].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model))
      .map(row => [row.date, row.model, row.author, row.totalTokens, row.rounded, snapshot.coverage.kind, snapshot.source.url, snapshot.meta?.as_of || snapshot.asOf])]
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}
