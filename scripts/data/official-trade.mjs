// Official Bank of Korea ECOS series. The public sample endpoint allows at most
// ten rows per request; requests below use disjoint windows of <= 10 months.
export const TRADE_SERIES = [
  { id: 'kr-semiconductor-volume', name: '반도체 수출물량지수', table: '403Y002', item: '3091AA', itemName: '반도체', kind: 'volume-index', chains: [1, 2, 3, 4] },
  { id: 'kr-transformer-volume', name: '변압기 수출물량지수', table: '403Y002', item: '310121AA', itemName: '변압기', kind: 'volume-index', chains: [5, 6] },
  { id: 'kr-electrical-volume', name: '전기장비 수출물량지수', table: '403Y002', item: '310AA', itemName: '전기장비', kind: 'volume-index', chains: [5, 6] },
  { id: 'kr-electronics-volume', name: '전자·광학기기 수출물량지수', table: '403Y002', item: '309AA', itemName: '컴퓨터,전자및광학기기', kind: 'volume-index', chains: [1, 2, 3, 4] },
  { id: 'kr-total-volume', name: '한국 전체 수출물량지수', table: '403Y002', item: '*AA', itemName: '총지수', kind: 'volume-index', chains: [] },
  { id: 'kr-semiconductor-value-index', name: '반도체 수출금액지수', table: '403Y001', item: '3091AA', itemName: '반도체', kind: 'value-index', chains: [1, 2, 3, 4] },
  { id: 'kr-transformer-value-index', name: '변압기 수출금액지수', table: '403Y001', item: '310121AA', itemName: '변압기', kind: 'value-index', chains: [5, 6] },
  { id: 'kr-total-value-index', name: '한국 전체 수출금액지수', table: '403Y001', item: '*AA', itemName: '총지수', kind: 'value-index', chains: [] },
];

const ECOS_URL = 'https://ecos.bok.or.kr/';
const yyyymm = date => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const shift = (date, months) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
const periodOf = text => `${text.slice(0, 4)}-${text.slice(4, 6)}`;

export function monthWindows(start, end, size = 10) {
  if (!Number.isInteger(size) || size < 1 || size > 10) throw new Error('Monthly window must contain 1–10 months');
  const windows = [];
  for (let cursor = new Date(start); cursor <= end; cursor = shift(cursor, size)) {
    const last = shift(cursor, size - 1);
    windows.push([yyyymm(cursor), yyyymm(last > end ? end : last)]);
  }
  return windows;
}

export function normalizeEcosRows(body, spec, start, end, now = new Date()) {
  if (body.RESULT) throw new Error(`ECOS ${body.RESULT.CODE || 'response error'}`);
  const rows = body.StatisticSearch?.row;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10) throw new Error('ECOS returned an invalid monthly response');
  const seen = new Set();
  return rows.map(row => {
    if (row.STAT_CODE !== spec.table || row.ITEM_CODE1 !== spec.item || row.ITEM_NAME1 !== spec.itemName || row.UNIT_NAME !== '2020=100') throw new Error('ECOS series or unit changed');
    const raw = row.TIME;
    if (!/^\d{6}$/.test(raw) || raw < start || raw > end || seen.has(raw)) throw new Error('ECOS returned an unexpected period');
    const value = Number(row.DATA_VALUE);
    if (row.DATA_VALUE === '' || !Number.isFinite(value) || value <= 0) throw new Error('ECOS returned an invalid index');
    seen.add(raw);
    // The current-year trade indices remain provisional until the following
    // year's March release. Keep the preceding year provisional through March.
    const provisionalFrom = now.getUTCFullYear() - (now.getUTCMonth() < 3 ? 1 : 0);
    return { period: periodOf(raw), value, status: Number(raw.slice(0, 4)) >= provisionalFrom ? 'provisional' : 'final' };
  });
}

export function withYearlyChanges(points) {
  const byPeriod = new Map(points.map(point => [point.period, point.value]));
  return points.map(point => {
    const previous = byPeriod.get(`${Number(point.period.slice(0, 4)) - 1}${point.period.slice(4)}`);
    return previous > 0 ? { ...point, yoy: Math.round((point.value / previous - 1) * 1000) / 10 } : point;
  });
}

