import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BYTES = 3_000_000
const DISCOVERY = [
  { url: 'https://openai.com/news/rss.xml', type: 'rss' },
  { url: 'https://www.anthropic.com/news', type: 'html' },
]
const RELEVANT_TITLE = /revenue|user|customer|subscriber|subscription|enterprise|business|funding|raises?|invest|compute|partner|work|financ|scal|growth|code|token|million|billion/i
const sha256 = value => createHash('sha256').update(value).digest('hex')
const seoulDay = date => new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

/** Exact host and article-path allowlist, applied before every request and redirect. */
export function normalizeOfficialUrl(value, { discovery = false, base } = {}) {
  let url
  try { url = new URL(value, base) } catch { throw new Error('허용되지 않은 발표자료 URL입니다.') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('HTTPS 공식 발표자료만 확인합니다.')
  }
  let host
  if (['openai.com', 'www.openai.com'].includes(url.hostname)) host = 'openai.com'
  else if (['anthropic.com', 'www.anthropic.com'].includes(url.hostname)) host = 'www.anthropic.com'
  else throw new Error('허용되지 않은 발표자료 호스트입니다.')
  const path = url.pathname.replace(/\/$/, '')
  const isArticle = host === 'openai.com' ? /^\/index\/[a-z0-9-]+$/.test(path) : /^\/news\/[a-z0-9-]+$/.test(path)
  const isIndex = discovery && (host === 'openai.com' ? path === '/news/rss.xml' : path === '/news')
  if (!isArticle && !isIndex) throw new Error('공식 발표문 또는 지정 뉴스 목록만 확인합니다.')
  return `https://${host}${path}${host === 'openai.com' && isArticle ? '/' : ''}`
}

function decodeEntities(value) {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
      const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]
      const n = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10)
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
    })
}

function plainText(value) {
  return decodeEntities(String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim()
}

/** Public output contains metadata and a hash, never article body or extracted values. */
export function extractDisclosureDocument(html) {
  const title = plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1]
    || html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '').slice(0, 220)
  const main = html.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1]
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]
    || html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] || html
  const text = plainText(main)
  if (!title || text.length < 80 || (text.length < 2000 && /just a moment|verify you are human|access denied|enable javascript and cookies|checking your browser/i.test(text))) {
    throw new Error('본문을 확인할 수 없는 응답입니다. 기존 확인값을 유지합니다.')
  }
  const published = html.match(/<meta\b[^>]*(?:property|name)=["']article:published_time["'][^>]*content=["']([^"']+)/i)?.[1]
    || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']article:published_time["']/i)?.[1]
    || html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1]
  const publishedAt = published && /^\d{4}-\d{2}-\d{2}/.test(published) && Number.isFinite(Date.parse(published)) ? published.slice(0, 10) : null
  return { title, contentHash: sha256(`${title}\n${text}`), ...(publishedAt ? { publishedAt } : {}) }
}

export function extractKnownDisclosureUrls(statistics) {
  if (statistics?.schemaVersion !== 1 || !Array.isArray(statistics.metrics)) throw new Error('AI 통계 자료 형식이 올바르지 않습니다.')
  const urls = new Set()
  for (const metric of statistics.metrics) {
    const candidates = [metric.sourceUrl, ...(metric.sources || []).map(s => typeof s === 'string' ? s : s.url), ...(metric.observations || []).map(p => p.sourceUrl)]
    for (const candidate of candidates.filter(Boolean)) {
      try { urls.add(normalizeOfficialUrl(candidate)) } catch { /* Non-official sources stay outside this monitor. */ }
    }
  }
  return [...urls].sort()
}

export function discoverDisclosureLinks(body, { url, type, limit = 6 }) {
  if (!['rss', 'html'].includes(type) || (type === 'rss' && !/<rss\b/i.test(body))) throw new Error('뉴스 목록을 확인할 수 없는 응답입니다.')
  const matches = type === 'rss'
    ? [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].map(match => ({
      href: decodeEntities(match[1].match(/<link\b[^>]*>([\s\S]*?)<\/link\s*>/i)?.[1] || '').trim(),
      title: plainText(match[1].match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || ''),
    }))
    : [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)].map(match => ({ href: decodeEntities(match[1]), title: plainText(match[2]) }))
  const results = new Map()
  const originHost = new URL(url).hostname.replace(/^www\./, '')
  let validArticles = 0
  for (const match of matches) {
    if (!match.href || !match.title) continue
    try {
      const normalized = normalizeOfficialUrl(match.href, { base: url })
      if (new URL(normalized).hostname.replace(/^www\./, '') !== originHost) continue
      validArticles += 1
      if (RELEVANT_TITLE.test(match.title) && !results.has(normalized)) results.set(normalized, { url: normalized, title: match.title.slice(0, 220) })
    } catch { /* External and unsupported links are never fetched. */ }
    if (results.size >= limit) break
  }
  if (!validArticles) throw new Error('뉴스 목록을 확인할 수 없는 응답입니다.')
  return [...results.values()]
}

