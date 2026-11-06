import test from 'node:test';
import assert from 'node:assert/strict';
import { getSectorEventCandidates } from '../../assets/sector-event-candidates.js';

const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'];
const event = (id, tradingDate, sector = 'memory', date = tradingDate) =>
  ({ id, tradingDate, date, sectorIds: [sector], title: id });
function model(series, moves = {}, sessions = dates, axis = dates) {
  return {
    dates: axis,
    sectors: [{ id: 'memory', series }, { id: 'ai-chips', series: [...series].reverse() }],
    eventMovesOn: date => Object.entries(moves[date] ?? {}).map(([sectorId, changePct]) =>
      ({ sectorId, changePct, observedCount: 1 })),
    sectorSessionDates: () => sessions,
  };
}

test('mandatory highs/lows reflect the selected line, keep the first tie, and allow no matching announcement', () => {
  const m = model([null, 100, 110, 110, 90, NaN]);
  const result = getSectorEventCandidates(m, 'memory', [], {limit: 0});
  assert.deepEqual(result.map(row => [row.date, row.kinds]), [[dates[2], ['high']], [dates[4], ['low']]]);
  assert.ok(result.every(row => row.mandatory && row.related && row.changePct === null && !row.events.length));
  assert.deepEqual(getSectorEventCandidates(m, 'ai-chips', []).map(row => row.date), [dates[1], dates[2]]);
  assert.deepEqual(getSectorEventCandidates(m, 'missing', []), []);
});

test('flat lines have one combined mandatory milestone; missing, single and misaligned arrays yield none', () => {
  const flat = getSectorEventCandidates(model([null, 100, 100, 0, NaN, null]), 'memory', []);
  assert.equal(flat.length, 1);
  assert.deepEqual(flat[0].kinds, ['high', 'low']);
  assert.equal(flat[0].date, dates[1]);
  for (const values of [[], [100, 110], [null, null, 100, 0, undefined, NaN]]) {
    assert.deepEqual(getSectorEventCandidates(model(values), 'memory', []), []);
  }
});

test('matches both ends of ±3 actual selected-sector sessions across chart boundaries and preserves announcement dates', () => {
  const sessions = ['2026-09-24','2026-09-25','2026-09-28','2026-09-30',
    '2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13'];
  const axis = ['2026-10-05','2026-10-07','2026-10-09'];
  const m = model([108, 101, 100], {}, sessions, axis);
  const farBefore = event('outside-before', sessions[0]);
  const boundary = event('related-minus-three', sessions[1], 'memory', '2026-09-24');
  const relatedOne = event('related-plus-one', sessions[5]);
  const exactUnrelated = event('unrelated-on-high', axis[0], 'ai-chips');
  const boundaryAfter = event('unrelated-plus-three', sessions[7], 'ai-chips');
  const outsideAfter = event('outside-after', sessions[8], 'memory');
  const afterPeriod = event('one-after-end', sessions[9], 'memory', '2026-10-11');
  const news = [outsideAfter, farBefore, exactUnrelated, boundaryAfter, relatedOne, boundary, afterPeriod];
  const rows = getSectorEventCandidates(m, 'memory', news);
  const high = rows.find(row => row.kinds.includes('high'));
  assert.deepEqual(high.events, [relatedOne, boundary, exactUnrelated, boundaryAfter]);
  assert.equal(high.events[1], boundary);
  assert.equal(high.events[1].date, '2026-09-24');
  assert.ok(rows.find(row => row.kinds.includes('low')).events.includes(afterPeriod));
  assert.ok(rows.every(row => row.date >= axis[0] && row.date <= axis.at(-1)));
});

test('±4% inclusivity and ranking are symmetric, and returns are daily observations rather than differences of plotted points', () => {
  const axis = [dates[0], dates[2], dates[3], dates[4], dates[5]];
  const m = model([100, 120, 111, 103, 90], {
    [dates[1]]: {memory: 3.99999999999999},
    [dates[2]]: {memory: -4},
    [dates[3]]: {memory: 3.9999, 'ai-chips': 15},
    [dates[4]]: {memory: -8},
  }, dates, axis);
  const rows = getSectorEventCandidates(m, 'memory', []);
  const rise = rows.find(row => row.date === dates[1]);
  assert.deepEqual(rise.kinds, ['rise']);
  assert.equal(rise.fraction, 0.125);
  assert.deepEqual(rows.find(row => row.date === dates[2]).kinds, ['high', 'fall']);
  assert.ok(rows.every(row => row.date !== dates[3]));
  assert.ok(rows.some(row => row.date === dates[4] && row.kinds.includes('fall')));
  const balanced = model([80, 100, 110, 90, 105, 115], {
    [dates[1]]: {memory: 4}, [dates[2]]: {memory: -3.9999999999999996},
  });
  const paired = getSectorEventCandidates(balanced, 'memory', []).filter(row => !row.mandatory);
  assert.deepEqual(paired.map(row => row.kinds), [['rise'], ['fall']]);
  assert.equal(paired[0].score, paired[1].score);
});

test('budget preserves extrema, then prioritizes directly related official dates and selected-sector movement', () => {
  const m = model([70, 92, 96, 98, 115, 150], { [dates[1]]: {memory: -9}, [dates[2]]: {memory: 6} });
  const foreign = event('other', dates[3], 'ai-chips');
  const related = event('focus', dates[4]);
  const second = event('also-focus', dates[4]);
  const news = [foreign, related, second];
  const limited = getSectorEventCandidates(m, 'memory', news, {limit: 4});
  assert.deepEqual(limited.map(row => row.date), [dates[0],dates[1],dates[4],dates[5]]);
  assert.deepEqual(limited[2].kinds, []);
  assert.deepEqual(limited[2].events, [second, related]);
  const full = getSectorEventCandidates(m, 'memory', news);
  assert.equal(full.find(row => row.date === dates[3]).related, false);
  assert.equal(new Set(full.map(row => row.date)).size, full.length);
});

test('falls back to the chart calendar, keeps positive/negative samples, and applies period density defaults', () => {
  const axis = Array.from({length: 36}, (_, i) => new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10));
  const m = model(axis.map((_, i) => 100+i), Object.fromEntries(axis.map((date,i) =>
    [date, {memory: i%2 ? 7 : -7}])), axis, axis);
  delete m.sectorSessionDates;
  for (const [days, limit] of [[30,10],[90,16],[180,18],[365,22],[730,25],[1095,25]]) {
    const rows = getSectorEventCandidates(m, 'memory', [], {days});
    assert.equal(rows.length, limit);
    assert.equal(rows[0].date, axis[0]);
    assert.equal(rows.at(-1).date, axis.at(-1));
    assert.ok(rows.some(row => row.kinds.includes('rise')) && rows.some(row => row.kinds.includes('fall')));
  }
});
