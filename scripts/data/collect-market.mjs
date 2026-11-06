import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instruments } from '../../assets/instruments.js'
import { chart } from '../../server/market.mjs'
import { dailyClose } from '../../server/market-close.mjs'
import { batchQuotes } from '../../server/market-quotes.mjs'
import { loadMarketUniverse } from './market-universe.mjs'
import { enrichHomeMarket } from './enrich-home-market.mjs'
import { MARKET_DATA_POLICY } from '../../assets/market-data-policy.js'
export { instruments }

const positive = value => Number.isFinite(value) && value > 0
const reason = error => String(error?.message || error || '시세 미제공').slice(0, 400)
const capKeys = ['marketCap', 'marketCapCurrency', 'marketCapAsOf', 'marketCapObservedAt', 'marketCapFetchedAt', 'marketCapBasis', 'sharesOutstanding', 'sharesObservedAt']

// Provider capitalization is an observation, not a fabricated historical cap.
// Preserve its own timestamp even when prices use completed daily sessions.
export function capitalization(quote, previous, error = null) {
  if (positive(quote?.marketCap) && typeof quote.currency === 'string' && quote.currency) {
    return {
      marketCap: quote.marketCap,
      // GBp/GBX and ILA price units don't establish capitalization currency.
      marketCapCurrency: /^[A-Z]{3}$/.test(quote.currency) && !['GBX', 'ILA'].includes(quote.currency) ? quote.currency : null,
      marketCapAsOf: quote.marketCapAsOf || null, marketCapFetchedAt: quote.fetchedAt || null,
      marketCapObservedAt: quote.marketCapObservedAt || quote.fetchedAt || null,
      marketCapBasis: 'provider-current', marketCapStatus: 'ok', marketCapError: null,
      sharesOutstanding: positive(quote.sharesOutstanding) ? quote.sharesOutstanding : null,
      sharesObservedAt: quote.sharesObservedAt || null,
    }
  }
  const old = Object.fromEntries(capKeys.map(key => [key, previous?.[key] ?? null]))
  return { ...old, marketCapStatus: positive(old.marketCap) ? 'stale' : 'unavailable',
    marketCapError: error || '제공처 시가총액 미제공' }
}

