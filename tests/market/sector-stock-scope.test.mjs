import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTORS } from '../../assets/home-map-core.js';
import { getStockRows } from '../../assets/sector-compare-view.js';

function measuredSectors() {
  return SECTORS.map(({ id, name, color }) => ({
    id, name, color,
    members: [null, 0, 14, null].map((rate, i) => ({
      symbol: id + '-' + i,
      name: name + ' 기업 ' + i,
      sectorName: name,
      rate,
      series: rate === null ? null : [100, 100 + rate],
      ...(rate === null && { reason: i === 0 ? '시세 수집값 없음' : '선택 기간 이력 부족' }),
    })),
  }));
}

test('all stocks starts with one eligible company per sector, even after a memory-only selection', () => {
  const sectors = measuredSectors();
  const rows = getStockRows(sectors, 'all', ['memory-2']);
  assert.equal(rows.length, 9);
  for (const sector of sectors) {
    const representatives = rows.filter(row => row.sectorName === sector.name);
    assert.deepEqual(representatives.map(row => row.id), [sector.id + '-1']);
  }
});

test('each of nine sector scopes includes every registered company and preserves its data status', () => {
  const sectors = measuredSectors();
  assert.equal(sectors.length, 9);
  for (const sector of sectors) {
    const rows = getStockRows(sectors, sector.id);
    assert.equal(rows.length, sector.members.length);
    const found = new Map(rows.map(row => [row.id, row]));
    for (const member of sector.members) {
      const row = found.get(member.symbol);
      assert.equal(row.sectorName, sector.name);
      assert.equal(row.rate, member.rate);
      assert.deepEqual(row.series, member.series);
      assert.equal(row.reason, member.reason);
    }
  }
});

test('a sector with only unavailable quotes keeps its companies but contributes no representative', () => {
  const sectors = measuredSectors();
  const memory = sectors.find(sector => sector.id === 'memory');
  memory.members = memory.members.filter(member => member.rate === null);
  const members = getStockRows(sectors, 'memory');
  assert.deepEqual(members.map(row => row.id).sort(), ['memory-0', 'memory-3']);
  assert.ok(members.every(row => row.rate === null && row.series === null));
  const rows = getStockRows(sectors, 'all', []);
  assert.equal(rows.length, 8);
  assert.ok(rows.every(row => row.sectorName !== memory.name));
});

test('manual cross-sector choices retain their identity when a longer period lacks history', () => {
  const sectors = measuredSectors();
  const selected = ['ai-chips-2', 'memory-1'];
  const ids = rows => rows.map(row => row.id).sort();
  assert.deepEqual(ids(getStockRows(sectors, 'custom', selected)), [...selected].sort());

  const memory = sectors.find(sector => sector.id === 'memory').members[1];
  memory.rate = null;
  memory.series = null;
  memory.reason = '선택 기간 이력 부족';
  const rows = getStockRows(sectors, 'custom', selected);
  assert.deepEqual(ids(rows), [...selected].sort());
  const unavailable = rows.find(row => row.id === memory.symbol);
  assert.equal(unavailable.rate, null);
  assert.equal(unavailable.reason, memory.reason);
});