async function responseText(response) {
  const length = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('발표자료 응답 크기 제한을 초과했습니다.')
  if (!response.body?.[Symbol.asyncIterator]) {
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('발표자료 응답 크기 제한을 초과했습니다.')
    return text
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BYTES) throw new Error('발표자료 응답 크기 제한을 초과했습니다.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function fetchOfficialDocument(url, { fetcher = fetch, timeoutMs = 15000, discovery = false } = {}) {
  let target = normalizeOfficialUrl(url, { discovery })
  const signal = AbortSignal.timeout(timeoutMs)
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetcher(target, {
      redirect: 'manual', signal,
      headers: { Accept: discovery ? 'text/html,application/rss+xml,application/xml,text/xml' : 'text/html,application/xhtml+xml', 'User-Agent': 'AI-Chain-Disclosure-Monitor/1.0 (+https://khcho9642-sketch.github.io/ai-chain-prototype/)' },
    })
    if (response.url) normalizeOfficialUrl(response.url, { discovery })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.('location')
      if (!location || redirect === 3) throw new Error('발표자료 리디렉션 제한을 초과했습니다.')
      target = normalizeOfficialUrl(location, { discovery, base: target })
      continue
    }
    if (!response.ok) throw new Error(`공식 발표자료 HTTP ${response.status}`)
    const type = response.headers?.get?.('content-type') || ''
    if (type && !/text\/html|application\/xhtml\+xml|(?:application|text)\/(?:rss\+)?xml/i.test(type)) throw new Error('지원하지 않는 발표자료 형식입니다.')
    return { body: await responseText(response), finalUrl: target }
  }
  throw new Error('발표자료 요청에 실패했습니다.')
}

function errorLabel(error) {
  // Never copy request headers, response bodies or raw fetch errors to public JSON.
  if (/^공식 발표자료 HTTP \d{3}$/.test(error?.message || '')) return error.message
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return '공식 발표자료 응답 시간이 초과되었습니다.'
  if (/허용되지 않은|HTTPS 공식|공식 발표문|리디렉션/.test(error?.message || '')) return '허용되지 않은 이동 주소 또는 발표자료 경로입니다.'
  if (['본문을 확인할 수 없는 응답입니다. 기존 확인값을 유지합니다.', '발표자료 응답 크기 제한을 초과했습니다.', '지원하지 않는 발표자료 형식입니다.', '뉴스 목록을 확인할 수 없는 응답입니다.'].includes(error?.message)) return error.message
  return '공식 발표자료를 확인하지 못했습니다. 이전 성공 기록을 유지합니다.'
}

async function mapLimited(items, limit, callback) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await callback(items[index], index)
    }
  }))
  return results
}

export function emptyDisclosureSnapshot() {
  return { schemaVersion: 1, collection: { method: 'web-monitor', status: 'not-run', lastAttemptAt: null, lastSuccessAt: null }, sources: [], candidates: [], notes: [] }
}

export function validateDisclosureSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.candidates) || !snapshot.collection) throw new Error('발표자료 확인 기록 형식이 올바르지 않습니다.')
  const urls = new Set()
  for (const source of snapshot.sources) {
    const url = normalizeOfficialUrl(source.url)
    if (urls.has(url)) throw new Error('발표자료 출처가 중복되었습니다.')
    urls.add(url)
    if (source.contentHash != null && !/^[a-f0-9]{64}$/.test(source.contentHash)) throw new Error('발표자료 해시 형식이 올바르지 않습니다.')
  }
  for (const item of snapshot.candidates) {
    normalizeOfficialUrl(item.url)
    if (typeof item.id !== 'string' || !item.id || !['needs-review', 'reviewed', 'dismissed'].includes(item.status)) throw new Error('발표자료 검토 후보 형식이 올바르지 않습니다.')
  }
  return snapshot
}

