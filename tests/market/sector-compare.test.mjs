import test from 'node:test';
import assert from 'node:assert/strict';
import { getSectorPeriod } from '../../assets/sector-compare-data.js';
import { buildHomeSectorReturns } from '../../assets/home-sector-returns.js';
import { COMPANIES } from '../../assets/home-map-core.js';

const snapshot = quotes => ({
  schemaVersion: 1, generatedAt: '2025-04-01T20:00:00Z', source: 'fixture', quotes,
});
const quote = (symbol, values, extra = {}) => ({
  symbol, timezone: 'America/New_York', interval: '1d', currency: 'USD',
  bars: values.map(([date, close]) => ({ time: Date.parse(date + 'T05:00:00Z') / 1000, close })),
  ...extra,
});

test('sector and company curves share the home calculation and use only common local dates', () => {
  const input = snapshot([
    quote('NVDA', [['2025-01-02', 20], ['2025-01-03', 25], ['2025-04-01', 30]]),
    quote('AMD', [['2025-01-02', 100], ['2025-04-01', 80]]),
    quote('MU', [['2025-03-31', 100], ['2025-04-01', 110]]),
    quote('TSM', [['2025-01-02', 100], ['2025-04-01', 70]]),
  ]);
  const period = getSectorPeriod(input, 90);
  const home = buildHomeSectorReturns(input);
  assert.equal(period.generatedAt, input.generatedAt);
  assert.equal(period.source, input.source);
  assert.deepEqual(period.dates, ['2025-01-02', '2025-04-01']);
  assert.deepEqual(period.sectors.map(s => s.id), [
    'semiconductor-equipment', 'memory', 'foundry-packaging', 'ai-chips', 'ai-equipment',
    'power-cooling', 'data-centers', 'cloud-gpu', 'ai-models',
  ]);
  assert.equal(period.sectors.flatMap(s => s.members).length, COMPANIES.length);
  const homeSeries = new Map(home.groups.map(group => [group.name, group.series.map(point => point.index)]));
  for (const sector of period.sectors) assert.deepEqual(sector.series, homeSeries.get(sector.name));
  const foundry = period.sectors[2];
  assert.deepEqual(foundry.members.find(m => m.symbol === 'TSM').series, [100, 70]);
  const chips = period.sectors.find(s => s.id === 'ai-chips');
  assert.equal(chips.series[0], 100);
  assert.ok(Math.abs(chips.series[1] - 115) < 1e-10);
  assert.deepEqual(chips.members.find(m => m.symbol === 'NVDA').series, [100, 150]);
  assert.deepEqual(chips.members.find(m => m.symbol === 'AMD').series, [100, 80]);
  const memory = period.sectors.find(s => s.id === 'memory');
  assert.deepEqual(memory.series, []);
  assert.equal(memory.members.find(m => m.symbol === 'MU').reason, '선택 기간 이력 부족');
  assert.equal(memory.members.find(m => m.symbol === '005930.KS').series, null);
});

test('a Korean and US listing align by exchange date even when their UTC dates differ', () => {
  const korea = quote('000660.KS', [], { timezone: 'Asia/Seoul', currency: 'KRW' });
  const us = quote('NVDA', []);
  const bar = (time, close) => ({ time: Date.parse(time) / 1000, close });
  korea.bars = [bar('2025-01-01T23:30:00Z', 70000), bar('2025-03-31T23:30:00Z', 77000)];
  us.bars = [bar('2025-01-03T00:00:00Z', 100), bar('2025-04-02T00:00:00Z', 125)];
  const period = getSectorPeriod(snapshot([korea, us]), 90);
  assert.deepEqual(period.dates, ['2025-01-02', '2025-04-01']);
  const koreanMember = period.sectors.find(s => s.id === 'memory').members.find(m => m.symbol === korea.symbol);
  assert.equal(koreanMember.currency, 'KRW');
  assert.ok(Math.abs(koreanMember.series[1] - 110) < 1e-10);
});

test('multi-year periods require collected long daily history and enforce duration independently', () => {
  const prices = [['2022-04-01', 10], ['2023-04-03', 15], ['2025-04-01', 30]];
  const input = snapshot([
    quote('NVDA', prices, { range: '3y' }),
    quote('AMD', prices.slice(1), { range: '3y' }),
    quote('MU', prices),
  ]);
  const two = getSectorPeriod(input, 730);
  const three = getSectorPeriod(input, 1095);
  const chipMembers = period => period.sectors.find(s => s.id === 'ai-chips').members;
  assert.deepEqual(chipMembers(two).find(m => m.symbol === 'AMD').series, [100, 200]);
  assert.equal(chipMembers(three).find(m => m.symbol === 'AMD').series, null);
  assert.equal(three.sectors.find(s => s.id === 'memory').members.find(m => m.symbol === 'MU').reason, '3년 일봉 자료 없음');
});

test('bad payloads fail explicitly and missing quotes keep the nine empty catalog entries', () => {
  assert.throws(() => getSectorPeriod({}, 90), TypeError);
  assert.throws(() => getSectorPeriod(snapshot([]), 14), RangeError);
  const empty = getSectorPeriod(snapshot([]), 90);
  assert.equal(empty.sectors.length, 9);
  assert.deepEqual(empty.dates, []);
  assert.ok(empty.sectors.every(s => !s.series.length && s.members.every(m => m.series === null && m.reason)));
});
