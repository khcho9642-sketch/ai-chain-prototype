import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTORS } from '../../assets/home-map-core.js';
import { sectorEvents } from '../../assets/sector-event-catalog.js';
import { groupPins } from '../../assets/sector-event-pins.js';

const pin = (date, fraction, score = 20, mandatory = false) => ({ date, fraction, score, mandatory });

test('recent dates use a tighter cluster distance while individual controls remain reachable', () => {
  const pins = [pin('2026-03-01', 0), pin('2026-03-02', .2), pin('2026-09-03', .55), pin('2026-09-04', .8)];
  const groups = groupPins(pins, 0, 100, '2026-08-06');
  assert.deepEqual(groups.map(g => g.pins.length), [2, 1, 1]);
  assert.notEqual(groups[1].lane, groups[2].lane);
});

test('extrema keep separate markers; a group opens on its strongest candidate, then follows selection', () => {
  const high = pin('2026-09-01', .1, 100, true);
  const low = pin('2026-09-02', .12, 100, true);
  const news = pin('2026-09-03', .14), related = pin('2026-09-04', .15, 95);
  const pins = [high, low, news, related];
  const groups = groupPins(pins, 0, 500, '2026-01-01');
  assert.deepEqual(groups.map(g => g.pin.date), [high.date, low.date, related.date]);
  assert.equal(groups[2].x, 75);
  const selected = groupPins(pins, 0, 500, '2026-01-01', news.date);
  assert.equal(selected[2].pin, news);
  assert.equal(selected[2].x, 70);
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
