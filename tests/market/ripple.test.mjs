import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECTORS } from '../../assets/home-map-core.js'
import { buildRippleSnapshot, createUnavailableRippleSnapshot, rippleMarket, validateRippleSnapshot } from '../../assets/ripple-core.js'
import { buildRippleFile } from '../../scripts/data/build-ripple.mjs'

const now = '2026-11-06T09:00:00.000Z'
const company = (ticker, order = 4) => ({ ticker, name: ticker + ' company', sectorId: SECTORS[order - 1].id })
function dates(end, count) {
  const result = [], cursor = new Date(end + 'T00:00:00Z')
  while (result.length < count) {
    if (![0, 6].includes(cursor.getUTCDay())) result.unshift(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return result
}
const usDates = dates('2026-11-05', 81), krDates = dates('2026-11-06', 81)
function quote(ticker, sessionDates, returns = 1, { market = 'US', fetchedAt = now, completed = true, ...extra } = {}) {
  let close = 100
  const bars = sessionDates.map((date, index) => {
    if (index) close *= 1 + (typeof returns === 'function' ? returns(index, date) : returns) / 100
    return { time: Date.parse(date + (market === 'KR' ? 'T00:00:00Z' : 'T14:30:00Z')) / 1000, close }
  })
  return { symbol: ticker, name: ticker, group: market === 'KR' ? '국내' : '해외', currency: market === 'KR' ? 'KRW' : 'USD',
    timezone: market === 'KR' ? 'Asia/Seoul' : 'America/New_York', status: 'ok', interval: '1d', range: '1y', fetchedAt,
    ...(completed ? { priceBasis: 'previous-completed-session', closeDate: sessionDates.at(-1) } : {}), bars, ...extra }
}
const snapshot = quotes => ({ schemaVersion: 1, generatedAt: now, mode: 'scheduled-close', quotes })
const build = (quotes, companies, extra = {}) => buildRippleSnapshot({ marketSnapshot: snapshot(quotes), companies, now, ...extra })
function rippleFor(value, ticker) { return value.ripples.find(ripple => ripple.trigger.ticker === ticker) }

test('top three triggers are largest absolute completed daily changes, with a two-percent floor', () => {
  const companies = ['ONE','TWO','THREE','SMALL'].map(ticker => company(ticker))
  const value = build([quote('ONE',usDates,6),quote('TWO',usDates,-5),quote('THREE',usDates,4),quote('SMALL',usDates,1.99)], companies)
  assert.deepEqual(value.triggers.map(item => item.ticker), ['ONE','TWO','THREE'])
  assert.equal(value.triggers[0].date, '2026-11-05')
  assert.equal(value.priceBasis, 'previous-completed-session')
  assert.equal(value.coverage.targetCompanies, 4)
  assert.equal(value.coverage.usableCompanies, 4)
})

test('US listing follows its session regardless of foreign issuer domicile, and uses next Korean session', () => {
  const companies = [company('TSM'),company('000001.KS',3)]
  const value = build([quote('TSM',usDates,3),quote('000001.KS',krDates,1,{market:'KR'})],companies)
  const ripple = rippleFor(value,'TSM')
  assert.equal(rippleMarket('TSM',{timezone:'America/New_York',country:'TW'}),'US')
  assert.equal(ripple.upstream[0].date,'2026-11-06')
  assert.equal(ripple.upstream[0].market,'KR')
  assert.equal(ripple.upstream[0].syncRate,100)
  assert.equal(ripple.upstream[0].samples,60)
  assert.equal(ripple.comparisonLabel,'미국 11.05 종가 → 한국 11.06 종가')
  assert.equal(ripple.pendingKoreanClose,false)
})

test('a missing next-session target quote is not silently replaced by its next available day', () => {
  const nextMonday = [...krDates,'2026-11-09']
  const missingFriday = nextMonday.filter(date => date !== '2026-11-06')
  const companies = [company('TRIGGER'),company('000001.KS',2)]
  const source = snapshot([quote('TRIGGER',usDates,3,{fetchedAt:'2026-11-09T09:00:00Z'}),
    quote('000001.KS',missingFriday,1,{market:'KR',fetchedAt:'2026-11-09T09:00:00Z'}),
    quote('000002.KS',nextMonday,1,{market:'KR',fetchedAt:'2026-11-09T09:00:00Z'})])
  const value = buildRippleSnapshot({marketSnapshot:source,companies,now:'2026-11-09T09:00:00Z'})
  assert.equal(rippleFor(value,'TRIGGER').upstream.length,0)
})

test('Korean trigger waits for same-date US close and never compares the preceding US close', () => {
  const companies = [company('000001.KS'),company('USPEER',6)]
  const value = build([quote('000001.KS',krDates,3,{market:'KR'}),quote('USPEER',usDates,1)], companies)
  const ripple = rippleFor(value,'000001.KS')
  assert.equal(ripple.downstream.length,0)
  assert.deepEqual(ripple.pendingMarkets,['US'])
  assert.equal(ripple.comparisonLabel,'한국 11.06 종가 → 미국 종가 반영 전')
})

test('US-to-Korea comparison displays pending when next Korea close is not yet observed', () => {
  const companies = [company('TRIGGER'),company('000001.KS',2)]
  const value = build([quote('TRIGGER',usDates,3),quote('000001.KS',usDates,1,{market:'KR'})],companies)
  const ripple = rippleFor(value,'TRIGGER')
  assert.equal(ripple.upstream.length,0)
  assert.equal(ripple.pendingKoreanClose,true)
  assert.deepEqual(ripple.pendingMarkets,['KR'])
})

test('conditional sync uses only last sixty trigger sessions and excludes a known sub-50 rate', () => {
  const companies = [company('TRIGGER'),company('LOW',2),company('HALF',3)]
  const value = build([
    quote('TRIGGER',usDates,3),
    quote('LOW',usDates,index => index === 80 ? 1 : -1),
    quote('HALF',usDates,index => index % 2 === 0 ? 1 : -1),
  ],companies)
  const ripple = rippleFor(value,'TRIGGER')
  assert.ok(!ripple.upstream.some(item => item.ticker === 'LOW'))
  const half = ripple.upstream.find(item => item.ticker === 'HALF')
  assert.equal(half.syncRate,50)
  assert.equal(half.samples,60)
  assert.equal(half.triggerEvents,60)
})

test('fewer than five paired trigger events display unknown sync without fabricating a percentage', () => {
  const companies = [company('TRIGGER'),company('PEER',2)]
  const value = build([quote('TRIGGER',usDates,index => index >= 77 ? 3 : 0.5),quote('PEER',usDates,1)],companies)
  const peer = rippleFor(value,'TRIGGER').upstream[0]
  assert.equal(peer.syncRate,null)
  assert.equal(peer.samples,4)
  assert.equal(peer.triggerEvents,4)
  assert.equal(peer.insufficientSamples,true)
})

test('same direction, sector order, top-three bounds and deterministic neighbor ordering are enforced', () => {
  const companies = [company('TRIGGER',5),company('UP1',2),company('UP2',5),company('UP3',1),company('UP4',3),company('DOWN',6),company('OPPOSITE',9)]
  const value = build([quote('TRIGGER',usDates,8),quote('UP1',usDates,1.1),quote('UP2',usDates,1.8),quote('UP3',usDates,1.5),quote('UP4',usDates,1.2),quote('DOWN',usDates,1.7),quote('OPPOSITE',usDates,-1)],companies)
  const ripple = rippleFor(value,'TRIGGER')
  assert.deepEqual(ripple.upstream.map(item => item.ticker),['UP2','UP3','UP4'])
  assert.deepEqual(ripple.downstream.map(item => item.ticker),['DOWN'])
  assert.ok(ripple.upstream.every(item => item.sectorOrder <= ripple.trigger.sectorOrder))
  assert.ok(!ripple.downstream.some(item => item.ticker === 'OPPOSITE'))
})

test('legacy capture-day partial candles are excluded even when read on a later day', () => {
  const companyList = [company('TRIGGER')]
  const captured = '2026-11-05T17:00:00Z'
  const original = quote('TRIGGER',usDates,index => index === 80 ? 90 : 1,{completed:false,fetchedAt:captured})
  const value = build([original],companyList,{now:'2026-11-09T09:00:00Z'})
  assert.equal(value.triggers.length,0)
  assert.equal(value.reason,'no-large-moves')
  assert.equal(value.coverage.usableCompanies,1)
})

test('a missing preceding exchange session does not become a misleading one-day return', () => {
  const companies = [company('TRIGGER')]
  const incomplete = usDates.filter(date => date !== '2026-11-04')
  const missing = quote('TRIGGER',incomplete,index => index === incomplete.length - 1 ? 50 : 1)
  const calendarQuote = quote('CALENDAR',usDates,1)
  const value = build([missing,calendarQuote],companies)
  assert.equal(value.triggers.length,0)
})

test('calm and unavailable states differ and minimal build fixtures produce explicit unavailable data', () => {
  const calm = build([quote('CALM',usDates,1)],[company('CALM')])
  assert.equal(calm.status,'ok')
  assert.equal(calm.reason,'no-large-moves')
  const empty = buildRippleSnapshot({marketSnapshot:{quotes:[]},companies:[company('CALM')],now})
  assert.equal(empty.status,'unavailable')
  assert.equal(empty.sourceSnapshotGeneratedAt,null)
  assert.deepEqual(empty.triggers,[])
  assert.equal(validateRippleSnapshot(createUnavailableRippleSnapshot({now})).status,'unavailable')
  const malformed = structuredClone(calm); malformed.thresholdPercent = 1
  assert.throws(()=>validateRippleSnapshot(malformed),/기준/)
})

test('file writer is atomic and preserves an old snapshot on total unavailable or size limit', async t => {
  const directory = await mkdtemp(join(tmpdir(),'ai-ripple-'))
  t.after(()=>rm(directory,{recursive:true,force:true}))
  const input = join(directory,'market.json'), output = join(directory,'ripple.json')
  await writeFile(output,'OLD')
  await writeFile(input,JSON.stringify(snapshot([])))
  await assert.rejects(buildRippleFile({input,output,companies:[company('CALM')],now}),/보존/)
  assert.equal(await readFile(output,'utf8'),'OLD')
  await writeFile(input,JSON.stringify(snapshot([quote('CALM',usDates,1)])))
  await assert.rejects(buildRippleFile({input,output,companies:[company('CALM')],now,maxBytes:10}),/크기/)
  assert.equal(await readFile(output,'utf8'),'OLD')
  const value = await buildRippleFile({input,output,companies:[company('CALM')],now,logger:{log(){}}})
  assert.equal(value.reason,'no-large-moves')
  assert.equal(JSON.parse(await readFile(output,'utf8')).sourceSnapshotGeneratedAt,now)
  assert.deepEqual((await readdir(directory)).sort(),['market.json','ripple.json'])
})

test('missing trigger observations cannot stretch the sixty-session window into older event dates', () => {
  const triggerDates = usDates.filter((date,index) => !(index >= 30 && index < 45))
  const events = new Set([usDates[15],...usDates.slice(-6)])
  const companies = [company('TRIGGER'),company('PEER',2)]
  const value = build([quote('TRIGGER',triggerDates,(index,date)=>events.has(date)?3:0.5),quote('PEER',usDates,1)],companies)
  const peer = rippleFor(value,'TRIGGER').upstream[0]
  assert.equal(peer.triggerEvents,6)
  assert.equal(peer.samples,6)
  assert.equal(peer.windowStart,usDates.at(-60))
})

test('the public validator rejects false trigger thresholds and inconsistent unavailable coverage', () => {
  const valid = build([quote('TRIGGER',usDates,3)],[company('TRIGGER')])
  const below = structuredClone(valid)
  below.ripples[0].trigger.changePct = 1.5
  assert.throws(()=>validateRippleSnapshot(below),/목록/)
  const malformed = structuredClone(valid)
  malformed.coverage.usableCompanies = 99
  assert.throws(()=>validateRippleSnapshot(malformed),/형식/)
})

test('Friday US moves align to Monday Korean trading sessions without inventing weekend closes', () => {
  const current = '2026-11-09T09:00:00Z'
  const source = { ...snapshot([
    quote('TRIGGER',dates('2026-11-06',81),3,{fetchedAt:current}),
    quote('000001.KS',dates('2026-11-09',81),1,{market:'KR',fetchedAt:current}),
  ]),generatedAt:current }
  const value = buildRippleSnapshot({marketSnapshot:source,companies:[company('TRIGGER'),company('000001.KS',2)],now:current})
  const ripple = rippleFor(value,'TRIGGER')
  assert.equal(ripple.upstream[0].date,'2026-11-09')
  assert.equal(ripple.comparisonLabel,'미국 11.06 종가 → 한국 11.09 종가')
})
