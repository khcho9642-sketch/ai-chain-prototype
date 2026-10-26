import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dartCompanies } from '../assets/company-disclosure-sources.js'
import { createEmptyCompanyDisclosures, dartFilingUrl, MAX_COMPANY_DISCLOSURES, normalizeDartName, validateCompanyDisclosures, validateDartCompanySources } from '../assets/company-disclosures-core.js'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const MAX_BYTES = 2_000_000, DAY = 86400000, COOLDOWN = 15 * 60 * 1000
const error = message => { throw new Error(message) }
const plain = value => String(value || '').replace(/\s+/g, ' ').trim()
const sortItems = (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.receiptNumber.localeCompare(a.receiptNumber)

function decodeXml(value) {
  const decoded = value.replace(/&([^;\s]+);/g, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (Object.hasOwn(named, entity)) return named[entity]
    const code = /^#x[0-9a-f]+$/i.test(entity) ? Number.parseInt(entity.slice(2), 16) : /^#[0-9]+$/.test(entity) ? Number(entity.slice(1)) : NaN
    if (!Number.isInteger(code) || !([9, 10, 13].includes(code) || (code >= 32 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF))) error('DART RSS XML 문자 형식이 올바르지 않습니다.')
    return String.fromCodePoint(code)
  })
  if (/&(?!(?:[^&;]*;))/.test(value)) error('DART RSS XML 문자 형식이 올바르지 않습니다.')
  return decoded
}

// Small, bounded XML reader. It never evaluates DTDs, entities, scripts or external resources.
function xmlTree(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) error('DART RSS XML 형식이 올바르지 않습니다.')
  const document = { name: '#document', children: [], text: '' }, stack = [document]
  let cursor = 0, nodes = 0
  while (cursor < xml.length) {
    const current = stack.at(-1)
    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4)
      if (end < 0 || xml.slice(cursor + 4, end).includes('--')) error('DART RSS XML 형식이 올바르지 않습니다.')
      cursor = end + 3; continue
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      const end = xml.indexOf(']]>', cursor + 9)
      if (end < 0 || stack.length === 1) error('DART RSS XML 형식이 올바르지 않습니다.')
      current.text += xml.slice(cursor + 9, end); cursor = end + 3; continue
    }
    if (xml.startsWith('<?xml ', cursor)) {
      const end = xml.indexOf('?>', cursor + 6)
      if (end < 0 || stack.length !== 1 || document.children.length) error('DART RSS XML 형식이 올바르지 않습니다.')
      cursor = end + 2; continue
    }
    if (xml[cursor] !== '<') {
      const next = xml.indexOf('<', cursor), end = next < 0 ? xml.length : next
      const value = decodeXml(xml.slice(cursor, end))
      if ((stack.length === 1 && value.trim()) || value.includes(']]>')) error('DART RSS XML 형식이 올바르지 않습니다.')
      current.text += value; cursor = end; continue
    }
    const end = xml.indexOf('>', cursor + 1)
    if (end < 0) error('DART RSS XML 형식이 올바르지 않습니다.')
    const token = xml.slice(cursor, end + 1)
    if (token.startsWith('</')) {
      const match = token.match(/^<\/([A-Za-z_][\w:.-]*)\s*>$/)
      if (!match || stack.length === 1 || current.name !== match[1]) error('DART RSS XML 형식이 올바르지 않습니다.')
      stack.pop()
    } else {
      const match = token.match(/^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/)
      if (!match || ++nodes > 20000 || stack.length > 32) error('DART RSS XML 형식이 올바르지 않습니다.')
      let attributes = match[2], attribute
      const attributeNames = new Set()
      while (attributes.trim()) {
        attribute = attributes.match(/^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/)
        if (!attribute || attributeNames.has(attribute[1])) error('DART RSS XML 형식이 올바르지 않습니다.')
        decodeXml(attribute[2] ?? attribute[3]); attributeNames.add(attribute[1]); attributes = attributes.slice(attribute[0].length)
      }
      const node = { name: match[1], children: [], text: '' }
      current.children.push(node)
      if (!match[3]) stack.push(node)
    }
    cursor = end + 1
  }
  if (stack.length !== 1 || document.children.length !== 1 || document.children[0].name !== 'rss') error('DART RSS XML 형식이 올바르지 않습니다.')
  return document.children[0]
}
function child(node, name, required = true) {
  const values = node.children.filter(item => item.name === name)
  if (values.length > 1 || (required && values.length !== 1)) error('DART RSS 필수 항목을 확인하지 못했습니다.')
  return values[0] || null
}
function tag(node, name, required = true) {
  const item = child(node, name, required)
  if (item?.children.length || (required && !plain(item?.text))) error('DART RSS 필수 항목을 확인하지 못했습니다.')
  return plain(item?.text)
}
function receiptFromLink(value) {
  let url
  try { url = new URL(value) } catch { error('DART RSS 공시 주소가 올바르지 않습니다.') }
  if (url.protocol !== 'https:' || url.hostname !== 'dart.fss.or.kr' || url.port || url.username || url.password || url.hash ||
      !['/api/link.jsp', '/dsaf001/main.do'].includes(url.pathname) || [...url.searchParams.keys()].length !== 1 ||
      !/^[0-9]{14}$/.test(url.searchParams.get('rcpNo') || '')) error('DART RSS 공시 주소가 올바르지 않습니다.')
  return url.searchParams.get('rcpNo')
}

