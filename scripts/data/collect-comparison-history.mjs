import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instruments } from '../../assets/instruments.js'
import { chart } from '../../server/market.mjs'
import { comparisonHistoryCatalog, MAX_COMPARISON_HISTORY_BYTES, validateComparisonHistorySnapshot } from '../../assets/comparison-history-core.js'

const source = 'Yahoo Finance'
const sourceUrl = symbol => 'https://finance.yahoo.com/quote/' + encodeURIComponent(symbol) + '/'
const errorReason = error => String(error?.message || '실제 일봉 수집 실패').slice(0, 500)

export function compactComparisonQuote(item, quote, now = Date.now()) {
  if (quote?.symbol !== item.symbol || quote.range !== '3y' || quote.interval !== '1d' || !Array.isArray(quote.bars)) throw new Error('요청한 종목의 3년 일봉이 아닙니다.')
  const points = new Map()
  for (const bar of quote.bars) {
    if (Number.isInteger(bar?.time) && bar.time > 0 && bar.time * 1000 <= now
      && typeof bar.close === 'number' && Number.isFinite(bar.close) && bar.close > 0) points.set(bar.time, bar.close)
  }
  const bars = [...points].sort((a, b) => a[0] - b[0]).map(([time, close]) => ({ time, close }))
  return {
    symbol: item.symbol, name: item.name, currency: quote.currency, timezone: quote.timezone,
    range: '3y', interval: '1d', source, sourceUrl: sourceUrl(item.symbol),
    fetchedAt: quote.fetchedAt, status: 'ok', bars, error: null,
  }
}

export async function collectComparisonHistory(output = 'data/comparison-history.json', {
  chartService = chart, now = Date.now, catalog = instruments, concurrency = 3,
  maxBytes = MAX_COMPARISON_HISTORY_BYTES, logger = console,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new RangeError('수집 동시 실행 수 오류')
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_COMPARISON_HISTORY_BYTES) throw new RangeError('공개 응답 크기 제한 오류')
  const nowMs = Number(now())
  if (!Number.isFinite(nowMs)) throw new RangeError('수집 시각 오류')
  const peers = comparisonHistoryCatalog(catalog)
  if (!peers.length) throw new Error('등록된 AI 피어가 없습니다.')
  let previous = null
  try { previous = validateComparisonHistorySnapshot(JSON.parse(await readFile(output, 'utf8')), { catalog, now: nowMs }) } catch {}
  const oldQuotes = new Map((previous?.quotes || []).map(quote => [quote.symbol, quote]))
  const queue = [...peers], quotes = []
  await Promise.all(Array.from({ length: Math.min(concurrency, peers.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      try {
        const quote = compactComparisonQuote(item, await chartService(item.symbol, '3y'), Number(now()))
        validateComparisonHistorySnapshot({ schemaVersion: 1, range: '3y', interval: '1d', generatedAt: new Date(nowMs).toISOString(), source, quotes: [quote] }, { catalog: [item], now: Number(now()) })
        quotes.push(quote)
      } catch (error) {
        const old = oldQuotes.get(item.symbol)
        const reason = errorReason(error)
        quotes.push(old?.bars?.length ? { ...old, status: 'stale', error: reason } : {
          symbol: item.symbol, name: item.name, currency: null, timezone: null,
          range: '3y', interval: '1d', source, sourceUrl: sourceUrl(item.symbol),
          fetchedAt: null, status: 'error', bars: [], error: reason,
        })
        logger.error?.(item.symbol, reason)
      }
    }
  }))
  const ok = quotes.filter(quote => quote.status === 'ok').length
  if (!ok) throw new Error('전체 비교 일봉 수집 실패. 이전 파일을 보존합니다.')
  const order = new Map(peers.map((item, index) => [item.symbol, index]))
  quotes.sort((a, b) => order.get(a.symbol) - order.get(b.symbol))
  const data = validateComparisonHistorySnapshot({ schemaVersion: 1, range: '3y', interval: '1d', generatedAt: new Date(nowMs).toISOString(), source, quotes }, { catalog, now: Number(now()) })
  const body = JSON.stringify(data) + '\n'
  if (Buffer.byteLength(body, 'utf8') >= maxBytes) throw new Error('비교 일봉 공개 응답 크기 제한 초과. 이전 파일을 보존합니다.')
  await mkdir(dirname(resolve(output)), { recursive: true })
  const temporary = output + '.tmp'
  try {
    await writeFile(temporary, body)
    await rename(temporary, output)
  } finally { await rm(temporary, { force: true }) }
  logger.log?.('comparison daily history: ' + ok + '/' + quotes.length + ' successful; ' + Buffer.byteLength(body, 'utf8') + ' bytes')
  return data
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  collectComparisonHistory().catch(error => { console.error(error.message); process.exitCode = 1 })
}
