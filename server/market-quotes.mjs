// The provider's quote endpoint accepts several symbols in one request. Keep this
// server-only: Yahoo's transient cookie and crumb must never enter a snapshot.
import YahooFinance from 'yahoo-finance2'

const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
const headers = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
const validSymbol = value => typeof value === 'string' && /^[A-Z0-9^=.-]{1,24}$/i.test(value)
const positive = value => Number.isFinite(value) && value > 0 ? value : null
const timestamp = value => positive(value) !== null && Number.isFinite(new Date(value * 1000).getTime()) ? value : null
const safeReason = error => ['AbortError', 'TimeoutError'].includes(error?.name)
  ? '일괄 시세 제공처 응답 시간 초과' : error?.publicReason || '일괄 시세 제공처 연결 실패'
const providerFailure = (message, authenticationFailed = false) => Object.assign(new Error(message), { publicReason: message, authenticationFailed })

export function projectQuote(row, fetchedAt) {
  const marketTime = timestamp(row.regularMarketTime)
  return {
    symbol: row.symbol.toUpperCase(),
    currency: typeof row.currency === 'string' && /^[A-Za-z]{3,4}$/.test(row.currency) ? row.currency : null,
    marketCap: positive(row.marketCap),
    sharesOutstanding: positive(row.sharesOutstanding),
    regularMarketPrice: positive(row.regularMarketPrice),
    regularMarketTime: marketTime,
    // The quote endpoint supplies no separate valuation timestamp. Do not turn
    // the current quote's trade time into a claimed historical cap timestamp.
    marketCapAsOf: null,
    marketCapObservedAt: positive(row.marketCap) !== null ? fetchedAt : null,
    marketCapBasis: positive(row.marketCap) !== null ? 'provider-current' : null,
    sharesObservedAt: positive(row.sharesOutstanding) !== null ? fetchedAt : null,
    fetchedAt,
    source: 'Yahoo Finance',
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(row.symbol.toUpperCase())}/`,
  }
}

export function createBatchQuoteService({
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8_000,
  batchSize = 50, ttl = 60_000, credentialTtl = 30 * 60_000, maxEntries = 1_000,
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new RangeError('batchSize must be between 1 and 50')
  if (!Number.isFinite(ttl) || ttl < 0 || !Number.isFinite(credentialTtl) || credentialTtl < 0) throw new RangeError('cache duration must be nonnegative')
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be positive')
  const cache = new Map(), pending = new Map()
  let credentials = null, authPending = null

  async function fetchProvider(url, extraHeaders = {}) {
    return fetchImpl(url, { headers: { ...headers, ...extraHeaders }, signal: AbortSignal.timeout(timeoutMs) })
  }

  async function authenticate() {
    if (credentials && credentials.expires > now()) return credentials
    if (authPending) return authPending
    authPending = (async () => {
      // fc.yahoo.com can respond 404 while still setting the required cookie.
      const response = await fetchProvider(new URL('https://fc.yahoo.com/'))
      const setCookies = typeof response.headers?.getSetCookie === 'function'
        ? response.headers.getSetCookie() : [response.headers?.get?.('set-cookie')].filter(Boolean)
      const cookie = setCookies.map(value => String(value).split(';', 1)[0])
        .filter(value => /^[A-Za-z0-9!#$%&'*+.^_`|~-]+=[^\r\n;,]+$/.test(value)).join('; ')
      if (!cookie) throw providerFailure('일괄 시세 인증 쿠키를 받지 못했습니다.')
      for (const host of hosts) {
        const crumbResponse = await fetchProvider(new URL(`https://${host}/v1/test/getcrumb`), { Cookie: cookie })
        if (!crumbResponse.ok) continue
        const crumb = (await crumbResponse.text()).trim()
        if (!crumb || crumb.length > 512 || /[\s<>\x00-\x1f\x7f]/.test(crumb)) continue
        credentials = { cookie, crumb, expires: now() + credentialTtl }
        return credentials
      }
      throw providerFailure('일괄 시세 인증 토큰을 받지 못했습니다.')
    })()
    try { return await authPending } finally { authPending = null }
  }

  async function request(host, symbols, auth) {
    const url = new URL(`https://${host}/v7/finance/quote`)
    url.searchParams.set('symbols', symbols.join(','))
    url.searchParams.set('formatted', 'false')
    if (auth) url.searchParams.set('crumb', auth.crumb)
    const response = await fetchProvider(url, auth ? { Cookie: auth.cookie } : {})
    if (response.status === 401 || response.status === 403) return { unauthorized: true }
    if (!response.ok) throw providerFailure(`일괄 시세 제공처 HTTP ${response.status}`)
    const body = await response.json()
    const errorCode = body?.quoteResponse?.error?.code
    if (/unauthorized|forbidden/i.test(String(errorCode || ''))) return { unauthorized: true }
    if (!Array.isArray(body?.quoteResponse?.result) || body.quoteResponse.error) {
      throw providerFailure('일괄 시세 응답 형식 오류')
    }
    return { rows: body.quoteResponse.result }
  }

  async function loadChunk(symbols) {
    let lastError, refreshed = false
    for (const host of hosts) {
      try {
        let result = await request(host, symbols, credentials?.expires > now() ? credentials : null)
        if (result.unauthorized && !refreshed) {
          refreshed = true
          credentials = null
          let auth
          try { auth = await authenticate() }
          catch (error) {
            // The cookie/token flow has already failed. Sending every remaining
            // batch through that same flow only multiplies a provider outage.
            throw Object.assign(providerFailure(safeReason(error), true), { stopBatch: true })
          }
          result = await request(host, symbols, auth)
        }
        if (result.unauthorized) throw providerFailure('일괄 시세 제공처 인증 실패', true)
        return result.rows
      } catch (error) {
        if (error.stopBatch) throw error
        lastError = error
      }
    }
    throw providerFailure(safeReason(lastError), lastError?.authenticationFailed)
  }

  return async function batchQuotes(symbols) {
    if (!Array.isArray(symbols) || symbols.length > 10_000 || !symbols.every(validSymbol)) {
      throw new TypeError('종목 코드 배열이 올바르지 않습니다.')
    }
    const requested = [...new Set(symbols.map(symbol => symbol.toUpperCase()))]
    const key = requested.join(',')
    if (pending.has(key)) return pending.get(key)
    const task = (async () => {
      const found = new Map(), errors = new Map()
      const missing = requested.filter(symbol => {
        const entry = cache.get(symbol)
        if (entry?.expires > now()) { found.set(symbol, entry.quote); return false }
        return true
      })
      // Sequential chunks bound upstream concurrency and share one transient
      // authentication session. A failed chunk does not erase successful chunks.
      let authenticationFailure = null
      for (let start = 0; start < missing.length; start += batchSize) {
        const chunk = missing.slice(start, start + batchSize), allowed = new Set(chunk)
        if (authenticationFailure) {
          for (const symbol of chunk) errors.set(symbol, authenticationFailure)
          continue
        }
        try {
          const rows = await loadChunk(chunk), fetchedAt = new Date(now()).toISOString()
          for (const row of rows) {
            if (!validSymbol(row?.symbol)) continue
            const symbol = row.symbol.toUpperCase()
            if (!allowed.has(symbol) || found.has(symbol)) continue
            const quote = projectQuote(row, fetchedAt)
            found.set(symbol, quote)
            if (cache.size >= maxEntries) cache.delete(cache.keys().next().value)
            cache.set(symbol, { quote, expires: now() + ttl })
          }
          for (const symbol of chunk) if (!found.has(symbol)) errors.set(symbol, '일괄 시세 응답에 종목이 없습니다.')
        } catch (error) {
          // This circuit lasts for this service call only. A later scheduled
          // collection may retry after the provider has recovered.
          if (error.authenticationFailed) authenticationFailure = safeReason(error)
          for (const symbol of chunk) errors.set(symbol, safeReason(error))
        }
      }
      return {
        quotes: requested.filter(symbol => found.has(symbol)).map(symbol => found.get(symbol)),
        errors: requested.filter(symbol => errors.has(symbol)).map(symbol => ({ symbol, error: errors.get(symbol) })),
        requestedCount: requested.length, batchSize, source: 'Yahoo Finance',
      }
    })()
    pending.set(key, task)
    try { return await task } finally { pending.delete(key) }
  }
}

