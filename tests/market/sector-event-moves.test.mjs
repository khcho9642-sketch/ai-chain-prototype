import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPANIES } from '../../assets/home-map-core.js';
import { comparisonSectors as DISPLAY_SECTORS } from '../../assets/sector-compare-data.js';
import { createSectorEventMoves } from '../../assets/sector-event-moves.js';

const snapshot = quotes => ({ schemaVersion: 1, generatedAt: '2026-04-10T23:00:00Z', quotes });
const day = (date, close) => ({ time: Date.parse(date + 'T12:00:00Z') / 1000, close });
const quote = (symbol, bars, extra = {}) => ({ symbol, timezone: 'America/New_York', interval: '1d', bars, ...extra });
const sector = (moves, date, id = 'ai-chips') => moves(date).find(row => row.sectorId === id);

test('each member uses its prior local session close and contributes equal weight', () => {
  const us = [day('2026-04-02', 100), day('2026-04-06', 110)];
  const korea = [day('2026-04-02', 400), day('2026-04-03', 200), day('2026-04-06', 180)];
  const moves = createSectorEventMoves(snapshot([
    quote('NVDA', us),
    quote('AMD', [day('2026-04-02', 1000), day('2026-04-06', 1000)]),
    quote('000660.KS', korea, { timezone: 'Asia/Seoul' }),
    quote('MU', us),
  ]));
  const rows = moves('2026-04-06');
  assert.deepEqual(rows.map(row => row.sectorId), DISPLAY_SECTORS.map(item => item.id));
  assert.deepEqual(rows.slice(1, 3).map(row => row.sectorId), ['memory', 'foundry-packaging']);
  const chips = sector(moves, '2026-04-06');
  assert.equal(chips.observedCount, 2);
  assert.equal(chips.totalCount, COMPANIES.filter(company => company.sector === chips.name).length);
  assert.ok(Math.abs(chips.changePct - 5) < 1e-9);
  const memory = sector(moves, '2026-04-06', 'memory');
  assert.equal(memory.observedCount, 2);
  assert.ok(Math.abs(memory.changePct) < 1e-9);
  assert.equal(sector(moves, '2026-04-03').changePct, null);
});

test('missing prior session, invalid close and extended gaps cannot become one-day moves', () => {
  const moves = createSectorEventMoves(snapshot([
    quote('NVDA', [day('2026-03-10', 2), day('2026-04-06', 5), day('2026-04-08', 50)]),
    quote('AMD', [day('2026-04-06', 10), day('2026-04-07', null), day('2026-04-08', 20)]),
    quote('AVGO', [day('2026-04-07', 10), day('2026-04-08', 0)]),
  ]));
  for (const date of ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09']) {
    const row = sector(moves, date);
    assert.equal(row.observedCount, 0);
    assert.equal(row.changePct, null);
  }
});

test('local dates, completed-session cutoff and legacy capture date control inclusion', () => {
  const bars = [
    { time: Date.parse('2026-04-05T16:00:00Z') / 1000, close: 100 }, // Seoul, April 6
    { time: Date.parse('2026-04-06T16:00:00Z') / 1000, close: 120 }, // Seoul, April 7
  ];
  const extra = { timezone: 'Asia/Seoul', fetchedAt: '2026-04-07T08:00:00Z', status: 'stale' };
  const legacy = quote('005930.KS', bars, extra);
  const confirmed = quote('000660.KS', bars, { ...extra, priceBasis: 'previous-completed-session', closeDate: '2026-04-07' });
  const moves = createSectorEventMoves(snapshot([legacy, confirmed]));
  const memory = sector(moves, '2026-04-07', 'memory');
  assert.equal(memory.observedCount, 1);
  assert.ok(Math.abs(memory.changePct - 20) < 1e-9);
  assert.equal(sector(moves, '2026-04-08', 'memory').changePct, null);
});

test('works across daily payload formats and excludes non-daily prices and duplicate date quotes', () => {
  const bars = [day('2026-04-06', 80), day('2026-04-07', 100)];
  const earlier = { time: bars[1].time - 600, close: 95 };
  const moves = createSectorEventMoves(snapshot([
    quote('NVDA', [], { interval: '5m', bars1year: [bars[1], earlier, bars[0]] }),
    quote('AMD', [], { interval: '5m', histories: { '1y': bars } }),
    quote('AVGO', bars, { interval: '5m' }),
    quote('MU', bars, { range: '3y' }),
    quote('005930.KS', bars, { timezone: 'Invalid' }),
  ]));
  assert.equal(sector(moves, '2026-04-07').observedCount, 2);
  assert.equal(sector(moves, '2026-04-07').changePct, 25);
  assert.equal(sector(moves, '2026-04-07', 'memory').observedCount, 1);
  assert.throws(() => createSectorEventMoves({}), TypeError);
  assert.ok(createSectorEventMoves(snapshot([]))('2026-04-07').every(row => row.changePct === null));
});