export async function collect(output = 'data/market.json', {
  universe, closeService = dailyClose, batchService = batchQuotes, chartService = chart,
  now = Date.now, logger = console, concurrency = 4, includeHistories = true,
  includeHomeData = !universe, homeEnricher = enrichHomeMarket,
  maxBytes = 25_000_000,
  collectionEnabled = MARKET_DATA_POLICY.collectionEnabled,
} = {}) {
  if (!collectionEnabled) {
    logger.log?.(MARKET_DATA_POLICY.statusLabel)
    return { status: 'paused', paused: true, output: resolve(output) }
  }
  const startedAt = new Date(now()).toISOString()
  const loaded = universe || await loadMarketUniverse()
  const targets = loaded.targets
  if (!Array.isArray(targets) || !targets.length
    || !targets.every(row => typeof row?.symbol === 'string' && /^[A-Z0-9^=.-]{1,24}$/.test(row.symbol)
      && typeof row.name === 'string' && row.name.trim())
    || new Set(targets.map(row => row.symbol)).size !== targets.length) {
    throw new Error('중복 없는 수집 종목 원장이 필요합니다.')
  }
  let previous = {}
  try { previous = JSON.parse(await readFile(output, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('이전 시세 파일을 읽지 못했습니다. 원본을 보존합니다.', { cause: error }) }
  const oldQuotes = new Map((previous.quotes || []).map(quote => [quote.symbol, quote]))
  const legacySymbols = new Set(instruments.map(item => item.symbol))
  const caps = new Map(), capErrors = new Map()
  try {
    const result = await batchService(targets.map(item => item.symbol))
    for (const quote of result.quotes || []) caps.set(quote.symbol, quote)
    for (const error of result.errors || []) capErrors.set(error.symbol, reason(error.error))
  } catch (error) {
    for (const item of targets) capErrors.set(item.symbol, reason(error))
  }

  const queue = [...targets], quotes = []
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, Number(concurrency) || 4)) }, async () => {
    while (queue.length) {
      const item = queue.shift(), old = oldQuotes.get(item.symbol)
      const cap = capitalization(caps.get(item.symbol), old, capErrors.get(item.symbol))
      try {
        const closing = await closeService(item.symbol)
        if (closing.symbol !== item.symbol || closing.priceBasis !== 'previous-completed-session'
          || !positive(closing.price) || !closing.closeDate || !Array.isArray(closing.bars) || !closing.bars.length) {
          throw new Error('확정 종가의 필수 값이 없습니다.')
        }
        if (old?.priceBasis === 'previous-completed-session' && old.closeDate > closing.closeDate) {
          throw new Error('제공처 종가 기준일이 이전 성공값보다 오래되었습니다.')
        }
        const histories = { ...(old?.histories || {}) }, historyErrors = {}, historyFetchedAt = { ...(old?.historyFetchedAt || {}) }
        // Preserve existing detailed charts; newly covered firms need daily
        // history only. Selected charts still use the existing /api/chart route.
        if (includeHistories && legacySymbols.has(item.symbol)) {
          for (const range of ['1d', '5d', '5y']) {
            try {
              const history = await chartService(item.symbol, range)
              histories[range] = history.bars
              historyFetchedAt[range] = history.fetchedAt || startedAt
            } catch (error) {
              histories[range] ||= []
              historyErrors[range] = reason(error)
            }
          }
        }
        quotes.push({ ...item, ...closing, ...cap, name: item.name, providerName: closing.name || null,
          identityStatus: legacySymbols.has(item.symbol) ? 'existing-connection' : 'unverified',
          histories, historyFetchedAt, historyErrors, status: 'ok', error: null, lastAttemptAt: startedAt })
      } catch (error) {
        // A pre-migration intraday value cannot become a completed close.
        const usable = old?.priceBasis === 'previous-completed-session' && positive(old.price)
        const fallback = usable ? old : { price: null, previousClose: null, change: null, changePercent: null,
          closeDate: null, fetchedAt: null, marketTime: null, bars: [], histories: old?.histories || {} }
        quotes.push({ ...fallback, ...item, ...cap,
          currency: usable ? old.currency : item.currency || null,
          timezone: usable ? old.timezone : null,
          exchange: usable ? old.exchange : item.exchange || '',
          priceBasis: 'previous-completed-session',
          status: usable ? 'stale' : 'error', error: reason(error), lastAttemptAt: startedAt })
        logger.error?.(item.symbol, reason(error))
      }
    }
  }))
  const ok = quotes.filter(quote => quote.status === 'ok').length
  if (!ok) throw new Error('전체 종가 수집 실패. 이전 시세 파일을 보존합니다.')
  const order = new Map(targets.map((item, index) => [item.symbol, index]))
  quotes.sort((a, b) => order.get(a.symbol) - order.get(b.symbol))
  let data = {
    schemaVersion: 1, generatedAt: startedAt, source: 'Yahoo Finance',
    mode: 'scheduled-close', priceBasis: 'previous-completed-session', refreshMinutes: null,
    staleAfterHours: 96,
    coverage: { ...loaded.coverage, targetSymbols: targets.length, successfulCloses: ok,
      failedCloses: quotes.length - ok,
      marketCaps: quotes.filter(quote => quote.marketCapStatus === 'ok').length },
    collection: { status: ok === quotes.length ? 'ok' : 'partial', lastAttemptAt: startedAt }, quotes,
  }
  if (includeHomeData) data = await homeEnricher(data, { previous, now })
  const body = JSON.stringify(data) + '\n'
  if (Buffer.byteLength(body) > maxBytes) throw new Error('시세 파일 크기 제한 초과. 이전 파일을 보존합니다.')
  await mkdir(dirname(resolve(output)), { recursive: true })
  const temporary = output + '.tmp'
  try { await writeFile(temporary, body); await rename(temporary, output) }
  finally { await rm(temporary, { force: true }) }
  logger.log?.(`closing snapshot: ${ok}/${quotes.length} successful; ${data.coverage.marketCaps} market caps`)
  return data
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  collect().catch(error => { console.error(error.message); process.exitCode = 1 })
}