/** A company's feed may include filings submitted for a different issuer. Only the exact issuer is kept. */
export function parseCompanyRss(xml, company, { now = new Date() } = {}) {
  validateDartCompanySources([company])
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) error('DART 수집 기준시각이 올바르지 않습니다.')
  const channel = child(xmlTree(xml), 'channel')
  const companyTitle = tag(channel, 'title').match(/^DART\s*:\s*\((?:유가|코스닥|코넥스|기타)\)\s*(.+?)의\s*공시$/)
  if (!companyTitle || normalizeDartName(companyTitle[1]) !== normalizeDartName(company.dartName)) error('DART RSS 회사 이름과 연결 정보가 일치하지 않습니다.')
  const entries = channel.children.filter(item => item.name === 'item')
  if (entries.length > 1000) error('DART RSS 항목 수 제한을 초과했습니다.')
  const items = new Map()
  let excludedItemCount = 0
  for (const entry of entries) {
    const title = tag(entry, 'title').match(/^\((?:유가|코스닥|코넥스|기타)\)\s*(.+?)\s+-\s+(.+)$/)
    if (!title) error('DART RSS 공시 제목 형식이 올바르지 않습니다.')
    if (normalizeDartName(title[1]) !== normalizeDartName(company.dartName)) { excludedItemCount += 1; continue }
    const receiptNumber = receiptFromLink(tag(entry, 'link'))
    const guid = tag(entry, 'guid', false)
    if (guid && receiptFromLink(guid) !== receiptNumber) error('DART RSS 접수번호가 일치하지 않습니다.')
    const publishedAt = new Date(tag(entry, 'pubDate'))
    if (!Number.isFinite(publishedAt.getTime()) || publishedAt.getTime() > now.getTime() + 15 * 60 * 1000) error('DART RSS 공시 시각이 올바르지 않습니다.')
    const receiptDay = new Date(publishedAt.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '')
    if (receiptNumber.slice(0, 8) !== receiptDay) error('DART RSS 접수일과 공시 시각이 일치하지 않습니다.')
    const item = { receiptNumber, title: plain(title[2]), publishedAt: publishedAt.toISOString(), sourceUrl: dartFilingUrl(receiptNumber) }
    if (item.title.length > 500) error('DART RSS 공시 제목 길이 제한을 초과했습니다.')
    if (items.has(receiptNumber) && JSON.stringify(items.get(receiptNumber)) !== JSON.stringify(item)) error('DART RSS 동일 접수번호의 항목이 일치하지 않습니다.')
    items.set(receiptNumber, item)
  }
  return { items: [...items.values()].sort(sortItems), feedItemCount: entries.length, excludedItemCount }
}

