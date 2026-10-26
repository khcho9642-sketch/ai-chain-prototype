import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTokenSnapshot, validTokenDate } from '../assets/token-core.js'

const DAY_MS = 86400000
export const RANKINGS_ENDPOINT = 'https://openrouter.ai/api/v1/datasets/rankings-daily'
const SOURCE = { name: 'OpenRouter', url: 'https://openrouter.ai/rankings', license: 'CC BY 4.0' }
const COUNT = /^(?:0|[1-9]\d{0,29})$/
const ROOT = fileURLToPath(new URL('../', import.meta.url))

class TokenCollectionError extends Error {
  constructor(message) { super(message); this.name = 'TokenCollectionError' }
}

export function tokenDateWindow(now = new Date(), days = 90) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('토큰 조회 기간은 1~366일이어야 합니다.')
  const time = new Date(now)
  if (!Number.isFinite(time.getTime())) throw new Error('수집 기준일이 올바르지 않습니다.')
  const midnight = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate())
  const endDate = new Date(midnight - DAY_MS).toISOString().slice(0, 10)
  const startDate = new Date(Math.max(Date.parse('2025-01-01T00:00:00Z'), midnight - days * DAY_MS)).toISOString().slice(0, 10)
  if (endDate < startDate) throw new Error('OpenRouter 공개 이력은 2025년 1월부터 제공됩니다.')
  return { startDate, endDate }
}

export function emptyTokenSnapshot() {
  return {
    schemaVersion: 1, source: { ...SOURCE }, timezone: 'UTC', asOf: null, meta: {}, rows: [],
    coverage: { kind: 'reviewed-top-model-snapshot', completePublicTotal: false, publicOnly: true },
    collection: { method: 'api', status: 'not-connected', lastAttemptAt: null, lastSuccessAt: null, message: '공식 토큰 API 수집 전입니다.' }
  }
}

export function parseRankingsResponse(payload, { startDate, endDate, now = new Date() }) {
  const invalid = () => { throw new TokenCollectionError('OpenRouter 응답의 날짜·모델·토큰 형식을 확인하지 못했습니다.') }
  const maxRows = (Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS) + 1) * 51
  if (!payload || !Array.isArray(payload.data) || !payload.data.length || payload.data.length > maxRows ||
      !payload.meta || payload.meta.start_date !== startDate || payload.meta.end_date !== endDate ||
      typeof payload.meta.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(payload.meta.as_of) ||
      !Number.isFinite(Date.parse(payload.meta.as_of)) || typeof payload.meta.version !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,40}$/.test(payload.meta.version)) invalid()
  const rows = payload.data.map(row => {
    if (!row || !validTokenDate(row.date) || row.date < startDate || row.date > endDate ||
        typeof row.model_permaslug !== 'string' || row.model_permaslug.length > 250 ||
        (row.model_permaslug !== 'other' && !/^[^\s/]+\/[^\s]+$/.test(row.model_permaslug)) ||
        typeof row.total_tokens !== 'string' || !COUNT.test(row.total_tokens)) invalid()
    return {
      date: row.date, model: row.model_permaslug,
      author: row.model_permaslug === 'other' ? 'other' : row.model_permaslug.split('/')[0],
      totalTokens: row.total_tokens, rounded: false
    }
  }).sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model))
  const candidate = {
    ...emptyTokenSnapshot(), rows, asOf: payload.meta.as_of,
    coverage: { kind: 'api-top50-plus-other', completePublicTotal: true, publicOnly: true },
    meta: { as_of: payload.meta.as_of, version: payload.meta.version, start_date: startDate, end_date: endDate }
  }
  try { validateTokenSnapshot(candidate, { now }) } catch { invalid() }
  return candidate
}

function httpError(status) {
  if (status === 401 || status === 403) return new TokenCollectionError('OpenRouter 토큰 API 인증에 실패했습니다. 이전 자료를 유지합니다.')
  if (status === 429) return new TokenCollectionError('OpenRouter 토큰 API 호출 한도에 도달했습니다. 이전 자료를 유지합니다.')
  return new TokenCollectionError(`OpenRouter 토큰 API HTTP ${Number.isInteger(status) && status >= 100 && status <= 599 ? status : '오류'}: 이전 자료를 유지합니다.`)
}