export async function collectOfficialTrade(previous = {}, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? new Date();
  const key = options.key ?? (process.env.ECOS_API_KEY || 'sample');
  if (!/^[a-zA-Z0-9]+$/.test(key)) throw new Error('ECOS API key has an invalid format');
  const checkedAt = now.toISOString();
  const end = shift(now, -1);
  const months = options.months ?? 36;
  if (!Number.isInteger(months) || months < 13 || months > 120) throw new Error('Trade history must contain 13–120 months');
  const fullStart = shift(end, 1 - months);
  const oldById = new Map((previous.series ?? []).map(series => [series.id, series]));
  const series = [];
  const errors = [];
  let successes = 0;
  for (const spec of TRADE_SERIES) {
    const old = oldById.get(spec.id);
    // Refresh at least 13 months to incorporate revisions and calculate YoY.
    const start = old?.points?.length >= months - 1 ? shift(end, -12) : fullStart;
    try {
      const fresh = [];
      for (const [from, to] of monthWindows(start, end)) {
        const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/1/10/${spec.table}/M/${from}/${to}/${encodeURIComponent(spec.item)}`;
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`ECOS HTTP ${response.status}`);
        const points = normalizeEcosRows(await response.json(), spec, from, to, now);
        // Public evidence uses the public sample URL; never publish a private key.
        const sourceUrl = key === 'sample' ? url : ECOS_URL;
        fresh.push(...points.map(point => ({ ...point, sourceUrl })));
      }
      const merged = new Map((old?.points ?? []).filter(point => point.period >= periodOf(yyyymm(fullStart))).map(point => [point.period, point]));
      for (const point of fresh) merged.set(point.period, point);
      const points = withYearlyChanges([...merged.values()].sort((a, b) => a.period.localeCompare(b.period)));
      const volume = spec.kind === 'volume-index';
      series.push({
        id: spec.id, name: spec.name, kind: spec.kind, unit: '2020=100', chains: spec.chains,
        sourceId: 'bok-ecos', frequency: 'monthly', fetchedAt: checkedAt, checkedAt,
        definition: volume
          ? `한국은행 ${spec.itemName} 수출물량지수. 수출금액지수를 통관시차를 반영한 달러 기준 수출물가지수로 나누어 산출하며 품질 변동도 포함하는 물량 지표입니다. 칩 개수·출하 비트 수·순중량(kg)이 아니며 개별 기업 실적을 뜻하지 않습니다.`
          : `한국은행 ${spec.itemName} 달러 기준 수출금액지수(2020=100). 실제 달러 금액이 아니라 기준년 대비 지수입니다.`,
        tableCode: spec.table, itemCode: spec.item, points,
      });
      successes += 1;
    } catch (error) {
      // Preserve usable evidence with its original timestamp on a failed refresh.
      errors.push(`${spec.name}: ${error?.name === 'TimeoutError' ? '조회 시간 초과' : error.message}`);
      if (old) series.push({ ...old, refreshError: '공식 통계 갱신 실패 · 이전 수집값 유지', error: '공식 통계 갱신 실패 · 이전 수집값 유지' });
    }
  }
  const oldSource = (previous.sources ?? []).find(source => source.id === 'bok-ecos');
  const lastSuccessAt = successes ? checkedAt : oldSource?.checkedAt;
  const source = { id: 'bok-ecos', name: '한국은행 ECOS 수출입무역지수', url: ECOS_URL, ...(lastSuccessAt ? { checkedAt: lastSuccessAt } : {}), attemptedAt: checkedAt, apiMode: key === 'sample' ? 'public-sample-10-rows' : 'registered-key', note: '2020=100, 달러 기준. 당해 연도는 잠정치이며 이후 수정될 수 있습니다. 선박·무기류·항공기·예술품 등 가격조사 제외 품목이 빠져 관세청 전체 수출액·중량의 움직임과 다를 수 있습니다.' };
  return { sources: [source], series, gaps: [
    { id: 'customs-hs-weight', name: 'HS 품목별 수출금액·순중량', status: 'credential-required', sourceUrl: 'https://www.data.go.kr/data/15101609/openapi.do', message: '관세청 HS 품목별 kg·달러 API는 승인된 serviceKey가 필요합니다. 수출물량지수와 kg을 혼용하지 않습니다.', reason: '관세청 HS 품목별 kg·달러 API는 승인된 serviceKey가 필요합니다. 수출물량지수와 kg을 혼용하지 않습니다.' },
    ...errors.map((message, index) => ({ id: `ecos-error-${index}`, status: 'refresh-failed', message, reason: message })),
  ] };
}
