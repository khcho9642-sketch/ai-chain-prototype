import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { debateRequestedDate, chronologicalDebateThread, visibleDebateThread, debateVotePresentation, debateWritingPriceLabel, hasNewerDebateClose } from '../../assets/debate.js'
import { DEBATE_CHARACTERS, debateCharacterChange } from '../../assets/debate-characters.js'

test('independent debate routing retains Today and its own archived date links', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
  assert.equal((html.match(/data-r="debate"/gu) || []).length, 3)
  assert.equal((html.match(/data-r="today"/gu) || []).length, 3)
  assert.match(html, /id="v-today"/u)
  assert.match(html, /id="v-debate"/u)
  assert.match(html, /today:'오늘의 변화',debate:'오늘의 토론'/u)
  assert.equal(debateRequestedDate('#debate?date=2026-11-05'), '2026-11-05')
  assert.equal(debateRequestedDate('#debate?date=../private'), null)
  assert.equal(debateRequestedDate('#today?date=2026-11-05'), null)
})

test('single thread orders actual timestamps without mutating input and reveals remaining speech', () => {
  const thread = Array.from({ length: 8 }, (_, index) => ({ id: String(index), writtenAt: new Date(Date.UTC(2026, 10, 5, 3, index)).toISOString() })).reverse()
  assert.deepEqual(chronologicalDebateThread(thread).map(row => row.id), ['0', '1', '2', '3', '4', '5', '6', '7'])
  assert.equal(thread[0].id, '7')
  assert.deepEqual(visibleDebateThread(thread).visible.map(row => row.id), ['0', '1', '2', '3'])
  assert.equal(visibleDebateThread(thread).remaining, 4)
  assert.equal(visibleDebateThread(thread, true).visible.length, 8)
  assert.equal(visibleDebateThread(thread.slice(0, 6)).visible.length, 6)
})

test('vote presentation never exposes totals before the browser has voted or percentages below ten', () => {
  const percentages = { gpt: 40, claude: 35, gemini: 25 }
  assert.deepEqual(debateVotePresentation({ hasVoted: false, count: 100, percentages }), { kind: 'unvoted', count: null, rows: [] })
  assert.deepEqual(debateVotePresentation({ hasVoted: true, count: 9, percentages }), { kind: 'counting', count: 9, rows: [] })
  assert.equal(debateVotePresentation({ hasVoted: true, count: 10, percentages }).rows.length, 3)
  assert.equal(debateVotePresentation({ hasVoted: true, count: 10, percentages: { ...percentages, gpt: NaN } }).kind, 'unavailable')
  assert.equal(debateVotePresentation({ hasVoted: true, count: null, percentages }).kind, 'unavailable')
})

test('writing-price labels retain the analysis close date rather than imply a current quote', () => {
  assert.equal(debateWritingPriceLabel({ priceAtWriting: 206.69, closeDate: '2026-11-04', writtenAt: '2026-11-06T01:00:00Z' }), '작성 당시 206.69 USD · 11.04')
  assert.equal(debateWritingPriceLabel({ priceAtWriting: null, closeDate: '2026-11-04' }), null)
})

test('freshness follows actual completed US observations rather than a Korean calendar rollover', () => {
  const day = { date: '2026-11-05' }
  const quote = { timezone: 'America/New_York', priceBasis: 'previous-completed-session', closeDate: '2026-11-05' }
  assert.equal(hasNewerDebateClose(day, { quotes: [quote] }), false)
  assert.equal(hasNewerDebateClose(day, { quotes: [{ ...quote, closeDate: '2026-11-06' }] }), true)
  assert.equal(hasNewerDebateClose(day, { quotes: [{ ...quote, closeDate: '2026-11-06', priceBasis: 'intraday' }] }), false)
  assert.equal(hasNewerDebateClose(day, { quotes: [{ ...quote, closeDate: '2026-11-06', timezone: 'Asia/Seoul' }] }), false)
})

test('character narrative badges require the documented transition rather than force a contrary stance', () => {
  assert.equal(Object.keys(DEBATE_CHARACTERS).length, 3)
  assert.equal(debateCharacterChange('gpt', { from: 'bullish', to: 'neutral' }), '🥲 → 😵 오늘은 못 버티겠대')
  assert.equal(debateCharacterChange('claude', { from: 'bearish', to: 'bullish' }), '🐻 → 🙇 하방 접음')
  assert.equal(debateCharacterChange('gemini', { from: 'neutral', to: 'bearish' }), '👀 → 😮 드디어 결정')
  assert.equal(debateCharacterChange('gpt', { from: 'neutral', to: 'bearish' }), null)
  assert.equal(debateCharacterChange('claude', null), null)
})