export async function collectAiTokens(previous = emptyTokenSnapshot(), {
  apiKey = process.env.OPENROUTER_API_KEY || '', fetcher = fetch, now = new Date(), days = 90, force = false
} = {}) {
  validateTokenSnapshot(previous, { now })
  const attemptedAt = new Date(now).toISOString()
  // This skip means a successful fetch today, not that a prior attempt succeeded.
  if (!force && previous.collection.lastSuccessAt?.slice(0, 10) === attemptedAt.slice(0, 10)) return previous
  const base = structuredClone(previous)
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    base.collection = { ...base.collection, method: 'api', status: 'missing-key', lastAttemptAt: attemptedAt,
      message: 'OPENROUTER_API_KEY가 설정되지 않아 검증된 이전 자료를 표시합니다. API 자동 수집은 아직 연결되지 않았습니다.' }
    return base
  }
  const { startDate, endDate } = tokenDateWindow(now, days)
  try {
    if (/[\r\n]/.test(apiKey) || apiKey.length > 4096) throw new TokenCollectionError('OpenRouter API 키의 형식을 확인하세요. 이전 자료를 유지합니다.')
    const url = new URL(RANKINGS_ENDPOINT)
    url.searchParams.set('start_date', startDate)
    url.searchParams.set('end_date', endDate)
    const response = await fetcher(url.toString(), {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) throw httpError(response.status)
    if (Number(response.headers?.get?.('content-length') || 0) > 12 * 1024 * 1024) throw new TokenCollectionError('OpenRouter 응답 크기가 허용 범위를 벗어났습니다. 이전 자료를 유지합니다.')
    const parsed = parseRankingsResponse(await response.json(), { startDate, endDate, now })
    // Refresh each returned date as a group; a model dropping out of the top 50 moves into other.
    // Merging by model would double-count that traffic. Preserve history for absent dates,
    // because an upstream gap is not evidence of zero activity. Rounded seed rows are never merged.
    const refreshedDates = new Set(parsed.rows.map(row => row.date))
    const retained = previous.coverage.kind === 'api-top50-plus-other'
      ? previous.rows.filter(row => !refreshedDates.has(row.date)) : []
    const rows = [...retained, ...parsed.rows].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model))
    const result = {
      ...parsed, rows,
      collection: { method: 'api', status: 'ok', lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt,
        message: '완료된 UTC 날짜의 OpenRouter 공개 토큰 집계입니다. 개발사별 합계는 공개 상위 모델에 한정됩니다.' },
      source: { ...SOURCE, attribution: `Source: OpenRouter (openrouter.ai/rankings), as of ${parsed.meta.as_of}. Licensed under CC BY 4.0.` },
      meta: { ...parsed.meta,
        retainedDates: [...new Set(retained.map(row => row.date))].sort(),
        retainedSnapshotAsOf: retained.length ? previous.asOf : null }
    }
    return validateTokenSnapshot(result, { now })
  } catch (error) {
    // Never publish an upstream response body, request headers, a token, or an arbitrary error message.
    base.collection = { ...base.collection, method: 'api', status: 'error', lastAttemptAt: attemptedAt,
      message: error instanceof TokenCollectionError ? error.message : 'OpenRouter 토큰 API 연결 또는 응답 확인에 실패했습니다. 이전 성공 자료와 기준일을 유지합니다.' }
    return base
  }
}

export async function collectAiTokenFile(output = resolve(ROOT, 'data/ai-tokens.json'), options = {}) {
  let previous
  try { previous = JSON.parse(await readFile(output, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('기존 토큰 자료를 읽지 못했습니다. 파일을 덮어쓰지 않았습니다.'); previous = emptyTokenSnapshot() }
  const result = await collectAiTokens(previous, options)
  if (result === previous) return result
  await mkdir(dirname(resolve(output)), { recursive: true })
  const temporary = `${output}.${process.pid}.tmp`
  try { await writeFile(temporary, JSON.stringify(result) + '\n'); await rename(temporary, output) }
  finally { await rm(temporary, { force: true }).catch(() => {}) }
  return result
}

function cliOptions(args) {
  const options = { force: false, days: 90 }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') options.force = true
    else if (args[i] === '--days' && /^\d+$/.test(args[i + 1] || '')) options.days = Number(args[++i])
    else throw new Error('사용법: node scripts/collect-ai-tokens.mjs [--force] [--days 1~366]')
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 366) throw new Error('토큰 조회 기간은 1~366일이어야 합니다.')
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => collectAiTokenFile(undefined, cliOptions(process.argv.slice(2)))).then(result => {
    console.log(`토큰 수집: ${result.collection.status} · ${result.rows.length}개 모델·날짜 관측 · ${result.collection.message}`)
    if (result.collection.status === 'error') process.exitCode = 1
  }).catch(() => { console.error('토큰 수집 파일 또는 실행 인자를 확인하세요. 기존 자료는 유지됩니다.'); process.exitCode = 1 })
}
