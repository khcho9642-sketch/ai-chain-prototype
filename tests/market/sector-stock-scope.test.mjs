import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTORS } from '../../assets/home-map-core.js';
import { getStockRows } from '../../assets/sector-compare-view.js';

function measuredSectors() {
  return SECTORS.map(({ id, name, color }) => ({
    id, name, color,
    members: [null, 0, 14].map((rate, i) => ({
      symbol: id + '-' + i,
      name: name + ' 기업 ' + i,
      sectorName: name,
      rate,
      series: rate === null ? null : [100, 100 + rate],
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

test('sector drilldown includes every eligible member of that sector; all scope skips empty sectors', () => {
  const sectors = measuredSectors();
  const memory = sectors.find(sector => sector.id === 'memory');
  assert.deepEqual(getStockRows(sectors, 'memory', []).map(row => row.id).sort(), ['memory-1', 'memory-2']);
  memory.members = memory.members.filter(member => member.rate === null);
  assert.equal(getStockRows(sectors, 'memory', []).length, 0);
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