// The maintained library handles Yahoo's changing cookie/consent handshake.
// Keep the direct transport factory above for diagnostics, never as an automatic
// per-batch authentication retry after a library authentication failure.
export function createLibraryBatchQuoteService({
  quoteImpl, now = Date.now, timeoutMs = 20_000, batchSize = 50,
  ttl = 60_000, maxEntries = 1_000,
} = {}) {
  if (quoteImpl !== undefined && typeof quoteImpl !== 'function') throw new TypeError('quoteImpl must be a function')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new RangeError('batchSize must be between 1 and 50')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive')
  if (!Number.isFinite(ttl) || ttl < 0 || !Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('cache configuration is invalid')
  const client = quoteImpl ? null : new YahooFinance({
    logger: { info() {}, warn() {}, error() {}, debug() {}, dir() {} },
    suppressNotices: ['yahooSurvey', 'ripHistorical'],
  })
  const query = quoteImpl || client.quote.bind(client), cache = new Map(), pending = new Map()

  async function loadChunk(symbols) {
    const controller = new AbortController()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new DOMException('일괄 시세 제공처 응답 시간 초과', 'TimeoutError')
        controller.abort(error)
        reject(error)
      }, timeoutMs)
    })
    try {
      const rows = await Promise.race([
        Promise.resolve().then(() => query(symbols, {}, {
          fetchOptions: { signal: controller.signal }, validateResult: false,
        })),
        timeout,
      ])
      if (!Array.isArray(rows)) throw providerFailure('일괄 시세 응답 형식 오류')
      return rows
    } catch (error) {
      const status = error?.status || error?.statusCode || error?.response?.status
      const authenticationFailed = [401, 403].includes(status)
        || /\b401\b|\b403\b|unauthorized|forbidden|crumb|cookie|consent|authenticat/i.test(String(error?.message || error?.code || ''))
      throw providerFailure(authenticationFailed ? '일괄 시세 제공처 인증 실패' : safeReason(error), authenticationFailed)
    } finally { clearTimeout(timer) }
  }

  return async function libraryBatchQuotes(symbols) {
    if (!Array.isArray(symbols) || symbols.length > 10_000 || !symbols.every(validSymbol)) throw new TypeError('종목 코드 배열이 올바르지 않습니다.')
    const requested = [...new Set(symbols.map(symbol => symbol.toUpperCase()))], key = requested.join(',')
    if (pending.has(key)) return pending.get(key)
    const task = (async () => {
      const found = new Map(), errors = new Map()
      const missing = requested.filter(symbol => {
        const entry = cache.get(symbol)
        if (entry?.expires > now()) { found.set(symbol, entry.quote); return false }
        return true
      })
      let authenticationFailure = null
      for (let start = 0; start < missing.length; start += batchSize) {
        const chunk = missing.slice(start, start + batchSize), allowed = new Set(chunk)
        if (authenticationFailure) {
          for (const symbol of chunk) errors.set(symbol, authenticationFailure)
          continue
        }
        try {
          const rows = await loadChunk(chunk), fetchedAt = new Date(now()).toISOString()
          for (const row of rows) {
            if (!validSymbol(row?.symbol)) continue
            const symbol = row.symbol.toUpperCase()
            if (!allowed.has(symbol) || found.has(symbol)) continue
            const regularMarketTime = row.regularMarketTime instanceof Date
              ? row.regularMarketTime.getTime() / 1000 : row.regularMarketTime
            const projected = projectQuote({ ...row, regularMarketTime }, fetchedAt)
            found.set(symbol, projected)
            if (cache.size >= maxEntries) cache.delete(cache.keys().next().value)
            cache.set(symbol, { quote: projected, expires: now() + ttl })
          }
          for (const symbol of chunk) if (!found.has(symbol)) errors.set(symbol, '일괄 시세 응답에 종목이 없습니다.')
        } catch (error) {
          if (error.authenticationFailed) authenticationFailure = safeReason(error)
          for (const symbol of chunk) errors.set(symbol, safeReason(error))
        }
      }
      return {
        quotes: requested.filter(symbol => found.has(symbol)).map(symbol => found.get(symbol)),
        errors: requested.filter(symbol => errors.has(symbol)).map(symbol => ({ symbol, error: errors.get(symbol) })),
        requestedCount: requested.length, batchSize, source: 'Yahoo Finance',
      }
    })()
    pending.set(key, task)
    try { return await task } finally { pending.delete(key) }
  }
}

export const batchQuotes = createLibraryBatchQuoteService()
