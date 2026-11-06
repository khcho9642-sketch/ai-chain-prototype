import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTORS } from '../../assets/home-map-core.js';
import { sectorEvents } from '../../assets/sector-event-catalog.js';
import { eventsOnAxis, groupPins } from '../../assets/sector-event-pins.js';

test('a local session missing from the common axis keeps its own trading date', () => {
  const dates = ['2026-09-29', '2026-10-02', '2026-10-05'];
  const events = [
    { id: 'outside', tradingDate: '2026-09-28' },
    { id: 'first', tradingDate: '2026-09-29' },
    { id: 'missing', tradingDate: '2026-09-30' },
    { id: 'after-close', date: '2026-10-02', tradingDate: '2026-10-05' },
  ];
  const pins = eventsOnAxis(dates, events);
  assert.deepEqual(pins.map(pin => pin.fraction), [0, 1 / 6, 1]);
  assert.equal(pins[1].event.tradingDate, '2026-09-30');
  assert.deepEqual(eventsOnAxis([dates[0]], events), []);
});

test('a narrow chart groups close pins without losing individual events', () => {
  const pins = [0, 0.03, 0.09, 1].map((fraction, i) => ({ fraction, event: { id: i } }));
  assert.deepEqual(groupPins(pins, 40, 240).map(g => g.events.map(e => e.id)), [[0, 1, 2], [3]]);
  assert.deepEqual(groupPins(pins, 40, 1640).map(g => g.events.length), [1, 1, 1, 1]);
  const consecutive = [0, 0.12, 0.25, 0.38, 0.5].map(fraction => ({ fraction, event: { id: fraction } }));
  assert.deepEqual(groupPins(consecutive, 0, 200).map(g => g.events.length), [2, 2, 1]);
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