async function readResponse(response) {
  const length = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(length) && length > MAX_BYTES) error('DART RSS 응답 크기 제한을 초과했습니다.')
  if (!response.body?.[Symbol.asyncIterator]) {
    const body = await response.text()
    if (Buffer.byteLength(body) > MAX_BYTES) error('DART RSS 응답 크기 제한을 초과했습니다.')
    return body
  }
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > MAX_BYTES) error('DART RSS 응답 크기 제한을 초과했습니다.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}
const PUBLIC_ERRORS = new Set([
  'DART RSS XML 문자 형식이 올바르지 않습니다.', 'DART RSS XML 형식이 올바르지 않습니다.',
  'DART RSS 필수 항목을 확인하지 못했습니다.', 'DART RSS 공시 주소가 올바르지 않습니다.',
  'DART RSS 회사 이름과 연결 정보가 일치하지 않습니다.', 'DART RSS 항목 수 제한을 초과했습니다.',
  'DART RSS 공시 제목 형식이 올바르지 않습니다.', 'DART RSS 접수번호가 일치하지 않습니다.',
  'DART RSS 공시 시각이 올바르지 않습니다.', 'DART RSS 접수일과 공시 시각이 일치하지 않습니다.',
  'DART RSS 공시 제목 길이 제한을 초과했습니다.', 'DART RSS 동일 접수번호의 항목이 일치하지 않습니다.',
  'DART RSS 응답 크기 제한을 초과했습니다.', 'DART RSS 응답 주소가 올바르지 않습니다.',
  'DART RSS 응답 형식을 확인하지 못했습니다.',
])
function publicError(cause) {
  if (/^DART RSS HTTP [0-9]{3}$/.test(cause?.message || '') || PUBLIC_ERRORS.has(cause?.message)) return cause.message
  if (cause?.name === 'AbortError' || cause?.name === 'TimeoutError') return 'DART RSS 응답 시간이 초과되었습니다.'
  return 'DART RSS를 확인하지 못했습니다. 이전 성공 기록을 유지합니다.'
}

export async function collectCompanyDisclosures({ root = projectRoot, previous, write = true, fetcher = fetch, now = new Date(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)), force = false, companies = dartCompanies, timeoutMs = 15000 } = {}) {
  validateDartCompanySources(companies)
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) error('DART 수집 기준시각이 올바르지 않습니다.')
  const output = join(root, 'data', 'company-disclosures.json')
  let prior = previous
  if (prior === undefined) {
    try { prior = JSON.parse(await readFile(output, 'utf8')) } catch (cause) { if (cause.code !== 'ENOENT') throw cause }
  }
  const state = structuredClone(validateCompanyDisclosures(prior || createEmptyCompanyDisclosures({ companies }), { now, companies }))
  if (!force && state.collection.lastAttemptAt && now.getTime() - Date.parse(state.collection.lastAttemptAt) < COOLDOWN) return state
  const timestamp = now.toISOString()
  let successes = 0, failures = 0, stopped = false
  for (let index = 0; index < companies.length; index++) {
    if (index) await pause(750)
    const company = companies[index], record = state.companies.find(item => item.symbol === company.symbol)
    record.lastAttemptAt = timestamp
    try {
      const response = await fetcher(company.rssUrl, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/rss+xml,application/xml,text/xml', 'User-Agent': 'AI-Chain-Company-RSS/1.0 (+https://khcho9642-sketch.github.io/ai-chain-prototype/)' } })
      if ([403, 429].includes(response.status)) stopped = true
      if (!response.ok) { const cause = new Error(`DART RSS HTTP ${response.status}`); throw cause }
      if (response.redirected || (response.url && response.url !== company.rssUrl)) error('DART RSS 응답 주소가 올바르지 않습니다.')
      const type = response.headers?.get?.('content-type') || ''
      if (type && !/^(?:application\/(?:rss\+)?xml|text\/xml)(?:\s*;|$)/i.test(type)) error('DART RSS 응답 형식을 확인하지 못했습니다.')
      const parsed = parseCompanyRss(await readResponse(response), company, { now })
      const merged = new Map(record.items.map(item => [item.receiptNumber, item]))
      for (const item of parsed.items) merged.set(item.receiptNumber, item)
      record.items = [...merged.values()].filter(item => Date.parse(item.publishedAt) >= now.getTime() - 90 * DAY).sort(sortItems).slice(0, MAX_COMPANY_DISCLOSURES)
      record.status = 'ok'; record.lastSuccessAt = timestamp; record.error = null
      record.feedItemCount = parsed.feedItemCount; record.excludedItemCount = parsed.excludedItemCount
      successes++
    } catch (cause) {
      record.status = 'error'; record.error = publicError(cause); failures++
    }
    if (stopped) break
  }
  const status = successes === companies.length ? 'ok' : successes ? 'partial' : 'error'
  state.collection = { status, lastAttemptAt: timestamp, lastSuccessAt: status === 'ok' ? timestamp : state.collection.lastSuccessAt,
    error: status === 'ok' ? null : stopped ? 'DART 요청 제한 응답으로 남은 회사 요청을 중단했습니다. 이전 성공 기록을 유지합니다.' : `${failures}개 회사의 DART RSS를 확인하지 못했습니다. 이전 성공 기록을 유지합니다.` }
  validateCompanyDisclosures(state, { now, companies })
  if (write) {
    await mkdir(dirname(output), { recursive: true })
    const temporary = `${output}.${process.pid}.collect.tmp`
    try { await writeFile(temporary, JSON.stringify(state, null, 2) + '\n'); await rename(temporary, output) }
    catch (cause) { await rm(temporary, { force: true }); throw cause }
  }
  return state
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(value => value !== '--force')) { console.error('사용법: node scripts/collect-company-disclosures.mjs [--force]'); process.exitCode = 1 }
  else {
    try {
      const state = await collectCompanyDisclosures({ force: args.includes('--force') })
      console.log(`DART 회사별 공시: ${state.collection.status} · ${state.companies.filter(company => company.status === 'ok').length}/${state.companies.length}개 회사 · 공시 ${state.companies.reduce((sum, company) => sum + company.items.length, 0)}건`)
      if (state.collection.error) console.log(state.collection.error)
    } catch { console.error('DART 회사별 공시 수집을 완료하지 못했습니다. 이전 파일을 유지합니다.'); process.exitCode = 1 }
  }
}
