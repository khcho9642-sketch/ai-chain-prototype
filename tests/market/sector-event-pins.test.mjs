import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTORS } from '../../assets/home-map-core.js';
import { sectorEvents } from '../../assets/sector-event-catalog.js';
import { groupPins } from '../../assets/sector-event-pins.js';

test('a narrow chart groups close pins without losing individual events', () => {
  const pins = [0, 0.03, 0.09, 1].map((fraction, i) => ({ fraction, date: '2026-06-0' + (i + 1) }));
  assert.deepEqual(groupPins(pins, 40, 240).map(g => g.pins.length), [3, 1]);
  assert.deepEqual(groupPins(pins, 40, 1640).map(g => g.pins.length), [1, 1, 1, 1]);
});

test('group markers keep the exact extremum or selected date while staying at least 40px apart', () => {
  const pins = [
    { date: '2026-06-19', fraction: 0.21 },
    { date: '2026-06-22', fraction: 0.22, mandatory: true },
    { date: '2026-06-23', fraction: 0.23 },
    { date: '2026-11-05', fraction: 1, mandatory: true },
  ];
  for (const active of [undefined, pins[2].date]) {
    const groups = groupPins(pins, 40, 440, active);
    assert.deepEqual(groups.flatMap(group => group.pins), pins);
    assert.equal(groups[0].anchor, active ? pins[2] : pins[1]);
    assert.equal(groups[0].x, 40 + groups[0].anchor.fraction * 400);
    assert.ok(groups[1].x - groups[0].x >= 40);
  }
});

test('curated announcements link to a source and reference existing sectors', () => {
  const ids = new Set(SECTORS.map(sector => sector.id));
  assert.equal(new Set(sectorEvents.map(event => event.id)).size, sectorEvents.length);
  for (const event of sectorEvents) {
    assert.ok(event.sourceName && event.title && event.summary);
    assert.equal(new URL(event.sourceUrl).protocol, 'https:');
    assert.ok(event.sectorIds.length && event.sectorIds.every(id => ids.has(id)));
    assert.ok(event.tradingDate >= event.date);
    if (event.date !== event.tradingDate) assert.ok(event.timing);
  }
});