/** Detect source changes only. This function never writes approved numerical data. */
export async function collectDisclosures(previous, statistics, { fetcher = fetch, now = new Date(), force = false, discover = true, timeoutMs = 15000, concurrency = 3, discoveryLimit = 6 } = {}) {
  const state = structuredClone(validateDisclosureSnapshot(previous || emptyDisclosureSnapshot()))
  if (!Number.isFinite(now.getTime())) throw new Error('수집 기준시각이 올바르지 않습니다.')
  const lastAttempt = state.collection.lastAttemptAt && new Date(state.collection.lastAttemptAt)
  if (!force && lastAttempt && Number.isFinite(lastAttempt.getTime()) && seoulDay(lastAttempt) === seoulDay(now)) return state
  const timestamp = now.toISOString()
  const known = new Set(extractKnownDisclosureUrls(statistics))
  const tracked = new Map(state.sources.map(s => [normalizeOfficialUrl(s.url), { ...s, url: normalizeOfficialUrl(s.url) }]))
  const queue = new Map(state.candidates.map(c => [c.id, c]))
  const oldDiscovery = new Map((state.discovery || []).map(d => [d.url, d]))
  const discovered = new Set()
  let successes = 0, failures = 0, checkedSources = 0
  const discoveryStatus = []
  if (discover) {
    for (const index of DISCOVERY) {
      const prior = oldDiscovery.get(index.url) || { url: index.url, checkedAt: null }
      try {
        const { body } = await fetchOfficialDocument(index.url, { fetcher, timeoutMs, discovery: true })
        const links = discoverDisclosureLinks(body, { ...index, limit: Math.max(1, Math.min(20, discoveryLimit)) })
        for (const link of links) discovered.add(link.url)
        discoveryStatus.push({ url: index.url, checkedAt: timestamp, foundCount: links.length })
        successes += 1
      } catch (error) {
        discoveryStatus.push({ ...prior, lastAttemptAt: timestamp, error: errorLabel(error) })
        failures += 1
      }
    }
  }
  const targets = [...new Set([...known, ...discovered])]
  await mapLimited(targets, Math.max(1, Math.min(5, concurrency)), async url => {
    const prior = tracked.get(url)
    try {
      const { body } = await fetchOfficialDocument(url, { fetcher, timeoutMs })
      const doc = extractDisclosureDocument(body)
      const changed = Boolean(prior?.contentHash && prior.contentHash !== doc.contentHash)
      const isUnreviewedNew = !known.has(url) && !prior?.contentHash
      const source = { url, ...doc, checkedAt: timestamp, lastChangedAt: changed || !prior?.contentHash ? timestamp : prior.lastChangedAt || prior.checkedAt || timestamp }
      tracked.set(url, source)
      if (changed || isUnreviewedNew) {
        const id = sha256(`${url}\n${doc.contentHash}`).slice(0, 24)
        if (!queue.has(id)) queue.set(id, {
          id, url, title: doc.title, detectedAt: timestamp, status: 'needs-review',
          reason: changed ? '공식 발표문 본문이 변경되었습니다. 값·단위·기준일을 다시 확인해야 합니다.' : '새 공식 발표문을 발견했습니다. 관련 통계의 존재와 정의를 확인해야 합니다.',
          ...(doc.publishedAt ? { publishedAt: doc.publishedAt } : {}),
        })
      }
      successes += 1
      checkedSources += 1
    } catch (error) {
      tracked.set(url, { ...(prior || { url, title: '', contentHash: null, checkedAt: null, lastChangedAt: null }), lastAttemptAt: timestamp, error: errorLabel(error) })
      failures += 1
    }
  })
  const status = failures ? (successes ? 'partial' : 'error') : (successes ? 'ok' : 'error')
  return validateDisclosureSnapshot({
    ...state,
    collection: { method: 'web-monitor', status, lastAttemptAt: timestamp, lastSuccessAt: status === 'ok' ? timestamp : state.collection.lastSuccessAt || null,
      attemptedSourceCount: targets.length, checkedSourceCount: checkedSources, failedRequestCount: failures, timezone: 'Asia/Seoul' },
    sources: [...tracked.values()].sort((a, b) => a.url.localeCompare(b.url)),
    candidates: [...queue.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
    ...(discover ? { discovery: discoveryStatus } : {}),
    notes: [
      '공식 발표문 변경·신규 발견 기록입니다. 매출·사용자 수를 자동 확정하거나 기존 통계 값을 변경하지 않습니다.',
      '기존 검증 출처의 첫 수집은 해시 기준선으로 기록합니다. 새로 발견했거나 본문이 변경된 출처만 검토 후보에 표시합니다.',
      '확인일은 웹페이지를 읽은 날짜이며 통계 관측일이나 발표일을 뜻하지 않습니다.',
      '새 글 탐색은 OpenAI RSS와 Anthropic 뉴스 목록의 관련 제목 일부에 한정됩니다. 모든 신규 공시를 보장하지 않습니다.',
      ...(successes === 0 && failures === 0 ? ['확인할 공식 발표자료가 없습니다. 통계의 출처 연결을 확인하세요.'] : []),
    ],
  })
}

export async function collectDisclosureFile({ input = 'data/ai-statistics.json', output = 'data/ai-disclosures.json', force = false, discover = true, fetcher = fetch, now = new Date() } = {}) {
  const statistics = JSON.parse(await readFile(input, 'utf8'))
  let previous
  try { previous = JSON.parse(await readFile(output, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; previous = emptyDisclosureSnapshot() }
  const result = await collectDisclosures(previous, statistics, { force, discover, fetcher, now })
  await mkdir(dirname(resolve(output)), { recursive: true })
  const temporary = `${output}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(result) + '\n')
  await rename(temporary, output)
  console.log(`AI 발표자료: ${result.collection.status} · 확인 출처 ${result.sources.filter(s => s.checkedAt).length}개 · 검토 대기 ${result.candidates.filter(c => c.status === 'needs-review').length}개`)
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--force', '--no-discovery'].includes(arg))) {
    console.error('사용법: node scripts/data/collect-ai-disclosures.mjs [--force] [--no-discovery]')
    process.exitCode = 1
  } else {
    collectDisclosureFile({ force: args.includes('--force'), discover: !args.includes('--no-discovery') })
      .catch(() => { console.error('AI 발표자료 확인을 완료하지 못했습니다. 기존 공개 통계는 유지됩니다.'); process.exitCode = 1 })
  }
}
