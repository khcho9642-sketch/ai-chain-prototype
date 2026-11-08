import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { INDEX_STRIP_INDICES, buildIndexCards } from '../../assets/index-strip-core.js'

const now = '2026-11-08T04:00:00Z'
const quote = overrides => ({
  symbol: '^IXIC', price: 110, previousClose: 100,
  closeDate: '2026-11-06', previousCloseDate: '2026-11-05',
  priceBasis: 'previous-completed-session', timezone: 'America/New_York',
  fetchedAt: '2026-11-06T22:00:00.123Z', lastAttemptAt: '2026-11-06T22:00:00.000Z',
  source: 'Yahoo Finance', sourceUrl: 'https://finance.yahoo.com/quote/%5EIXIC/',
  status: 'ok', error: null, ...overrides,
})
const snapshot = (...quotes) => ({ schemaVersion: 1, generatedAt: '2026-11-06T22:00:03.456Z', source: 'Yahoo Finance', quotes })
const card = (value, symbol = '^IXIC') => buildIndexCards(value, { now }).find(row => row.symbol === symbol)
const bar = (date, close, time = '14:30:00Z') => ({ time: Date.parse(date + 'T' + time) / 1000, close })

async function stripHarness(initialSnapshot) {
  const source = (await readFile(new URL('../../assets/index-strip.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '')
  const cards = { innerHTML: '' }, status = { textContent: '', title: '' }, listeners = new Map()
  const forbidden = () => { throw new Error('the saved index strip must not start requests or timers') }
  const root = { querySelector: selector => selector === '[data-index-strip-cards]' ? cards : selector === '[data-index-strip-status]' ? status : null }
  vm.runInNewContext(source, {
    document: { querySelector: () => root },
    window: { aiChainSnapshot: initialSnapshot, addEventListener: (type, listener) => listeners.set(type, listener) },
    buildIndexCards: value => buildIndexCards(value, { now }),
    fetch: forbidden, XMLHttpRequest: forbidden, EventSource: forbidden, WebSocket: forbidden,
    setTimeout: forbidden, setInterval: forbidden,
  })
  return { cards, status, dispatch: (type, detail) => listeners.get(type)?.({ detail }) }
}

test('saved indices belong to the home heading slot without a global strip before navigation', async () => {
  const [html, home] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../assets/home-map.js', import.meta.url), 'utf8'),
  ])
  const aside = html.match(/<aside\b[^>]*\bdata-index-strip\b[^>]*>/)?.[0]
  assert.ok(aside, 'one saved-index strip must remain in the home light DOM')
  assert.match(aside, /\bslot="home-indices"/)
  const position = html.indexOf(aside)
  assert.ok(position > html.indexOf('id="v-home"'))
  assert.ok(position < html.indexOf('id="v-today"'))
  assert.doesNotMatch(html.slice(html.indexOf('<body>'), html.indexOf('<header>')), /data-index-strip/)
  assert.equal((html.match(/\bdata-index-strip(?=[\s>])/g) || []).length, 1)
  assert.match(home, /attachShadow\(\{mode:'open'\}\)/)
  assert.ok(home.indexOf('<slot name="home-indices"') > home.indexOf('<h1>AI 시장 지도'))
})

test('the mounted strip reuses stored dashboard events without any request or timer', async () => {
  const initial = snapshot(quote())
  const ui = await stripHarness(initial)
  assert.equal((ui.cards.innerHTML.match(/role="listitem"/g) || []).length, 5)
  assert.match(ui.cards.innerHTML, /110\.00/)
  assert.match(ui.cards.innerHTML, /2026-11-06/)
  assert.match(ui.cards.innerHTML, /저장된 지수 자료가 없습니다/)
  assert.match(ui.status.textContent, /실시간 갱신 중지/)
  const html = ui.cards.innerHTML
  ui.dispatch('market-snapshot', initial)
  assert.equal(ui.cards.innerHTML, html)
  ui.dispatch('market-snapshot-error', '자료를 확인할 수 없습니다.')
  assert.equal(ui.cards.innerHTML, html)
  assert.match(ui.status.textContent, /조회 실패/)
  assert.match(ui.status.title, /자료를 확인/)
  ui.dispatch('market-snapshot', snapshot(quote({ price: 120 })))
  assert.match(ui.cards.innerHTML, /120\.00/)
  assert.equal(ui.status.title, '')
})

test('source metadata is escaped before rendering the saved index cards', async () => {
  const ui = await stripHarness(snapshot(quote({ source: '<img src=x onerror=alert(1)>', error: '" onmouseover="alert(1)', status: 'stale' })))
  assert.ok(!ui.cards.innerHTML.includes('<img'))
  assert.match(ui.cards.innerHTML, /&lt;img/)
  assert.ok(!ui.cards.innerHTML.includes('title="<'))
  assert.match(ui.cards.innerHTML, /&quot; onmouseover=&quot;/)
  assert.match(ui.cards.innerHTML, /이전 저장값/)
})

test('the global strip always keeps exactly five ordered indices including unavailable SOX', () => {
  const cards = buildIndexCards(snapshot(quote()), { now })
  assert.deepEqual(cards.map(row => row.symbol), ['^IXIC', '^GSPC', '^SOX', '^KS11', '^KQ11'])
  assert.equal(new Set(cards.map(row => row.symbol)).size, 5)
  assert.equal(INDEX_STRIP_INDICES[2].ai, true)
  assert.equal(cards[2].available, false)
  assert.equal(cards[2].status, 'unavailable')
  assert.equal(cards[2].price, null)
  assert.equal(cards[2].changePercent, null)
  assert.match(cards[2].reason, /저장된 지수 자료/)
})

test('confirmed stored closes calculate positive, negative and flat changes from the same quote', () => {
  const cases = [[110, 100, 10, 10], [90, 100, -10, -10], [100, 100, 0, 0]]
  for (const [price, previousClose, change, changePercent] of cases) {
    const result = card(snapshot(quote({ price, previousClose, changePercent: 999 })))
    assert.equal(result.price, price)
    assert.equal(result.previousClose, previousClose)
    assert.equal(result.change, change)
    assert.equal(result.changePercent, changePercent)
    assert.equal(result.available, true)
    assert.equal(result.closeConfirmed, true)
    assert.equal(result.priceBasis, 'previous-completed-session')
  }
})

test('previous stored Korean closes preserve their own dates, source times and collector error', () => {
  const stored = quote({ symbol: '^KS11', timezone: 'Asia/Seoul',
    price: 5059.68994140625, previousClose: 5383.7998046875,
    fetchedAt: '2026-11-06T11:29:02.792Z', lastAttemptAt: '2026-11-06T15:38:28.487Z',
    status: 'stale', error: '제공처 종가 기준일이 이전 성공값보다 오래되었습니다.' })
  const original = snapshot(stored)
  const before = structuredClone(original)
  const result = card(original, '^KS11')
  assert.equal(result.status, 'stale')
  assert.equal(result.collectionStatus, 'stale')
  assert.equal(result.stale, true)
  assert.equal(result.available, true)
  for (const key of ['closeDate', 'previousCloseDate', 'source', 'sourceUrl', 'fetchedAt', 'lastAttemptAt', 'error', 'timezone']) {
    assert.equal(result[key], stored[key])
  }
  assert.equal(result.snapshotGeneratedAt, original.generatedAt)
  assert.deepEqual(original, before)
})

test('daily-bar-start timestamps are never substituted for stored closing dates or clocks', () => {
  const result = card(snapshot(quote({ marketTime: Date.parse('2026-11-06T14:30:00Z') / 1000, marketTimeBasis: 'daily-bar-start' })))
  assert.equal(result.closeDate, '2026-11-06')
  assert.equal(result.timezone, 'America/New_York')
  assert.equal(Object.hasOwn(result, 'marketTime'), false)
  assert.equal(Object.hasOwn(result, 'closingTime'), false)
})

test('missing or invalid previous closes leave returns null, including a conflicting prior date', () => {
  for (const previousClose of [undefined, null, 0, -1, NaN, Infinity, '100']) {
    const result = card(snapshot(quote({ previousClose, changePercent: 1 })))
    assert.equal(result.available, true)
    assert.equal(result.previousClose, null)
    assert.equal(result.change, null)
    assert.equal(result.changePercent, null)
  }
  const badDate = card(snapshot(quote({ previousCloseDate: '2026-11-06' })))
  assert.equal(badDate.changePercent, null)
  assert.equal(badDate.previousCloseDate, null)
})

test('invalid price, date, timezone or future capture never creates an available close', () => {
  const invalid = [
    { price: 0 }, { price: '110' }, { price: NaN }, { price: Infinity },
    { closeDate: '2026-02-30' }, { closeDate: '2026-11-09' },
    { timezone: '' }, { timezone: 'Not/A_Timezone' },
    { fetchedAt: '2026-11-09T22:00:00Z' },
  ]
  for (const overrides of invalid) {
    const result = card(snapshot(quote(overrides)))
    assert.equal(result.available, false)
    assert.equal(result.status, 'unconfirmed')
    assert.equal(result.price, null)
    assert.equal(result.changePercent, null)
    assert.equal(typeof result.reason, 'string')
  }
})

test('collector failure stays unavailable and preserves its error rather than displaying a sample', () => {
  const result = card(snapshot(quote({ status: 'error', error: 'provider unavailable' })))
  assert.equal(result.available, false)
  assert.equal(result.price, null)
  assert.equal(result.error, 'provider unavailable')
  assert.equal(result.collectionStatus, 'error')
})

test('an aged legacy intraday quote remains unconfirmed even if its price is positive', () => {
  const result = card(snapshot(quote({ priceBasis: undefined, interval: '5m', bars: [bar('2026-11-05', 100), bar('2026-11-06', 110)] })))
  assert.equal(result.status, 'unconfirmed')
  assert.equal(result.available, false)
  assert.equal(result.price, null)
})

test('legacy daily histories use only completed dates before the original capture day', () => {
  const result = card(snapshot(quote({
    priceBasis: undefined, price: 999, previousClose: 777, changePercent: 88,
    interval: '1d', fetchedAt: '2026-11-06T18:00:00Z',
    bars: [bar('2026-11-04', 100), bar('2026-11-05', 105), bar('2026-11-06', 999), bar('2026-11-09', 888)],
  })))
  assert.equal(result.available, true)
  assert.equal(result.closeDate, '2026-11-05')
  assert.equal(result.previousCloseDate, '2026-11-04')
  assert.equal(result.price, 105)
  assert.equal(result.changePercent, 5)
  assert.equal(result.priceBasis, 'derived-completed-daily-bars')
})

test('explicit year-history remains usable independently of an old intraday display series', () => {
  const result = card(snapshot(quote({ priceBasis: undefined, interval: '5m',
    bars: [bar('2026-11-06', 999)], bars1year: [bar('2026-11-04', 100), bar('2026-11-05', 102)] })))
  assert.equal(result.price, 102)
  assert.equal(result.changePercent, 2)
})

test('legacy dates are exchange-local, and a single stored close cannot invent a prior return', () => {
  // 11/06 UTC is still 11/05 in New York; that is the capture date there.
  const result = card(snapshot(quote({ priceBasis: undefined, interval: '1d',
    fetchedAt: '2026-11-06T01:00:00Z', bars: [bar('2026-11-04', 100), bar('2026-11-05', 110)] })))
  assert.equal(result.closeDate, '2026-11-04')
  assert.equal(result.price, 100)
  assert.equal(result.changePercent, null)
})

test('duplicates prefer validated closes and then the latest valid source collection timestamp', () => {
  const goodOld = quote({ price: 105, fetchedAt: '2026-11-06T21:30:00Z' })
  const goodNew = quote({ price: 110, fetchedAt: '2026-11-06T22:00:00Z' })
  const badNew = quote({ price: 999, closeDate: '2030-01-01', fetchedAt: '2026-11-07T22:00:00Z' })
  assert.equal(card(snapshot(badNew, goodOld, goodNew)).price, 110)
  assert.equal(card(snapshot(goodNew, goodOld, badNew)).price, 110)
  assert.equal(card(snapshot(quote({ status: 'error', fetchedAt: '2026-11-07T22:00:00Z' }), goodOld)).price, 105)
})

test('source links preserve valid HTTP(S), reject executable URLs and only fall back for explicit Yahoo provenance', () => {
  const original = 'https://example.org/series/nasdaq?date=2026-11-06'
  assert.equal(card(snapshot(quote({ source: 'Official exchange archive', sourceUrl: original }))).sourceUrl, original)
  assert.equal(card(snapshot(quote({ sourceUrl: 'javascript:alert(1)' }))).sourceUrl, 'https://finance.yahoo.com/quote/%5EIXIC/')
  assert.equal(card({ quotes: [quote({ source: 'Unknown source', sourceUrl: 'javascript:alert(1)' })] }).sourceUrl, null)
  assert.equal(card({ quotes: [quote({ source: '', sourceUrl: 'https://user:password@example.org' })] }).sourceUrl, null)
})

test('the snapshot capture time can confirm legacy history without inventing a per-quote collection time', () => {
  const result = card(snapshot(quote({ priceBasis: undefined, fetchedAt: null, interval: '1d', bars: [bar('2026-11-05', 105)] })))
  assert.equal(result.available, true)
  assert.equal(result.fetchedAt, null)
  assert.equal(result.snapshotGeneratedAt, '2026-11-06T22:00:03.456Z')
})

test('old stored closes become stale without moving their source dates forward', () => {
  const result = card(snapshot(quote({ fetchedAt: '2026-10-30T22:00:00Z', closeDate: '2026-10-30', previousCloseDate: '2026-10-29' })))
  assert.equal(result.stale, true)
  assert.equal(result.status, 'stale')
  assert.equal(result.closeDate, '2026-10-30')
  assert.equal(result.fetchedAt, '2026-10-30T22:00:00Z')
})

test('malformed or empty snapshots keep five unavailable cards and invalid rendering clocks fail explicitly', () => {
  for (const value of [null, undefined, {}, { quotes: {} }, { quotes: [null, 5, {}] }]) {
    const result = buildIndexCards(value, { now })
    assert.equal(result.length, 5)
    assert.ok(result.every(row => !row.available && row.price === null))
  }
  assert.throws(() => buildIndexCards(null, { now: 'not-a-date' }), RangeError)
})
