import test from 'node:test';
import assert from 'node:assert/strict';
import { TRADE_SERIES, monthWindows, normalizeEcosRows, withYearlyChanges, collectOfficialTrade } from '../../scripts/data/official-trade.mjs';

test('public ECOS requests never exceed ten monthly records', () => {
  assert.deepEqual(monthWindows(new Date('2023-10-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z')), [['202310', '202407'], ['202408', '202505'], ['202506', '202603'], ['202604', '202609']]);
  assert.throws(() => monthWindows(new Date(), new Date(), 11));
});

const spec = TRADE_SERIES[0];
const row = { STAT_CODE: '403Y002', ITEM_CODE1: '3091AA', ITEM_NAME1: '반도체', UNIT_NAME: '2020=100', TIME: '202609', DATA_VALUE: '292.59' };
test('wrong table, units, item, duplicate dates and invalid values fail instead of silently becoming data', () => {
  for (const change of [{ STAT_CODE: '403Y001' }, { UNIT_NAME: 'kg' }, { ITEM_CODE1: '310AA' }, { DATA_VALUE: '' }, { DATA_VALUE: '0' }, { DATA_VALUE: 'NaN' }, { TIME: '202608' }]) {
    assert.throws(() => normalizeEcosRows({ StatisticSearch: { row: [{ ...row, ...change }] } }, spec, '202609', '202609'));
  }
  assert.throws(() => normalizeEcosRows({ StatisticSearch: { row: [row, row] } }, spec, '202609', '202609'));
  assert.throws(() => normalizeEcosRows({ RESULT: { CODE: 'ERROR-301' } }, spec, '202609', '202609'));
});
test('trade indices stay provisional through the following March', () => {
  const result = normalizeEcosRows({ StatisticSearch: { row: [row] } }, spec, '202609', '202609', new Date('2027-02-10T00:00:00Z'));
  assert.equal(result[0].status, 'provisional');
});
test('YoY compares the same month twelve months ago and preserves gaps', () => {
  const points = withYearlyChanges([{ period: '2025-09', value: 100 }, { period: '2026-08', value: 110 }, { period: '2026-09', value: 130.5 }]);
  assert.equal(points[2].yoy, 30.5);
  assert.equal(points[1].yoy, undefined);
});
test('failed official refresh keeps previous evidence date and flags failure', async () => {
  const old = { ...spec, fetchedAt: '2026-10-16T00:00:00Z', points: [{ period: '2026-09', value: 292.59, status: 'provisional' }] };
  const result = await collectOfficialTrade({ series: [old] }, { fetchImpl: async () => { throw new Error('unreachable'); }, now: new Date('2026-10-26T00:00:00Z') });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].fetchedAt, old.fetchedAt);
  assert.match(result.series[0].refreshError, /이전/);
});
test('monthly collection keeps all periods, computes YoY and never publishes a registered API key', async () => {
  let count = 0;
  const result = await collectOfficialTrade({}, {
    key: 'privateKeyABC', now: new Date('2026-10-26T00:00:00Z'),
    fetchImpl: async url => {
      count += 1;
      const parts = new URL(url).pathname.split('/');
      const table = parts[8], from = parts[10], to = parts[11], item = decodeURIComponent(parts[12]);
      const itemSpec = TRADE_SERIES.find(spec => spec.table === table && spec.item === item);
      const rows = [];
      for (let year = Number(from.slice(0, 4)), month = Number(from.slice(4)); `${year}${String(month).padStart(2, '0')}` <= to;) {
        rows.push({ STAT_CODE: table, ITEM_CODE1: item, ITEM_NAME1: itemSpec.itemName, UNIT_NAME: '2020=100', TIME: `${year}${String(month).padStart(2, '0')}`, DATA_VALUE: String(100 + year - 2020 + month) });
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      assert.ok(rows.length <= 10);
      return { ok: true, json: async () => ({ StatisticSearch: { row: rows } }) };
    },
  });
  assert.equal(count, 32);
  assert.equal(result.series.length, 8);
  assert.ok(result.series.every(series => series.points.length === 36));
  assert.ok(result.series.every(series => series.points.at(-1).yoy !== undefined));
  assert.equal(JSON.stringify(result).includes('privateKeyABC'), false);
});
